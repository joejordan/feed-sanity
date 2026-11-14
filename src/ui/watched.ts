import type { Logger } from '../core/log';
import { Listeners } from '../core/listeners';

/**
 * A value that can change, with a way to hear when it does. It fits React's
 * `useSyncExternalStore`: `subscribe` returns a function that stops it.
 */
export interface Watched<T> {
  get: () => T;
  subscribe: (onChange: () => void) => () => void;
}

/** A value a feature keeps for its UI to follow. `set` tells every subscriber. */
export function watchedValue<T>(initial: T, log: Logger): Watched<T> & { set: (value: T) => void } {
  const listeners = new Listeners(log);
  let value = initial;
  return {
    get: () => value,
    subscribe: (listener) => listeners.add(listener),
    set: (next) => {
      value = next;
      listeners.emit();
    },
  };
}
