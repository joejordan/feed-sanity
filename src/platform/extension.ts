import { browser } from 'wxt/browser';
import type { Badge, Platform } from '../core/platform';
import { extensionStore } from './extension-store';
import {
  badgeMessage,
  badgeVisualKey,
  GET_POPUP_STATE,
  PING_RUNTIME,
  parseOpenOptionsMessage,
  parseThemePreviewMessage,
  THEME_PREVIEW_PORT,
} from './messages';
import { requestSafariPageWorld } from './safari-page-world';

const BUILDS: Record<string, string> = {
  firefox: 'Firefox extension',
  chrome: 'Chrome extension',
  safari: 'Safari extension',
};

/** The build name shown in Diagnostics for WXT's `import.meta.env.BROWSER`. */
export const buildName = (target: string): string => BUILDS[target] ?? `${target} extension`;

/** How long a new badge waits before it is sent, so that changes close together are sent once. */
export const BADGE_DELAY_MS = 100;

/** The badge last set, which is sent once the wait is over. */
let latestBadge: Badge | undefined;
/** Key for the last toolbar-visible state (`failed`, `paused`) delivered to the background script. */
let lastSentBadgeKey: string | undefined;
let badgeInFlight = false;
let pendingForce = false;
let badgeGeneration = 0;
let badgeTimer: ReturnType<typeof setTimeout> | undefined;
let pageShowListener: ((event: PageTransitionEvent) => void) | undefined;

function clearBadgeTimer(): void {
  if (badgeTimer !== undefined) {
    clearTimeout(badgeTimer);
    badgeTimer = undefined;
  }
}

async function sendBadge(force = false): Promise<void> {
  clearBadgeTimer();
  const badge = latestBadge;
  if (!badge) {
    return;
  }
  if (badgeInFlight) {
    pendingForce = pendingForce || force;
    return;
  }
  const visualKey = badgeVisualKey(badge);
  // The toolbar button only reacts to `failed` (`!`) and `paused` (monochrome icon),
  // so skip redundant IPCs when only `count` changed to avoid waking the MV3 service worker.
  if (!force && lastSentBadgeKey === visualKey) {
    return;
  }
  const generation = badgeGeneration;
  badgeInFlight = true;
  let succeeded = false;
  try {
    // Chrome throws at once, rather than rejecting, once the extension has
    // been reloaded or updated under this page.
    await browser.runtime.sendMessage(badgeMessage(badge));
    succeeded = true;
    if (generation === badgeGeneration) {
      lastSentBadgeKey = visualKey;
    }
  } catch {
    // The background script is being updated or reloaded. The next change sends the badge again.
  } finally {
    if (generation === badgeGeneration) {
      badgeInFlight = false;
      const nextForce = pendingForce;
      pendingForce = false;
      const current = latestBadge;
      if (current) {
        const currentKey = badgeVisualKey(current);
        const shouldDrain =
          nextForce || (currentKey !== lastSentBadgeKey && (succeeded || currentKey !== visualKey));
        if (shouldDrain) {
          void sendBadge(nextForce);
        }
      }
    }
  }
}

/** The browser extension builds. */
export const extensionPlatform: Platform = {
  store: extensionStore,
  build: buildName(import.meta.env.BROWSER),
  onOpenOptions(listener) {
    const onMessage: Parameters<typeof browser.runtime.onMessage.addListener>[0] = (message) => {
      const parsed = parseOpenOptionsMessage(message);
      if (parsed.matched) {
        listener(parsed.section);
      }
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  },
  onPopupStateRequest(handler) {
    const onMessage: Parameters<typeof browser.runtime.onMessage.addListener>[0] = (
      message,
      _sender,
      sendResponse,
    ) => {
      if (message !== GET_POPUP_STATE) {
        return;
      }
      void handler().then(
        (state) => sendResponse(state),
        () => sendResponse(undefined),
      );
      return true;
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  },
  onThemePreview(listener) {
    const onConnect: Parameters<typeof browser.runtime.onConnect.addListener>[0] = (port) => {
      if (port.name !== THEME_PREVIEW_PORT) {
        return;
      }
      let previewActive = false;
      const clearPreview = (): void => {
        if (previewActive) {
          previewActive = false;
          listener(null);
        }
      };
      port.onMessage.addListener((message) => {
        const parsed = parseThemePreviewMessage(message);
        if (!parsed) {
          return;
        }
        if (parsed.type === 'preview') {
          previewActive = true;
          listener(parsed.document);
        } else {
          clearPreview();
        }
      });
      port.onDisconnect.addListener(clearPreview);
    };
    browser.runtime.onConnect.addListener(onConnect);
    return () => browser.runtime.onConnect.removeListener(onConnect);
  },
  setBadge(badge) {
    if (!pageShowListener) {
      // A page restored from the browser's back and forward cache has lost its badge.
      pageShowListener = (event) => {
        if (event.persisted) {
          void sendBadge(true);
        }
      };
      globalThis.addEventListener('pageshow', pageShowListener);
    }
    latestBadge = badge;
    // Filtering a page of posts changes the count once for each post; skip arming
    // a no-op debounce timer when the toolbar-visible state is already delivered.
    if (badgeTimer === undefined && (badgeInFlight || lastSentBadgeKey !== badgeVisualKey(badge))) {
      badgeTimer = setTimeout(() => void sendBadge(), BADGE_DELAY_MS);
    }
  },
  stopBadge() {
    badgeGeneration += 1;
    latestBadge = undefined;
    lastSentBadgeKey = undefined;
    badgeInFlight = false;
    pendingForce = false;
    clearBadgeTimer();
    if (pageShowListener) {
      globalThis.removeEventListener('pageshow', pageShowListener);
      pageShowListener = undefined;
    }
  },
  isContextInvalidated() {
    if (!browser.runtime?.id) {
      return true;
    }
    return Promise.resolve()
      .then(() => browser.runtime.sendMessage(PING_RUNTIME))
      .then(
        (reply) =>
          !(typeof reply === 'object' && reply !== null && (reply as { ok?: unknown }).ok === true),
        () => true,
      );
  },
  // Chrome and Firefox register each site's `*-page-world.content.ts` with
  // `world: 'MAIN'` in the manifest. Safari uses dynamic `registerContentScripts`
  // at `document_start`, with this on-demand `executeScript` fallback for
  // cold-start or already-open tabs when `PageBridge` does not connect synchronously.
  installPageWorld: (siteId) =>
    import.meta.env.BROWSER === 'safari' ? requestSafariPageWorld(siteId) : Promise.resolve(),
};
