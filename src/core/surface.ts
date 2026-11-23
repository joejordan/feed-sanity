import type { DomEnvironment } from './dom-env';
import type { PageWatcher } from './page-watcher';
import type { Scope } from './scope';
import { addStyle, isShadowRoot } from './dom';
import { pageWatcher } from './page-watcher';

/** Attribute marking one of Facebook's elements that a feature is temporarily hiding. */
export const HIDDEN_ATTR = 'data-feed-sanity-hidden';
/** Attribute marking an element this project inserted into Facebook's DOM. */
export const OWN_ATTR = 'data-feed-sanity';

const SURFACE_STYLE_ID = 'feed_sanity_surface';
const SURFACE_HIDE_CSS = `[${HIDDEN_ATTR}="none"] { display: none !important; }`;

/**
 * Ref-counts for attributes managed by `markElement` and `hideElement`, so
 * multiple features or scopes can mark the same host node without clobbering
 * each other when one of them tears down.
 */
const attrCounts = new WeakMap<Element, Map<string, number>>();

/**
 * Adds a `<style id="...">` sheet to either a `Document` or a `ShadowRoot`,
 * returning a remover.
 */
export function addRootStyle(root: Document | ShadowRoot, id: string, css: string): () => void {
  return addStyle(id, css, root);
}

const rootHideState = new WeakMap<Document | ShadowRoot, { count: number; remove: () => void }>();

function styleRootFor(element: Element): Document | ShadowRoot {
  const root = element.getRootNode();
  return isShadowRoot(root) ? root : (element.ownerDocument ?? document);
}

export interface StyleAcrossRootsOptions {
  readonly doc?: Document;
  readonly env?: Pick<DomEnvironment, 'doc' | 'onShadowRoot'>;
  /** Optional CSS variant for Shadow Roots (defaults to `lightCss`). */
  readonly shadowCss?: string;
}

/**
 * Adds a `<style id>` to the light document and, when `env` is provided,
 * mirrors it into every current and late-arriving open `ShadowRoot`. Cleans up
 * cleanly on `scope` disposal, individual Shadow Root disconnect, or calling
 * the returned remover.
 */
export function addStyleAcrossRoots(
  scope: Scope,
  id: string,
  lightCss: string,
  { doc, env, shadowCss = lightCss }: StyleAcrossRootsOptions = {},
): () => void {
  if (scope.disposed) {
    return () => undefined;
  }
  const styleScope = scope.child();
  styleScope.add(addStyle(id, lightCss, doc ?? env?.doc ?? document));
  if (env) {
    const shadowRemovers = new Set<() => void>();
    styleScope.add(
      env.onShadowRoot((shadow, rootScope) => {
        if (styleScope.disposed || rootScope.disposed) {
          return;
        }
        const removeStyle = addStyle(id, shadowCss, shadow);
        let unbindRoot: (() => void) | undefined;
        const cleanup = (): void => {
          shadowRemovers.delete(cleanup);
          unbindRoot?.();
          unbindRoot = undefined;
          removeStyle();
        };
        shadowRemovers.add(cleanup);
        unbindRoot = rootScope.add(cleanup);
      }),
    );
    styleScope.add(() => {
      for (const cleanup of [...shadowRemovers]) {
        cleanup();
      }
      shadowRemovers.clear();
    });
  }
  return () => styleScope.dispose();
}

/**
 * Sets `attribute` on `element` while `scope` is alive, ref-counted so
 * overlapping scopes do not remove it early. Uses attributes rather than
 * inline styles so all presentation stays in scoped CSS.
 */
export function markElement(
  scope: Scope,
  element: Element,
  attribute: string,
  value = '',
): () => void {
  if (scope.disposed) {
    return () => undefined;
  }
  let counts = attrCounts.get(element);
  if (!counts) {
    counts = new Map();
    attrCounts.set(element, counts);
  }
  const current = counts.get(attribute) ?? 0;
  counts.set(attribute, current + 1);
  if (current === 0 || element.getAttribute(attribute) !== value) {
    element.setAttribute(attribute, value);
  }

  return scope.add(() => {
    const map = attrCounts.get(element);
    const next = (map?.get(attribute) ?? 1) - 1;
    if (next <= 0) {
      map?.delete(attribute);
      if (map && map.size === 0) {
        attrCounts.delete(element);
      }
      element.removeAttribute(attribute);
    } else {
      map?.set(attribute, next);
    }
  });
}

/**
 * Hides a host element via `data-feed-sanity-hidden="none"` while `scope` is
 * alive, restoring it automatically when the last scope hiding it disposes.
 * Works in both light DOM and open Shadow Roots (injecting the shared rule
 * per root) and stays distinct from `video_scrubber`'s layout-preserving mark.
 */
export function hideElement(scope: Scope, element: Element): () => void {
  if (scope.disposed) {
    return () => undefined;
  }
  const root = styleRootFor(element);
  let state = rootHideState.get(root);
  if (!state) {
    state = { count: 0, remove: addRootStyle(root, SURFACE_STYLE_ID, SURFACE_HIDE_CSS) };
    rootHideState.set(root, state);
  }
  state.count++;
  const releaseMark = markElement(scope, element, HIDDEN_ATTR, 'none');
  return scope.add(() => {
    releaseMark();
    const cur = rootHideState.get(root);
    if (!cur) {
      return;
    }
    cur.count--;
    if (cur.count <= 0) {
      cur.remove();
      rootHideState.delete(root);
    }
  });
}

export interface ConcealRule {
  /** Style element ID. */
  readonly id: string;
  /** Attribute on `<html>` that enables concealment while present. */
  readonly activeAttr: string;
  /** CSS selector matching items that should stay hidden until checked. */
  readonly pendingSelector: string;
  /** Maximum milliseconds before the CSS `step-end` fail-safe reveals unchecked items. */
  readonly maxMs?: number;
}

/**
 * Installs a pre-paint CSS concealment rule with a `step-end` fail-safe
 * animation so newly inserted feed items or rows never flash before async
 * checks finish, yet automatically reveal after `maxMs` if untracked.
 * When `env` is supplied, also injects the rule into discovered open Shadow Roots.
 */
export function concealPending(
  scope: Scope,
  rule: ConcealRule,
  env?: Pick<DomEnvironment, 'doc' | 'onShadowRoot'>,
): () => void {
  if (scope.disposed) {
    return () => undefined;
  }
  const maxMs = rule.maxMs ?? 300;
  const keyframe = `${rule.id}_reveal`;
  const keyframes = `@keyframes ${keyframe} { 0% { opacity: 0; } 100% { opacity: 1; } }`;
  const lightCss = `html[${rule.activeAttr}] :is(${rule.pendingSelector}) { animation: ${keyframe} ${maxMs}ms step-end 1; } ${keyframes}`;
  const shadowCss = `${rule.pendingSelector} { animation: ${keyframe} ${maxMs}ms step-end 1; } ${keyframes}`;
  return addStyleAcrossRoots(scope, rule.id, lightCss, {
    ...(env ? { env } : {}),
    shadowCss,
  });
}

export type SlotPlacement = 'before' | 'after' | 'prepend' | 'append';

function isPlacedCorrectly(anchor: Element, placement: SlotPlacement, slot: Element): boolean {
  const parent = anchor.parentElement;
  switch (placement) {
    case 'before':
      return parent !== null && slot.parentElement === parent && slot.nextElementSibling === anchor;
    case 'after':
      return parent !== null && slot.parentElement === parent && anchor.nextElementSibling === slot;
    case 'prepend':
      return slot.parentElement === anchor && anchor.firstElementChild === slot;
    case 'append':
      return slot.parentElement === anchor && anchor.lastElementChild === slot;
  }
}

function placeSlot(anchor: Element, placement: SlotPlacement, slot: Element): void {
  if (!anchor.isConnected || isPlacedCorrectly(anchor, placement, slot)) {
    return;
  }
  switch (placement) {
    case 'before':
      anchor.before(slot);
      break;
    case 'after':
      anchor.after(slot);
      break;
    case 'prepend':
      anchor.prepend(slot);
      break;
    case 'append':
      anchor.append(slot);
      break;
  }
}

interface MountedSlot {
  readonly anchor: Element;
  readonly placement: SlotPlacement;
  readonly element: Element;
}

interface SlotWatcherState {
  readonly slots: Set<MountedSlot>;
  stop: (() => void) | undefined;
  queued: boolean;
}

const slotWatchers = new WeakMap<PageWatcher, SlotWatcherState>();

function scheduleSlotCheck(state: SlotWatcherState): void {
  if (state.queued) {
    return;
  }
  state.queued = true;
  queueMicrotask(() => {
    state.queued = false;
    for (const slot of state.slots) {
      if (!slot.element.isConnected && slot.anchor.isConnected) {
        placeSlot(slot.anchor, slot.placement, slot.element);
      }
    }
  });
}

function registerSlot(watcher: PageWatcher, slot: MountedSlot): void {
  let state = slotWatchers.get(watcher);
  if (!state) {
    state = { slots: new Set(), stop: undefined, queued: false };
    slotWatchers.set(watcher, state);
  }
  const targetState = state;
  targetState.slots.add(slot);
  targetState.stop ??= watcher.watchTree({
    removed: () => scheduleSlotCheck(targetState),
  });
}

function unregisterSlot(watcher: PageWatcher, slot: MountedSlot): void {
  const state = slotWatchers.get(watcher);
  if (!state) {
    return;
  }
  state.slots.delete(slot);
  if (state.slots.size === 0) {
    state.stop?.();
    state.stop = undefined;
    slotWatchers.delete(watcher);
  }
}

/**
 * Mounts an `OWN` (`data-feed-sanity`) slot element relative to `anchor`,
 * re-attaching it via `watcher` (defaults to the shared `pageWatcher`) if the
 * host refills or mutates the parent while `anchor` remains connected, and
 * removing it on dispose.
 */
export function mountSlot<E extends Element>(
  scope: Scope,
  anchor: Element,
  placement: SlotPlacement,
  element: E,
  watcher: PageWatcher = pageWatcher,
): () => void {
  if (scope.disposed) {
    return () => undefined;
  }
  element.setAttribute(OWN_ATTR, '');
  placeSlot(anchor, placement, element);
  const entry: MountedSlot = { anchor, placement, element };
  registerSlot(watcher, entry);

  return scope.add(() => {
    unregisterSlot(watcher, entry);
    element.remove();
  });
}

export interface RouteWatchOptions {
  readonly watcher?: PageWatcher;
  readonly getLocation?: () => Location;
}

/**
 * Runs `setup(subScope)` whenever the SPA URL satisfies `matches(location)`,
 * disposing `subScope` as soon as navigation leaves a matching route and
 * re-running if navigation enters one again.
 */
export function whileOnRoute(
  scope: Scope,
  matches: (url: Location) => boolean,
  setup: (routeScope: Scope) => void,
  { watcher = pageWatcher, getLocation = () => location }: RouteWatchOptions = {},
): () => void {
  if (scope.disposed) {
    return () => undefined;
  }
  let active: Scope | undefined;
  let stopped = false;

  const sync = (): void => {
    if (stopped) {
      return;
    }
    const want = matches(getLocation());
    if (want && !active) {
      active = scope.child();
      setup(active);
    } else if (!want && active) {
      active.dispose();
      active = undefined;
    }
  };

  sync();
  const stopUrl = watcher.onUrlChange(sync);

  return scope.add(() => {
    stopped = true;
    stopUrl();
    active?.dispose();
    active = undefined;
  });
}
