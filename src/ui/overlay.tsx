import type { ReactNode } from 'react';
import { callSafely } from '../core/listeners';
import { createLogger } from '../core/log';
import { pageWatcher } from '../core/page-watcher';
import { OWN } from '../facebook/selectors';
import { HOST_TAG, renderInShadow, stopAtHost } from './mount';

const log = createLogger('overlay');

/**
 * Presses and clicks inside an overlay stop at its host, so the page does
 * not act on them as well, for example by opening the video underneath.
 * Pointer moves go on, so the page still sees the pointer over its element
 * and shows its own controls.
 */
const PRESS_EVENTS = [
  'pointerdown',
  'pointerup',
  'mousedown',
  'mouseup',
  'click',
  'dblclick',
  'auxclick',
  'contextmenu',
  'touchstart',
  'touchend',
] as const;

/**
 * The host takes no room and no pointer events. `mountOverlay` sets its
 * place and size to the target's. Inside it, only elements that set
 * `pointer-events: auto` take the pointer.
 */
const HOST_STYLE =
  'display:block;position:absolute;left:0;top:0;width:0;height:0;margin:0;pointer-events:none';

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Overlay {
  readonly host: HTMLElement;
  readonly target: Element;
  readonly container: () => Element | null;
  readonly onMeasure: (() => void) | undefined;
  /** The element the host was last put in. */
  parent: Element | null;
  /**
   * The host's containing block, as last measured. When the container is
   * not positioned, this is an element further up, and the container can
   * move inside it without changing size. Its size is watched too.
   */
  anchor: Element | null;
  /** The host's place and size, as last set. */
  box: Box;
  /**
   * True when the target or the container changed size, or a measurement
   * was asked for, since `onMeasure` last ran. A move of the container
   * inside its containing block moves the target and its surroundings
   * alike, so it leaves `onMeasure` out.
   */
  reshaped: boolean;
}

const overlays = new Set<Overlay>();
/** The overlays placed by each element whose size is watched. */
const sizing = new Map<Element, Set<Overlay>>();
let resizes: ResizeObserver | undefined;
let stopWatching: (() => void) | undefined;
let checkQueued = false;

/** Reads where each target is, then moves the hosts, so the page is laid out once for all of them. */
function measure(list: Iterable<Overlay>): void {
  const moves: [Overlay, Box, Element | null][] = [];
  for (const overlay of list) {
    if (!overlay.host.isConnected) {
      continue;
    }
    const target = overlay.target.getBoundingClientRect();
    const host = overlay.host.getBoundingClientRect();
    const box = {
      left: overlay.box.left + target.left - host.left,
      top: overlay.box.top + target.top - host.top,
      width: target.width,
      height: target.height,
    };
    moves.push([overlay, box, overlay.host.offsetParent]);
    if (overlay.reshaped && overlay.onMeasure) {
      callSafely(log, overlay.onMeasure);
    }
    overlay.reshaped = false;
  }
  for (const [overlay, next, anchor] of moves) {
    const { host, box } = overlay;
    for (const key of ['left', 'top', 'width', 'height'] as const) {
      if (Math.abs(box[key] - next[key]) >= 0.5) {
        host.style[key] = `${next[key]}px`;
        box[key] = next[key];
      }
    }
    if (anchor !== overlay.anchor) {
      forgetAnchor(overlay);
      overlay.anchor = anchor;
      if (anchor && watchedForAnchor(overlay, anchor)) {
        observe(anchor, overlay);
      }
    }
  }
}

function resized(entries: ResizeObserverEntry[]): void {
  const affected = new Set<Overlay>();
  for (const { target } of entries) {
    for (const overlay of sizing.get(target) ?? []) {
      affected.add(overlay);
      if (target === overlay.target || target === overlay.parent) {
        overlay.reshaped = true;
      }
    }
  }
  measure(affected);
}

/**
 * Measures `overlay` again whenever `element` changes size, and once soon
 * when `element` was not observed yet.
 */
function observe(element: Element, overlay: Overlay): void {
  const users = sizing.get(element) ?? new Set();
  sizing.set(element, users);
  users.add(overlay);
  resizes ??= new ResizeObserver(resized);
  resizes.observe(element);
}

/**
 * Asks for a new report on `element` soon. Chrome and Firefox ignore a call
 * to observe an element that is observed already, so it is observed afresh.
 */
function reobserve(element: Element): void {
  resizes?.unobserve(element);
  resizes?.observe(element);
}

function unobserve(element: Element, overlay: Overlay): void {
  const users = sizing.get(element);
  users?.delete(overlay);
  if (users?.size === 0) {
    sizing.delete(element);
    resizes?.unobserve(element);
  }
}

/** True when `anchor` is watched only because it is the overlay's containing block. */
const watchedForAnchor = (overlay: Overlay, anchor: Element): boolean =>
  anchor !== overlay.parent && anchor !== overlay.target;

/** Stops watching the overlay's containing block, unless it is watched for another reason. */
function forgetAnchor(overlay: Overlay): void {
  const { anchor } = overlay;
  if (anchor && watchedForAnchor(overlay, anchor)) {
    unobserve(anchor, overlay);
  }
  overlay.anchor = null;
}

/** Puts the host in its container, unless it is there already. */
function place(overlay: Overlay): void {
  const container = overlay.container();
  if (!container || container === overlay.host.parentNode || !overlay.target.isConnected) {
    return;
  }
  container.append(overlay.host);
  forgetAnchor(overlay);
  if (overlay.parent) {
    unobserve(overlay.parent, overlay);
  }
  overlay.parent = container;
  overlay.reshaped = true;
  observe(container, overlay);
  observe(overlay.target, overlay);
  // The target, and the container, may have been observed already.
  reobserve(overlay.target);
}

/** Puts back each host that was removed, or left behind, while its target stays in the page. */
function check(): void {
  checkQueued = false;
  for (const overlay of overlays) {
    const { host, target } = overlay;
    if (target.isConnected && !(host.isConnected && host.parentNode?.contains(target))) {
      place(overlay);
    }
  }
}

/** Called for each change to the page. The check runs once, after the whole batch. */
function queueCheck(): void {
  if (!checkQueued) {
    checkQueued = true;
    queueMicrotask(check);
  }
}

export interface OverlayOptions {
  /**
   * The element the host goes in, as its last child. It must hold the
   * target. It is asked again each time the host has to be put back, and
   * defaults to the target's parent.
   */
  container?: () => Element | null;
  /** Style sheet for inside the shadow root, added after the shared themes. */
  css?: string;
  /**
   * Called each time the overlay is measured, while every overlay measured
   * with it is still being read. It may read the page's layout but must not
   * change the page; a state update in the UI, which renders later, is fine.
   */
  onMeasure?: () => void;
}

/** Removes the overlay when called. */
export interface MountedOverlay {
  (): void;
  /** Asks for the overlay to be measured again soon, as when something over the target moved. */
  measure: () => void;
}

/**
 * Renders `ui` in a shadow root laid over `target`, for UI that belongs on
 * one of Facebook's elements, such as a video.
 *
 * The host goes inside Facebook's own tree, as the last child of the
 * container, so it scrolls and moves with the target, is clipped where the
 * target is clipped, and stays under Facebook's sticky header and dialogs.
 * Its place and size are measured only when the target, the container or
 * the host's containing block changes size, or when asked to with
 * `measure`. It takes no pointer events itself, and presses, clicks and
 * keys inside it stop at the host.
 *
 * If Facebook removes the host, or moves the target out of the container,
 * the host is put back while the target is in the page. React leaves
 * elements it did not create alone, so the extra child does not disturb
 * Facebook's rendering.
 *
 * Returns a function that unmounts the UI and removes the host.
 */
export function mountOverlay(
  target: Element,
  ui: ReactNode,
  { container = () => target.parentElement, css = '', onMeasure }: OverlayOptions = {},
): MountedOverlay {
  const host = document.createElement(HOST_TAG);
  host.setAttribute(OWN, '');
  host.style.cssText = HOST_STYLE;
  stopAtHost(host, PRESS_EVENTS);
  const unmount = renderInShadow(host, ui, css);
  const overlay: Overlay = {
    host,
    target,
    container,
    onMeasure,
    parent: null,
    anchor: null,
    box: { left: 0, top: 0, width: 0, height: 0 },
    reshaped: true,
  };
  overlays.add(overlay);
  stopWatching ??= pageWatcher.watchTree({ added: queueCheck, removed: queueCheck });
  place(overlay);

  let removed = false;
  const remove = (): void => {
    if (removed) {
      return;
    }
    removed = true;
    overlays.delete(overlay);
    forgetAnchor(overlay);
    unobserve(target, overlay);
    if (overlay.parent) {
      unobserve(overlay.parent, overlay);
    }
    unmount();
    host.remove();
    if (overlays.size === 0) {
      stopWatching?.();
      stopWatching = undefined;
      resizes?.disconnect();
      resizes = undefined;
    }
  };
  return Object.assign(remove, {
    // A new report on the target measures it.
    measure: () => {
      if (!removed && overlay.parent) {
        overlay.reshaped = true;
        reobserve(target);
      }
    },
  });
}
