import type { Store } from './storage';

/** Reactive in-memory `Store` implementation for core unit tests. */
export function inMemoryStore(initial: Record<string, unknown> = {}): Store {
  const data = new Map<string, unknown>(Object.entries(initial));
  const listeners = new Map<string, Set<(oldValue: unknown, newValue: unknown) => void>>();
  return {
    get: (key) => Promise.resolve(data.get(key)),
    set: (key, value) => {
      const prev = data.get(key);
      data.set(key, value);
      for (const listener of [...(listeners.get(key) ?? [])]) {
        listener(prev, value);
      }
      return Promise.resolve();
    },
    onChange: (key, listener) => {
      let bucket = listeners.get(key);
      if (!bucket) {
        bucket = new Set();
        listeners.set(key, bucket);
      }
      bucket.add(listener);
      return () => {
        bucket.delete(listener);
        if (bucket.size === 0) {
          listeners.delete(key);
        }
      };
    },
  };
}
