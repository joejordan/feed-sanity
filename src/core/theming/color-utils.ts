import type { ThemePalette } from './types';
import { parseCssColor, rgbaContrastRatio, rgbaLuminance } from '../theme';

export const WCAG_AA_TEXT_CONTRAST = 4.5;
export const WCAG_AA_ACCENT_CONTRAST = 3;

const HEX6 = /^#([0-9a-f]{6})$/i;
const HEX3 = /^#([0-9a-f]{3})$/i;

/** Validates and normalizes `#rgb` or `#rrggbb` to lowercase `#rrggbb`, or returns `null`. */
export function normalizeHex(input: string): string | null {
  const trimmed = input.trim();
  if (HEX6.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  const short = HEX3.exec(trimmed);
  if (short?.[1]) {
    const [r, g, b] = short[1];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return null;
}

function parseHexRgb(hex: string, fallback = '#000000'): [number, number, number] {
  const norm = normalizeHex(hex) ?? fallback;
  return [
    Number.parseInt(norm.slice(1, 3), 16),
    Number.parseInt(norm.slice(3, 5), 16),
    Number.parseInt(norm.slice(5, 7), 16),
  ];
}

/** Converts `#rrggbb` into a bare `R, G, B` triplet (e.g. `'30, 30, 46'`). */
export function hexToRgbTriplet(hex: string): string {
  const [r, g, b] = parseHexRgb(hex);
  return `${r}, ${g}, ${b}`;
}

/** Computes WCAG 2.1 relative luminance (`0..1`) to pick crisp dark/light text on custom colors. */
export function relativeLuminance(hex: string): number {
  const parsed = parseCssColor(hex);
  return parsed ? rgbaLuminance(parsed) : 0;
}

/** Converts `#rrggbb` into a bare `H S% L%` triplet (e.g. `'220 20% 15%'`). */
export function hexToHslTriplet(hex: string): string {
  const [ri, gi, bi] = parseHexRgb(hex);
  const r = ri / 255;
  const g = gi / 255;
  const b = bi / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) {
      h = (g - b) / d + (g < b ? 6 : 0);
    } else if (max === g) {
      h = (b - r) / d + 2;
    } else {
      h = (r - g) / d + 4;
    }
    h *= 60;
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/** Mixes two `#rrggbb` colors by `weight` (`0` = `a`, `1` = `b`) into `#rrggbb`. */
export function mixHex(a: string, b: string, weight: number): string {
  const [ra, ga, ba] = parseHexRgb(a, '#000000');
  const [rb, gb, bb] = parseHexRgb(b, '#ffffff');
  const w = Math.max(0, Math.min(1, weight));
  const mix = (ca: number, cb: number): string =>
    Math.round(ca + (cb - ca) * w)
      .toString(16)
      .padStart(2, '0');
  return `#${mix(ra, rb)}${mix(ga, gb)}${mix(ba, bb)}`;
}

/** Computes the WCAG 2.1 contrast ratio (`1..21`) between two `#rrggbb` colors. */
export function contrastRatio(a: string, b: string): number {
  const fg = parseCssColor(a);
  const bg = parseCssColor(b);
  return fg && bg ? rgbaContrastRatio(fg, bg) : 1;
}

/** Picks `#ffffff` or `#111111` for maximum contrast on top of `backgroundHex`. */
export const contrastingText = (backgroundHex: string): string =>
  relativeLuminance(backgroundHex) > 0.42 ? '#111111' : '#ffffff';

/** Returns the lower WCAG 2.1 contrast ratio of `text` against both `background` and `surface`. */
export function minTextContrast(text: string, background: string, surface: string): number {
  return Math.min(contrastRatio(text, background), contrastRatio(text, surface));
}

/** Picks `#ffffff` or `#111111` for the highest worst-case contrast across `background` and `surface`. */
export function pickAccessibleText(background: string, surface: string): string {
  const whiteMin = minTextContrast('#ffffff', background, surface);
  const darkMin = minTextContrast('#111111', background, surface);
  if (whiteMin === darkMin) {
    return contrastingText(background);
  }
  return whiteMin > darkMin ? '#ffffff' : '#111111';
}

/**
 * Deterministically hydrates omitted optional palette tokens (`surfaceAlt`, `textMuted`,
 * `border`, `accentSecondary`, `accentText`, `danger`) from the 4 required hex tokens.
 */
export function hydratePalette(
  raw: Partial<ThemePalette> &
    Pick<ThemePalette, 'colorScheme' | 'background' | 'surface' | 'text' | 'accent'>,
): ThemePalette {
  const isLight = raw.colorScheme === 'light';
  const background = normalizeHex(raw.background) ?? (isLight ? '#f4efe6' : '#0b0f17');
  const surface = normalizeHex(raw.surface) ?? (isLight ? '#ffffff' : '#131926');
  const text = normalizeHex(raw.text) ?? (isLight ? '#111111' : '#f8fafc');
  const accent = normalizeHex(raw.accent) ?? (isLight ? '#1d4ed8' : '#3b82f6');

  const surfaceAlt =
    normalizeHex(raw.surfaceAlt ?? '') ??
    mixHex(surface, isLight ? background : text, isLight ? 0.55 : 0.08);
  const textMuted =
    normalizeHex(raw.textMuted ?? '') ?? mixHex(text, surface, isLight ? 0.32 : 0.36);
  const border = normalizeHex(raw.border ?? '') ?? mixHex(surface, text, isLight ? 0.16 : 0.14);
  const accentText = normalizeHex(raw.accentText ?? '') ?? pickAccessibleText(accent, accent);
  const danger = normalizeHex(raw.danger ?? '') ?? (isLight ? '#dc2626' : '#f87171');
  const accentSecondary = normalizeHex(raw.accentSecondary ?? '') ?? undefined;

  return {
    colorScheme: raw.colorScheme,
    background,
    surface,
    surfaceAlt,
    text,
    textMuted,
    border,
    accent,
    ...(accentSecondary ? { accentSecondary } : {}),
    accentText,
    danger,
  };
}

/** Returns custom swatches when provided, otherwise derives swatches from `palette`. */
export function getPaletteSwatches(
  palette: ThemePalette | null,
  customSwatches?: readonly string[],
  includeSecondaryAccent = false,
): readonly string[] {
  if (customSwatches && customSwatches.length >= 2) {
    return customSwatches;
  }
  if (!palette) {
    return [];
  }
  return [
    palette.background,
    palette.surface,
    palette.text,
    palette.accent,
    ...(includeSecondaryAccent && palette.accentSecondary ? [palette.accentSecondary] : []),
  ];
}
