// Unified pure color math: CSS color parsing (hex/rgb/hsl/named), OKLCH
// perceptual classification, WCAG 2.1 contrast, palette hydration/equality,
// and WCAG-AA palette generation & polarity flipping. Zero DOM dependencies.

import type { ThemeColorScheme, ThemePalette } from './types';

export interface RgbaColor {
  /** 0..255 */
  readonly r: number;
  /** 0..255 */
  readonly g: number;
  /** 0..255 */
  readonly b: number;
  /** 0..1 */
  readonly a: number;
}

export interface OklchColor {
  /** Perceptual lightness 0..1 */
  readonly L: number;
  /** Perceptual chroma >= 0 (~0..0.37 for sRGB) */
  readonly C: number;
  /** Hue angle in degrees 0..360 */
  readonly H: number;
}

export type PaintPropertyKind = 'background' | 'border' | 'text';

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
const MAX_COLOR_CACHE = 512;
const parseCache = new Map<string, RgbaColor | null>();

const NAMED_COLORS: Record<string, RgbaColor> = {
  transparent: { r: 0, g: 0, b: 0, a: 0 },
  black: { r: 0, g: 0, b: 0, a: 1 },
  white: { r: 255, g: 255, b: 255, a: 1 },
  gray: { r: 128, g: 128, b: 128, a: 1 },
  grey: { r: 128, g: 128, b: 128, a: 1 },
  silver: { r: 192, g: 192, b: 192, a: 1 },
  darkgray: { r: 169, g: 169, b: 169, a: 1 },
  darkgrey: { r: 169, g: 169, b: 169, a: 1 },
  lightgray: { r: 211, g: 211, b: 211, a: 1 },
  lightgrey: { r: 211, g: 211, b: 211, a: 1 },
  dimgray: { r: 105, g: 105, b: 105, a: 1 },
  dimgrey: { r: 105, g: 105, b: 105, a: 1 },
  whitesmoke: { r: 245, g: 245, b: 245, a: 1 },
  gainsboro: { r: 220, g: 220, b: 220, a: 1 },
};

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const clamp255 = (v: number): number => Math.min(255, Math.max(0, Math.round(v)));

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

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (channel: number): string => clamp255(channel).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp01(s);
  const lig = clamp01(l);
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
  return [clamp255((r + m) * 255), clamp255((g + m) * 255), clamp255((b + m) * 255)];
}

function hslToHex(h: number, s: number, l: number): string {
  const [r, g, b] = hslToRgb(h, s, l);
  return rgbToHex(r, g, b);
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

/** Converts `#rrggbb` into a bare `R, G, B` triplet (e.g. `'30, 30, 46'`). */
export function hexToRgbTriplet(hex: string): string {
  const [r, g, b] = parseHexRgb(hex);
  return `${r}, ${g}, ${b}`;
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
  const w = clamp01(weight);
  return rgbToHex(ra + (rb - ra) * w, ga + (gb - ga) * w, ba + (bb - ba) * w);
}

function parseAlpha(token: string | undefined): number | null {
  if (token === undefined || token === '') {
    return 1;
  }
  if (token.endsWith('%')) {
    const pct = Number.parseFloat(token.slice(0, -1));
    return Number.isFinite(pct) ? clamp01(pct / 100) : null;
  }
  const num = Number.parseFloat(token);
  return Number.isFinite(num) ? clamp01(num) : null;
}

function parseRgbChannel(token: string): number | null {
  if (token.endsWith('%')) {
    const pct = Number.parseFloat(token.slice(0, -1));
    return Number.isFinite(pct) ? clamp255((pct / 100) * 255) : null;
  }
  const num = Number.parseFloat(token);
  return Number.isFinite(num) ? clamp255(num) : null;
}

function parseHexColor(raw: string): RgbaColor | null {
  let hex = raw.slice(1);
  if (hex.length === 3 || hex.length === 4) {
    hex = [...hex].map((ch) => ch + ch).join('');
  }
  if (hex.length !== 6 && hex.length !== 8) {
    return null;
  }
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  const a = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1;
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b) || Number.isNaN(a)) {
    return null;
  }
  return { r, g, b, a };
}

function parseColorUncached(input: string): RgbaColor | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed || trimmed.includes('var(') || trimmed.includes('calc(')) {
    return null;
  }
  const named = NAMED_COLORS[trimmed];
  if (named) {
    return named;
  }
  if (trimmed.startsWith('#')) {
    return parseHexColor(trimmed);
  }
  const fnMatch = /^(rgba?|hsla?)\(([^)]+)\)$/.exec(trimmed);
  if (!fnMatch) {
    return null;
  }
  const fn = fnMatch[1] ?? '';
  const inner = (fnMatch[2] ?? '').trim();
  const slashParts = inner.split('/');
  if (slashParts.length > 2) {
    return null;
  }
  const mainParts = (slashParts[0] ?? '')
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
  const alphaToken = slashParts[1]?.trim() ?? mainParts[3];
  if (mainParts.length < 3 || mainParts.length > 4) {
    return null;
  }
  const a = parseAlpha(alphaToken);
  if (a === null) {
    return null;
  }
  if (fn === 'rgb' || fn === 'rgba') {
    const r = parseRgbChannel(mainParts[0] ?? '');
    const g = parseRgbChannel(mainParts[1] ?? '');
    const b = parseRgbChannel(mainParts[2] ?? '');
    if (r === null || g === null || b === null) {
      return null;
    }
    return { r, g, b, a };
  }
  const hRaw = mainParts[0] ?? '';
  let h = Number.parseFloat(hRaw);
  if (hRaw.endsWith('turn')) {
    h *= 360;
  } else if (hRaw.endsWith('rad')) {
    h = (h * 180) / Math.PI;
  } else if (hRaw.endsWith('grad')) {
    h *= 0.9;
  }
  const s = Number.parseFloat((mainParts[1] ?? '').replace('%', '')) / 100;
  const l = Number.parseFloat((mainParts[2] ?? '').replace('%', '')) / 100;
  if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(l)) {
    return null;
  }
  const [r, g, b] = hslToRgb(h, s, l);
  return { r, g, b, a };
}

/** Parses any standard CSS hex/rgb/rgba/hsl/hsla/named neutral color into RGBA. */
export function parseCssColor(input: string): RgbaColor | null {
  const cached = parseCache.get(input);
  if (cached !== undefined) {
    return cached;
  }
  const parsed = parseColorUncached(input);
  if (parseCache.size >= MAX_COLOR_CACHE) {
    const oldest = parseCache.keys().next().value;
    if (oldest !== undefined) {
      parseCache.delete(oldest);
    }
  }
  parseCache.set(input, parsed);
  return parsed;
}

/** Formats `#rrggbb` with alpha (`0..1`) as modern CSS `rgb(r g b / pct%)`. */
export function hexWithAlpha(hex: string, alpha: number): string {
  const parsed = parseCssColor(hex);
  const r = parsed?.r ?? 0;
  const g = parsed?.g ?? 0;
  const b = parsed?.b ?? 0;
  const pct = Math.round(clamp01(alpha) * 100);
  return `rgb(${r} ${g} ${b} / ${pct}%)`;
}

function srgbChannelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.1 relative luminance (0 = black, 1 = white). */
export function rgbaLuminance(color: RgbaColor): number {
  return (
    0.2126 * srgbChannelToLinear(color.r) +
    0.7152 * srgbChannelToLinear(color.g) +
    0.0722 * srgbChannelToLinear(color.b)
  );
}

/** Computes WCAG 2.1 relative luminance (`0..1`) for a CSS hex color. */
export function relativeLuminance(hex: string): number {
  const parsed = parseCssColor(hex);
  return parsed ? rgbaLuminance(parsed) : 0;
}

/** Porter-Duff source-over alpha compositing of `top` onto opaque `bottom`. */
export function compositeOver(top: RgbaColor, bottom: RgbaColor): RgbaColor {
  const a = top.a;
  if (a >= 1) {
    return top;
  }
  if (a <= 0) {
    return bottom;
  }
  const inv = 1 - a;
  return {
    r: clamp255(top.r * a + bottom.r * inv),
    g: clamp255(top.g * a + bottom.g * inv),
    b: clamp255(top.b * a + bottom.b * inv),
    a: clamp01(a + bottom.a * inv),
  };
}

/** WCAG 2.1 contrast ratio (`1..21`) between two opaque/composited RGBA colors. */
export function rgbaContrastRatio(fg: RgbaColor, bg: RgbaColor): number {
  const compositedFg = fg.a < 1 ? compositeOver(fg, bg) : fg;
  const l1 = rgbaLuminance(compositedFg);
  const l2 = rgbaLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
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
  if (background === surface) {
    return contrastRatio(text, background);
  }
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

/** Converts sRGB (`0..255`) into perceptual OKLCH (`L: 0..1`, `C >= 0`, `H: 0..360`). */
export function rgbToOklch(color: RgbaColor): OklchColor {
  const r = srgbChannelToLinear(color.r);
  const g = srgbChannelToLinear(color.g);
  const b = srgbChannelToLinear(color.b);

  const l = Math.cbrt(0.412_221_470_8 * r + 0.536_332_536_3 * g + 0.051_445_992_9 * b);
  const m = Math.cbrt(0.211_903_498_2 * r + 0.680_699_545_1 * g + 0.107_396_956_6 * b);
  const s = Math.cbrt(0.088_302_461_9 * r + 0.281_718_837_6 * g + 0.629_978_700_5 * b);

  const L = 0.210_454_255_3 * l + 0.793_617_785 * m - 0.004_072_046_8 * s;
  const a = 1.977_998_495_1 * l - 2.428_592_205 * m + 0.450_593_709_9 * s;
  const bLab = 0.025_904_037_1 * l + 0.782_771_766_2 * m - 0.808_675_766 * s;

  const C = Math.hypot(a, bLab);
  const H = C < 1e-5 ? 0 : ((Math.atan2(bLab, a) * 180) / Math.PI + 360) % 360;
  return { L: clamp01(L), C, H };
}

/**
 * True for achromatic and low-chroma UI chrome neutrals (greys, slates, X's
 * Dim `#15202b` navy-grey has `C ≈ 0.029`, while brand/status hues have `C > 0.10`).
 */
export function isNeutralColor(
  color: RgbaColor,
  maxChroma = 0.045,
  oklch: OklchColor = rgbToOklch(color),
): boolean {
  return oklch.C <= maxChroma;
}

/**
 * True when an opaque neutral color belongs to the opposite polarity of the
 * active theme (`L < 0.42` on a light theme — covering X Dim `#38444d` and dark
 * chrome `#3e4144` — or `L > 0.80` on a dark theme).
 */
export function isOppositePolarityNeutral(
  color: RgbaColor,
  colorScheme: ThemeColorScheme,
  oklch?: OklchColor,
): boolean {
  if (color.a < 0.5) {
    return false;
  }
  const lch = oklch ?? rgbToOklch(color);
  if (!isNeutralColor(color, 0.045, lch)) {
    return false;
  }
  return colorScheme === 'light' ? lch.L < 0.42 : lch.L > 0.8;
}

/** Shortest angular distance between two hues in degrees (`0..180`). */
function hueDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * True when a chromatic `color` closely matches one of a site's declared
 * primary brand accent colors (in OKLCH hue + chroma).
 */
export function matchesBrandHue(
  color: RgbaColor,
  brandOklch: readonly OklchColor[],
  oklch?: OklchColor,
): boolean {
  if (brandOklch.length === 0) {
    return false;
  }
  const lch = oklch ?? rgbToOklch(color);
  if (lch.C < 0.07) {
    return false;
  }
  return brandOklch.some(
    (brand) => hueDistance(lch.H, brand.H) <= 22 && Math.abs(lch.L - brand.L) <= 0.22,
  );
}

/**
 * Maps a host UI neutral color onto the corresponding semantic token in
 * `palette`, preserving translucency (`alpha < 1`) so frosted sticky headers
 * and hover washes retain their visual depth.
 */
export function mapHostNeutralToPalette(
  color: RgbaColor,
  hostScheme: ThemeColorScheme,
  kind: PaintPropertyKind,
  palette: ThemePalette,
  oklch?: OklchColor,
): string | null {
  if (color.a <= 0.005) {
    return null;
  }
  const lch = oklch ?? rgbToOklch(color);
  const t = hostScheme === 'dark' ? lch.L : 1 - lch.L;

  let baseHex: string;
  if (kind === 'background') {
    if (color.a < 0.35) {
      baseHex = t > 0.5 ? palette.text : palette.background;
      return hexWithAlpha(baseHex, color.a);
    }
    const bgCutoff = hostScheme === 'dark' ? 0.2 : 0.015;
    const surfaceCutoff = hostScheme === 'dark' ? 0.32 : 0.07;
    const surfaceAltCutoff = hostScheme === 'dark' ? 0.55 : 0.25;
    if (t <= bgCutoff) {
      baseHex = palette.background;
    } else if (t <= surfaceCutoff) {
      baseHex = palette.surface;
    } else if (t <= surfaceAltCutoff) {
      baseHex = palette.surfaceAlt;
    } else {
      return null;
    }
  } else if (kind === 'border') {
    baseHex = palette.border;
  } else if (t >= 0.72) {
    baseHex = palette.text;
  } else if (t >= 0.36) {
    baseHex = palette.textMuted;
  } else {
    return null;
  }

  return color.a < 0.99 ? hexWithAlpha(baseHex, color.a) : baseHex;
}

/** Classifies an opaque color as `'dark'` or `'light'` using perceptual OKLCH lightness. */
export function colorSchemeOf(
  color: RgbaColor,
  oklch: OklchColor = rgbToOklch(color),
): ThemeColorScheme {
  return oklch.L < 0.5 ? 'dark' : 'light';
}

/** Shallow value equality for two optional `ThemePalette` objects. */
export function samePalette(a: ThemePalette | null, b: ThemePalette | null): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return (
    a.colorScheme === b.colorScheme &&
    a.background === b.background &&
    a.surface === b.surface &&
    a.surfaceAlt === b.surfaceAlt &&
    a.text === b.text &&
    a.textMuted === b.textMuted &&
    a.border === b.border &&
    a.accent === b.accent &&
    a.accentSecondary === b.accentSecondary &&
    a.accentText === b.accentText &&
    a.danger === b.danger
  );
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
  const accentSecondary = normalizeHex(raw.accentSecondary ?? '');

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
