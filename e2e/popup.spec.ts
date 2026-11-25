import { OPTIONS_TITLE } from '../project';
import { STUDIO_VIBES } from '../src/core/theme-effects/model';
import { applyStudioVibe, DEFAULT_THEME_DOCUMENT } from '../src/core/theming/config';
import { readThemeLibraryState, THEME_LIBRARY_KEY } from '../src/core/theming/library';
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
  await expect(adPost).toHaveClass(/\bfs_filter_hidden\b/);

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
  await expect(bram).toHaveClass(/\bfs_filter_hidden\b/);

  // Clicking "Theme Studio" opens the full Options dialog directly to Appearance on the Facebook tab!
  await popup.getByRole('button', { name: /Theme Studio/i }).click();
  const dialog = page.getByRole('dialog', { name: OPTIONS_TITLE });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Appearance' })).toBeVisible();
});

test('extension toolbar popup shows Supported Sites launcher on unsupported tabs', async ({
  page,
  openPopup,
}) => {
  await page.goto('about:blank');

  const popup = await openPopup();
  await expect(popup.getByText('Not active on this page')).toBeVisible();
  await expect(popup.getByText('Facebook')).toBeVisible();
  await expect(popup.getByText('X (Twitter)')).toBeVisible();
  await expect(popup.getByText('Instagram')).toBeVisible();
  await expect(popup.getByText('Reddit')).toBeVisible();
  await expect(popup.getByText('Gmail')).toBeVisible();
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
