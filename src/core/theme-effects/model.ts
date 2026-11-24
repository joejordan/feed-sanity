// Declarative model, validation, safe clamping, and curated Studio Vibes for
// Feed Sanity's Creative Theme & Effects Studio.

import type { RainCharsetName } from './digital-rain/charsets';
import type { RainIntro, RainLookName } from './digital-rain/settings';
import { isRecord } from '../storage';
import { RAIN_CHARSETS } from './digital-rain/charsets';
import { RAIN_INTROS } from './digital-rain/settings';

export const BACKDROP_EFFECT_IDS = [
  'none',
  'digital-rain',
  'vice-horizon',
  'aurora',
  'silk',
  'starfield',
  'cyber-grid',
  'prism-beams',
  'dot-spotlight',
] as const;

export type BackdropEffectId = (typeof BACKDROP_EFFECT_IDS)[number];

export const SURFACE_FINISH_IDS = ['default', 'glass', 'gradient', 'neon'] as const;
export type SurfaceFinishId = (typeof SURFACE_FINISH_IDS)[number];

export const CLICK_EFFECT_IDS = ['none', 'ripple', 'spark', 'matrix-burst', 'glow-pulse'] as const;
export type ClickEffectId = (typeof CLICK_EFFECT_IDS)[number];

export const RAIN_LOOK_NAMES: readonly RainLookName[] = [
  'theme',
  'phosphor',
  'ultraviolet',
  'ember',
  'glacier',
  'newsprint',
  'blueprint',
];

export const RAIN_CHARSET_NAMES = Object.keys(RAIN_CHARSETS) as readonly RainCharsetName[];
export const RAIN_INTRO_NAMES = RAIN_INTROS;

export interface ThemeEffectsConfig {
  readonly backdrop: BackdropEffectId;
  /** Backdrop opacity multiplier (`0.15..1`). */
  readonly intensity: number;
  /** Motion speed multiplier (`0.25..2`). */
  readonly speed: number;
  /** Card translucency when a backdrop is active (`0..0.65`, clamped for safe contrast). */
  readonly glassStrength: number;
  /** Freezes motion onto a single still frame. */
  readonly paused: boolean;
  /** Enables pointer time-warp, spotlights, and parallax where supported. */
  readonly interactive: boolean;
  /** Color look for Digital Rain (`'theme'` harmonizes with active palette). */
  readonly rainLook: RainLookName;
  /** Glyph set for Digital Rain. */
  readonly rainCharset: RainCharsetName;
  /** Stream density for Digital Rain (`0.15..0.9`). */
  readonly rainDensity: number;
  /** Entry style for Digital Rain (`'filled'` or `'rain-in'`). */
  readonly rainIntro: RainIntro;
  /** Card, header, and CTA surface treatment. */
  readonly surface: SurfaceFinishId;
  /** Interactive micro-effect triggered on primary clicks. */
  readonly click: ClickEffectId;
}

export const DEFAULT_THEME_EFFECTS: ThemeEffectsConfig = {
  backdrop: 'none',
  intensity: 0.8,
  speed: 1,
  glassStrength: 0.22,
  paused: false,
  interactive: true,
  rainLook: 'theme',
  rainCharset: 'matrix',
  rainDensity: 0.45,
  rainIntro: 'filled',
  surface: 'default',
  click: 'none',
};

export const THEME_EFFECT_BOUNDS = {
  intensity: { min: 0.15, max: 1 },
  speed: { min: 0.25, max: 2 },
  glassStrength: { min: 0, max: 0.65 },
  rainDensity: { min: 0.15, max: 0.9 },
} as const;

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.round(Math.min(max, Math.max(min, value)) * 100) / 100;
}

function readEnum<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T {
  return typeof raw === 'string' && (allowed as readonly string[]).includes(raw)
    ? (raw as T)
    : fallback;
}

/** Validates and clamps persisted `ThemeEffectsConfig` safely. */
export function readThemeEffectsConfig(raw: unknown): ThemeEffectsConfig {
  if (!isRecord(raw)) {
    return { ...DEFAULT_THEME_EFFECTS };
  }
  return {
    backdrop: readEnum(raw.backdrop, BACKDROP_EFFECT_IDS, DEFAULT_THEME_EFFECTS.backdrop),
    intensity: clampNumber(
      raw.intensity,
      THEME_EFFECT_BOUNDS.intensity.min,
      THEME_EFFECT_BOUNDS.intensity.max,
      DEFAULT_THEME_EFFECTS.intensity,
    ),
    speed: clampNumber(
      raw.speed,
      THEME_EFFECT_BOUNDS.speed.min,
      THEME_EFFECT_BOUNDS.speed.max,
      DEFAULT_THEME_EFFECTS.speed,
    ),
    glassStrength: clampNumber(
      raw.glassStrength,
      THEME_EFFECT_BOUNDS.glassStrength.min,
      THEME_EFFECT_BOUNDS.glassStrength.max,
      DEFAULT_THEME_EFFECTS.glassStrength,
    ),
    paused: typeof raw.paused === 'boolean' ? raw.paused : DEFAULT_THEME_EFFECTS.paused,
    interactive:
      typeof raw.interactive === 'boolean' ? raw.interactive : DEFAULT_THEME_EFFECTS.interactive,
    rainLook: readEnum(raw.rainLook, RAIN_LOOK_NAMES, DEFAULT_THEME_EFFECTS.rainLook),
    rainCharset: readEnum(raw.rainCharset, RAIN_CHARSET_NAMES, DEFAULT_THEME_EFFECTS.rainCharset),
    rainDensity: clampNumber(
      raw.rainDensity,
      THEME_EFFECT_BOUNDS.rainDensity.min,
      THEME_EFFECT_BOUNDS.rainDensity.max,
      DEFAULT_THEME_EFFECTS.rainDensity,
    ),
    rainIntro: readEnum(raw.rainIntro, RAIN_INTRO_NAMES, DEFAULT_THEME_EFFECTS.rainIntro),
    surface: readEnum(raw.surface, SURFACE_FINISH_IDS, DEFAULT_THEME_EFFECTS.surface),
    click: readEnum(raw.click, CLICK_EFFECT_IDS, DEFAULT_THEME_EFFECTS.click),
  };
}

/** True when any backdrop, surface finish, or click effect is enabled. */
export function hasActiveEffects(
  effects: ThemeEffectsConfig | undefined,
): effects is ThemeEffectsConfig {
  if (!effects) {
    return false;
  }
  return effects.backdrop !== 'none' || effects.surface !== 'default' || effects.click !== 'none';
}

export interface BackdropOptionMeta {
  readonly id: BackdropEffectId;
  readonly name: string;
  readonly tagline: string;
  readonly preview: string;
}

export const BACKDROP_OPTIONS: readonly BackdropOptionMeta[] = [
  {
    id: 'none',
    name: 'None',
    tagline: 'Clean solid canvas',
    preview: 'linear-gradient(135deg, #1f2937, #111827)',
  },
  {
    id: 'digital-rain',
    name: 'Matrix Rain',
    tagline: 'Interactive falling glyphs & cascades',
    preview: 'linear-gradient(180deg, #031508 0%, #0a3d1c 55%, #1fdf64 100%)',
  },
  {
    id: 'vice-horizon',
    name: 'Vice Horizon',
    tagline: 'GTA VI dusk, Deco skyline, ocean & palms',
    preview:
      'radial-gradient(circle at 50% 62%, #ffd056 0 16%, transparent 17%), linear-gradient(180deg, #1f0e45 0%, #5a1a62 38%, #f0625a 60%, #ffa24f 66%, #3a1252 67%, #080411 100%)',
  },
  {
    id: 'aurora',
    name: 'Aurora',
    tagline: 'Billowing northern-lights curtains',
    preview:
      'radial-gradient(ellipse 80% 60% at 30% 0%, #22e58b 0%, transparent 70%), radial-gradient(ellipse 70% 60% at 80% 10%, #8b5cf6 0%, transparent 70%), #0b1026',
  },
  {
    id: 'silk',
    name: 'Silk',
    tagline: 'Slow liquid satin folds in your palette',
    preview:
      'linear-gradient(128deg, #12060b 0%, #6d1430 32%, #e48aa0 47%, #8f1d3a 58%, #2a0a14 100%)',
  },
  {
    id: 'starfield',
    name: 'Constellations',
    tagline: 'Deep stars, shooting stars & cursor links',
    preview:
      'radial-gradient(1.5px 1.5px at 22% 30%, #fff, transparent), radial-gradient(1px 1px at 70% 60%, #fff, transparent), radial-gradient(circle at 25% 25%, #1e3a8a 0%, #050814 70%)',
  },
  {
    id: 'cyber-grid',
    name: 'Cyber Grid',
    tagline: 'Outrun perspective grid & horizon glow',
    preview:
      'repeating-linear-gradient(90deg, transparent 0 14px, rgb(0 240 255 / 45%) 14px 15px), linear-gradient(180deg, #070b1a 0%, #3b0764 55%, #ff2a85 56%, #070b1a 57%)',
  },
  {
    id: 'prism-beams',
    name: 'Prism Beams',
    tagline: 'Volumetric light rays & drifting dust',
    preview:
      'conic-gradient(from 150deg at 50% -10%, transparent 0deg, #28d7ff 12deg, transparent 22deg, #c084fc 32deg, transparent 44deg, #ff3b8d 56deg, transparent 66deg), #090814',
  },
  {
    id: 'dot-spotlight',
    name: 'Dot Spotlight',
    tagline: 'Architectural dots lit by your cursor',
    preview:
      'radial-gradient(circle at 50% 45%, rgb(59 130 246 / 55%) 0%, transparent 60%), radial-gradient(rgb(255 255 255 / 35%) 1px, transparent 1.4px) 0 0 / 8px 8px, #111827',
  },
];

export const SURFACE_FINISH_OPTIONS: ReadonlyArray<{
  readonly value: SurfaceFinishId;
  readonly label: string;
  readonly summary: string;
}> = [
  { value: 'default', label: 'Solid', summary: 'Crisp opaque cards' },
  { value: 'glass', label: 'Glass', summary: 'Frosted translucent blur' },
  { value: 'gradient', label: 'Gradient', summary: 'Rich directional sheen' },
  { value: 'neon', label: 'Neon Edge', summary: 'Luminous accent borders' },
];

export const CLICK_EFFECT_OPTIONS: ReadonlyArray<{
  readonly value: ClickEffectId;
  readonly label: string;
}> = [
  { value: 'none', label: 'Off' },
  { value: 'ripple', label: 'Ripple' },
  { value: 'spark', label: 'Sparks' },
  { value: 'matrix-burst', label: 'Glyphs' },
  { value: 'glow-pulse', label: 'Glow' },
];

export interface StudioVibe {
  readonly id: string;
  readonly name: string;
  readonly tagline: string;
  readonly preset: string;
  readonly font?: string;
  readonly swatch: string;
  readonly effects: Partial<ThemeEffectsConfig>;
}

/**
 * Curated one-click Studio Vibes combining palette, live backdrop, surface finish,
 * and click feedback. Each is calibrated so the backdrop shines in the page
 * gutters while reading columns stay crisp, opaque enough for all-day use.
 */
export const STUDIO_VIBES: readonly StudioVibe[] = [
  {
    id: 'enter-the-matrix',
    name: 'Enter the Matrix',
    tagline: 'Phosphor rain, frosted glass & glyph bursts',
    preset: 'terminal-phosphor',
    font: 'mono',
    swatch: 'linear-gradient(135deg, #040c06 0%, #0d3b1b 50%, #1fdf64 100%)',
    effects: {
      backdrop: 'digital-rain',
      rainLook: 'phosphor',
      rainCharset: 'matrix',
      rainDensity: 0.46,
      rainIntro: 'rain-in',
      intensity: 0.8,
      speed: 1,
      glassStrength: 0.26,
      surface: 'glass',
      click: 'matrix-burst',
      paused: false,
      interactive: true,
    },
  },
  {
    id: 'vice-city-vi',
    name: 'Vice City VI',
    tagline: 'Sliced sunset, Deco skyline, palms & sparks',
    preset: 'sunset-vapor',
    swatch: 'linear-gradient(135deg, #1f0e45 0%, #b3306c 45%, #ff6b4a 75%, #ffc46b 100%)',
    effects: {
      backdrop: 'vice-horizon',
      intensity: 0.92,
      speed: 0.9,
      glassStrength: 0.24,
      surface: 'gradient',
      click: 'spark',
      paused: false,
      interactive: true,
    },
  },
  {
    id: 'prism-dream',
    name: 'Prism Dream',
    tagline: 'Aurora curtains, gradient cards & sparks',
    preset: 'prism-aurora',
    swatch:
      'linear-gradient(135deg, #ff3b8d 0%, #ffe600 33%, #22e58b 62%, #28d7ff 82%, #8b5cf6 100%)',
    effects: {
      backdrop: 'aurora',
      intensity: 0.85,
      speed: 0.85,
      glassStrength: 0.24,
      surface: 'gradient',
      click: 'spark',
      paused: false,
      interactive: true,
    },
  },
  {
    id: 'velvet-silk',
    name: 'Velvet Silk',
    tagline: 'Liquid satin folds, frosted glass & ripples',
    preset: 'crimson-velvet',
    swatch:
      'linear-gradient(128deg, #12060b 0%, #6d1430 34%, #e48aa0 50%, #8f1d3a 62%, #1c1016 100%)',
    effects: {
      backdrop: 'silk',
      intensity: 0.85,
      speed: 0.8,
      glassStrength: 0.26,
      surface: 'glass',
      click: 'ripple',
      paused: false,
      interactive: true,
    },
  },
  {
    id: 'night-city',
    name: 'Night City Grid',
    tagline: 'Outrun horizon grid, neon rims & ripples',
    preset: 'cyber-neon',
    swatch: 'linear-gradient(135deg, #060913 0%, #00f0ff 50%, #ff2a85 100%)',
    effects: {
      backdrop: 'cyber-grid',
      intensity: 0.82,
      speed: 1,
      glassStrength: 0.22,
      surface: 'neon',
      click: 'ripple',
      paused: false,
      interactive: true,
    },
  },
  {
    id: 'deep-space',
    name: 'Deep Space',
    tagline: 'Shooting stars, constellations & soft glow',
    preset: 'midnight',
    swatch: 'linear-gradient(135deg, #0b0f17 0%, #1e3a8a 58%, #60a5fa 100%)',
    effects: {
      backdrop: 'starfield',
      intensity: 0.9,
      speed: 0.85,
      glassStrength: 0.26,
      surface: 'glass',
      click: 'glow-pulse',
      paused: false,
      interactive: true,
    },
  },
  {
    id: 'studio-blueprint',
    name: 'Blueprint Studio',
    tagline: 'Daylight cobalt ink rain & crisp ripples',
    preset: 'royal-cobalt',
    swatch: 'linear-gradient(135deg, #ebf0fa 0%, #93c5fd 55%, #1d4ed8 100%)',
    effects: {
      backdrop: 'digital-rain',
      rainLook: 'blueprint',
      rainCharset: 'binary',
      rainDensity: 0.32,
      intensity: 0.6,
      speed: 0.8,
      glassStrength: 0.18,
      surface: 'glass',
      click: 'ripple',
      paused: false,
      interactive: true,
    },
  },
];
