import { OPTIONS_TITLE } from '../project';
import { DEFAULT_THEME_DOCUMENT, updateThemeTypography } from '../src/core/theming/config';
import { THEME_FILE_FORMAT } from '../src/core/theming/document';
import { expect, ORIGIN, THEME_KEY, test } from './extension';

const FEED = `${ORIGIN}/`;

test('applies Appearance themes live immediately with Undo, supports disclosures, and persists after reload', async ({
  page,
  pressToolbarButton,
}) => {
  await page.goto(FEED);
  await pressToolbarButton();

  const dialog = page.getByRole('dialog', { name: OPTIONS_TITLE });
  await expect(dialog).toBeVisible();

  // Appearance panel is automatically attached and shows presets.
  await dialog.getByRole('button', { name: 'Appearance' }).click();
  await expect(dialog.getByRole('button', { name: /^Site Default/i })).toBeVisible();

  // Selecting Catppuccin Mocha applies live on BOTH Facebook (`--web-wash`) and Feed Sanity's own Shadow UI (`--fs-accent`).
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

  // Undo toast reverts immediately to Site Default cleanly.
  await dialog.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('#feed_sanity_user_theme')).toHaveCount(0);

  // Switching to Sites shows production sites and reveals experimental sites on toggle.
  await dialog.getByRole('button', { name: /^Sites/ }).click();
  await expect(dialog.getByText('X (Twitter)', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Instagram', { exact: true })).toHaveCount(0);
  await dialog.getByRole('checkbox', { name: 'Show experimental sites' }).click();
  await expect(dialog.getByText('Instagram', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Reddit', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Gmail', { exact: true })).toBeVisible();

  // Configure Warm Paper + custom accent + Editorial Serif + custom CSS via disclosures (instant apply!).
  await dialog.getByRole('button', { name: 'Appearance' }).click();
  await dialog.getByRole('button', { name: /Warm Paper/i }).click();
  await dialog.getByRole('button', { name: /Customize colors/i }).click();
  await dialog.getByRole('textbox', { name: 'Accent', exact: true }).fill('#ff5500');
  await dialog.getByRole('combobox', { name: 'Typography' }).selectOption('serif');
  await dialog.getByRole('button', { name: /Custom CSS/i }).click();
  await dialog.getByRole('textbox', { name: 'Custom CSS' }).fill('body { outline-offset: 7px; }');
  await dialog.getByRole('button', { name: 'Close' }).click();
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
    [THEME_KEY]: updateThemeTypography(DEFAULT_THEME_DOCUMENT, 'mono'),
  });

  await page.goto(FEED);
  await expect(page.locator('#feed_sanity_user_theme')).toHaveCount(1);

  const styleText = await page.locator('#feed_sanity_user_theme').textContent();
  expect(styleText).toContain('font-family:');
  expect(styleText).not.toContain('--web-wash');
  expect(styleText).not.toContain('color-scheme');
});

test('imports Tier 2 Custom Scene (verified data) and Tier 3 Opt-In GLSL Shader with live custom tuners', async ({
  page,
  pressToolbarButton,
}) => {
  await page.goto(FEED);
  await pressToolbarButton();

  const dialog = page.getByRole('dialog', { name: OPTIONS_TITLE });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Appearance' }).click();
  await dialog.getByRole('button', { name: /Import \/ Export theme/i }).click();

  // 1. Tier 2 Custom Scene imports safely as Verified data and mounts a live Canvas 2D backdrop.
  const customSceneTheme = JSON.stringify({
    format: THEME_FILE_FORMAT,
    schemaVersion: 1,
    meta: { name: 'Sakura Drift' },
    palette: {
      colorScheme: 'dark',
      background: '#130d1e',
      surface: '#1d1530',
      text: '#f5ecff',
      accent: '#f472b6',
    },
    effects: {
      backdrop: {
        id: 'custom-scene',
        intensity: 0.85,
        scene: {
          fps: 24,
          layers: [
            { kind: 'gradient', style: 'linear', colors: ['background', '#2a1640', 'accent'] },
            {
              kind: 'particles',
              shape: 'petal',
              count: 36,
              sizeMin: 4,
              sizeMax: 10,
              speed: 0.7,
              angle: 110,
              spread: 25,
              color: '#fbcfe8',
            },
          ],
        },
      },
      surface: { finish: 'glass', glassStrength: 0.25 },
    },
  });

  await dialog.getByRole('textbox', { name: 'Paste theme JSON' }).fill(customSceneTheme);
  await dialog.getByRole('button', { name: 'Preview import' }).click();
  await expect(dialog.getByText('Verified data')).toBeVisible();
  await expect(dialog.getByText('Scene (2 layers)')).toBeVisible();
  await dialog.getByRole('button', { name: 'Apply imported theme' }).click();

  await expect(dialog.getByText(/Custom Scene active \(2 layers\)/i)).toBeVisible();
  await expect(page.locator('[data-fs-backdrop="custom-scene"]')).toHaveCount(1);
  await expect(
    page.locator('[data-fs-backdrop="custom-scene"] canvas[data-fs-renderer="canvas2d"]'),
  ).toHaveCount(1);

  // 2. Tier 3 Custom GLSL Shader requires explicit opt-in and renders its custom uniform slider.
  const customShaderTheme = JSON.stringify({
    format: THEME_FILE_FORMAT,
    schemaVersion: 1,
    meta: { name: 'Neon Plasma' },
    palette: {
      colorScheme: 'dark',
      background: '#080c16',
      surface: '#111829',
      text: '#e6edf7',
      accent: '#38bdf8',
    },
    effects: {
      backdrop: {
        id: 'custom-shader',
        intensity: 0.85,
        shader: {
          fragment:
            'void mainImage(out vec4 fragColor, in vec2 fragCoord) { vec2 uv = fragCoord / u_resolution; fragColor = premultiply(mix(u_bg, u_accent, 0.5 + 0.5 * sin(uv.x * u_density + u_time)), 0.85); }',
          fallbackColors: ['#080c16', '#38bdf8'],
          params: [
            {
              key: 'density',
              kind: 'number',
              label: 'Wave density',
              min: 1,
              max: 12,
              step: 1,
              defaultValue: 6,
            },
          ],
        },
      },
    },
  });

  await dialog.getByRole('textbox', { name: 'Paste theme JSON' }).fill(customShaderTheme);
  await dialog.getByRole('button', { name: 'Preview import' }).click();
  await expect(dialog.getByText('Includes GPU shader')).toBeVisible();

  const shaderCheckbox = dialog.getByRole('checkbox', { name: /Include custom GPU shader/i });
  await expect(shaderCheckbox).not.toBeChecked();
  await shaderCheckbox.check();
  await dialog.getByRole('button', { name: 'Apply imported theme' }).click();

  await expect(dialog.getByText('Custom GPU Shader active')).toBeVisible();
  await expect(dialog.getByRole('slider', { name: 'Wave density' })).toBeVisible();
  await expect(page.locator('[data-fs-backdrop="custom-shader"]')).toHaveCount(1);
});
