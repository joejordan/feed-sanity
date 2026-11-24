import type { ThemePalette } from './types';
import { parseCssColor, rgbaContrastRatio, rgbaLuminance } from '../theme';

export const WCAG_AA_TEXT_CONTRAST = 4.5;
export const WCAG_AA_ACCENT_CONTRAST = 3;

export const PALETTE_MOODS = [
  'midnight',
  'soft-dark',
  'neon',
  'warm-paper',
  'crisp-light',
  'pastel',
] as const;

export type PaletteMood = (typeof PALETTE_MOODS)[number];

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

function hexToHsl(hex: string): [number, number, number] {
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
  return [((h % 360) + 360) % 360, s, l];
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (channel: number): string =>
    Math.round(Math.max(0, Math.min(255, channel)))
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(1, s));
  const lig = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lig - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) {
    [r, g, b] = [c, x, 0];
  } else if (hue < 120) {
    [r, g, b] = [x, c, 0];
  } else if (hue < 180) {
    [r, g, b] = [0, c, x];
  } else if (hue < 240) {
    [r, g, b] = [0, x, c];
  } else if (hue < 300) {
    [r, g, b] = [x, 0, c];
  } else {
    [r, g, b] = [c, 0, x];
  }
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

/** Converts `#rrggbb` into a bare `H S% L%` triplet (e.g. `'220 20% 15%'`). */
export function hexToHslTriplet(hex: string): string {
  const [h, s, l] = hexToHsl(hex);
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/** Mixes two `#rrggbb` colors by `weight` (`0` = `a`, `1` = `b`) into `#rrggbb`. */
export function mixHex(a: string, b: string, weight: number): string {
  const [ra, ga, ba] = parseHexRgb(a, '#000000');
  const [rb, gb, bb] = parseHexRgb(b, '#ffffff');
  const w = Math.max(0, Math.min(1, weight));
  return rgbToHex(ra + (rb - ra) * w, ga + (gb - ga) * w, ba + (bb - ba) * w);
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

function ensureAccentContrast(
  h: number,
  s: number,
  initialL: number,
  background: string,
  surface: string,
  isLight: boolean,
): string {
  let l = initialL;
  let candidate = hslToHex(h, s, l);
  for (let step = 0; step < 12; step++) {
    if (minTextContrast(candidate, background, surface) >= WCAG_AA_ACCENT_CONTRAST) {
      return candidate;
    }
    l = isLight ? Math.max(0.14, l - 0.04) : Math.min(0.88, l + 0.04);
    candidate = hslToHex(h, s, l);
  }
  return candidate;
}

/**
 * Generates a harmonious, WCAG-AA-verified `ThemePalette` from a single seed
 * hex color and aesthetic `mood`.
 */
export function generateThemePalette(seedHex: string, mood: PaletteMood): ThemePalette {
  const seed = normalizeHex(seedHex) ?? '#3b82f6';
  const [h, rawSat] = hexToHsl(seed);
  const sat = Math.max(0.32, rawSat);

  let colorScheme: 'dark' | 'light';
  let background: string;
  let surface: string;
  let text: string;
  let accentSat: number;
  let accentLightness: number;
  let accentSecondary: string;

  switch (mood) {
    case 'midnight':
      colorScheme = 'dark';
      background = hslToHex(h, Math.min(0.38, sat * 0.45), 0.08);
      surface = hslToHex(h, Math.min(0.32, sat * 0.4), 0.13);
      text = hslToHex(h, 0.2, 0.94);
      accentSat = Math.max(0.58, sat);
      accentLightness = 0.62;
      accentSecondary = hslToHex(h + 38, Math.max(0.55, sat), 0.64);
      break;
    case 'soft-dark':
      colorScheme = 'dark';
      background = hslToHex(h, Math.min(0.22, sat * 0.3), 0.13);
      surface = hslToHex(h, Math.min(0.2, sat * 0.28), 0.18);
      text = hslToHex(h, 0.14, 0.92);
      accentSat = Math.min(0.76, Math.max(0.45, sat));
      accentLightness = 0.66;
      accentSecondary = hslToHex(h + 32, 0.55, 0.68);
      break;
    case 'neon':
      colorScheme = 'dark';
      background = hslToHex(h + 15, 0.36, 0.06);
      surface = hslToHex(h + 15, 0.32, 0.11);
      text = hslToHex(h, 0.24, 0.96);
      accentSat = 0.92;
      accentLightness = 0.62;
      accentSecondary = hslToHex(h + 145, 0.9, 0.6);
      break;
    case 'warm-paper':
      colorScheme = 'light';
      background = hslToHex(36, 0.36, 0.94);
      surface = hslToHex(38, 0.44, 0.98);
      text = hslToHex(h, 0.2, 0.14);
      accentSat = Math.max(0.54, sat);
      accentLightness = 0.4;
      accentSecondary = hslToHex(h + 35, 0.58, 0.44);
      break;
    case 'crisp-light':
      colorScheme = 'light';
      background = hslToHex(h, Math.min(0.28, sat * 0.35), 0.95);
      surface = '#ffffff';
      text = hslToHex(h, 0.24, 0.13);
      accentSat = Math.max(0.58, sat);
      accentLightness = 0.42;
      accentSecondary = hslToHex(h + 42, 0.62, 0.46);
      break;
    case 'pastel':
      colorScheme = 'light';
      background = hslToHex(h, Math.min(0.46, sat * 0.55), 0.93);
      surface = hslToHex(h, Math.min(0.38, sat * 0.45), 0.97);
      text = hslToHex(h, 0.28, 0.16);
      accentSat = Math.max(0.56, sat);
      accentLightness = 0.44;
      accentSecondary = hslToHex(h + 55, 0.6, 0.48);
      break;
  }

  const accent = ensureAccentContrast(
    h,
    accentSat,
    accentLightness,
    background,
    surface,
    colorScheme === 'light',
  );
  if (minTextContrast(text, background, surface) < WCAG_AA_TEXT_CONTRAST) {
    text = pickAccessibleText(background, surface);
  }
  return hydratePalette({
    colorScheme,
    background,
    surface,
    text,
    accent,
    accentSecondary,
  });
}

/**
 * Flips a palette between dark and light polarity while preserving its accent
 * identity and WCAG-AA readability.
 */
export function flipPaletteScheme(palette: ThemePalette): ThemePalette {
  const targetMood: PaletteMood = palette.colorScheme === 'dark' ? 'crisp-light' : 'midnight';
  const flipped = generateThemePalette(palette.accent, targetMood);
  if (!palette.accentSecondary) {
    return flipped;
  }
  const [secH, secS] = hexToHsl(palette.accentSecondary);
  const adaptedSecondary = hslToHex(
    secH,
    Math.max(0.45, secS),
    flipped.colorScheme === 'dark' ? 0.64 : 0.44,
  );
  return { ...flipped, accentSecondary: adaptedSecondary };
}
