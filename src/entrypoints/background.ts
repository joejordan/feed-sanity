import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { ACTIVE_ICON_PATHS, FIREFOX_TOOLBAR_ICON } from '../../project';
import { badgeListener } from '../platform/badge';

export default defineBackground(() => {
  // Manifest V2, which the Firefox build uses, calls the toolbar button browserAction.
  // Toolbar clicks open `popup.html` directly via `default_popup`, so the background
  // script only updates per-tab failure badges and paused toolbar icons from content scripts.
  const action = browser.action ?? browser.browserAction;
  const activeIcon =
    import.meta.env.BROWSER === 'firefox' ? FIREFOX_TOOLBAR_ICON : ACTIVE_ICON_PATHS;
  browser.runtime.onMessage.addListener(badgeListener(action, activeIcon));
});
