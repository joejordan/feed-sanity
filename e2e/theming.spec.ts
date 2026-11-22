import { OPTIONS_TITLE } from '../project';
import { expect, ORIGIN, test } from './extension';

const FEED = `${ORIGIN}/`;
const THEME_KEY = '100000000000042/theme';

test('previews Appearance themes live across Options tabs, rolls back on Cancel, and persists after Save + reload', async ({
  page,
  pressToolbarButton,
  stored,
}) => {
  await page.goto(FEED);
  await pressToolbarButton();

  const dialog = page.getByRole('dialog', { name: OPTIONS_TITLE });
  await expect(dialog).toBeVisible();

  // Appearance panel is automatically attached and shows presets.
  await dialog.getByRole('button', { name: 'Appearance' }).click();
  await expect(dialog.getByRole('button', { name: /^Site Default/i })).toBeVisible();

  // Selecting Catppuccin Mocha previews live on BOTH Facebook (`--web-wash`) and Feed Sanity's own Shadow UI (`--fs-accent`).
  await dialog.getByRole('button', { name: /Catppuccin Mocha/i }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--web-wash').trim(),
      ),
    )
    .toBe('#1e1e2e');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const host = document.querySelector('#feed_sanity_options');
        return host ? getComputedStyle(host).getPropertyValue('--fs-accent').trim() : '';
      }),
    )
    .toBe('#cba6f7');

  // Switching to another tab inside Options keeps the staged live preview active.
  await dialog.getByRole('button', { name: 'Sites' }).click();
  await expect(dialog.getByText('Facebook', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Instagram', { exact: true })).toBeVisible();
  await expect(dialog.getByText('X (Twitter)', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--web-wash').trim(),
    ),
  ).toBe('#1e1e2e');

  // Clicking Cancel closes the dialog and restores Site Default cleanly without saving.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#feed_sanity_user_theme')).toHaveCount(0);
  expect(await stored(THEME_KEY)).toBeUndefined();

  // Re-open, configure Warm Paper + custom accent + Editorial Serif + custom CSS, then Save.
  await pressToolbarButton();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Appearance' }).click();
  await dialog.getByRole('button', { name: /Warm Paper/i }).click();
  await dialog.getByRole('textbox', { name: 'Accent', exact: true }).fill('#ff5500');
  await dialog.getByRole('combobox', { name: 'Typography' }).selectOption('serif');
  await dialog.getByRole('textbox', { name: 'Custom CSS' }).fill('body { outline-offset: 7px; }');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  // Reloading the page persists the theme and applies it automatically.
  await page.reload();
  await expect(page.locator('#feed_sanity_user_theme')).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate(() => ({
        wash: getComputedStyle(document.documentElement).getPropertyValue('--web-wash').trim(),
        accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
        font: getComputedStyle(document.body).fontFamily,
        outlineOffset: getComputedStyle(document.body).outlineOffset,
      })),
    )
    .toEqual({
      wash: '#f4efe6',
      accent: '#ff5500',
      font: expect.stringMatching(/Georgia/i),
      outlineOffset: '7px',
    });
});

test('keeps Site Default colors untouched when only Typography is customized', async ({
  page,
  store,
}) => {
  await store({
    [THEME_KEY]: {
      preset: 'default',
      accent: '',
      background: '',
      surface: '',
      text: '',
      font: 'mono',
      customCss: '',
    },
  });

  await page.goto(FEED);
  await expect(page.locator('#feed_sanity_user_theme')).toHaveCount(1);

  const styleText = await page.locator('#feed_sanity_user_theme').textContent();
  expect(styleText).toContain('font-family:');
  expect(styleText).not.toContain('--web-wash');
  expect(styleText).not.toContain('color-scheme');
});
