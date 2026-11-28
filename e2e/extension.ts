// Test fixtures that start Chromium with the built Chrome extension and serve
// the pages in e2e/pages in place of https://www.facebook.com/.

import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { test as base, chromium, expect } from '@playwright/test';
import type { BrowserContext, Page, Route, Worker } from '@playwright/test';
import type { browser } from 'wxt/browser';
import { CUSTOM_FILTERS_KEY } from '../src/core/filter-types';
import { siteStoragePrefix } from '../src/core/site-storage';
import { THEME_DATA_KEY } from '../src/core/theming/types';
import { READ_HISTORY_KEY as READ_HISTORY } from '../src/facebook/read-history';
import { OPEN_OPTIONS } from '../src/platform/messages';

const ROOT = path.resolve(import.meta.dirname, '..');
const EXTENSION = path.join(ROOT, '.output', 'chrome-mv3');
const PAGES = path.join(import.meta.dirname, 'pages');
const CDN_FILES = path.join(import.meta.dirname, 'cdn');

/** The only site the tests load. Its pages come from e2e/pages. */
export const ORIGIN = 'https://www.facebook.com';

/**
 * A stand-in for Facebook's video file server. Its files come from e2e/cdn.
 * It lets the fake Facebook read them, as the real one does for Facebook's
 * player, except under `/no-cors/`, which stands for a file server that
 * does not: it allows another site only.
 */
export const CDN = 'https://video.e2e.fbcdn.net';
const NO_CORS = '/no-cors/';

/** The logged-in user, from the `c_user` cookie. */
const USER_ID = '100000000000042';
/** Canonical v2 storage prefix for Facebook settings in E2E tests. */
const STORAGE_PREFIX = siteStoragePrefix('facebook', USER_ID);

export const OPTIONS_KEY = `${STORAGE_PREFIX}/options`;
export const FILTERS_KEY = `${STORAGE_PREFIX}/${CUSTOM_FILTERS_KEY}`;
export const READ_HISTORY_KEY = `${STORAGE_PREFIX}/${READ_HISTORY}`;
export const THEME_KEY = `${STORAGE_PREFIX}/${THEME_DATA_KEY}`;

// The extension API in the service worker, for the functions the tests run
// there with `evaluate`. Declared in this module only, so code under src/
// cannot use it by mistake.
declare const chrome: typeof browser;

/** The file under `root` that `pathname` names, or undefined when there is none. */
function fileIn(root: string, pathname: string): string | undefined {
  const file = path.join(root, ...pathname.split('/').map(decodeURIComponent));
  // A folder asked for without the trailing slash is not found, as a file
  // cannot be served from it.
  return file.startsWith(root + path.sep) && statSync(file, { throwIfNoEntry: false })?.isFile()
    ? file
    : undefined;
}

const NOT_FOUND = { status: 404, contentType: 'text/plain', body: 'Not found' };

/**
 * Answers a request to the fake Facebook from e2e/pages and one to the fake
 * file server from e2e/cdn, and refuses every other request.
 */
async function serve(route: Route, blocked: string[]): Promise<void> {
  const url = new URL(route.request().url());
  if (url.protocol === 'chrome-extension:') {
    await route.continue();
    return;
  }
  if (url.origin === CDN) {
    const cors = !url.pathname.startsWith(NO_CORS);
    const file = fileIn(CDN_FILES, cors ? url.pathname : url.pathname.slice(NO_CORS.length - 1));
    // Playwright adds a header that allows any site to a fulfilled response that has none,
    // so the refusal names another site.
    const headers = { 'access-control-allow-origin': cors ? ORIGIN : 'https://example.com' };
    await route.fulfill(file ? { path: file, contentType: 'video/mp4', headers } : NOT_FOUND);
    return;
  }
  if (url.origin !== ORIGIN) {
    blocked.push(url.href);
    await route.abort('blockedbyclient');
    return;
  }
  // The query string is ignored, so `/?sk=h_chr` is served from index.html as well.
  const relative = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
  const file = fileIn(PAGES, relative);
  await route.fulfill(file ? { path: file } : NOT_FOUND);
}

/** A browser with the extension loaded, shared by the tests of one Playwright worker. */
interface Browser {
  context: BrowserContext;
  /** The extension's service worker. */
  worker: Worker;
  /** Every request that was refused because it was for another site. */
  blocked: string[];
}

interface TestFixtures {
  /** Saves values in the extension's storage. */
  store: (items: Record<string, unknown>) => Promise<void>;
  /** Reads one value from the extension's storage. */
  stored: (key: string) => Promise<unknown>;
  /** Opens the full Options dialog on the tab `page` is in (as clicking "All settings" from the popup does). */
  pressToolbarButton: () => Promise<void>;
  /** Opens the extension's built `popup.html` connected to the active tab and returns its Page. */
  openPopup: () => Promise<Page>;
  /** The text of the toolbar button's badge for the tab `page` is in. */
  badgeText: () => Promise<string>;
}

export const test = base.extend<TestFixtures, { extensionBrowser: Browser }>({
  // Starting Chromium with the extension takes several seconds, so each
  // Playwright worker starts it once. Each test starts with empty extension
  // storage and ends by unloading its page instead.
  //
  // A persistent context is the only kind Chromium loads extensions into.
  // With the `chromium` channel it can run headless: that channel is the full
  // Chromium build, whose headless mode supports extensions, where the default
  // headless shell does not.
  extensionBrowser: [
    async ({ headless }, use) => {
      if (!existsSync(path.join(EXTENSION, 'manifest.json'))) {
        throw new Error(`${EXTENSION} is missing. Run \`pnpm test:e2e\`, which builds it first.`);
      }
      const context = await chromium.launchPersistentContext('', {
        channel: 'chromium',
        headless,
        args: [
          `--disable-extensions-except=${EXTENSION}`,
          `--load-extension=${EXTENSION}`,
          // A second guard behind the route below: no host name resolves, so
          // a request that somehow got past the route could not reach any
          // server. Routed requests are answered before a name is looked up.
          '--host-resolver-rules=MAP * ~NOTFOUND',
        ],
      });
      const blocked: string[] = [];
      await context.route('**/*', (route) => serve(route, blocked));
      await context.addCookies([
        { name: 'c_user', value: USER_ID, domain: '.facebook.com', path: '/', secure: true },
      ]);
      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
      await use({ context, worker, blocked });
      await context.close();
    },
    { scope: 'worker', timeout: 60_000 },
  ],

  context: async ({ extensionBrowser }, use) => {
    await use(extensionBrowser.context);
  },

  // Every test uses the tab the browser opened with, so there is one tab for
  // the toolbar button to act on.
  page: async ({ extensionBrowser: { context, blocked, worker } }, use) => {
    await worker.evaluate(() => chrome.storage.local.clear());
    const page = context.pages()[0] ?? (await context.newPage());
    const blockedBefore = blocked.length;
    await use(page);
    // Unloads the page, and the content script with it.
    await page.goto('about:blank');
    expect(blocked.slice(blockedBefore), 'requests to sites other than the fake Facebook').toEqual(
      [],
    );
  },

  store: async ({ extensionBrowser: { worker } }, use) => {
    await use((items) => worker.evaluate((values) => chrome.storage.local.set(values), items));
  },

  stored: async ({ extensionBrowser: { worker } }, use) => {
    await use(async (key) => {
      const items = await worker.evaluate((name) => chrome.storage.local.get(name), key);
      return items[key];
    });
  },

  // With `action.default_popup` set in the manifest, clicking the toolbar button
  // opens `popup.html` instead of firing `action.onClicked`. Existing Options
  // tests use this fixture to open the Options dialog on the active tab via the
  // same `OPEN_OPTIONS` message the popup sends, while `openPopup` tests the
  // real `popup.html` UI end-to-end.
  pressToolbarButton: async ({ extensionBrowser: { worker } }, use) => {
    await use(async () => {
      await worker.evaluate(async (message) => {
        const tabs = await chrome.tabs.query({ active: true });
        const tabId = tabs[0]?.id;
        if (tabId === undefined) {
          throw new Error('No active tab to open Options on');
        }
        await chrome.tabs.sendMessage(tabId, message);
      }, OPEN_OPTIONS);
    });
  },

  openPopup: async ({ extensionBrowser: { context, worker } }, use) => {
    const opened: Page[] = [];
    await use(async () => {
      const extId = new URL(worker.url()).host;
      const popupPage = await context.newPage();
      opened.push(popupPage);
      await popupPage.goto(`chrome-extension://${extId}/popup.html`);
      return popupPage;
    });
    for (const p of opened) {
      if (!p.isClosed()) {
        await p.close();
      }
    }
  },

  // The badge is set for one tab, so it is read for that tab. The browser has
  // one window with one tab in it, the one every test uses.
  badgeText: async ({ extensionBrowser: { worker } }, use) => {
    await use(() =>
      worker.evaluate(async () => {
        const tabs = await chrome.tabs.query({ active: true });
        const tabId = tabs.length === 1 ? tabs[0]?.id : undefined;
        if (tabId === undefined) {
          throw new Error(`Expected one active tab, found ${tabs.length}`);
        }
        return chrome.action.getBadgeText({ tabId });
      }),
    );
  },
});

export { expect };
