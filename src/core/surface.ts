import type { Scope } from './scope';
import { addStyle } from './dom';
import { onUrlChange } from './navigation';
import { pageWatcher } from './page-watcher';

/** Attribute marking one of Facebook's elements that a feature is temporarily hiding. */
export const HIDDEN_ATTR = 'data-feed-sanity-hidden';
/** Attribute marking an element this project inserted into Facebook's DOM. */
export const OWN_ATTR = 'data-feed-sanity';

const SURFACE_STYLE_ID = 'feed_sanity_surface';
const SURFACE_HIDE_CSS = `[${HIDDEN_ATTR}="none"] { display: none !important; }`;

/**
 * Ref-counts for attributes managed by `markElement` and `hideElement`, so
 * multiple features or scopes can mark the same Facebook node without
 * clobbering each other when one of them tears down.
 */
const attrCounts = new WeakMap<Element, Map<string, number>>();

let hiddenCount = 0;
let removeHideStyle: (() => void) | undefined;

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
      element.removeAttribute(attribute);
    } else {
      map?.set(attribute, next);
    }
  });
}

/**
 * Hides a Facebook element via `data-feed-sanity-hidden="none"` while `scope`
 * is alive, restoring it automatically when the last scope hiding it disposes.
 * Leaves the node in the DOM so Facebook's React reconciliation and hidden
 * SPA navigation links keep working, and keeps a shared `display: none` rule
 * distinct from `video_scrubber`'s layout-preserving `visibility: hidden` mark.
 */
export function hideElement(scope: Scope, element: Element): () => void {
  if (scope.disposed) {
    return () => undefined;
  }
  if (hiddenCount === 0) {
    removeHideStyle = addStyle(SURFACE_STYLE_ID, SURFACE_HIDE_CSS);
  }
  hiddenCount++;
  const releaseMark = markElement(scope, element, HIDDEN_ATTR, 'none');
  return scope.add(() => {
    releaseMark();
    hiddenCount--;
    if (hiddenCount === 0) {
      removeHideStyle?.();
      removeHideStyle = undefined;
    }
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

const activeSlots = new Set<MountedSlot>();
let stopSlotWatch: (() => void) | undefined;
let slotCheckQueued = false;

function scheduleSlotCheck(): void {
  if (slotCheckQueued) {
    return;
  }
  slotCheckQueued = true;
  queueMicrotask(() => {
    slotCheckQueued = false;
    for (const slot of activeSlots) {
      if (!slot.element.isConnected && slot.anchor.isConnected) {
        placeSlot(slot.anchor, slot.placement, slot.element);
      }
    }
  });
}

function registerSlot(slot: MountedSlot): void {
  activeSlots.add(slot);
  stopSlotWatch ??= pageWatcher.watchTree({
    removed: scheduleSlotCheck,
  });
}

function unregisterSlot(slot: MountedSlot): void {
  activeSlots.delete(slot);
  if (activeSlots.size === 0) {
    stopSlotWatch?.();
    stopSlotWatch = undefined;
  }
}

/**
 * Mounts an `OWN` (`data-feed-sanity`) slot element relative to `anchor`,
 * re-attaching it via the shared `PageWatcher` if Facebook refills or mutates
 * the parent while `anchor` remains connected, and removing it on dispose.
 */
export function mountSlot<E extends Element>(
  scope: Scope,
  anchor: Element,
  placement: SlotPlacement,
  element: E,
): () => void {
  if (scope.disposed) {
    return () => undefined;
  }
  element.setAttribute(OWN_ATTR, '');
  placeSlot(anchor, placement, element);
  const entry: MountedSlot = { anchor, placement, element };
  registerSlot(entry);

  return scope.add(() => {
    unregisterSlot(entry);
    element.remove();
  });
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
    const want = matches(location);
    if (want && !active) {
      active = scope.child();
      setup(active);
    } else if (!want && active) {
      active.dispose();
      active = undefined;
    }
  };

  sync();
  const stopUrl = onUrlChange(sync);

  return scope.add(() => {
    stopped = true;
    stopUrl();
    active?.dispose();
    active = undefined;
  });
}
