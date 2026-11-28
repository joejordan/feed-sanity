import { OPTIONS_TITLE } from '../project';
import { STUDIO_VIBES } from '../src/core/theme-effects/vibes';
import { applyStudioVibe, DEFAULT_THEME_DOCUMENT } from '../src/core/theming/config';
import { readThemeLibraryState, THEME_LIBRARY_KEY } from '../src/core/theming/library';
import { FILTERED_ATTR, FILTERED_HIDDEN } from '../src/features/post-filters/markers';
import { expect, ORIGIN, test } from './extension';

const FEED = `${ORIGIN}/`;

test('extension toolbar popup controls live Facebook tab (Starter Mode, Quick Theme, Quick Mute, and deep-link to Options)', async ({
  page,
  openPopup,
}) => {
  await page.goto(FEED);
  // Wait for content script to mount and be ready.
  await expect(page.locator('[aria-posinset]').first()).toBeVisible();

  const popup = await openPopup();

  await expect(popup.getByRole('heading', { name: 'Facebook' })).toBeVisible();
  await expect(popup.getByText(/Active/)).toBeVisible();

  // Popup must fit cleanly inside Chrome's 600px cap with no unnecessary vertical scrollbar.
  const popupMetrics = await popup.evaluate(() => {
    const body = document.querySelector('.qp-body') as HTMLElement | null;
    const root = document.querySelector('.qp-root') as HTMLElement | null;
    return {
      rootHeight: root?.getBoundingClientRect().height ?? 0,
      bodyScrollHeight: body?.scrollHeight ?? 0,
      bodyClientHeight: body?.clientHeight ?? 0,
    };
  });
  expect(popupMetrics.rootHeight).toBeLessThanOrEqual(600);
  expect(popupMetrics.bodyScrollHeight).toBeLessThanOrEqual(popupMetrics.bodyClientHeight + 1);

  // Starter Mode: clicking Focus enables Hide ads (hiding Sourdough School live) and switches mode cleanly!
  await popup.getByRole('button', { name: 'Focus', exact: true }).click();
  await expect(popup.getByRole('button', { name: 'Focus', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const adPost = page
    .locator('[aria-posinset]')
    .filter({ has: page.locator('h4', { hasText: 'Sourdough School' }) });
  await expect(adPost).toHaveAttribute(FILTERED_ATTR, FILTERED_HIDDEN);

  // Switching back down from Focus -> Clean stays responsive and updates active mode.
  await popup.getByRole('button', { name: 'Clean', exact: true }).click();
  await expect(popup.getByRole('button', { name: 'Clean', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Quick Theme dot applies Catppuccin Mocha live onto the open Facebook tab!
  await popup.getByRole('button', { name: 'Catppuccin Mocha theme' }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--web-wash').trim(),
      ),
    )
    .toBe('#1e1e2e');

  // Quick Mute hides matching post live on the Facebook tab!
  await popup.getByRole('textbox', { name: 'Quick mute keyword' }).fill('typewriter');
  await popup.getByRole('button', { name: 'Hide', exact: true }).click();
  const bram = page
    .locator('[aria-posinset]')
    .filter({ has: page.locator('h4', { hasText: 'Bram Okafor' }) });
  await expect(bram).toHaveAttribute(FILTERED_ATTR, FILTERED_HIDDEN);

  // Clicking "Theme Studio" opens the full Options dialog directly to Appearance on the Facebook tab!
  await popup.getByRole('button', { name: /Theme Studio/i }).click();
  const dialog = page.getByRole('dialog', { name: OPTIONS_TITLE });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Appearance' })).toBeVisible();
});

test('extension toolbar popup gates Show beta behind Sites tab and opens standalone Settings window with site switcher', async ({
  page,
  context,
  store,
  openPopup,
}) => {
  await page.goto('about:blank');

  const popup = await openPopup();
  await expect(popup.getByText('Not active on this page')).toBeVisible();
  await expect(popup.getByText('Facebook')).toBeVisible();
  await expect(popup.getByText('X (Twitter)')).toBeVisible();
  // Neither experimental sites nor "Show beta" appear on the main plugin menu until opted in via Sites tab.
  await expect(popup.getByRole('button', { name: 'Show beta' })).toHaveCount(0);
  await expect(popup.getByText('Instagram')).toHaveCount(0);
  await expect(popup.getByText('Reddit')).toHaveCount(0);
  await expect(popup.getByText('Gmail')).toHaveCount(0);

  // Clicking "All settings" from an unsupported tab opens the standalone Settings window.
  const settingsPagePromise = context.waitForEvent('page');
  await popup.getByRole('button', { name: /All settings/i }).click();
  const settingsPage = await settingsPagePromise;
  await settingsPage.waitForLoadState();

  await expect(settingsPage.getByRole('main', { name: OPTIONS_TITLE })).toBeVisible();
  await expect(
    settingsPage.getByRole('button', { name: /Switch site \(Facebook\)/ }),
  ).toBeVisible();

  // Switching sites via the top-left rich dropdown loads X (Twitter)'s settings.
  await settingsPage.getByRole('button', { name: /Switch site \(Facebook\)/ }).click();
  await expect(settingsPage.getByRole('listbox')).toBeVisible();
  await settingsPage.getByRole('option', { name: /X \(Twitter\)/ }).click();
  await expect(
    settingsPage.getByRole('button', { name: /Switch site \(X \(Twitter\)\)/ }),
  ).toBeVisible();
  await expect(settingsPage.getByRole('button', { name: 'Timeline & Clutter' })).toBeVisible();

  // Visiting the Sites tab and enabling "Show experimental sites" unlocks experimental sites everywhere.
  await settingsPage
    .getByRole('navigation', { name: 'Sections' })
    .getByRole('button', { name: /^Sites\b/ })
    .click();
  await settingsPage.getByRole('checkbox', { name: 'Show experimental sites' }).click();
  await expect(settingsPage.getByRole('button', { name: 'Enable Reddit' })).toBeVisible();

  // Top-left site switcher now lists beta sites too.
  await settingsPage.getByRole('button', { name: /Switch site \(X \(Twitter\)\)/ }).click();
  await expect(settingsPage.getByRole('option', { name: /Reddit/ })).toBeVisible();
  await settingsPage.keyboard.press('Escape');

  // Re-opening the toolbar popup on an unsupported tab now displays "Show beta" (and toggles beta rows).
  const popupAfter = await openPopup();
  const showBeta = popupAfter.getByRole('button', { name: 'Show beta' });
  await expect(showBeta).toBeVisible();
  await showBeta.click();
  await expect(popupAfter.getByText('Instagram')).toBeVisible();
  await expect(popupAfter.getByText('Reddit')).toBeVisible();
  await expect(popupAfter.getByText('Gmail')).toBeVisible();

  // Enabling Reddit via storage keeps it visible even when collapsing beta.
  await store({ 'v2/sites': { reddit: true } });
  await popupAfter.getByRole('button', { name: 'Hide beta' }).click();
  await expect(popupAfter.getByText('Reddit')).toBeVisible();
  await expect(popupAfter.getByText('Instagram')).toHaveCount(0);
  await expect(popupAfter.getByText('Gmail')).toHaveCount(0);

  // Clicking "Theme Studio" while the standalone Settings window is already open reuses and navigates it.
  const pageCountBefore = context.pages().length;
  await popupAfter.getByRole('button', { name: /Theme Studio/i }).click();
  await expect(settingsPage.getByRole('heading', { name: 'Appearance' })).toBeVisible();
  expect(context.pages().length).toBeLessThanOrEqual(pageCountBefore);
  await settingsPage.close();
});

test('extension toolbar popup previews & switches My Themes, pauses live backdrop motion, and broadcasts to all sites', async ({
  page,
  store,
  stored,
  openPopup,
}) => {
  const matrixVibe = STUDIO_VIBES.find((v) => v.id === 'enter-the-matrix')!;
  const savedDoc = {
    ...applyStudioVibe(DEFAULT_THEME_DOCUMENT, matrixVibe),
    id: 'midnight-rain',
    meta: {
      name: 'Midnight Rain',
      swatches: ['#040c06', '#0e2514', '#22c55e', '#b6f7c8'],
    },
  };
  await store({
    [THEME_LIBRARY_KEY]: {
      schemaVersion: 1,
      hoverPreview: true,
      themes: [{ id: 'midnight-rain', document: savedDoc, savedAt: 1000, updatedAt: 1000 }],
    },
  });

  await page.goto(FEED);
  await expect(page.locator('[aria-posinset]').first()).toBeVisible();

  const popup = await openPopup();
  const savedChip = popup.getByRole('button', { name: 'Midnight Rain' });
  await expect(savedChip).toBeVisible();

  // Hovering the saved theme live-previews on the open Facebook tab, and leaving restores Site Default.
  await savedChip.hover();
  await expect
    .poll(() =>
      page.evaluate(() => ({
        backdrop: document.querySelector('[data-fs-backdrop="digital-rain"]') !== null,
        accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
      })),
    )
    .toEqual({ backdrop: true, accent: '#22c55e' });

  await popup.getByRole('heading', { name: 'Facebook' }).hover();
  await expect
    .poll(() =>
      page.evaluate(() => ({
        backdrop: document.querySelector('[data-fs-backdrop="digital-rain"]') !== null,
        userStyle: document.querySelector('#feed_sanity_user_theme') !== null,
      })),
    )
    .toEqual({ backdrop: false, userStyle: false });

  // Clicking applies the saved theme + live Digital Rain backdrop onto Facebook.
  await savedChip.click();
  await expect(savedChip).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector('[data-fs-backdrop="digital-rain"]') !== null),
    )
    .toBe(true);

  // Pausing backdrop motion updates the popup label and persists paused state.
  await popup.getByRole('button', { name: 'Pause' }).click();
  await expect(popup.getByText('Matrix Rain · Paused')).toBeVisible();

  // Even with both the active Studio FX bar and My Themes strip visible, the popup fits inside Chrome's 600px cap.
  const fullHeightMetrics = await popup.evaluate(() => {
    const root = document.querySelector('.qp-root') as HTMLElement | null;
    const footer = document.querySelector('.qp-footer') as HTMLElement | null;
    return {
      rootHeight: root?.getBoundingClientRect().height ?? 0,
      footerBottom: footer?.getBoundingClientRect().bottom ?? 0,
    };
  });
  expect(fullHeightMetrics.rootHeight).toBeLessThanOrEqual(600);
  expect(fullHeightMetrics.footerBottom).toBeLessThanOrEqual(600);

  // Apply theme to all sites writes the global override in v2/theme-library.
  await popup.getByRole('button', { name: 'Apply theme to all sites' }).click();
  await expect
    .poll(async () => {
      const lib = readThemeLibraryState(await stored(THEME_LIBRARY_KEY));
      return lib.globalTheme?.document.meta.name;
    })
    .toBe('Midnight Rain');

  // Closing the popup abruptly mid-hover restores the saved theme via port.onDisconnect.
  await popup.getByRole('button', { name: 'Warm Paper theme' }).hover();
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--web-wash').trim(),
      ),
    )
    .toBe('#f4efe6');

  await popup.close();
  await expect
    .poll(() =>
      page.evaluate(() => ({
        backdrop: document.querySelector('[data-fs-backdrop="digital-rain"]') !== null,
        accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
      })),
    )
    .toEqual({ backdrop: true, accent: '#22c55e' });
});
