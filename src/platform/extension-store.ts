import { browser } from 'wxt/browser';
import type { Store } from '../core/storage';

/** Settings storage for the browser extension builds. */
export const extensionStore: Store = {
  async get(key) {
    return (await browser.storage.local.get(key))[key];
  },
  async set(key, value) {
    await browser.storage.local.set({ [key]: value });
  },
  onChange(key, listener) {
    browser.storage.onChanged.addListener((changes, area) => {
      const change = area === 'local' ? changes[key] : undefined;
      if (change) {
        listener(change.oldValue, change.newValue);
      }
    });
  },
};
