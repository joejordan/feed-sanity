/** True for a plain object, which is what saved settings should be. Stored data can be anything. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Where settings are kept. The browser extension and the userscript each
 * supply their own, in `src/platform/`.
 */
export interface Store {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<void>;
  /**
   * Calls `listener` whenever the value under `key` is saved, by this tab or
   * another. A store that cannot see saves never calls it.
   */
  onChange: (key: string, listener: (oldValue: unknown, newValue: unknown) => void) => void;
}
