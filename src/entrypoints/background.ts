import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import type { ToolbarButton } from '../platform/badge';
import { attachExistingTabs, attachTabListener } from '../platform/auto-attach';
import { badgeListener } from '../platform/badge';
import { PING_RUNTIME } from '../platform/messages';
import {
  ensureSafariPageWorldScripts,
  safariPageWorldListener,
} from '../platform/safari-page-world';

const BOOT_ATTACH_SESSION_KEY = 'feed-sanity/boot-attached';

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

  // Liveness ping used by content scripts to authenticate cross-world teardown
  // events so untrusted host-page scripts cannot spoof instance replacement.
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message === PING_RUNTIME) {
      sendResponse({ ok: true });
      return true;
    }
  });

  // Automatically attach or live-upgrade already-open supported tabs whenever the
  // extension installs, updates, reloads, starts up, or receives host permissions.
  if (browser.scripting && browser.tabs) {
    const autoAttachApi = { tabs: browser.tabs, scripting: browser.scripting };
    const syncOpenTabs = (): void => {
      void attachExistingTabs(autoAttachApi).catch(() => undefined);
    };
    browser.runtime.onInstalled.addListener(syncOpenTabs);
    browser.runtime.onStartup.addListener(syncOpenTabs);
    browser.permissions?.onAdded?.addListener(syncOpenTabs);
    browser.runtime.onMessage.addListener(
      attachTabListener(autoAttachApi, { ownOrigin: browser.runtime.getURL('') }),
    );
    // Run at most once per browser session on cold background startup (covers Safari
    // contexts that activate without firing `onInstalled`) without re-sweeping on
    // every MV3 idle service-worker wake-up.
    const session = browser.storage?.session;
    if (session) {
      void session
        .get(BOOT_ATTACH_SESSION_KEY)
        .then((stored) => {
          if (stored[BOOT_ATTACH_SESSION_KEY]) {
            return;
          }
          return session.set({ [BOOT_ATTACH_SESSION_KEY]: true }).then(() => syncOpenTabs());
        })
        .catch(() => syncOpenTabs());
    } else {
      syncOpenTabs();
    }
  }

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
