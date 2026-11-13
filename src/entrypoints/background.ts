import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { OPEN_OPTIONS } from '../platform/messages';

export default defineBackground(() => {
  // Manifest V2, which the Firefox build uses, calls the toolbar button browserAction.
  const action = browser.action ?? browser.browserAction;
  action.onClicked.addListener((tab) => {
    if (tab.id === undefined) {
      return;
    }
    browser.tabs.sendMessage(tab.id, OPEN_OPTIONS).catch(() => {
      // Not a Facebook page, so nothing in the tab is listening.
    });
  });
});
