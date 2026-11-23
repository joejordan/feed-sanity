/** True for a plain object, which is what saved settings should be. Stored data can be anything. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Stops a `Store.onChange` subscription when called. */
export type StoreUnsubscribe = () => void;

/**
 * Where settings are kept. The browser extension and the userscript each
 * supply their own, in `src/platform/`.
 */
export interface Store {
  get: (key: string) => Promise<unknown>;
  /** Optional native multi-key read to collapse startup storage IPC into one round-trip. */
  readonly getMany?: (keys: readonly string[]) => Promise<Record<string, unknown>>;
  set: (key: string, value: unknown) => Promise<void>;
  /**
   * Calls `listener` whenever the value under `key` is saved, by this tab or
   * another. A store that cannot see saves never calls it. May return an
   * unsubscribe function to release the underlying storage listener.
   */
  onChange: (
    key: string,
    listener: (oldValue: unknown, newValue: unknown) => void,
  ) => StoreUnsubscribe | void;
}

/** Reads `keys` in one native call when `store.getMany` exists, else concurrently via `get`. */
export async function readStoreMany(
  store: Store,
  keys: readonly string[],
): Promise<Record<string, unknown>> {
  if (keys.length === 0) {
    return {};
  }
  if (store.getMany) {
    return store.getMany(keys);
  }
  const entries = await Promise.all(keys.map(async (key) => [key, await store.get(key)] as const));
  return Object.fromEntries(entries);
}

export interface PreloadedStore extends Store {
  /** Drops any unconsumed preloaded entries so subsequent reads hit the live backing store. */
  readonly clear: () => void;
}

/**
 * Wraps `store` with a one-shot preloaded cache populated from `readStoreMany`.
 * Each preloaded key serves its first `get`/`getMany` without another storage
 * IPC hop; subsequent reads or writes pass straight through to `store`.
 */
export function createPreloadedStore(
  store: Store,
  preloaded: Readonly<Record<string, unknown>>,
): PreloadedStore {
  const cache = new Map<string, unknown>(Object.entries(preloaded));
  return {
    clear() {
      cache.clear();
    },
    async get(key) {
      if (cache.has(key)) {
        const value = cache.get(key);
        cache.delete(key);
        return value;
      }
      return store.get(key);
    },
    async getMany(keys) {
      const result: Record<string, unknown> = {};
      const missing: string[] = [];
      for (const key of keys) {
        if (cache.has(key)) {
          result[key] = cache.get(key);
          cache.delete(key);
        } else {
          missing.push(key);
        }
      }
      if (missing.length > 0) {
        Object.assign(result, await readStoreMany(store, missing));
      }
      return result;
    },
    async set(key, value) {
      cache.delete(key);
      return store.set(key, value);
    },
    onChange(key, listener) {
      return store.onChange(key, listener);
    },
  };
}
