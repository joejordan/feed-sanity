import { browser } from 'wxt/browser';
import type { Badge, Platform } from '../core/platform';
import { extensionStore } from './extension-store';
import { badgeMessage, GET_POPUP_STATE, parseOpenOptionsMessage } from './messages';

const BUILDS: Record<string, string> = { firefox: 'Firefox extension', chrome: 'Chrome extension' };

/** How long a new badge waits before it is sent, so that changes close together are sent once. */
export const BADGE_DELAY_MS = 100;

/** The badge last set, which is sent once the wait is over. */
let latestBadge: Badge | undefined;
let sendQueued = false;

async function sendBadge(): Promise<void> {
  sendQueued = false;
  if (!latestBadge) {
    return;
  }
  try {
    // Chrome throws at once, rather than rejecting, once the extension has
    // been reloaded or updated under this page.
    await browser.runtime.sendMessage(badgeMessage(latestBadge));
  } catch {
    // The background script is being updated or reloaded. The next change sends the badge again.
  }
}

/** The browser extension builds. */
export const extensionPlatform: Platform = {
  store: extensionStore,
  build: BUILDS[import.meta.env.BROWSER] ?? `${import.meta.env.BROWSER} extension`,
  onOpenOptions(listener) {
    browser.runtime.onMessage.addListener((message) => {
      const parsed = parseOpenOptionsMessage(message);
      if (parsed.matched) {
        listener(parsed.section);
      }
    });
  },
  onPopupStateRequest(handler) {
    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message !== GET_POPUP_STATE) {
        return;
      }
      void handler().then(
        (state) => sendResponse(state),
        () => sendResponse(undefined),
      );
      return true;
    });
  },
  setBadge(badge) {
    if (latestBadge === undefined) {
      // A page restored from the browser's back and forward cache has lost its badge.
      addEventListener('pageshow', (event) => {
        if (event.persisted) {
          void sendBadge();
        }
      });
    }
    latestBadge = badge;
    // Filtering a page of posts changes the count once for each post, and
    // only the last of those changes is sent.
    if (!sendQueued) {
      sendQueued = true;
      setTimeout(() => void sendBadge(), BADGE_DELAY_MS);
    }
  },
  // The manifest registers each site's `*-page-world.content.ts` in `world: 'MAIN'`.
  installPageWorld: () => Promise.resolve(),
};
