import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import type { ToolbarButton } from '../platform/badge';
import { badgeListener } from '../platform/badge';
import {
  ensureSafariPageWorldScripts,
  safariPageWorldListener,
} from '../platform/safari-page-world';

export default defineBackground(() => {
  // Manifest V2, which the Firefox build uses, calls the toolbar button browserAction.
  // Toolbar clicks open `popup.html` directly via `default_popup`, so the background
  // script only updates per-tab failure badges and paused toolbar icons from content scripts.
  const action = (browser.action ?? browser.browserAction) as unknown as ToolbarButton;
  // On Firefox, passing `null` clears any per-tab paused override so manifest `theme_icons`
  // keeps auto-switching between light and dark browser toolbars.
  const listener =
    import.meta.env.BROWSER === 'firefox' ? badgeListener(action, null) : badgeListener(action);
  browser.runtime.onMessage.addListener(listener);

  // Safari does not support `world: 'MAIN'` in manifest `content_scripts`. Register
  // the 4 site MAIN-world scripts dynamically at `document_start` and also answer
  // cold-start fallback requests from tabs that were already open.
  if (import.meta.env.BROWSER === 'safari' && browser.scripting) {
    const syncScripts = (): void => {
      void ensureSafariPageWorldScripts(browser.scripting).catch(() => undefined);
    };
    syncScripts();
    browser.runtime.onInstalled.addListener(syncScripts);
    browser.runtime.onStartup.addListener(syncScripts);
    browser.runtime.onMessage.addListener(safariPageWorldListener(browser.scripting));
  }
});
