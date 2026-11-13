import type { Logger } from './log';

/** Calls `listener`. If it throws, the error is logged and not passed on. */
export function callSafely<T extends unknown[]>(
  log: Logger,
  listener: (...args: T) => void,
  ...args: T
): void {
  try {
    listener(...args);
  } catch (error) {
    log.error('a listener failed', error);
  }
}

/**
 * A set of callbacks for one event. A callback that throws is logged and the
 * others still run, because callbacks are feature code and one broken feature
 * must not stop the rest.
 */
export class Listeners<T extends unknown[] = []> {
  readonly #listeners = new Set<(...args: T) => void>();
  readonly #log: Logger;

  constructor(log: Logger) {
    this.#log = log;
  }

  get size(): number {
    return this.#listeners.size;
  }

  /** Adds `listener` and returns a function that removes it. */
  add(listener: (...args: T) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  emit(...args: T): void {
    for (const listener of this.#listeners) {
      callSafely(this.#log, listener, ...args);
    }
  }
}
