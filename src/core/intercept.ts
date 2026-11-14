import type { Logger } from './log';
import type { Scope } from './scope';
import { createLogger } from './log';

/**
 * The events of one press of a pointer, for a handler that keeps a whole
 * press from the page once it has settled on the first event, so the page
 * is never left half way through a press it did not see end.
 */
export const PRESS_EVENTS = [
  'pointerdown',
  'touchstart',
  'mousedown',
  'pointerup',
  'touchend',
  'mouseup',
  'click',
  'pointercancel',
] as const;

/** True for a press of the main button with no modifier key held. */
export const isPlainPress = (event: MouseEvent): boolean =>
  event.button === 0 && !(event.altKey || event.ctrlKey || event.metaKey || event.shiftKey);

/**
 * Hears events of the given types on `window` in the capture phase, which
 * comes before every listener on the page's elements and on `document`.
 * Only listeners on `window` that were added earlier hear the event first.
 *
 * When `handler` returns true, the event goes no further: no other
 * listener hears it, including later ones on `window`. The handler calls
 * `preventDefault` itself when the browser's own action should not happen
 * either. A handler that throws is logged and the event goes on.
 *
 * Stops when `scope` is disposed. Returns a function that stops it earlier.
 */
export function intercept<K extends keyof WindowEventMap>(
  scope: Scope,
  types: readonly K[],
  handler: (event: WindowEventMap[K]) => boolean,
  log: Logger = createLogger('intercept'),
): () => void {
  const listener = (event: Event): void => {
    let stop = false;
    try {
      stop = handler(event as WindowEventMap[K]);
    } catch (error) {
      log.error(`could not handle a ${event.type} event`, error);
    }
    if (stop) {
      event.stopImmediatePropagation();
    }
  };
  if (scope.disposed) {
    return () => undefined;
  }
  for (const type of types) {
    addEventListener(type, listener, { capture: true });
  }
  return scope.add(() => {
    for (const type of types) {
      removeEventListener(type, listener, { capture: true });
    }
  });
}
