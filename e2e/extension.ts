// Test fixtures that start Chromium with the built Chrome extension and serve
// the pages in e2e/pages in place of https://www.facebook.com/.

import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { test as base, chromium, expect } from '@playwright/test';
import type { BrowserContext, Route, Worker } from '@playwright/test';
import type { browser } from 'wxt/browser';

const ROOT = path.resolve(import.meta.dirname, '..');
const EXTENSION = path.join(ROOT, '.output', 'chrome-mv3');
const PAGES = path.join(import.meta.dirname, 'pages');

/** The only site the tests load. Its pages come from e2e/pages. */
export const ORIGIN = 'https://www.facebook.com';

/** The logged-in user, from the `c_user` cookie. Settings are saved under this prefix. */
const USER_ID = '100000000000042';

export const OPTIONS_KEY = `${USER_ID}/options`;
export const FILTERS_KEY = `${USER_ID}/filters`;

// The extension API in the service worker, for the functions the tests run
// there with `evaluate`. Declared in this module only, so code under src/
// cannot use it by mistake.
declare const chrome: typeof browser;

/** Answers a request to the fake Facebook from e2e/pages, and refuses every other request. */
async function serve(route: Route, blocked: string[]): Promise<void> {
  const url = new URL(route.request().url());
  if (url.origin !== ORIGIN) {
    blocked.push(url.href);
    await route.abort('blockedbyclient');
    return;
  }
  // The query string is ignored, so `/?sk=h_chr` is served from index.html as well.
  const relative = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
  const file = path.join(PAGES, ...relative.split('/').map(decodeURIComponent));
  // A folder asked for without the trailing slash is not found, as a file
  // cannot be served from it.
  if (file.startsWith(PAGES + path.sep) && statSync(file, { throwIfNoEntry: false })?.isFile()) {
    await route.fulfill({ path: file });
  } else {
    await route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' });
  }
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
  /** Fires the toolbar button's click event for the tab `page` is in. */
  pressToolbarButton: () => Promise<void>;
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

  // Playwright cannot click the toolbar button, which is part of the
  // browser's own window. Chromium's DevTools protocol can run an extension's
  // action on a tab, though, and that fires the same `action.onClicked` event
  // a click does, so the background script's listener runs. What is not
  // covered is the button itself: that it is shown, and that a click on it
  // reaches the extension.
  pressToolbarButton: async ({ extensionBrowser: { context, worker }, page }, use) => {
    const session = await context.browser()?.newBrowserCDPSession();
    if (!session) {
      throw new Error('No browser-wide DevTools session');
    }
    await use(async () => {
      // The action is run on the tab target, which holds the page target.
      const { targetInfos } = await session.send('Target.getTargets', {
        filter: [{ type: 'tab' }],
      });
      const tab = targetInfos.find((target) => target.url === page.url());
      if (!tab) {
        throw new Error(`No tab shows ${page.url()}`);
      }
      await session.send('Extensions.triggerAction', {
        id: new URL(worker.url()).host,
        targetId: tab.targetId,
      });
    });
    await session.detach();
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
