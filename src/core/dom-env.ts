import type { Logger } from './log';
import type { Watch, WatchHandlers } from './page-watcher';
import type { SlotPlacement } from './surface';
import { SHADOW_ATTACHED_EVENT } from '../engines/shadow';
import { addStyle } from './dom';
import { callSafely, Listeners } from './listeners';
import { createLogger } from './log';
import { PageWatcher, pageWatcher } from './page-watcher';
import { Scope } from './scope';
import { hideElement, isOwnUiElement, markElement, mountSlot, whileOnRoute } from './surface';

export interface DomEnvironmentOptions {
  /** Root document to observe (defaults to `globalThis.document`). */
  readonly doc?: Document;
  /** When true, also discovers open `ShadowRoot`s under `doc`. */
  readonly pierceShadow?: boolean;
  /** When true, discovers same-origin `<iframe>` documents and notifies `onIframe` listeners. */
  readonly includeIframes?: boolean;
  /** Whether background shadow/iframe scanning starts active (default `true`). */
  readonly active?: boolean;
  readonly log?: Logger;
}

/**
 * Document-scoped DOM runtime replacing ad-hoc globals. Reuses the shared
 * `pageWatcher` on the main document (creating a document-scoped `PageWatcher`
 * only for same-origin iframes), making multi-document apps (such as Gmail)
 * and isolated unit tests clean and leak-free.
 */
export interface DomEnvironment {
  readonly doc: Document;
  readonly scope: Scope;
  readonly watcher: PageWatcher;
  readonly shadowRoots: ReadonlySet<ShadowRoot>;
  /** Injects a scoped `<style>` into `doc` (or a specific `ShadowRoot`), removed on `scope` dispose. */
  addStyle: (scope: Scope, id: string, css: string, root?: Document | ShadowRoot) => () => void;
  markElement: (scope: Scope, element: Element, attribute: string, value?: string) => () => void;
  hideElement: (scope: Scope, element: Element) => () => void;
  mountSlot: <E extends Element>(
    scope: Scope,
    anchor: Element,
    placement: SlotPlacement,
    element: E,
  ) => () => void;
  whileOnRoute: (
    scope: Scope,
    matches: (url: Location) => boolean,
    setup: (routeScope: Scope) => void,
  ) => () => void;
  /** Queries light DOM and, when `pierceShadow` is enabled, every discovered open Shadow Root. */
  queryAll: <E extends Element = Element>(selector: string) => E[];
  /**
   * Watches elements matching `selector` across light DOM and, when
   * `pierceShadow` is enabled, every current and late-arriving open Shadow Root.
   */
  watch: PageWatcher['watch'];
  /** Subscribes to open `ShadowRoot`s discovered inside `doc` (when `pierceShadow` is enabled). */
  onShadowRoot: (listener: (root: ShadowRoot, rootScope: Scope) => void) => () => void;
  /** Returns the shared `PageWatcher` owned by this environment for a discovered `ShadowRoot`. */
  shadowWatcherOf: (root: ShadowRoot) => PageWatcher | undefined;
  /** Immediately scans `doc` and discovered Shadow Roots for newly attached open Shadow Roots. */
  scanShadowRoots: () => void;
  /** Subscribes to same-origin `<iframe>` child environments (when `includeIframes` is enabled). */
  onIframe: (listener: (childEnv: DomEnvironment, frame: HTMLIFrameElement) => void) => () => void;
  onUrlChange: (listener: () => void) => () => void;
  /** Pauses or resumes background shadow/iframe discovery without disposing listeners. */
  setActive: (active: boolean) => void;
  dispose: () => void;
}

const SHADOW_RESCAN_INTERVAL_MS = 150;
const SHADOW_CANDIDATE_TTL_MS = 3000;
const MAX_PENDING_SHADOW_CANDIDATES = 120;

/**
 * Only custom elements (`*-*`) and empty mount-point containers (`div`/`section`/`aside`
 * with zero children) are plausible asynchronous Shadow DOM hosts before `attachShadow()`.
 * Skipping already-populated layout divs prevents queuing thousands of RNW/StyleX wrappers.
 */
function isShadowHostCandidate(el: Element): boolean {
  if (el.shadowRoot || isOwnUiElement(el)) {
    return false;
  }
  const tag = el.localName;
  if (tag.includes('-')) {
    return true;
  }
  return el.childElementCount === 0 && (tag === 'div' || tag === 'section' || tag === 'aside');
}

/**
 * Creates a self-contained `DomEnvironment` bound to `doc`. Disposing it tears
 * down every child iframe environment, shadow scope, and watcher subscription.
 */
export function createDomEnvironment({
  doc = document,
  pierceShadow = false,
  includeIframes = false,
  active: initialActive = true,
  log = createLogger('dom-env'),
}: DomEnvironmentOptions = {}): DomEnvironment {
  const envScope = new Scope(log);
  const watcher = doc === document ? pageWatcher : new PageWatcher(log, doc);
  let active = initialActive;

  const shadowRoots = new Set<ShadowRoot>();
  const shadowScopes = new Map<ShadowRoot, Scope>();
  const shadowWatchers = new Map<ShadowRoot, PageWatcher>();
  const shadowListeners = new Listeners<[ShadowRoot, Scope]>(log);
  // Tracks recently inserted host candidates (`Element -> expiry timestamp`) to catch
  // open ShadowRoots attached asynchronously after mount (e.g. X Chat / Calls), since
  // `attachShadow()` does not emit a document MutationObserver record.
  const pendingShadowCandidates = new Map<Element, number>();
  let shadowRescanTimer: ReturnType<typeof setTimeout> | undefined;
  let urlScanPending = false;
  let directShadowHookActive = false;

  const iframeEnvs = new Map<HTMLIFrameElement, DomEnvironment>();
  const iframeLoadRemovers = new Map<HTMLIFrameElement, () => void>();
  const iframeListeners = new Listeners<[DomEnvironment, HTMLIFrameElement]>(log);

  const armShadowRescan = (): void => {
    if (!pierceShadow || !active || envScope.disposed || shadowRescanTimer !== undefined) {
      return;
    }
    shadowRescanTimer = setTimeout(() => {
      shadowRescanTimer = undefined;
      flushShadowCandidates();
    }, SHADOW_RESCAN_INTERVAL_MS);
  };

  const flushShadowCandidates = (): void => {
    if (!pierceShadow || !active || envScope.disposed) {
      return;
    }
    const now = Date.now();
    if (urlScanPending) {
      urlScanPending = false;
      if (!directShadowHookActive) {
        scanShadowSubtree(doc);
      }
    }
    for (const [candidate, expiresAt] of pendingShadowCandidates) {
      if (!candidate.isConnected) {
        pendingShadowCandidates.delete(candidate);
        continue;
      }
      if (candidate.shadowRoot) {
        pendingShadowCandidates.delete(candidate);
        attachShadow(candidate.shadowRoot);
        continue;
      }
      if (now >= expiresAt) {
        pendingShadowCandidates.delete(candidate);
      }
    }
    if (pendingShadowCandidates.size > 0) {
      armShadowRescan();
    }
  };

  const resetPendingShadowScan = (): void => {
    if (shadowRescanTimer !== undefined) {
      clearTimeout(shadowRescanTimer);
      shadowRescanTimer = undefined;
    }
    urlScanPending = false;
    pendingShadowCandidates.clear();
  };

  let pruneQueued = false;
  const schedulePrune = (): void => {
    if (
      pruneQueued ||
      !active ||
      envScope.disposed ||
      (shadowRoots.size === 0 && iframeLoadRemovers.size === 0)
    ) {
      return;
    }
    pruneQueued = true;
    queueMicrotask(() => {
      pruneQueued = false;
      if (active && !envScope.disposed) {
        pruneDisconnected();
      }
    });
  };
  const onRemovedForPrune = (el: Element): void => {
    if (!active) {
      return;
    }
    if (
      el.childElementCount > 0 ||
      el.shadowRoot ||
      (includeIframes && el.localName === 'iframe')
    ) {
      schedulePrune();
    }
  };

  const attachShadow = (root: ShadowRoot): void => {
    if (!active || shadowRoots.has(root) || envScope.disposed) {
      return;
    }
    const rootScope = envScope.child();
    shadowRoots.add(root);
    shadowScopes.set(root, rootScope);
    const shadowWatcher = new PageWatcher(log, root);
    shadowWatchers.set(root, shadowWatcher);
    rootScope.add(() => {
      shadowWatchers.delete(root);
    });
    rootScope.add(
      shadowWatcher.watchTree({
        added: (el) => scanShadowSubtree(el, true),
        removed: onRemovedForPrune,
      }),
    );
    shadowListeners.emit(root, rootScope);
    // Scan inside this shadow root for nested open shadow roots (e.g. Lit / Shreddit)
    // and collect already-present nested host candidates that may attach asynchronously.
    scanShadowSubtree(root, true);
  };

  const scanShadowSubtree = (root: ParentNode, collectCandidates = false): void => {
    if (!pierceShadow || !active || envScope.disposed) {
      return;
    }
    if (root.nodeType === Node.ELEMENT_NODE && isOwnUiElement(root as Element)) {
      return;
    }
    const shouldCollect = collectCandidates && !directShadowHookActive;
    const expiresAt = shouldCollect ? Date.now() + SHADOW_CANDIDATE_TTL_MS : 0;
    let queued = false;
    const visit = (el: Element): void => {
      if (el.shadowRoot) {
        attachShadow(el.shadowRoot);
      } else if (
        shouldCollect &&
        pendingShadowCandidates.size < MAX_PENDING_SHADOW_CANDIDATES &&
        isShadowHostCandidate(el)
      ) {
        pendingShadowCandidates.set(el, expiresAt);
        queued = true;
      }
    };
    if (root.nodeType === Node.ELEMENT_NODE) {
      visit(root as Element);
    }
    if (root.childElementCount > 0) {
      // Walk descendants iteratively via linked sibling pointers (no live HTMLCollection
      // allocation) so own UI subtrees are pruned immediately without scanning descendants.
      const stack: Element[] = [];
      for (let child = root.lastElementChild; child; child = child.previousElementSibling) {
        stack.push(child);
      }
      while (stack.length > 0) {
        const el = stack.pop();
        if (!el || isOwnUiElement(el)) {
          continue;
        }
        visit(el);
        for (let child = el.lastElementChild; child; child = child.previousElementSibling) {
          stack.push(child);
        }
      }
    }
    if (queued) {
      armShadowRescan();
    }
  };

  const mountIframeEnv = (frame: HTMLIFrameElement, reloaded = false): void => {
    if (!includeIframes || envScope.disposed) {
      return;
    }
    let childDoc: Document | null = null;
    try {
      childDoc = frame.contentDocument;
    } catch {
      // Cross-origin navigation: keep `childDoc = null` so any prior `existing`
      // same-origin child environment is disposed below.
    }
    const existing = iframeEnvs.get(frame);
    if (!childDoc || childDoc === doc) {
      if (existing) {
        iframeEnvs.delete(frame);
        existing.dispose();
      }
      return;
    }
    if (!reloaded && existing?.doc === childDoc) {
      return;
    }
    if (existing) {
      iframeEnvs.delete(frame);
      existing.dispose();
    }
    const childEnv = createDomEnvironment({
      doc: childDoc,
      pierceShadow,
      includeIframes: false,
      active,
      log,
    });
    iframeEnvs.set(frame, childEnv);
    iframeListeners.emit(childEnv, frame);
  };

  const attachIframe = (frame: HTMLIFrameElement): void => {
    if (!includeIframes || !active || envScope.disposed) {
      return;
    }
    if (!iframeLoadRemovers.has(frame)) {
      const onLoad = (): void => {
        if (active && frame.isConnected && !envScope.disposed) {
          mountIframeEnv(frame, true);
        }
      };
      frame.addEventListener('load', onLoad);
      iframeLoadRemovers.set(frame, () => frame.removeEventListener('load', onLoad));
    }
    mountIframeEnv(frame, false);
  };

  const pruneDisconnected = (): void => {
    if (pierceShadow && shadowRoots.size > 0) {
      for (const root of shadowRoots) {
        if (!root.host.isConnected) {
          shadowRoots.delete(root);
          shadowScopes.get(root)?.dispose();
          shadowScopes.delete(root);
        }
      }
    }
    if (includeIframes && (iframeEnvs.size > 0 || iframeLoadRemovers.size > 0)) {
      for (const [frame, removeLoad] of iframeLoadRemovers) {
        if (!frame.isConnected) {
          removeLoad();
          iframeLoadRemovers.delete(frame);
          const childEnv = iframeEnvs.get(frame);
          if (childEnv) {
            iframeEnvs.delete(frame);
            childEnv.dispose();
          }
        }
      }
    }
  };

  if (pierceShadow) {
    if (active) {
      scanShadowSubtree(doc, true);
    }
    const onDirectShadowAttached = (event: Event): void => {
      if (!active || envScope.disposed) {
        return;
      }
      if (!directShadowHookActive) {
        directShadowHookActive = true;
        // Flush any candidates that already attached a ShadowRoot during boot before the hook activated.
        for (const candidate of pendingShadowCandidates.keys()) {
          if (candidate.isConnected && candidate.shadowRoot) {
            attachShadow(candidate.shadowRoot);
          }
        }
        resetPendingShadowScan();
      }
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
      // Discover any enclosing ShadowRoots along the composed path that attached before the hook was active.
      for (let i = path.length - 1; i >= 0; i--) {
        const node = path[i];
        if (node instanceof ShadowRoot && !isOwnUiElement(node.host)) {
          attachShadow(node);
        }
      }
      const target = path[0] ?? event.target;
      if (target instanceof Element && target.shadowRoot && !isOwnUiElement(target)) {
        attachShadow(target.shadowRoot);
      }
    };
    doc.addEventListener(SHADOW_ATTACHED_EVENT, onDirectShadowAttached, { capture: true });
    envScope.add(() =>
      doc.removeEventListener(SHADOW_ATTACHED_EVENT, onDirectShadowAttached, { capture: true }),
    );
    envScope.add(
      watcher.onUrlChange(() => {
        if (active && !directShadowHookActive) {
          urlScanPending = true;
          armShadowRescan();
        }
      }),
    );
  }
  if (includeIframes && active) {
    for (const frame of doc.querySelectorAll('iframe')) {
      attachIframe(frame);
    }
  }
  if (pierceShadow || includeIframes) {
    envScope.add(
      watcher.watchTree({
        added: (el) => {
          if (!active) {
            return;
          }
          if (pierceShadow) {
            scanShadowSubtree(el, true);
          }
          if (includeIframes) {
            if (el.localName === 'iframe') {
              attachIframe(el as HTMLIFrameElement);
            } else if (el.childElementCount > 0) {
              for (const frame of el.querySelectorAll('iframe')) {
                attachIframe(frame);
              }
            }
          }
        },
        removed: onRemovedForPrune,
      }),
    );
  }

  envScope.add(() => {
    resetPendingShadowScan();
    for (const removeLoad of iframeLoadRemovers.values()) {
      removeLoad();
    }
    iframeLoadRemovers.clear();
    for (const childEnv of iframeEnvs.values()) {
      childEnv.dispose();
    }
    iframeEnvs.clear();
    shadowRoots.clear();
    shadowScopes.clear();
    shadowWatchers.clear();
  });

  const getLocation = (): Location => (doc.defaultView ?? globalThis).location;

  const onShadowRoot: DomEnvironment['onShadowRoot'] = (listener) => {
    const remove = shadowListeners.add(listener);
    for (const root of shadowRoots) {
      const rootScope = shadowScopes.get(root);
      if (rootScope && !rootScope.disposed) {
        callSafely(log, listener, root, rootScope);
      }
    }
    return envScope.add(remove);
  };

  const watch: PageWatcher['watch'] = (selector, handlers, options) => {
    const lightWatch = watcher.watch(selector, handlers, options);
    if (!pierceShadow) {
      return lightWatch;
    }

    let stopped = false;
    const subWatches = new Map<ShadowRoot, { stop: () => void; refresh: () => void }>();

    const attachRootWatch = (root: ShadowRoot, rootScope: Scope): void => {
      if (stopped || rootScope.disposed || subWatches.has(root)) {
        return;
      }
      const shadowWatcher = shadowWatchers.get(root);
      if (!shadowWatcher) {
        return;
      }
      const tracked = new Set<Element>();
      const wrappedHandlers: WatchHandlers = {
        added: (el) => {
          if (stopped) {
            return;
          }
          tracked.add(el);
          handlers.added?.(el);
        },
        removed: (el) => {
          if (stopped) {
            return;
          }
          tracked.delete(el);
          handlers.removed?.(el);
        },
        ...(handlers.changed
          ? {
              changed: (el, attr) => {
                if (!stopped) {
                  handlers.changed?.(el, attr);
                }
              },
            }
          : {}),
      };
      const subWatch: Watch = shadowWatcher.watch(selector, wrappedHandlers, options);
      // A one-shot `handlers.added` callback may have called `stop()` re-entrantly
      // during `shadowWatcher.watch`'s synchronous initial sweep.
      if (stopped) {
        subWatch();
        tracked.clear();
        return;
      }
      const cleanup = (): void => {
        subWatches.delete(root);
        subWatch();
      };
      const unbindScope = rootScope.add(() => {
        cleanup();
        // When a Shadow Host disconnects from light DOM, notify `removed` for
        // elements that were still tracked inside its Shadow Tree.
        if (!stopped && handlers.removed) {
          for (const el of tracked) {
            callSafely(log, handlers.removed, el);
          }
        }
        tracked.clear();
      });
      subWatches.set(root, {
        stop: () => {
          unbindScope();
          cleanup();
          tracked.clear();
        },
        refresh: () => subWatch.refresh(),
      });
    };

    const stopShadows = onShadowRoot(attachRootWatch);
    return Object.assign(
      () => {
        if (stopped) {
          return;
        }
        stopped = true;
        stopShadows();
        lightWatch();
        for (const entry of [...subWatches.values()]) {
          entry.stop();
        }
        subWatches.clear();
      },
      {
        refresh: () => {
          lightWatch.refresh();
          for (const entry of subWatches.values()) {
            entry.refresh();
          }
        },
      },
    );
  };

  const scanAllShadowRoots = (collectCandidates: boolean): void => {
    if (!pierceShadow || !active || envScope.disposed) {
      return;
    }
    // Snapshot existing roots first so newly attached roots discovered during
    // `scanShadowSubtree(doc, ...)` are not scanned a second time.
    const existingRoots = [...shadowRoots];
    scanShadowSubtree(doc, collectCandidates);
    for (const root of existingRoots) {
      if (root.host.isConnected) {
        scanShadowSubtree(root, collectCandidates);
      }
    }
  };

  return {
    doc,
    scope: envScope,
    watcher,
    shadowRoots,
    addStyle: (scope, id, css, root = doc) => scope.add(addStyle(id, css, root)),
    markElement,
    hideElement,
    mountSlot: (scope, anchor, placement, element) =>
      mountSlot(scope, anchor, placement, element, watcher),
    whileOnRoute: (scope, matches, setup) =>
      whileOnRoute(scope, matches, setup, { watcher, getLocation }),
    queryAll<E extends Element = Element>(selector: string): E[] {
      const results: E[] = [...doc.querySelectorAll<E>(selector)];
      if (pierceShadow) {
        for (const root of shadowRoots) {
          results.push(...root.querySelectorAll<E>(selector));
        }
      }
      return results;
    },
    watch,
    onShadowRoot,
    shadowWatcherOf: (root) => shadowWatchers.get(root),
    scanShadowRoots: () => scanAllShadowRoots(false),
    onIframe(listener) {
      const remove = iframeListeners.add(listener);
      for (const [frame, childEnv] of iframeEnvs) {
        callSafely(log, listener, childEnv, frame);
      }
      return envScope.add(remove);
    },
    onUrlChange: (listener) => envScope.add(watcher.onUrlChange(listener)),
    setActive(next: boolean) {
      if (next === active || envScope.disposed) {
        return;
      }
      active = next;
      if (!active) {
        resetPendingShadowScan();
        for (const childEnv of iframeEnvs.values()) {
          childEnv.setActive(false);
        }
        return;
      }
      pruneDisconnected();
      for (const childEnv of iframeEnvs.values()) {
        childEnv.setActive(true);
      }
      scanAllShadowRoots(true);
      if (includeIframes) {
        for (const frame of doc.querySelectorAll('iframe')) {
          attachIframe(frame);
        }
      }
    },
    dispose() {
      envScope.dispose();
    },
  };
}
