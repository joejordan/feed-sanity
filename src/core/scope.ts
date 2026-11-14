import type { Logger } from './log';
import { createLogger } from './log';

/**
 * Collects the cleanups for something that runs for a while, such as a
 * feature, so they can all be run at once when it stops.
 */
export class Scope {
  readonly #log: Logger;
  readonly #cleanups = new Set<() => void>();
  #disposed = false;

  constructor(log: Logger = createLogger('scope')) {
    this.#log = log;
  }

  /** True once `dispose` has been called. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * Runs `cleanup` when the scope is disposed, or at once if it already is.
   * Returns a function that runs it early. It runs once either way.
   */
  add(cleanup: () => void): () => void {
    if (this.#disposed) {
      this.#run(cleanup);
      return () => undefined;
    }
    // A wrapper of its own, so a function added twice runs twice.
    const entry = (): void => cleanup();
    this.#cleanups.add(entry);
    return () => {
      if (this.#cleanups.delete(entry)) {
        this.#run(cleanup);
      }
    };
  }

  /** A scope that is disposed with this one, and can be disposed earlier on its own. */
  child(): Scope {
    const child = new Scope(this.#log);
    child.add(this.add(() => child.dispose()));
    return child;
  }

  /**
   * Runs the cleanups, the last one added first. One that throws is logged
   * and the rest still run. Calling it again does nothing.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    const cleanups = [...this.#cleanups].reverse();
    this.#cleanups.clear();
    for (const cleanup of cleanups) {
      this.#run(cleanup);
    }
  }

  #run(cleanup: () => void): void {
    try {
      cleanup();
    } catch (error) {
      this.#log.error('a cleanup failed', error);
    }
  }
}
