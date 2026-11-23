// Perceptual color parsing (OKLCH), contrast math, and semantic role
// classification for the self-adapting theme compiler, real-time healer, and
// automated theme coverage auditor. Zero runtime dependency on `../theming`.

import type { ThemeColorScheme, ThemePalette } from '../theming';

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

/** Formats `#rrggbb` with alpha (`0..1`) as modern CSS `rgb(r g b / pct%)`. */
export function hexWithAlpha(hex: string, alpha: number): string {
  const parsed = parseCssColor(hex);
  const r = parsed?.r ?? 0;
  const g = parsed?.g ?? 0;
  const b = parsed?.b ?? 0;
  const pct = Math.round(clamp01(alpha) * 100);
  return `rgb(${r} ${g} ${b} / ${pct}%)`;
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
    r = c;
    g = x;
  } else if (hue < 120) {
    r = x;
    g = c;
  } else if (hue < 180) {
    g = c;
    b = x;
  } else if (hue < 240) {
    g = x;
    b = c;
  } else if (hue < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  return [clamp255((r + m) * 255), clamp255((g + m) * 255), clamp255((b + m) * 255)];
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

/** WCAG 2.1 contrast ratio (`1..21`) between two opaque/composited RGBA colors. */
export function rgbaContrastRatio(fg: RgbaColor, bg: RgbaColor): number {
  const compositedFg = fg.a < 1 ? compositeOver(fg, bg) : fg;
  const l1 = rgbaLuminance(compositedFg);
  const l2 = rgbaLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
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
 * active theme (`L < 0.36` on a light theme, or `L > 0.80` on a dark theme).
 */
export function isOppositePolarityNeutral(
  color: RgbaColor,
  colorScheme: ThemeColorScheme,
  oklch: OklchColor = rgbToOklch(color),
): boolean {
  if (color.a < 0.5 || !isNeutralColor(color, 0.045, oklch)) {
    return false;
  }
  return colorScheme === 'light' ? oklch.L < 0.36 : oklch.L > 0.8;
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
  oklch: OklchColor = rgbToOklch(color),
): boolean {
  if (brandOklch.length === 0 || oklch.C < 0.07) {
    return false;
  }
  return brandOklch.some(
    (brand) => hueDistance(oklch.H, brand.H) <= 22 && Math.abs(oklch.L - brand.L) <= 0.22,
  );
}

export type PaintPropertyKind = 'background' | 'border' | 'text';

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
  oklch: OklchColor = rgbToOklch(color),
): string | null {
  // Never invent paint for fully transparent colors (`rgba(0,0,0,0)`).
  if (color.a <= 0.005) {
    return null;
  }
  // Normalize lightness along the host's native axis: `0` = host canvas, `1` = host ink.
  const t = hostScheme === 'dark' ? oklch.L : 1 - oklch.L;

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
      // Opposite-polarity surface (e.g., high-contrast inverted pill button or light card on dark host).
      return null;
    }
  } else if (kind === 'border') {
    baseHex = palette.border;
  } else if (t >= 0.72) {
    baseHex = palette.text;
  } else if (t >= 0.36) {
    baseHex = palette.textMuted;
  } else {
    // Low-contrast-to-canvas text (e.g. dark ink on an inverted light pill button).
    return null;
  }

  return color.a < 0.99 ? hexWithAlpha(baseHex, color.a) : baseHex;
}

/**
 * Infers the host document's native polarity (`'dark' | 'light'`) from
 * computed `body` / `documentElement` styles before our theme styles run.
 */
export function detectHostColorScheme(doc: Document): ThemeColorScheme {
  const view = doc.defaultView ?? globalThis;
  const roots = [doc.body, doc.documentElement].filter((el): el is HTMLElement => el !== null);
  for (const el of roots) {
    try {
      const style = view.getComputedStyle(el);
      const bg = parseCssColor(style.backgroundColor);
      if (bg && bg.a >= 0.5) {
        return rgbToOklch(bg).L < 0.5 ? 'dark' : 'light';
      }
      const scheme = style.colorScheme?.toLowerCase() ?? '';
      if (scheme.includes('dark') && !scheme.includes('light')) {
        return 'dark';
      }
      if (scheme.includes('light') && !scheme.includes('dark')) {
        return 'light';
      }
    } catch {
      // Ignore detached or non-styled test documents.
    }
  }
  const html = doc.documentElement;
  if (html) {
    const themeAttr = html.getAttribute('data-theme')?.toLowerCase() ?? '';
    if (themeAttr.includes('dark') || themeAttr.includes('dim')) {
      return 'dark';
    }
    if (html.className.toLowerCase().includes('dark')) {
      return 'dark';
    }
  }
  return 'light';
}
