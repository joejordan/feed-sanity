import { describe, expect, it } from 'vitest';
import {
  compositeOver,
  isNeutralColor,
  isOppositePolarityNeutral,
  mapHostNeutralToPalette,
  matchesBrandHue,
  parseCssColor,
  rgbaContrastRatio,
  rgbToOklch,
} from './color';
import { detectConfirmedHostColorScheme, detectHostColorScheme } from './host-scheme';
import { findThemePreset } from './presets';

const warmPaper = findThemePreset('warm-paper')!.palette;
const mocha = findThemePreset('catppuccin-mocha')!.palette;

describe('core/theming/color', () => {
  it('parses hex, rgb, rgba, modern slash rgb, hsl, and named colors', () => {
    expect(parseCssColor('#0f1419')).toEqual({ r: 15, g: 20, b: 25, a: 1 });
    expect(parseCssColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseCssColor('rgb(21, 32, 43)')).toEqual({ r: 21, g: 32, b: 43, a: 1 });
    expect(parseCssColor('rgba(0, 0, 0, 0.65)')).toEqual({ r: 0, g: 0, b: 0, a: 0.65 });
    expect(parseCssColor('rgb(231 233 234 / 50%)')).toEqual({ r: 231, g: 233, b: 234, a: 0.5 });
    expect(parseCssColor('hsl(204 88% 53%)')).toMatchObject({ a: 1 });
    expect(parseCssColor('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseCssColor('var(--x-bg)')).toBeNull();
  });

  it('distinguishes neutral UI chrome (including X Dim slate) from chromatic status/brand hues', () => {
    // Black, white, grey, and X Dim (#15202b) are all UI neutrals.
    expect(isNeutralColor(parseCssColor('#000000')!)).toBe(true);
    expect(isNeutralColor(parseCssColor('#15202b')!)).toBe(true);
    expect(isNeutralColor(parseCssColor('#e7e9ea')!)).toBe(true);
    expect(isNeutralColor(parseCssColor('#536471')!)).toBe(true);

    // Brand blue, error red, and online green are chromatic.
    expect(isNeutralColor(parseCssColor('#1d9bf0')!)).toBe(false);
    expect(isNeutralColor(parseCssColor('#f4212e')!)).toBe(false);
    expect(isNeutralColor(parseCssColor('#00ba7c')!)).toBe(false);

    const xBlue = [rgbToOklch(parseCssColor('#1d9bf0')!)];
    expect(matchesBrandHue(parseCssColor('#1a8cd8')!, xBlue)).toBe(true);
    expect(matchesBrandHue(parseCssColor('#f4212e')!, xBlue)).toBe(false);
  });

  it('maps host dark and light neutral paint roles without ever painting transparent backgrounds', () => {
    // Transparent always returns null (never turns invisible wrappers opaque).
    expect(
      mapHostNeutralToPalette({ r: 0, g: 0, b: 0, a: 0 }, 'dark', 'background', warmPaper),
    ).toBeNull();

    // Dark host -> Warm Paper (light)
    expect(
      mapHostNeutralToPalette(parseCssColor('#000000')!, 'dark', 'background', warmPaper),
    ).toBe(warmPaper.background);
    expect(
      mapHostNeutralToPalette(parseCssColor('#202327')!, 'dark', 'background', warmPaper),
    ).toBe(warmPaper.surface);
    expect(
      mapHostNeutralToPalette(
        parseCssColor('rgba(0, 0, 0, 0.65)')!,
        'dark',
        'background',
        warmPaper,
      ),
    ).toContain('65%');
    expect(mapHostNeutralToPalette(parseCssColor('#e7e9ea')!, 'dark', 'text', warmPaper)).toBe(
      warmPaper.text,
    );
    expect(mapHostNeutralToPalette(parseCssColor('#71767b')!, 'dark', 'text', warmPaper)).toBe(
      warmPaper.textMuted,
    );
    expect(mapHostNeutralToPalette(parseCssColor('#2f3336')!, 'dark', 'border', warmPaper)).toBe(
      warmPaper.border,
    );
    // Canvas-matched borders (#000 on dark host, #fff on light host) stay canvas-matched so
    // invisible button borders and avatar cutouts never turn into visible rings.
    expect(mapHostNeutralToPalette(parseCssColor('#000000')!, 'dark', 'border', warmPaper)).toBe(
      warmPaper.background,
    );

    // Light host -> Catppuccin Mocha (dark)
    expect(mapHostNeutralToPalette(parseCssColor('#ffffff')!, 'light', 'background', mocha)).toBe(
      mocha.background,
    );
    expect(mapHostNeutralToPalette(parseCssColor('#ffffff')!, 'light', 'border', mocha)).toBe(
      mocha.background,
    );
    expect(mapHostNeutralToPalette(parseCssColor('#cfd9de')!, 'light', 'border', mocha)).toBe(
      mocha.border,
    );
    expect(mapHostNeutralToPalette(parseCssColor('#0f1419')!, 'light', 'text', mocha)).toBe(
      mocha.text,
    );
  });

  it('composites alpha layers and computes WCAG contrast accurately', () => {
    const halfBlack = compositeOver({ r: 0, g: 0, b: 0, a: 0.5 }, { r: 255, g: 255, b: 255, a: 1 });
    expect(halfBlack).toEqual({ r: 128, g: 128, b: 128, a: 1 });
    expect(
      rgbaContrastRatio({ r: 0, g: 0, b: 0, a: 1 }, { r: 255, g: 255, b: 255, a: 1 }),
    ).toBeCloseTo(21, 1);
    expect(rgbaContrastRatio(parseCssColor('#e7e9ea')!, parseCssColor('#f4efe6')!)).toBeLessThan(
      1.5,
    );
  });

  it('detects confirmed vs unconfirmed host color scheme and catches X Dim opposite-polarity neutrals', () => {
    document.body.style.backgroundColor = '';
    document.documentElement.style.backgroundColor = '';
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.className = '';
    document.body.innerHTML = '';

    // Unstyled transparent document returns null from confirmed detector (never locks a guess).
    expect(detectConfirmedHostColorScheme(document)).toBeNull();
    expect(detectHostColorScheme(document)).toBe('light');

    // Detects dark canvas painted on `#react-root` when `body` stays transparent.
    document.body.innerHTML = '<div id="react-root" style="background-color: rgb(0, 0, 0);"></div>';
    expect(detectConfirmedHostColorScheme(document)).toBe('dark');
    document.body.innerHTML = '';

    // Detects YouTube-style bare `<html dark>` / `<html light>` boolean attributes (ignoring `"false"` / `"0"`).
    document.documentElement.setAttribute('dark', '');
    expect(detectConfirmedHostColorScheme(document)).toBe('dark');
    document.documentElement.setAttribute('dark', 'false');
    expect(detectConfirmedHostColorScheme(document)).toBeNull();
    document.documentElement.setAttribute('dark', '0');
    expect(detectConfirmedHostColorScheme(document)).toBeNull();
    document.documentElement.removeAttribute('dark');
    document.documentElement.setAttribute('light', '');
    expect(detectConfirmedHostColorScheme(document)).toBe('light');
    document.documentElement.removeAttribute('light');

    // Detects `data-color-scheme` / `data-bs-theme` even when an earlier attribute is `"auto"`,
    // checks `document.body` classes/attributes, and ignores unrelated or ambiguous class names.
    document.documentElement.setAttribute('data-theme', 'auto');
    document.documentElement.setAttribute('data-color-scheme', 'dark');
    expect(detectConfirmedHostColorScheme(document)).toBe('dark');
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-color-scheme');
    document.documentElement.setAttribute('data-bs-theme', 'dark');
    expect(detectConfirmedHostColorScheme(document)).toBe('dark');
    document.documentElement.removeAttribute('data-bs-theme');
    document.documentElement.className = 'highlight spotlight';
    expect(detectConfirmedHostColorScheme(document)).toBeNull();
    document.documentElement.className = 'theme-dark theme-light';
    expect(detectConfirmedHostColorScheme(document)).toBeNull();
    document.documentElement.className = 'is_darkmode';
    expect(detectConfirmedHostColorScheme(document)).toBe('dark');
    document.documentElement.className = '';

    document.body.className = 'theme-dark';
    expect(detectConfirmedHostColorScheme(document)).toBe('dark');
    document.body.className = '';
    document.body.setAttribute('data-theme', 'light');
    expect(detectConfirmedHostColorScheme(document)).toBe('light');
    document.body.removeAttribute('data-theme');

    // Detects dark canvas painted on `#root`, `#app`, `#__next`, and `[role="main"]`.
    for (const html of [
      '<div id="root" style="background-color: rgb(15, 15, 15);"></div>',
      '<div id="app" style="background-color: rgb(15, 15, 15);"></div>',
      '<div id="__next" style="background-color: rgb(15, 15, 15);"></div>',
      '<div role="main" style="background-color: rgb(15, 15, 15);"></div>',
    ]) {
      document.body.innerHTML = html;
      expect(detectConfirmedHostColorScheme(document)).toBe('dark');
    }
    document.body.innerHTML = '';

    document.body.style.backgroundColor = 'rgb(0, 0, 0)';
    expect(detectHostColorScheme(document)).toBe('dark');
    document.body.style.backgroundColor = 'rgb(255, 255, 255)';
    expect(detectHostColorScheme(document)).toBe('light');
    document.body.style.backgroundColor = '';

    // X Dim (#38444d) and dark chrome (#3e4144) are flagged as opposite-polarity on Light themes.
    expect(isOppositePolarityNeutral(parseCssColor('#38444d')!, 'light')).toBe(true);
    expect(isOppositePolarityNeutral(parseCssColor('#3e4144')!, 'light')).toBe(true);
  });
});
