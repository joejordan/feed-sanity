import { browser } from 'wxt/browser';
import { messageOf } from '../core/log';
import { isRecord } from '../core/storage';
import {
  EXCLUDE_MATCHES as FACEBOOK_EXCLUDE_MATCHES,
  MATCHES as FACEBOOK_MATCHES,
} from '../facebook/urls';
import { INSTAGRAM_EXCLUDE_MATCHES, INSTAGRAM_MATCHES } from '../sites/instagram/urls';
import { REDDIT_EXCLUDE_MATCHES, REDDIT_MATCHES } from '../sites/reddit/urls';
import { X_EXCLUDE_MATCHES, X_MATCHES } from '../sites/x/urls';

/** Sent from a Safari tab to the background service worker for cold-start MAIN-world injection. */
export const REQUEST_PAGE_WORLD = 'feed-sanity/request-page-world';

export interface RequestPageWorldMessage {
  readonly type: typeof REQUEST_PAGE_WORLD;
  readonly siteId: string;
}

export const requestPageWorldMessage = (siteId: string): RequestPageWorldMessage => ({
  type: REQUEST_PAGE_WORLD,
  siteId,
});

export function isRequestPageWorldMessage(value: unknown): value is RequestPageWorldMessage {
  return (
    isRecord(value) &&
    value.type === REQUEST_PAGE_WORLD &&
    typeof value.siteId === 'string' &&
    value.siteId.length > 0
  );
}

export type RequestPageWorldReply =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

export function isRequestPageWorldReply(value: unknown): value is RequestPageWorldReply {
  if (!isRecord(value)) {
    return false;
  }
  return value.ok === true || (value.ok === false && typeof value.error === 'string');
}

export type SafariPageWorldSiteId = 'facebook' | 'instagram' | 'reddit' | 'x';

export type SafariPageWorldScript =
  | '/safari-facebook-page-world.js'
  | '/safari-instagram-page-world.js'
  | '/safari-reddit-page-world.js'
  | '/safari-x-page-world.js';

export interface SafariPageWorldSpec {
  readonly id: string;
  readonly siteId: SafariPageWorldSiteId;
  readonly script: SafariPageWorldScript;
  readonly matches: readonly string[];
  readonly excludeMatches: readonly string[];
}

/**
 * Safari dynamic MAIN-world content script registrations for the four sites
 * that use `PageBridge`. Safari does not support `world: 'MAIN'` in static
 * manifest `content_scripts`, so we register these via `browser.scripting`
 * at `document_start` and fall back to on-demand `executeScript` for cold-start
 * or already-open tabs.
 */
export const SAFARI_PAGE_WORLD_SITES: readonly SafariPageWorldSpec[] = [
  {
    id: 'feed-sanity-facebook-page-world',
    siteId: 'facebook',
    script: '/safari-facebook-page-world.js',
    matches: FACEBOOK_MATCHES,
    excludeMatches: FACEBOOK_EXCLUDE_MATCHES,
  },
  {
    id: 'feed-sanity-x-page-world',
    siteId: 'x',
    script: '/safari-x-page-world.js',
    matches: X_MATCHES,
    excludeMatches: X_EXCLUDE_MATCHES,
  },
  {
    id: 'feed-sanity-instagram-page-world',
    siteId: 'instagram',
    script: '/safari-instagram-page-world.js',
    matches: INSTAGRAM_MATCHES,
    excludeMatches: INSTAGRAM_EXCLUDE_MATCHES,
  },
  {
    id: 'feed-sanity-reddit-page-world',
    siteId: 'reddit',
    script: '/safari-reddit-page-world.js',
    matches: REDDIT_MATCHES,
    excludeMatches: REDDIT_EXCLUDE_MATCHES,
  },
];

function findSafariSpec(siteId: string): SafariPageWorldSpec | undefined {
  return SAFARI_PAGE_WORLD_SITES.find((spec) => spec.siteId === siteId);
}

export interface SafariRegisteredScript {
  id: string;
  matches: string[];
  excludeMatches: string[];
  js: [SafariPageWorldScript];
  runAt: 'document_start';
  world: 'MAIN';
  persistAcrossSessions: boolean;
}

/** Minimal `browser.scripting` surface used by Safari's hybrid MAIN-world loader. */
export interface SafariScripting {
  getRegisteredContentScripts: (filter?: { ids?: string[] }) => Promise<Array<{ id: string }>>;
  registerContentScripts: (scripts: SafariRegisteredScript[]) => Promise<void>;
  updateContentScripts: (scripts: SafariRegisteredScript[]) => Promise<void>;
  unregisterContentScripts?: (filter?: { ids?: string[] }) => Promise<void>;
  executeScript: (details: {
    target: { tabId: number; frameIds?: number[] };
    files: [SafariPageWorldScript];
    world: 'MAIN';
  }) => Promise<unknown>;
}

function toRegistration(spec: SafariPageWorldSpec): SafariRegisteredScript {
  return {
    id: spec.id,
    matches: [...spec.matches],
    excludeMatches: [...spec.excludeMatches],
    js: [spec.script],
    runAt: 'document_start',
    world: 'MAIN',
    persistAcrossSessions: true,
  };
}

let inFlightRegistration: Promise<void> | undefined;
const syncedScripting: WeakSet<SafariScripting> = new WeakSet();

async function syncRegistrations(scripting: SafariScripting): Promise<void> {
  const ids = SAFARI_PAGE_WORLD_SITES.map((spec) => spec.id);
  const existing = await scripting.getRegisteredContentScripts({ ids });
  const existingIds = new Set(existing.map((entry) => entry.id));

  // Skip redundant `updateContentScripts` calls once this background worker has
  // already registered/updated all 4 scripts (e.g. `onInstalled` firing right
  // after top-level startup), avoiding duplicate Safari open-tab injections.
  if (syncedScripting.has(scripting) && existingIds.size === SAFARI_PAGE_WORLD_SITES.length) {
    return;
  }

  const toUpdate: SafariRegisteredScript[] = [];
  const toRegister: SafariRegisteredScript[] = [];
  for (const spec of SAFARI_PAGE_WORLD_SITES) {
    const entry = toRegistration(spec);
    if (existingIds.has(spec.id)) {
      toUpdate.push(entry);
    } else {
      toRegister.push(entry);
    }
  }

  try {
    if (toUpdate.length > 0) {
      await scripting.updateContentScripts(toUpdate);
    }
    if (toRegister.length > 0) {
      await scripting.registerContentScripts(toRegister);
    }
  } catch {
    // Recover from stale or conflicting Safari registration state by replacing cleanly.
    if (scripting.unregisterContentScripts) {
      await scripting.unregisterContentScripts({ ids }).catch(() => undefined);
    }
    await scripting.registerContentScripts(SAFARI_PAGE_WORLD_SITES.map(toRegistration));
  }
  syncedScripting.add(scripting);
}

/**
 * Idempotently registers all four Safari MAIN-world `document_start` scripts,
 * coalescing concurrent calls from startup, `onInstalled`, `onStartup`, and
 * cold-start fallback messages.
 */
export function ensureSafariPageWorldScripts(scripting: SafariScripting): Promise<void> {
  inFlightRegistration ??= syncRegistrations(scripting).finally(() => {
    inFlightRegistration = undefined;
  });
  return inFlightRegistration;
}

interface Sender {
  tab?: { id?: number | undefined } | undefined;
  frameId?: number | undefined;
}

/**
 * `runtime.onMessage` listener for the Safari background service worker.
 * Handles cold-start `REQUEST_PAGE_WORLD` fallback requests from already-open
 * tabs by ensuring dynamic registrations are active and injecting the site's
 * unlisted MAIN-world script into the sending tab/frame.
 */
export function safariPageWorldListener(
  scripting: SafariScripting,
): (
  message: unknown,
  sender: Sender,
  sendResponse: (reply: RequestPageWorldReply) => void,
) => true | undefined {
  return (message, sender, sendResponse) => {
    const tabId = sender.tab?.id;
    if (!isRequestPageWorldMessage(message) || tabId === undefined) {
      return;
    }
    const spec = findSafariSpec(message.siteId);
    if (!spec) {
      sendResponse({
        ok: false,
        error: `no Safari page-world script for site "${message.siteId}"`,
      });
      return true;
    }
    // Re-sync dynamic `document_start` registrations in the background so future loads
    // connect synchronously without needing fallback IPC.
    void ensureSafariPageWorldScripts(scripting).catch(() => undefined);

    const target = sender.frameId === undefined ? { tabId } : { tabId, frameIds: [sender.frameId] };
    Promise.resolve()
      .then(() => scripting.executeScript({ target, files: [spec.script], world: 'MAIN' }))
      .then(
        () => sendResponse({ ok: true }),
        (error: unknown) => sendResponse({ ok: false, error: messageOf(error) }),
      );
    return true;
  };
}

/**
 * Content-script side of the Safari cold-start fallback. Resolves immediately
 * for sites that do not use a page-world script (such as Gmail).
 */
export async function requestSafariPageWorld(
  siteId?: string,
  send: (message: unknown) => Promise<unknown> = (message) => browser.runtime.sendMessage(message),
): Promise<void> {
  if (!siteId || !findSafariSpec(siteId)) {
    return;
  }
  const reply = await send(requestPageWorldMessage(siteId));
  if (!isRequestPageWorldReply(reply)) {
    throw new Error('the background script did not install the page script');
  }
  if (!reply.ok) {
    throw new Error(reply.error);
  }
}
