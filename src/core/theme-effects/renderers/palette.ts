// Palette harmonization helpers shared by the Canvas 2D and WebGL backdrop
// renderers: parse theme colors once, mix them, and format them for canvas.

import type { ThemeColorScheme } from '../../theming';
import type { BackdropContext } from './types';
import { parseCssColor } from '../../theme';
import { clamp, lerp } from '../digital-rain/math';

/** RGB triple with channels in `0..255`. */
export type Rgb = readonly [number, number, number];

export interface ScenePalette {
  readonly scheme: ThemeColorScheme;
  readonly accent: Rgb;
  /** Secondary accent (the palette's `danger` tone). */
  readonly alt: Rgb;
  readonly text: Rgb;
  readonly background: Rgb;
  readonly surface: Rgb;
  /** True when no theme palette is active and renderers may use their signature colors. */
  readonly native: boolean;
  /** Stable key so renderers rebuild cached layers only when colors actually change. */
  readonly key: string;
}

/** Colors used when the site keeps its own palette. */
export const FALLBACK_COLORS = {
  dark: {
    accent: '#3b82f6',
    alt: '#ec4899',
    text: '#f8fafc',
    background: '#06090f',
    surface: '#111622',
  },
  light: {
    accent: '#1d4ed8',
    alt: '#db2777',
    text: '#0f172a',
    background: '#f8fafc',
    surface: '#ffffff',
  },
} as const;

export const WHITE: Rgb = [255, 255, 255];
export const BLACK: Rgb = [0, 0, 0];

export function toRgb(color: string | undefined, fallback: string): Rgb {
  const parsed = (color ? parseCssColor(color) : null) ?? parseCssColor(fallback);
  return parsed ? [parsed.r, parsed.g, parsed.b] : [0, 0, 0];
}

/** Parses a literal color constant. */
export function hexRgb(hex: string): Rgb {
  return toRgb(hex, hex);
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const k = clamp(t, 0, 1);
  return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
}

/** Formats an RGB triple as a canvas-ready `rgba()` string. */
export function rgbCss(c: Rgb, alpha = 1): string {
  const a = clamp(alpha, 0, 1);
  return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${Number(a.toFixed(3))})`;
}

/** Normalized `0..1` channels for WebGL uniforms. */
export function rgbUnit(c: Rgb): [number, number, number] {
  return [c[0] / 255, c[1] / 255, c[2] / 255];
}

/** Rotates hue while keeping saturation and lightness (HSL). */
export function rotateHue(c: Rgb, degrees: number): Rgb {
  const r = c[0] / 255;
  const g = c[1] / 255;
  const b = c[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  if (chroma === 0) {
    return c;
  }
  let h: number;
  if (max === r) {
    h = ((g - b) / chroma) % 6;
  } else if (max === g) {
    h = (b - r) / chroma + 2;
  } else {
    h = (r - g) / chroma + 4;
  }
  h = (((h * 60 + degrees) % 360) + 360) % 360;
  // Rebuilding with the same chroma and minimum keeps HSL saturation and lightness.
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const sector = Math.floor(h / 60);
  const table: ReadonlyArray<readonly [number, number, number]> = [
    [chroma, x, 0],
    [x, chroma, 0],
    [0, chroma, x],
    [0, x, chroma],
    [x, 0, chroma],
    [chroma, 0, x],
  ];
  const [rr, gg, bb] = table[sector] ?? [chroma, x, 0];
  return [(rr + min) * 255, (gg + min) * 255, (bb + min) * 255];
}

export function resolveScenePalette(ctx: BackdropContext): ScenePalette {
  const scheme = ctx.palette?.colorScheme ?? ctx.hostScheme;
  const base = FALLBACK_COLORS[scheme];
  const p = ctx.palette;
  const accent = toRgb(p?.accent, base.accent);
  const alt = toRgb(p?.danger, base.alt);
  const text = toRgb(p?.text, base.text);
  const background = toRgb(p?.background, base.background);
  const surface = toRgb(p?.surface, base.surface);
  const key = [scheme, p ? 'theme' : 'native', accent, alt, text, background, surface]
    .map((part) => (Array.isArray(part) ? part.map(Math.round).join(',') : String(part)))
    .join('|');
  return { scheme, accent, alt, text, background, surface, native: !p, key };
}

/**
 * Memoizes colors derived from a palette. The scene host hands every frame the
 * same palette object until the theme changes, so this runs once per change.
 */
export function derivePalette<T>(derive: (palette: ScenePalette) => T): (p: ScenePalette) => T {
  let last: ScenePalette | null = null;
  let value: T | undefined;
  return (palette) => {
    if (palette !== last || value === undefined) {
      last = palette;
      value = derive(palette);
    }
    return value;
  };
}
