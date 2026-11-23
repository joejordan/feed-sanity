// End-to-end Theme Coverage & Layout-Integrity Audit on real Chromium!
// Verifies that our 3-layer Adaptive Theming Engine (Live Stylesheet/Token
// Compiler + Real-Time Self-Healer + Theme Auditor) automatically themes
// brand-new unknown CSS classes, inline-styled dark popups, Shadow DOM widgets,
// AND preserves sticky "Post" header geometry with ZERO layout shifts, ZERO
// header occlusions, ZERO polarity leaks, and ZERO contrast violations.

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
const REDDIT_ORIGIN = 'https://www.reddit.com';

let cachedUserscript: string | undefined;

function readUserscriptBundle(): string {
  if (cachedUserscript === undefined) {
    if (!existsSync(USERSCRIPT)) {
      throw new Error(`${USERSCRIPT} is missing. Run \`pnpm build:userscript\` first.`);
    }
    cachedUserscript = readFileSync(USERSCRIPT, 'utf8');
  }
  return cachedUserscript;
}

async function openAppearance(page: Page) {
  await page.evaluate(() =>
    (globalThis as unknown as { __openFeedSanityOptions: () => void }).__openFeedSanityOptions(),
  );
  const dialog = page.getByRole('dialog', { name: OPTIONS_TITLE });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Appearance' }).click();
  return dialog;
}

async function mountStatusVideo(page: Page, id: string): Promise<void> {
  await page.evaluate((videoId) => {
    const tweet = document.querySelector('#main-post')!;
    const player = document.createElement('div');
    player.setAttribute('data-testid', 'videoPlayer');
    const video = document.createElement('video');
    video.id = videoId;
    player.append(video);
    tweet.append(player);
  }, id);
}

async function installHarness(
  page: Page,
  initialStore: Record<string, unknown>,
  cookies: string,
): Promise<void> {
  const bundle = readUserscriptBundle();
  await page.addInitScript(
    ({ initial, cookieStr }) => {
      if (globalThis.self !== globalThis.top) {
        return;
      }
      const STORAGE_KEY = '__fs_e2e_theme_audit_store__';
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
      Object.defineProperty(document, 'cookie', { get: () => cookieStr, configurable: true });
      const menuCommands = new Map<string, () => void>();
      (globalThis as unknown as Record<string, unknown>).__openFeedSanityOptions = () => {
        for (const [caption, fn] of menuCommands) {
          if (/options/i.test(caption)) {
            fn();
            return;
          }
        }
        menuCommands.values().next().value?.();
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
        registerMenuCommand: (caption: string, onClick: () => void) => {
          menuCommands.set(caption, onClick);
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
  await page.addInitScript({
    content: `if (globalThis.self === globalThis.top) {\n${bundle}\n}`,
  });
}

async function routeAudit(route: Route): Promise<void> {
  const url = new URL(route.request().url());
  if (url.pathname === '/clip.webm') {
    await route.fulfill({ path: CLIP_WEBM, contentType: 'video/webm' });
    return;
  }
  if (url.origin === X_ORIGIN && url.pathname === '/status-audit') {
    // Realistic X status page with:
    // 1. Sticky "Post" header inside a transparent wrapper (tests ZERO resize / ZERO header occlusion!)
    // 2. Brand-new unknown atomic classes `.r-brand-new-card` & `.r-brand-new-ink` NOT in xThemeMapping!
    // 3. Inline dark popup & light-on-light text that only Layer 2 Self-Healer can catch!
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Post / X</title>
    <style>
      body { margin: 0; background: rgb(0, 0, 0); color: rgb(231, 233, 234); font-family: system-ui, sans-serif; }
      [data-testid="primaryColumn"] { width: 600px; margin: 0 auto; position: relative; }
      .sticky-shell { position: sticky; top: 0; z-index: 3; }
      .r-5zmot { background-color: rgba(0, 0, 0, 0.65); height: 53px; display: flex; align-items: center; padding: 0 16px; box-sizing: border-box; }
      .transparent-spacer { position: relative; background-color: rgba(0, 0, 0, 0); }
      .r-brand-new-card { background-color: rgb(32, 35, 39); border: 1px solid rgb(47, 51, 54); border-radius: 12px; padding: 14px; margin: 12px 0; }
      .r-brand-new-ink { color: rgb(231, 233, 234); }
      article[data-testid="tweet"] { padding: 16px; }
    </style>
  </head>
  <body>
    <div id="react-root">
      <main role="main">
        <div data-testid="primaryColumn">
          <div class="transparent-spacer">
            <div class="sticky-shell">
              <div id="post-header-bar" class="r-5zmot">
                <h2 id="post-header-title" class="r-brand-new-ink" style="margin: 0; font-size: 18px;">Post</h2>
              </div>
            </div>
            <article id="main-post" data-testid="tweet">
              <div id="main-post-text" data-testid="tweetText" class="r-brand-new-ink">First line of the actual post should never be covered by the Post header!</div>
            </article>
            <section id="unknown-new-card" class="r-brand-new-card">
              <span id="unknown-new-text" class="r-brand-new-ink">Newly shipped X feature card</span>
            </section>
          </div>
        </div>
      </main>
    </div>
  </body>
</html>`,
    });
    return;
  }
  if (url.origin === REDDIT_ORIGIN && (url.pathname === '/' || url.pathname === '/index.html')) {
    await route.fulfill({
      path: path.join(PAGES, 'reddit', 'index.html'),
      contentType: 'text/html',
    });
    return;
  }
  await route.abort('blockedbyclient');
}

test.describe('adaptive theme & layout-integrity audit E2E', () => {
  let context: BrowserContext;

  test.beforeAll(async () => {
    context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      args: ['--host-resolver-rules=MAP * ~NOTFOUND'],
    });
    await context.route('**/*', routeAudit);
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('X status page: preserves Post header geometry with zero occlusion, auto-themes unknown classes & late inline popups, and passes live Appearance Audit', async () => {
    const page = await context.newPage();
    try {
      await installHarness(page, {}, 'twid=u%3D424242');
      await page.goto(`${X_ORIGIN}/status-audit`);

      // Capture pre-theme geometry of the sticky "Post" header and the actual post below it.
      const before = await page.evaluate(() => ({
        header: document.querySelector('#post-header-bar')!.getBoundingClientRect().toJSON(),
        postText: document.querySelector('#main-post-text')!.getBoundingClientRect().toJSON(),
      }));
      expect(before.header.bottom).toBeLessThanOrEqual(before.postText.top);

      // Switch to Warm Paper (light theme on dark-mode X!).
      await page.evaluate(() =>
        (
          globalThis as unknown as { __openFeedSanityOptions: () => void }
        ).__openFeedSanityOptions(),
      );
      const dialog = page.getByRole('dialog', { name: OPTIONS_TITLE });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Appearance' }).click();
      await dialog.getByRole('button', { name: /Warm Paper/i }).click();

      // 1. Layer 1 Adaptive Compiler automatically themed `.r-brand-new-card` & `.r-brand-new-ink`
      //    even though neither class name exists anywhere in `xThemeMapping.ts`!
      await expect
        .poll(() =>
          page.evaluate(() => ({
            cardBg: getComputedStyle(document.querySelector('#unknown-new-card')!).backgroundColor,
            cardText: getComputedStyle(document.querySelector('#unknown-new-text')!).color,
            spacerBg: getComputedStyle(document.querySelector('.transparent-spacer')!)
              .backgroundColor,
          })),
        )
        .toEqual({
          cardBg: 'rgb(253, 250, 244)',
          cardText: 'rgb(43, 36, 28)',
          spacerBg: 'rgba(0, 0, 0, 0)',
        });

      // 2. Sticky "Post" header kept exact dimensions (<= 1px delta) and does NOT cover the post!
      const after = await page.evaluate(() => ({
        header: document.querySelector('#post-header-bar')!.getBoundingClientRect().toJSON(),
        postText: document.querySelector('#main-post-text')!.getBoundingClientRect().toJSON(),
      }));
      expect(Math.abs(after.header.height - before.header.height)).toBeLessThanOrEqual(1);
      expect(Math.abs(after.header.top - before.header.top)).toBeLessThanOrEqual(1);
      expect(Math.abs(after.postText.top - before.postText.top)).toBeLessThanOrEqual(1);
      expect(after.header.bottom).toBeLessThanOrEqual(after.postText.top);

      // 3. Dynamically inject a brand-new late-mounted inline-styled dark popup + light-on-light text
      //    AND a brand-new lazily loaded `<style>` chunk after theming is already active!
      await page.evaluate(() => {
        const lazyStyle = document.createElement('style');
        lazyStyle.textContent =
          '.x-lazy-chunk { background-color: rgb(32, 35, 39); color: rgb(231, 233, 234); padding: 12px; }';
        document.head.append(lazyStyle);

        const lazyCard = document.createElement('div');
        lazyCard.id = 'lazy-chunk-card';
        lazyCard.className = 'x-lazy-chunk';
        lazyCard.textContent = 'Lazily loaded X Money widget';

        // Intentionally avoid `role="dialog"` and hardcoded `rgb(231, 233, 234)` so ONLY
        // Layer 2 `ThemeHealer` (not static `xThemeMapping`) can heal this unknown inline widget!
        const inlinePopup = document.createElement('div');
        inlinePopup.id = 'late-inline-popup';
        inlinePopup.style.cssText =
          'background-color: rgb(24, 26, 30); color: rgb(225, 228, 232); padding: 12px; margin-top: 8px;';
        const span = document.createElement('span');
        span.id = 'late-inline-text';
        span.style.color = 'rgb(225, 228, 232)';
        span.textContent = 'Late inline-styled popup';
        inlinePopup.append(span);

        document.querySelector('[data-testid="primaryColumn"]')?.append(lazyCard, inlinePopup);
      });

      // Layer 1 automatically compiles the lazy `<style>` chunk AND Layer 2 stamps heal attributes!
      await expect
        .poll(() =>
          page.evaluate(() => {
            const popup = document.querySelector('#late-inline-popup')!;
            const text = document.querySelector('#late-inline-text')!;
            return {
              lazyBg: getComputedStyle(document.querySelector('#lazy-chunk-card')!).backgroundColor,
              lazyText: getComputedStyle(document.querySelector('#lazy-chunk-card')!).color,
              popupBg: getComputedStyle(popup).backgroundColor,
              popupText: getComputedStyle(text).color,
              healBgAttr: popup.getAttribute('data-fs-heal-bg'),
              healFgAttr: text.getAttribute('data-fs-heal-fg'),
            };
          }),
        )
        .toEqual({
          lazyBg: 'rgb(253, 250, 244)',
          lazyText: 'rgb(43, 36, 28)',
          popupBg: 'rgb(253, 250, 244)',
          popupText: 'rgb(43, 36, 28)',
          healBgAttr: 'surface',
          healFgAttr: 'text',
        });

      // 4. Open Theme health & layout check, click "Auto-heal now" and assert 100% coverage & 0 issues!
      await dialog.getByRole('button', { name: /Theme health & layout check/i }).click();
      await dialog.getByRole('button', { name: 'Auto-heal now' }).click();
      await expect(dialog.getByText(/100% coverage/)).toBeVisible();
      await expect(
        dialog.getByText(/0 contrast, 0 unthemed surfaces, 0 layout shifts, 0 header overlaps/),
      ).toBeVisible();
    } finally {
      await page.close();
    }
  });

  test('Reddit Shreddit: passes live Shadow DOM Appearance Audit under Catppuccin Mocha with zero violations', async () => {
    const page = await context.newPage();
    try {
      await installHarness(page, {}, 'loid=auditrddt1234.1.1700000000');
      await page.goto(`${REDDIT_ORIGIN}/`);

      await page.evaluate(() =>
        (
          globalThis as unknown as { __openFeedSanityOptions: () => void }
        ).__openFeedSanityOptions(),
      );
      const dialog = page.getByRole('dialog', { name: OPTIONS_TITLE });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Appearance' }).click();
      await dialog.getByRole('button', { name: /Catppuccin Mocha/i }).click();

      await expect
        .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
        .toBe('rgb(30, 30, 46)');

      await dialog.getByRole('button', { name: /Theme health & layout check/i }).click();
      await dialog.getByRole('button', { name: 'Audit page' }).click();
      await expect(dialog.getByText(/100% coverage/)).toBeVisible();
      await expect(
        dialog.getByText(/0 contrast, 0 unthemed surfaces, 0 layout shifts, 0 header overlaps/),
      ).toBeVisible();
    } finally {
      await page.close();
    }
  });

  test('X typography applies to host page text, Crimson Velvet passes Audit, and custom video speed persists across reloads', async () => {
    const page = await context.newPage();
    try {
      await installHarness(page, {}, 'twid=u%3D888999');
      await page.goto(`${X_ORIGIN}/status-audit`);

      await mountStatusVideo(page, 'x-status-video');

      // 1. Open Appearance -> pick Crimson Velvet + Editorial Serif (instant apply).
      const dialog = await openAppearance(page);
      await dialog.getByRole('button', { name: /Crimson Velvet/i }).click();
      await dialog.getByLabel('Typography').selectOption('serif');

      // Verify Typography changed the actual host X tweet text font-family (not just the dialog)!
      await expect
        .poll(() =>
          page.evaluate(() => ({
            tweetFont: getComputedStyle(document.querySelector('[data-testid="tweetText"]')!)
              .fontFamily,
            bg: getComputedStyle(document.body).backgroundColor,
          })),
        )
        .toEqual({
          tweetFont: expect.stringContaining('Georgia'),
          bg: 'rgb(17, 9, 13)',
        });

      await dialog.getByRole('button', { name: /Theme health & layout check/i }).click();
      await dialog.getByRole('button', { name: 'Audit page' }).click();
      await expect(dialog.getByText(/100% coverage/)).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Auto-heal now' })).toBeDisabled();
      await dialog.getByRole('button', { name: 'Close' }).click();
      await expect(dialog).toBeHidden();

      // 2. Open X's native Playback speed menu (rendered inside videoPlayer popover) and set custom speed `1.17x`.
      await page.evaluate(() => {
        const player = document.querySelector('[data-testid="videoPlayer"]') as HTMLElement;
        const popover = document.createElement('div');
        popover.id = 'x-video-settings-popover';
        const list = document.createElement('div');
        for (const label of ['0.25x', '0.5x', '0.75x', 'Normal', '1.25x', '1.5x', '1.75x', '2x']) {
          const item = document.createElement('div');
          item.setAttribute('role', 'button');
          item.setAttribute('tabindex', '0');
          item.textContent = label;
          list.append(item);
        }
        popover.append(list);
        player.append(popover);
      });

      const speedInput = page.getByRole('textbox', { name: 'Custom playback speed' });
      await expect(speedInput).toBeVisible();
      await speedInput.fill('1.17');
      await speedInput.press('Enter');

      await expect
        .poll(() =>
          page.evaluate(
            () => (document.querySelector('#x-status-video') as HTMLVideoElement).playbackRate,
          ),
        )
        .toBeCloseTo(1.17, 2);

      // 2b. Return to the parent gear menu and verify "Playback speed · 1.17x" is shown live.
      await page.evaluate(() => {
        const popover = document.querySelector('#x-video-settings-popover') as HTMLElement;
        popover.innerHTML =
          '<div role="button" tabindex="0"><span>Playback speed</span><span>Normal</span></div>';
      });
      await expect(page.locator('[data-feed-sanity="x-speed-parent-value"]')).toHaveText(
        ' · 1.17x',
      );

      // 3. Reload the page and mount a fresh video: saved `1.17x` speed must be remembered!
      await page.reload();
      await mountStatusVideo(page, 'x-reloaded-video');

      await expect
        .poll(() =>
          page.evaluate(
            () => (document.querySelector('#x-reloaded-video') as HTMLVideoElement).playbackRate,
          ),
        )
        .toBeCloseTo(1.17, 2);
    } finally {
      await page.close();
    }
  });
});
