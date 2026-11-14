import type { Logger } from './log';
import type { Scope } from './scope';
import { createLogger } from './log';

/**
 * Hears events of the given types once the page's own listeners have had
 * them, and stops none of them. It listens on `window` as the event bubbles
 * back up, which comes after the listeners on the page's elements and on
 * `document`. When the page stopped the event on the way, or the event does
 * not bubble, the handler hears it on the next task instead. A listener on
 * `window` in the capture phase notes each event, so none is missed or heard
 * twice.
 *
 * Use it to answer what the page did with an event, where a capture
 * listener would act before the page has. A handler that throws is logged.
 *
 * Stops when `scope` is disposed, and drops the events still waiting.
 * Returns a function that stops it earlier.
 */
export function listenAfterPage<K extends keyof WindowEventMap>(
  scope: Scope,
  types: readonly K[],
  handler: (event: WindowEventMap[K]) => void,
  log: Logger = createLogger('listen-after-page'),
): () => void {
  if (scope.disposed) {
    return () => undefined;
  }
  /** Events seen on the way down that have not come back up yet. */
  const waiting = new Set<Event>();
  /** Hands over, on the next task, the events still waiting then. One for all of them. */
  let timer: ReturnType<typeof setTimeout> | undefined;

  const hand = (event: Event): void => {
    if (!waiting.delete(event)) {
      return;
    }
    try {
      handler(event as WindowEventMap[K]);
    } catch (error) {
      log.error(`could not handle a ${event.type} event`, error);
    }
  };
  const flush = (): void => {
    timer = undefined;
    for (const event of [...waiting]) {
      hand(event);
    }
  };
  const noted = (event: Event): void => {
    waiting.add(event);
    timer ??= setTimeout(flush, 0);
  };

  for (const type of types) {
    addEventListener(type, noted, { capture: true });
    addEventListener(type, hand);
  }
  return scope.add(() => {
    for (const type of types) {
      removeEventListener(type, noted, { capture: true });
      removeEventListener(type, hand);
    }
    clearTimeout(timer);
    waiting.clear();
  });
}
