import { browser } from 'wxt/browser';
import { createLogger } from './log';

const log = createLogger('options');

export type OptionValue = boolean | number | string;

/** What a feature declares for each of its options. */
export interface OptionSpec {
  /** Heading the option appears under in the options dialog. */
  section: string;
  title: string;
  description: string;
  default: OptionValue;
}

export type OptionSpecs = Record<string, OptionSpec>;

type Widen<T> = T extends boolean
  ? boolean
  : T extends number
    ? number
    : T extends string
      ? string
      : never;

/** The value type of each option, taken from the type of its default. */
export type OptionValues<S extends OptionSpecs> = { [K in keyof S]: Widen<S[K]['default']> };

/** The options store as one feature sees it: only its own keys, with their value types. */
export interface FeatureOptions<S extends OptionSpecs> {
  get<K extends keyof S & string>(key: K): OptionValues<S>[K];
  set<K extends keyof S & string>(key: K, value: OptionValues<S>[K]): Promise<void>;
  /**
   * Calls `listener` with the current value, then again after every change.
   * Returns a function that stops the calls.
   */
  watch<K extends keyof S & string>(
    key: K,
    listener: (value: OptionValues<S>[K]) => void,
  ): () => void;
}

/** The saved object: option key to value, for the options that were changed. */
type Saved = Record<string, OptionValue>;

/**
 * Every feature's options, saved together as one object in extension storage.
 * A value that was never saved reads as the option's default.
 */
export class Options implements FeatureOptions<OptionSpecs> {
  readonly #storageKey: string;
  readonly #specs = new Map<string, OptionSpec>();
  readonly #listeners = new Map<string, Set<(value: OptionValue) => void>>();
  #saved: Saved = {};
  /** Saves made here that storage has not finished writing. */
  #pendingSaves = 0;
  #followsStorage = false;

  constructor(storageKey: string) {
    this.#storageKey = storageKey;
  }

  register(specs: OptionSpecs): void {
    for (const [key, spec] of Object.entries(specs)) {
      if (this.#specs.has(key)) {
        throw new Error(`Option '${key}' is defined twice`);
      }
      this.#specs.set(key, spec);
    }
  }

  /** Reads the saved values, and from then on follows saves made in other tabs. */
  async load(): Promise<void> {
    const found = await browser.storage.local.get(this.#storageKey);
    this.#saved = (found[this.#storageKey] as Saved | undefined) ?? {};
    if (this.#followsStorage) {
      return;
    }
    this.#followsStorage = true;
    browser.storage.onChanged.addListener((changes, area) => {
      const change = area === 'local' ? changes[this.#storageKey] : undefined;
      if (change) {
        this.#follow((change.oldValue ?? {}) as Saved, (change.newValue ?? {}) as Saved);
      }
    });
  }

  /** A saved value of the wrong type, such as one from an import, reads as the default. */
  get(key: string): OptionValue {
    const fallback = this.#spec(key).default;
    const saved = Object.hasOwn(this.#saved, key) ? this.#saved[key] : undefined;
    return saved !== undefined && typeof saved === typeof fallback ? saved : fallback;
  }

  async set(key: string, value: OptionValue): Promise<void> {
    if (this.get(key) === value) {
      return;
    }
    this.#saved[key] = value;
    this.#emit(key);
    this.#pendingSaves++;
    try {
      await browser.storage.local.set({ [this.#storageKey]: this.#saved });
    } finally {
      this.#pendingSaves--;
    }
  }

  watch(key: string, listener: (value: OptionValue) => void): () => void {
    this.#notify(key, listener, this.get(key));
    const listeners = this.#listeners.get(key) ?? new Set();
    this.#listeners.set(key, listeners);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  // Storage reports every save, including the ones made here. Only the keys
  // a save changed are taken over, so a report that arrives late does not
  // undo a value set since. While a save from here is on its way, its values
  // are the newer ones and the report is ignored.
  #follow(before: Saved, after: Saved): void {
    if (this.#pendingSaves > 0) {
      return;
    }
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const value = after[key];
      if (before[key] === value) {
        continue;
      }
      const known = this.#specs.has(key);
      const previous = known ? this.get(key) : undefined;
      if (value === undefined) {
        delete this.#saved[key];
      } else {
        this.#saved[key] = value;
      }
      if (known && this.get(key) !== previous) {
        this.#emit(key);
      }
    }
  }

  #emit(key: string): void {
    const value = this.get(key);
    for (const listener of this.#listeners.get(key) ?? []) {
      // A listener that set the option again has already told the others
      // the newer value.
      if (this.get(key) !== value) {
        return;
      }
      this.#notify(key, listener, value);
    }
  }

  // A listener is feature code. If it throws, report it and carry on, so the
  // value is still saved and the other listeners still run.
  #notify(key: string, listener: (value: OptionValue) => void, value: OptionValue): void {
    try {
      listener(value);
    } catch (error) {
      log.error(`a listener for '${key}' failed`, error);
    }
  }

  #spec(key: string): OptionSpec {
    const spec = this.#specs.get(key);
    if (!spec) {
      throw new Error(`Unknown option '${key}'`);
    }
    return spec;
  }
}
