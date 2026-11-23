import { OPTIONS_TITLE } from '../project';
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

  // Clicking "Audit theme" opens the full Options dialog directly to Appearance on the Facebook tab!
  await popup.getByRole('button', { name: /Audit theme/i }).click();
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
