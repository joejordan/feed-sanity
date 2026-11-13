import { browser } from 'wxt/browser';
import type { Platform } from '../core/platform';
import { extensionStore } from './extension-store';
import { OPEN_OPTIONS } from './messages';

/** The browser extension builds. */
export const extensionPlatform: Platform = {
  store: extensionStore,
  onOpenOptions(listener) {
    browser.runtime.onMessage.addListener((message) => {
      if (message === OPEN_OPTIONS) {
        listener();
      }
    });
  },
};
