import { browser } from 'wxt/browser';
import type { Store } from '../core/storage';

/** Settings storage for the browser extension builds. */
export const extensionStore: Store = {
  async get(key) {
    return (await browser.storage.local.get(key))[key];
  },
  async getMany(keys) {
    if (keys.length === 0) {
      return {};
    }
    const raw = await browser.storage.local.get([...keys]);
    // Include every requested key (even when unset) so `createPreloadedStore`
    // caches absent keys without triggering follow-up IPC reads.
    return Object.fromEntries(keys.map((key) => [key, raw[key]]));
  },
  async set(key, value) {
    await browser.storage.local.set({ [key]: value });
  },
  onChange(key, listener) {
    const handler = (
      changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
      area: string,
    ): void => {
      const change = area === 'local' ? changes[key] : undefined;
      if (change) {
        listener(change.oldValue, change.newValue);
      }
    };
    browser.storage.onChanged.addListener(handler);
    return () => {
      browser.storage.onChanged.removeListener(handler);
    };
  },
};
