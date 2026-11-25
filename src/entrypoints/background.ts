import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { badgeListener } from '../platform/badge';

export default defineBackground(() => {
  // Manifest V2, which the Firefox build uses, calls the toolbar button browserAction.
  // Toolbar clicks open `popup.html` directly via `default_popup`, so the background
  // script only forwards per-tab failure badges from content scripts.
  const action = browser.action ?? browser.browserAction;
  browser.runtime.onMessage.addListener(badgeListener(action));
});
