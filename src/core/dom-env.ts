import type { Logger } from './log';
import type { SlotPlacement } from './surface';
import { addStyle } from './dom';
import { callSafely, Listeners } from './listeners';
import { createLogger } from './log';
import { PageWatcher, pageWatcher } from './page-watcher';
import { Scope } from './scope';
import { hideElement, markElement, mountSlot, whileOnRoute } from './surface';

export interface DomEnvironmentOptions {
  /** Root document to observe (defaults to `globalThis.document`). */
  readonly doc?: Document;
  /** When true, also discovers open `ShadowRoot`s under `doc`. */
  readonly pierceShadow?: boolean;
  /** When true, discovers same-origin `<iframe>` documents and notifies `onIframe` listeners. */
  readonly includeIframes?: boolean;
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
  /** Subscribes to open `ShadowRoot`s discovered inside `doc` (when `pierceShadow` is enabled). */
  onShadowRoot: (listener: (root: ShadowRoot, rootScope: Scope) => void) => () => void;
  /** Subscribes to same-origin `<iframe>` child environments (when `includeIframes` is enabled). */
  onIframe: (listener: (childEnv: DomEnvironment, frame: HTMLIFrameElement) => void) => () => void;
  onUrlChange: (listener: () => void) => () => void;
  dispose: () => void;
}

/**
 * Creates a self-contained `DomEnvironment` bound to `doc`. Disposing it tears
 * down every child iframe environment, shadow scope, and watcher subscription.
 */
export function createDomEnvironment({
  doc = document,
  pierceShadow = false,
  includeIframes = false,
  log = createLogger('dom-env'),
}: DomEnvironmentOptions = {}): DomEnvironment {
  const envScope = new Scope(log);
  const watcher = doc === document ? pageWatcher : new PageWatcher(log, doc);

  const shadowRoots = new Set<ShadowRoot>();
  const shadowScopes = new Map<ShadowRoot, Scope>();
  const shadowListeners = new Listeners<[ShadowRoot, Scope]>(log);

  const iframeEnvs = new Map<HTMLIFrameElement, DomEnvironment>();
  const iframeLoadRemovers = new Map<HTMLIFrameElement, () => void>();
  const iframeListeners = new Listeners<[DomEnvironment, HTMLIFrameElement]>(log);

  const attachShadow = (root: ShadowRoot): void => {
    if (shadowRoots.has(root) || envScope.disposed) {
      return;
    }
    const rootScope = envScope.child();
    shadowRoots.add(root);
    shadowScopes.set(root, rootScope);
    const shadowWatcher = new PageWatcher(log, root);
    rootScope.add(
      shadowWatcher.watchTree({
        added: (el) => scanShadowSubtree(el),
        removed: () => pruneDisconnected(),
      }),
    );
    shadowListeners.emit(root, rootScope);
    // Scan inside this shadow root for nested open shadow roots (e.g. Lit / Shreddit).
    scanShadowSubtree(root);
  };

  const scanShadowSubtree = (root: ParentNode): void => {
    if (!pierceShadow || envScope.disposed) {
      return;
    }
    if (root instanceof Element && root.shadowRoot) {
      attachShadow(root.shadowRoot);
    }
    if (root.childElementCount === 0) {
      return;
    }
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) {
        attachShadow(el.shadowRoot);
      }
    }
  };

  const mountIframeEnv = (frame: HTMLIFrameElement): void => {
    if (!includeIframes || envScope.disposed) {
      return;
    }
    let childDoc: Document | null = null;
    try {
      childDoc = frame.contentDocument;
    } catch {
      // Cross-origin iframe; leave untouched.
      return;
    }
    const existing = iframeEnvs.get(frame);
    if (!childDoc || childDoc === doc) {
      if (existing) {
        iframeEnvs.delete(frame);
        existing.dispose();
      }
      return;
    }
    if (existing?.doc === childDoc) {
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
      log,
    });
    iframeEnvs.set(frame, childEnv);
    iframeListeners.emit(childEnv, frame);
  };

  const attachIframe = (frame: HTMLIFrameElement): void => {
    if (!includeIframes || envScope.disposed) {
      return;
    }
    if (!iframeLoadRemovers.has(frame)) {
      const onLoad = (): void => {
        if (frame.isConnected && !envScope.disposed) {
          mountIframeEnv(frame);
        }
      };
      frame.addEventListener('load', onLoad);
      iframeLoadRemovers.set(frame, () => frame.removeEventListener('load', onLoad));
    }
    mountIframeEnv(frame);
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
    scanShadowSubtree(doc);
  }
  if (includeIframes) {
    for (const frame of doc.querySelectorAll('iframe')) {
      attachIframe(frame);
    }
  }
  if (pierceShadow || includeIframes) {
    envScope.add(
      watcher.watchTree({
        added: (el) => {
          if (pierceShadow) {
            scanShadowSubtree(el);
          }
          if (includeIframes) {
            if (el instanceof HTMLIFrameElement) {
              attachIframe(el);
            } else if (el.childElementCount > 0) {
              for (const frame of el.querySelectorAll('iframe')) {
                attachIframe(frame);
              }
            }
          }
        },
        removed: () => pruneDisconnected(),
      }),
    );
  }

  envScope.add(() => {
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
  });

  const getLocation = (): Location => (doc.defaultView ?? globalThis).location;

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
    onShadowRoot(listener) {
      const remove = shadowListeners.add(listener);
      for (const root of shadowRoots) {
        const rootScope = shadowScopes.get(root);
        if (rootScope && !rootScope.disposed) {
          callSafely(log, listener, root, rootScope);
        }
      }
      return envScope.add(remove);
    },
    onIframe(listener) {
      const remove = iframeListeners.add(listener);
      for (const [frame, childEnv] of iframeEnvs) {
        callSafely(log, listener, childEnv, frame);
      }
      return envScope.add(remove);
    },
    onUrlChange: (listener) => envScope.add(watcher.onUrlChange(listener)),
    dispose() {
      envScope.dispose();
    },
  };
}
