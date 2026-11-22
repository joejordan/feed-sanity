import type { Store } from './storage';

/** Minimal in-memory `Store` implementation for core unit tests. */
export function inMemoryStore(initial: Record<string, unknown> = {}): Store {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    get: (key) => Promise.resolve(data.get(key)),
    set: (key, value) => {
      data.set(key, value);
      return Promise.resolve();
    },
    onChange: () => () => undefined,
  };
}
