import { isRecord } from '../core/storage';
import { isExcludedUrl, matchesMatchPattern } from '../core/urls';
import {
  EXCLUDE_GLOBS as FACEBOOK_EXCLUDE_GLOBS,
  EXCLUDE_MATCHES as FACEBOOK_EXCLUDE_MATCHES,
  MATCHES as FACEBOOK_MATCHES,
} from '../facebook/urls';
import { GMAIL_EXCLUDE_MATCHES, GMAIL_MATCHES } from '../sites/gmail/urls';
import { INSTAGRAM_EXCLUDE_MATCHES, INSTAGRAM_MATCHES } from '../sites/instagram/urls';
import { REDDIT_EXCLUDE_MATCHES, REDDIT_MATCHES } from '../sites/reddit/urls';
import { X_EXCLUDE_MATCHES, X_MATCHES } from '../sites/x/urls';
import { GET_POPUP_STATE, isPopupTabState } from './messages';

/** Sent by the toolbar popup to attach Feed Sanity to the active supported tab on demand. */
export const ATTACH_TAB = 'feed-sanity/attach-tab';

export interface AttachTabMessage {
  readonly type: typeof ATTACH_TAB;
  readonly tabId: number;
}

export const attachTabMessage = (tabId: number): AttachTabMessage => ({
  type: ATTACH_TAB,
  tabId,
});

export function isAttachTabMessage(value: unknown): value is AttachTabMessage {
  return (
    isRecord(value) &&
    value.type === ATTACH_TAB &&
    typeof value.tabId === 'number' &&
    Number.isInteger(value.tabId) &&
    value.tabId >= 0
  );
}

export interface AttachTabReply {
  readonly attached: boolean;
}

export function isAttachTabReply(value: unknown): value is AttachTabReply {
  return isRecord(value) && typeof value.attached === 'boolean';
}

export type AttachableSiteId = 'facebook' | 'gmail' | 'instagram' | 'reddit' | 'x';

export type AttachableContentScript =
  | '/content-scripts/facebook.js'
  | '/content-scripts/gmail.js'
  | '/content-scripts/instagram.js'
  | '/content-scripts/reddit.js'
  | '/content-scripts/x.js';

export type AttachablePageWorldScript =
  | '/content-scripts/facebook-page-world.js'
  | '/content-scripts/instagram-page-world.js'
  | '/content-scripts/reddit-page-world.js'
  | '/content-scripts/x-page-world.js'
  | '/safari-facebook-page-world.js'
  | '/safari-instagram-page-world.js'
  | '/safari-reddit-page-world.js'
  | '/safari-x-page-world.js';

export type AttachableScriptFile = AttachableContentScript | AttachablePageWorldScript;

export interface AttachableSiteSpec {
  readonly siteId: AttachableSiteId;
  readonly matches: readonly string[];
  readonly excludeMatches: readonly string[];
  readonly excludeGlobs: readonly string[];
  readonly contentScript: AttachableContentScript;
  readonly pageWorldScript?: AttachablePageWorldScript;
}

function pageWorldFile(
  siteId: 'facebook' | 'instagram' | 'reddit' | 'x',
): AttachablePageWorldScript {
  // Branch on `import.meta.env.BROWSER === 'safari'` directly so Chrome and Firefox
  // builds constant-fold and tree-shake Safari-only unlisted script filenames.
  return import.meta.env.BROWSER === 'safari'
    ? `/safari-${siteId}-page-world.js`
    : `/content-scripts/${siteId}-page-world.js`;
}

/**
 * All five supported sites and their isolated-world + optional MAIN-world script paths.
 * Used to automatically attach or live-upgrade already-open tabs after extension install,
 * update, reload, or permission grant without requiring a manual tab refresh.
 */
export const ATTACHABLE_SITES: readonly AttachableSiteSpec[] = [
  {
    siteId: 'facebook',
    matches: FACEBOOK_MATCHES,
    excludeMatches: FACEBOOK_EXCLUDE_MATCHES,
    excludeGlobs: FACEBOOK_EXCLUDE_GLOBS,
    contentScript: '/content-scripts/facebook.js',
    pageWorldScript: pageWorldFile('facebook'),
  },
  {
    siteId: 'x',
    matches: X_MATCHES,
    excludeMatches: X_EXCLUDE_MATCHES,
    excludeGlobs: [],
    contentScript: '/content-scripts/x.js',
    pageWorldScript: pageWorldFile('x'),
  },
  {
    siteId: 'instagram',
    matches: INSTAGRAM_MATCHES,
    excludeMatches: INSTAGRAM_EXCLUDE_MATCHES,
    excludeGlobs: [],
    contentScript: '/content-scripts/instagram.js',
    pageWorldScript: pageWorldFile('instagram'),
  },
  {
    siteId: 'reddit',
    matches: REDDIT_MATCHES,
    excludeMatches: REDDIT_EXCLUDE_MATCHES,
    excludeGlobs: [],
    contentScript: '/content-scripts/reddit.js',
    pageWorldScript: pageWorldFile('reddit'),
  },
  {
    siteId: 'gmail',
    matches: GMAIL_MATCHES,
    excludeMatches: GMAIL_EXCLUDE_MATCHES,
    excludeGlobs: [],
    contentScript: '/content-scripts/gmail.js',
  },
];

/** Returns the attachable site spec for `url`, or `undefined` if unsupported or excluded. */
export function matchAttachableSite(
  url: string | undefined,
  sites: readonly AttachableSiteSpec[] = ATTACHABLE_SITES,
): AttachableSiteSpec | undefined {
  if (!url) {
    return undefined;
  }
  for (const spec of sites) {
    if (
      spec.matches.some((pattern) => matchesMatchPattern(url, pattern)) &&
      !isExcludedUrl(url, spec.excludeMatches, spec.excludeGlobs)
    ) {
      return spec;
    }
  }
  return undefined;
}

export interface AutoAttachTab {
  readonly id?: number | undefined;
  readonly url?: string | undefined;
  readonly discarded?: boolean | undefined;
  readonly status?: string | undefined;
}

export interface AutoAttachTabsApi {
  query: (queryInfo: { url?: string | string[] }) => Promise<AutoAttachTab[]>;
  get?: (tabId: number) => Promise<AutoAttachTab>;
  sendMessage: (tabId: number, message: unknown) => Promise<unknown>;
}

export interface AutoAttachScriptingApi {
  executeScript: (details: {
    target: { tabId: number };
    files: [AttachableScriptFile];
    world?: 'ISOLATED' | 'MAIN';
  }) => Promise<unknown>;
}

export interface AutoAttachApi {
  readonly tabs: AutoAttachTabsApi;
  readonly scripting: AutoAttachScriptingApi;
}

const PING_TIMEOUT_MS = 1200;

type TabProbeResult = 'attached' | 'timeout' | 'unattached';

async function probeTabAttached(
  tabs: AutoAttachTabsApi,
  tabId: number,
  timeoutMs = PING_TIMEOUT_MS,
): Promise<TabProbeResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(() => tabs.sendMessage(tabId, GET_POPUP_STATE))
        .then(
          (reply): TabProbeResult => (isPopupTabState(reply) ? 'attached' : 'unattached'),
          (): TabProbeResult => 'unattached',
        ),
      new Promise<TabProbeResult>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export interface AttachTabOptions {
  readonly sites?: readonly AttachableSiteSpec[];
  /** Skip tabs whose `status` is `'loading'` (default `true` for background sweeps). */
  readonly skipLoading?: boolean;
}

const inFlightTabs = new Map<number, Promise<boolean>>();

/**
 * Attaches Feed Sanity to a single open tab if its URL matches a supported
 * non-excluded site and it is not already running the current extension runtime.
 *
 * Injects the isolated-world content script BEFORE the optional MAIN-world script
 * so any prior (orphaned) content script and its `PageBridge` are torn down before
 * the new `servePageWorld` dispatches `READY_EVENT`, preventing an older bridge
 * from stealing the new channel.
 */
export function attachTab(
  api: AutoAttachApi,
  tab: AutoAttachTab,
  options: AttachTabOptions = {},
): Promise<boolean> {
  const { sites = ATTACHABLE_SITES, skipLoading = true } = options;
  const tabId = tab.id;
  if (
    tabId === undefined ||
    tab.discarded === true ||
    tab.status === 'unloaded' ||
    (skipLoading && tab.status === 'loading')
  ) {
    return Promise.resolve(false);
  }
  const spec = matchAttachableSite(tab.url, sites);
  if (!spec) {
    return Promise.resolve(false);
  }
  const existing = inFlightTabs.get(tabId);
  if (existing) {
    return existing;
  }
  const task = (async (): Promise<boolean> => {
    const probe = await probeTabAttached(api.tabs, tabId);
    // Do not destructively re-inject tabs that are either already attached or
    // merely slow/throttled to respond.
    if (probe !== 'unattached') {
      return false;
    }
    try {
      await api.scripting.executeScript({
        target: { tabId },
        files: [spec.contentScript],
      });
    } catch {
      return false;
    }
    if (spec.pageWorldScript) {
      try {
        await api.scripting.executeScript({
          target: { tabId },
          files: [spec.pageWorldScript],
          world: 'MAIN',
        });
      } catch {
        // Features degrade gracefully when MAIN-world injection is unavailable.
      }
    }
    return true;
  })().finally(() => {
    if (inFlightTabs.get(tabId) === task) {
      inFlightTabs.delete(tabId);
    }
  });
  inFlightTabs.set(tabId, task);
  return task;
}

let inFlightSweep: Promise<number> | undefined;

async function queryCandidateTabs(
  tabs: AutoAttachTabsApi,
  sites: readonly AttachableSiteSpec[],
): Promise<AutoAttachTab[]> {
  const patterns = sites.flatMap((site) => site.matches);
  try {
    return await tabs.query({ url: patterns });
  } catch {
    // Fallback for engines that reject multi-pattern URL filters in `tabs.query`.
    try {
      return await tabs.query({});
    } catch {
      return [];
    }
  }
}

/**
 * Scans open tabs matching any supported site and attaches Feed Sanity to every
 * tab that is missing a live current-instance content script (fresh install,
 * extension update/reload, or newly granted host permission).
 *
 * Concurrent calls coalesce into a single pass. Returns the number of tabs attached.
 */
export function attachExistingTabs(
  api: AutoAttachApi,
  sites: readonly AttachableSiteSpec[] = ATTACHABLE_SITES,
): Promise<number> {
  inFlightSweep ??= (async (): Promise<number> => {
    const tabs = await queryCandidateTabs(api.tabs, sites);
    const results = await Promise.all(
      tabs.map((tab) => attachTab(api, tab, { sites, skipLoading: true })),
    );
    return results.filter(Boolean).length;
  })().finally(() => {
    inFlightSweep = undefined;
  });
  return inFlightSweep;
}

export interface AttachTabSender {
  readonly tab?: { readonly id?: number | undefined } | undefined;
  readonly url?: string | undefined;
}

export interface AttachTabListenerOptions {
  readonly sites?: readonly AttachableSiteSpec[];
  /** Own extension origin (e.g. `browser.runtime.getURL('')`) required to accept callers. */
  readonly ownOrigin?: string;
}

function isTrustedExtensionSender(
  sender: AttachTabSender | undefined,
  ownOrigin: string | undefined,
): boolean {
  const senderUrl = sender?.url;
  if (ownOrigin) {
    // When the extension origin is known, require callers from tabs to originate
    // from our own extension pages (e.g. `popup.html` opened in a tab) and reject
    // any non-extension URL (content scripts).
    if (senderUrl !== undefined) {
      return senderUrl.startsWith(ownOrigin);
    }
    return sender?.tab === undefined;
  }
  return sender?.tab === undefined;
}

/**
 * `runtime.onMessage` listener answering `ATTACH_TAB` requests from the toolbar
 * popup (for instance right after the user grants per-site access on Safari).
 * Rejects messages sent by web content scripts.
 */
export function attachTabListener(
  api: AutoAttachApi,
  options: AttachTabListenerOptions = {},
): (
  message: unknown,
  sender: AttachTabSender,
  sendResponse: (reply: AttachTabReply) => void,
) => true | undefined {
  const { sites = ATTACHABLE_SITES, ownOrigin } = options;
  return (message, sender, sendResponse) => {
    if (!isAttachTabMessage(message) || !isTrustedExtensionSender(sender, ownOrigin)) {
      return;
    }
    const { tabId } = message;
    const resolveTab = async (): Promise<AutoAttachTab | undefined> => {
      if (api.tabs.get) {
        try {
          return await api.tabs.get(tabId);
        } catch {
          // Fall through to query fallback.
        }
      }
      const tabs = await queryCandidateTabs(api.tabs, sites);
      return tabs.find((tab) => tab.id === tabId);
    };
    void resolveTab()
      .then((tab) => (tab ? attachTab(api, tab, { sites, skipLoading: false }) : false))
      .then(
        (attached) => sendResponse({ attached }),
        () => sendResponse({ attached: false }),
      );
    return true;
  };
}
