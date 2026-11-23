// End-to-end tests of the built multi-site userscript bundle on real Chromium
// against X.com and Instagram fixtures (testing transforming fetch/XHR Network
// Tap, React fiber enrichment, feed filters, zero-flash clutter hiding, shared
// VideoScrubber overlays, and first-class Appearance theming).

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import type { BrowserContext, Page, Route } from '@playwright/test';
import { OPTIONS_TITLE } from '../project';

const ROOT = path.resolve(import.meta.dirname, '..');
const USERSCRIPT = path.join(ROOT, '.output', 'userscript', 'feed-sanity.user.js');
const PAGES = path.join(import.meta.dirname, 'pages');
const CLIP_WEBM = path.join(PAGES, 'videos', 'clip.webm');

const X_ORIGIN = 'https://x.com';
const IG_ORIGIN = 'https://www.instagram.com';
const GMAIL_ORIGIN = 'https://mail.google.com';

async function installUserscriptHarness(
  page: Page,
  initialStore: Record<string, unknown>,
  cookies: string,
): Promise<void> {
  if (!existsSync(USERSCRIPT)) {
    throw new Error(`${USERSCRIPT} is missing. Run \`pnpm build:userscript\` first.`);
  }
  const bundle = readFileSync(USERSCRIPT, 'utf8');

  // Install GM.* storage + menu command shim backed by sessionStorage so saves survive page.reload().
  // Guard top-frame only so child iframes respect the userscript's `@noframes` directive.
  await page.addInitScript(
    ({ initial, cookieStr }) => {
      if (globalThis.self !== globalThis.top) {
        return;
      }
      const STORAGE_KEY = '__fs_e2e_gm_store__';
      if (!sessionStorage.getItem(STORAGE_KEY)) {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
      }
      const readAll = (): Record<string, unknown> =>
        JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>;
      const writeAll = (next: Record<string, unknown>): void =>
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));

      const listeners = new Map<
        string,
        Set<(name: string, oldVal: unknown, newVal: unknown, remote: boolean) => void>
      >();

      Object.defineProperty(document, 'cookie', {
        get: () => cookieStr,
        configurable: true,
      });

      const menuCommands: Array<() => void> = [];
      (globalThis as unknown as Record<string, unknown>).__openFeedSanityOptions = () => {
        for (const fn of menuCommands) {
          fn();
        }
      };

      (globalThis as unknown as Record<string, unknown>).GM = {
        getValue: async (key: string) => readAll()[key],
        setValue: async (key: string, value: unknown) => {
          const all = readAll();
          const prev = all[key];
          all[key] = value;
          writeAll(all);
          for (const cb of listeners.get(key) ?? []) {
            cb(key, prev, value, false);
          }
        },
        registerMenuCommand: (_caption: string, onClick: () => void) => {
          menuCommands.push(onClick);
        },
      };
      (globalThis as unknown as Record<string, unknown>).GM_addValueChangeListener = (
        key: string,
        cb: (name: string, oldVal: unknown, newVal: unknown, remote: boolean) => void,
      ) => {
        let set = listeners.get(key);
        if (!set) {
          set = new Set();
          listeners.set(key, set);
        }
        set.add(cb);
      };
    },
    { initial: initialStore, cookieStr: cookies },
  );

  // Execute the built production userscript in the top frame at document_start (`@noframes`).
  await page.addInitScript({
    content: `if (globalThis.self === globalThis.top) {\n${bundle}\n}`,
  });
}

async function routeMultiSite(route: Route): Promise<void> {
  const url = new URL(route.request().url());
  if (url.pathname === '/clip.webm') {
    await route.fulfill({ path: CLIP_WEBM, contentType: 'video/webm' });
    return;
  }
  if (url.origin === X_ORIGIN) {
    if (url.pathname === '/home') {
      await route.fulfill({
        path: path.join(PAGES, 'x', 'home.html'),
        contentType: 'text/html',
      });
      return;
    }
    if (url.pathname.startsWith('/i/api/graphql/')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            home: {
              home_timeline_urt: {
                instructions: [
                  {
                    type: 'TimelineAddEntries',
                    entries: [
                      { entryId: 'tweet-organic-1', content: { itemContent: {} } },
                      { entryId: 'promoted-tweet-ad-2', content: { itemContent: {} } },
                      {
                        entryId: 'tweet-ad-meta-3',
                        content: { itemContent: { promotedMetadata: { id: 'imp-1' } } },
                      },
                    ],
                  },
                  {
                    type: 'TimelineAddToModule',
                    moduleItems: [
                      { entryId: 'reply-ok', item: { itemContent: {} } },
                      {
                        entryId: 'reply-ad',
                        item: { itemContent: { promotedMetadata: { id: 'imp-2' } } },
                      },
                    ],
                  },
                ],
              },
            },
          },
        }),
      });
      return;
    }
  }
  if (url.origin === IG_ORIGIN) {
    if (url.pathname === '/' || url.pathname === '/index.html') {
      await route.fulfill({
        path: path.join(PAGES, 'instagram', 'index.html'),
        contentType: 'text/html',
      });
      return;
    }
    if (url.pathname.startsWith('/api/v1/feed/timeline/')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          feed_items: [
            { media_or_ad: { code: 'NETAD888', product_type: 'ad' } },
            { media_or_ad: { code: 'ORG12345', product_type: 'feed' } },
          ],
        }),
      });
      return;
    }
  }
  if (url.origin === GMAIL_ORIGIN) {
    // Serve Gmail with REAL browser-enforced strict Trusted Types CSP!
    const headers = { 'content-security-policy': "require-trusted-types-for 'script'" };
    if (url.pathname.startsWith('/mail/u/')) {
      await route.fulfill({
        path: path.join(PAGES, 'gmail', 'index.html'),
        contentType: 'text/html',
        headers,
      });
      return;
    }
    if (url.pathname === '/compose-frame.html') {
      await route.fulfill({
        path: path.join(PAGES, 'gmail', 'compose-frame.html'),
        contentType: 'text/html',
        headers,
      });
      return;
    }
  }
  await route.abort('blockedbyclient');
}

test.describe('multi-site E2E (X.com and Instagram)', () => {
  let context: BrowserContext;

  test.beforeAll(async () => {
    context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      args: ['--host-resolver-rules=MAP * ~NOTFOUND'],
    });
    await context.route('**/*', routeMultiSite);
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('X.com: strips promoted fetch/XHR entries, filters tweets, hides clutter, defaults to Following, mounts video scrubber, and themes live', async () => {
    const page = await context.newPage();
    try {
      await installUserscriptHarness(
        page,
        {
          'v2/x/424242/options': {
            x_default_following: true,
            x_hide_sponsored: true,
            x_hide_suggested: true,
            x_keywords: 'airdrop\n',
            x_hide_grok: true,
            x_hide_premium: true,
            x_hide_sidebar: true,
            x_video_scrubber: true,
          },
        },
        'twid=u%3D424242',
      );

      await page.goto(`${X_ORIGIN}/home`);

      // Following tab is clicked once automatically.
      await expect
        .poll(() =>
          page.evaluate(
            () => (globalThis as unknown as { __followingClicked?: number }).__followingClicked,
          ),
        )
        .toBe(1);
      await expect(page.locator('#following-tab')).toHaveAttribute('aria-selected', 'true');

      // DOM ad, React-fiber suggested topic, and keyword tweets are hidden; organic stays visible.
      await expect(page.locator('#tweet-organic')).toBeVisible();
      await expect(page.locator('#tweet-dom-ad')).toBeHidden();
      await expect(page.locator('#tweet-fiber-suggested')).toBeHidden();
      await expect(page.locator('#tweet-keyword')).toBeHidden();

      // Zero-flash CSS clutter hiding conceals Grok, Premium, and Sidebar while leaving Explore visible.
      await expect(page.locator('a[href="/i/grok"]')).toBeHidden();
      await expect(page.locator('[data-testid="GrokDrawer"]')).toBeHidden();
      await expect(page.locator('[data-testid="premium-hub-tab"]')).toBeHidden();
      await expect(page.locator('[data-testid="sidebarColumn"]')).toBeHidden();
      await expect(page.locator('[data-testid="AppTabBar_Explore_Link"]')).toBeVisible();

      // Shared VideoScrubber mounts inside `[data-testid="videoPlayer"]`.
      await expect(page.locator('#x-player feed-sanity-ui')).toHaveCount(1);

      // Transforming Network Tap strips promoted entries across BOTH `fetch()` and `XMLHttpRequest`!
      const fetchResult = await page.evaluate(async () => {
        const res = await fetch('/i/api/graphql/e2e/HomeTimeline');
        return { url: res.url, json: await res.json() };
      });
      expect(fetchResult.url).toContain('/i/api/graphql/e2e/HomeTimeline');
      expect(
        fetchResult.json.data.home.home_timeline_urt.instructions[0].entries.map(
          (e: { entryId: string }) => e.entryId,
        ),
      ).toEqual(['tweet-organic-1']);
      expect(
        fetchResult.json.data.home.home_timeline_urt.instructions[1].moduleItems.map(
          (e: { entryId: string }) => e.entryId,
        ),
      ).toEqual(['reply-ok']);

      const xhrResult = await page.evaluate(
        () =>
          new Promise<{ entries: string[] }>((resolve) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', '/i/api/graphql/e2e/HomeLatestTimeline');
            xhr.addEventListener('load', () => {
              const parsed = JSON.parse(xhr.responseText);
              resolve({
                entries: parsed.data.home.home_timeline_urt.instructions[0].entries.map(
                  (e: { entryId: string }) => e.entryId,
                ),
              });
            });
            xhr.send();
          }),
      );
      expect(xhrResult.entries).toEqual(['tweet-organic-1']);

      // First-class Appearance theming applies live on X.com, persists across reload, and themes
      // light-on-dark surfaces (Warm Paper on dark-mode X: sticky header, tabs, search pill,
      // sidebar cards, dialogs/menus, bio, ScrollSnap buttons, and async Chat Shadow DOM).
      await page.evaluate(() =>
        (
          globalThis as unknown as { __openFeedSanityOptions: () => void }
        ).__openFeedSanityOptions(),
      );
      const dialog = page.getByRole('dialog', { name: OPTIONS_TITLE });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Appearance' }).click();
      await dialog.getByRole('button', { name: /Warm Paper/i }).click();
      await expect
        .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
        .toBe('rgb(244, 239, 230)');
      await expect
        .poll(() =>
          page.evaluate(() => {
            const css = (sel: string) => getComputedStyle(document.querySelector(sel)!);
            const chatRoot = document
              .querySelector('#xchat-host')
              ?.shadowRoot?.querySelector('.chat-root');
            return {
              stickyBg: css('#sticky-header-inner').backgroundColor,
              followingTabColor: css('#following-tab > div > div').color,
              scrollPrevBg: css('#scroll-prev').backgroundColor,
              bioColor: css('#profile-bio').color,
              sheetBg: css('#sheet-dialog').backgroundColor,
              sheetText: css('#sheet-dialog span').color,
              menuBg: css('#more-menu').backgroundColor,
              menuText: css('#more-menu span').color,
              searchPillBg: css('#search-pill').backgroundColor,
              searchPillRadius: css('#search-pill').borderRadius,
              searchInputBg: css('#search-input').backgroundColor,
              newsCardBg: css('#news-card').backgroundColor,
              postCtaBg: css('#post-cta').backgroundColor,
              postCtaText: css('#post-cta span').color,
              chatBg: chatRoot ? getComputedStyle(chatRoot).backgroundColor : null,
              chatColor: chatRoot ? getComputedStyle(chatRoot).color : null,
            };
          }),
        )
        .toEqual({
          stickyBg: 'rgba(244, 239, 230, 0.88)',
          followingTabColor: 'rgb(43, 36, 28)',
          scrollPrevBg: 'rgba(253, 250, 244, 0.92)',
          bioColor: 'rgb(43, 36, 28)',
          sheetBg: 'rgb(253, 250, 244)',
          sheetText: 'rgb(43, 36, 28)',
          menuBg: 'rgb(253, 250, 244)',
          menuText: 'rgb(43, 36, 28)',
          searchPillBg: 'rgb(235, 228, 214)',
          searchPillRadius: '9999px',
          searchInputBg: 'rgba(0, 0, 0, 0)',
          newsCardBg: 'rgb(253, 250, 244)',
          postCtaBg: 'rgb(180, 83, 9)',
          postCtaText: 'rgb(255, 255, 255)',
          chatBg: 'rgb(244, 239, 230)',
          chatColor: 'rgb(43, 36, 28)',
        });
      await dialog.getByRole('button', { name: 'Save' }).click();
      await expect(dialog).toBeHidden();

      await page.reload();
      await expect
        .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
        .toBe('rgb(244, 239, 230)');
      await expect
        .poll(() =>
          page.evaluate(() => {
            const chatRoot = document
              .querySelector('#xchat-host')
              ?.shadowRoot?.querySelector('.chat-root');
            return chatRoot ? getComputedStyle(chatRoot).backgroundColor : null;
          }),
        )
        .toBe('rgb(244, 239, 230)');
    } finally {
      await page.close();
    }
  });

  test('Instagram: filters DOM + Network Tap ads/suggested/keywords, hides nav clutter, mounts scrubber, and themes RGB triplets live', async () => {
    const page = await context.newPage();
    try {
      await installUserscriptHarness(
        page,
        {
          'v2/instagram/999000/options': {
            ig_hide_sponsored: true,
            ig_hide_suggested: true,
            ig_keywords: 'crypto\n',
            ig_hide_reels_nav: true,
            ig_hide_threads_nav: true,
            ig_video_scrubber: true,
          },
          'v2/instagram/999000/theme': {
            preset: 'catppuccin-mocha',
            accent: '',
            background: '',
            surface: '',
            text: '',
            font: 'default',
            customCss: '',
          },
        },
        'ds_user_id=999000',
      );

      await page.goto(`${IG_ORIGIN}/`);

      // DOM sponsored, suggested, and keyword posts are hidden; organic post stays visible.
      await expect(page.locator('#ig-organic')).toBeVisible();
      await expect(page.locator('#ig-sponsored')).toBeHidden();
      await expect(page.locator('#ig-suggested')).toBeHidden();
      await expect(page.locator('#ig-keyword')).toBeHidden();

      // Reels and Threads nav items are hidden while Explore stays visible.
      await expect(page.locator('#nav-reels')).toBeHidden();
      await expect(page.locator('#nav-threads')).toBeHidden();
      await expect(page.locator('#nav-explore')).toBeVisible();

      // Shared VideoScrubber mounts directly inside `#ig-player` above the z-index:0 inner wrapper
      // and sibling `role="presentation"` click-capture layer, so clicking the scrubber seeks!
      await expect(page.locator('#ig-player > feed-sanity-ui')).toHaveCount(1);
      await expect
        .poll(() =>
          page.evaluate(() => {
            const v = document.querySelector('#ig-player video') as HTMLVideoElement | null;
            return Boolean(v && Number.isFinite(v.duration) && v.duration > 0);
          }),
        )
        .toBe(true);
      await expect(page.locator('#ig-player > feed-sanity-ui .zone')).toBeVisible();

      const scrubberBox = await page.locator('#ig-player > feed-sanity-ui .zone').boundingBox();
      expect(scrubberBox).not.toBeNull();
      if (scrubberBox) {
        const clickPoint = {
          x: scrubberBox.x + scrubberBox.width * 0.6,
          y: scrubberBox.y + scrubberBox.height / 2,
        };
        const hitTag = await page.evaluate(
          ({ x, y }) => document.elementsFromPoint(x, y)[0]?.tagName,
          clickPoint,
        );
        expect(hitTag).toBe('FEED-SANITY-UI');

        await page.mouse.click(clickPoint.x, clickPoint.y);
        await expect
          .poll(() =>
            page.evaluate(
              () =>
                (document.querySelector('#ig-player video') as HTMLVideoElement | null)
                  ?.currentTime ?? 0,
            ),
          )
          .toBeGreaterThan(0.5);
      }

      // Instagram `--ig-primary-background` RGB triplet theme compiles onto `.__fb-dark-mode` and paints body background!
      await expect
        .poll(() =>
          page.evaluate(() => ({
            triplet: getComputedStyle(document.documentElement)
              .getPropertyValue('--ig-primary-background')
              .trim(),
            bg: getComputedStyle(document.body).backgroundColor,
          })),
        )
        .toEqual({
          triplet: '30, 30, 46',
          bg: 'rgb(30, 30, 46)',
        });

      // Ensure `#ig-net-ad` starts visible and MAIN-world NetworkTap has patched `fetch`
      // before triggering the timeline API call.
      await expect(page.locator('#ig-net-ad')).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            () => !Function.prototype.toString.call(globalThis.fetch).includes('[native code]'),
          ),
        )
        .toBe(true);

      // Triggering an Instagram timeline API fetch lets passive Network Tap index `NETAD888` as an ad and hide `#ig-net-ad` live!
      await page.evaluate(async () => {
        const res = await fetch('/api/v1/feed/timeline/');
        await res.json();
      });
      await expect(page.locator('#ig-net-ad')).toBeHidden();
    } finally {
      await page.close();
    }
  });

  test('Gmail: runs under real Chromium Trusted Types CSP, filters inbox ads/keywords, hides workspace clutter, and propagates live themes into same-origin iframes', async () => {
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    try {
      await installUserscriptHarness(
        page,
        {
          'v2/gmail/u0/options': {
            gmail_hide_ads: true,
            gmail_keywords: 'crypto\n',
            gmail_hide_side_panel: true,
            gmail_hide_chat_meet: true,
            gmail_hide_gemini: true,
          },
        },
        '',
      );

      await page.goto(`${GMAIL_ORIGIN}/mail/u/0/#inbox`);

      // Organic email + email whose subject says "Ad" stay visible; promo ad + keyword rows are hidden.
      await expect(page.locator('#row-organic')).toBeVisible();
      await expect(page.locator('#row-subject-ad')).toBeVisible();
      await expect(page.locator('#row-promo-ad')).toBeHidden();
      await expect(page.locator('#row-newsletter')).toBeHidden();

      // Workspace clutter hidden while Category tabs stay visible when toggled off.
      await expect(page.locator('#side-panel')).toBeHidden();
      await expect(page.locator('#nav-chat')).toBeHidden();
      await expect(page.locator('#btn-gemini')).toBeHidden();
      await expect(page.locator('#category-tabs')).toBeVisible();

      // Open Shadow-DOM Options dialog under strict Trusted Types CSP and preview + save Catppuccin Mocha.
      await page.evaluate(() =>
        (
          globalThis as unknown as { __openFeedSanityOptions: () => void }
        ).__openFeedSanityOptions(),
      );
      const dialog = page.getByRole('dialog', { name: OPTIONS_TITLE });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Appearance' }).click();
      await dialog.getByRole('button', { name: /Catppuccin Mocha/i }).click();

      // Both Gmail's main document AND the same-origin `#compose-frame` iframe receive the live theme!
      await expect
        .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
        .toBe('rgb(30, 30, 46)');
      const frame = page.frameLocator('#compose-frame');
      await expect
        .poll(() => frame.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor))
        .toBe('rgb(30, 30, 46)');

      await dialog.getByRole('button', { name: 'Save' }).click();
      await expect(dialog).toBeHidden();

      // Full reload under real Trusted Types CSP persists the theme across main doc + iframe with zero errors.
      await page.reload();
      await expect
        .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
        .toBe('rgb(30, 30, 46)');
      await expect
        .poll(() => frame.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor))
        .toBe('rgb(30, 30, 46)');
      expect(pageErrors).toEqual([]);
    } finally {
      await page.close();
    }
  });
});
