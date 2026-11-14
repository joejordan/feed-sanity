import type { Store } from './storage';
import { Listeners } from './listeners';
import { createLogger } from './log';

const log = createLogger('saved');

/**
 * One value kept in the store under its own key, for data that is not an
 * option: a list the user builds, such as their post filters.
 *
 * `read` turns whatever the store holds into a usable value. It also gets
 * `undefined`, for nothing saved, and must not throw.
 */
export class Saved<T> {
  readonly #store: Store;
  readonly #key: string;
  readonly #read: (stored: unknown) => T;
  readonly #listeners = new Listeners<[T]>(log);
  #value: T;
  /** Saves made here that storage has not finished writing. */
  #pendingSaves = 0;
  /** True when the stored value could not be read. A save would then replace data nobody has seen. */
  #unread = false;

  /**
   * Settles once the saved value has been read. Until then `get` returns
   * what `read` makes of nothing, and a `set` would overwrite the stored value.
   */
  readonly ready: Promise<void>;

  constructor(store: Store, key: string, read: (stored: unknown) => T) {
    this.#store = store;
    this.#key = key;
    this.#read = read;
    this.#value = read(undefined);
    this.ready = this.#load();
  }

  get(): T {
    return this.#value;
  }

  async set(value: T): Promise<void> {
    if (this.#unread) {
      throw new Error(`'${this.#key}' could not be read, so it is not overwritten`);
    }
    this.#value = value;
    this.#listeners.emit(value);
    this.#pendingSaves++;
    try {
      await this.#store.set(this.#key, value);
    } finally {
      this.#pendingSaves--;
    }
  }

  /** Calls `listener` after every change, including saves made in other tabs. Returns a function that stops the calls. */
  onChange(listener: (value: T) => void): () => void {
    return this.#listeners.add(listener);
  }

  async #load(): Promise<void> {
    try {
      this.#value = this.#read(await this.#store.get(this.#key));
    } catch (error) {
      this.#unread = true;
      log.error(`could not read '${this.#key}'`, error);
    }
    this.#listeners.emit(this.#value);
    this.#store.onChange(this.#key, (_before, after) => {
      // While a save from here is on its way, its value is the newer one.
      // The store also reports saves made here, which change nothing.
      const value = this.#read(after);
      if (this.#pendingSaves === 0 && JSON.stringify(value) !== JSON.stringify(this.#value)) {
        this.#value = value;
        this.#listeners.emit(value);
      }
    });
  }
}

/** The saved values of one user, each under `<prefix>/<name>` in the store. */
export class SavedData {
  readonly #store: Store;
  readonly #prefix: string;
  readonly #values = new Map<string, Saved<unknown>>();

  constructor(store: Store, prefix: string) {
    this.#store = store;
    this.#prefix = prefix;
  }

  /**
   * The value saved under `name`. Every caller asking for the same name gets
   * the same object, so a change made by one is seen by the others.
   */
  value<T>(name: string, read: (stored: unknown) => T): Saved<T> {
    let saved = this.#values.get(name);
    if (!saved) {
      saved = new Saved<unknown>(this.#store, `${this.#prefix}/${name}`, read);
      this.#values.set(name, saved);
    }
    return saved as Saved<T>;
  }
}
