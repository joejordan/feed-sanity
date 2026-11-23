// Declarative model, validation, safe clamping, and curated Studio Vibes for
// Feed Sanity's Creative Theme & Effects Studio.

import type { RainCharsetName } from './digital-rain/charsets';
import type { RainLookName } from './digital-rain/settings';
import { isRecord } from '../storage';
import { RAIN_CHARSETS } from './digital-rain/charsets';

export const BACKDROP_EFFECT_IDS = [
  'none',
  'digital-rain',
  'vice-horizon',
  'aurora',
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
  /** Card, header, and CTA surface treatment. */
  readonly surface: SurfaceFinishId;
  /** Interactive micro-effect triggered on primary clicks. */
  readonly click: ClickEffectId;
}

export const DEFAULT_THEME_EFFECTS: ThemeEffectsConfig = {
  backdrop: 'none',
  intensity: 0.78,
  speed: 1,
  glassStrength: 0.24,
  paused: false,
  interactive: true,
  rainLook: 'theme',
  rainCharset: 'matrix',
  rainDensity: 0.45,
  surface: 'default',
  click: 'none',
};

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
    intensity: clampNumber(raw.intensity, 0.15, 1, DEFAULT_THEME_EFFECTS.intensity),
    speed: clampNumber(raw.speed, 0.25, 2, DEFAULT_THEME_EFFECTS.speed),
    glassStrength: clampNumber(raw.glassStrength, 0, 0.65, DEFAULT_THEME_EFFECTS.glassStrength),
    paused: typeof raw.paused === 'boolean' ? raw.paused : DEFAULT_THEME_EFFECTS.paused,
    interactive:
      typeof raw.interactive === 'boolean' ? raw.interactive : DEFAULT_THEME_EFFECTS.interactive,
    rainLook: readEnum(raw.rainLook, RAIN_LOOK_NAMES, DEFAULT_THEME_EFFECTS.rainLook),
    rainCharset: readEnum(raw.rainCharset, RAIN_CHARSET_NAMES, DEFAULT_THEME_EFFECTS.rainCharset),
    rainDensity: clampNumber(raw.rainDensity, 0.15, 0.9, DEFAULT_THEME_EFFECTS.rainDensity),
    surface: readEnum(raw.surface, SURFACE_FINISH_IDS, DEFAULT_THEME_EFFECTS.surface),
    click: readEnum(raw.click, CLICK_EFFECT_IDS, DEFAULT_THEME_EFFECTS.click),
  };
}

/** True when any backdrop, surface finish, or click effect is enabled. */
export function hasActiveEffects(effects: ThemeEffectsConfig | undefined): boolean {
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
    tagline: 'GTA VI sunset, neon water & palms',
    preview: 'linear-gradient(180deg, #1b0b2e 0%, #a21c5e 52%, #ff6b4a 82%, #ffb800 100%)',
  },
  {
    id: 'aurora',
    name: 'Aurora',
    tagline: 'Flowing northern lights glow',
    preview: 'linear-gradient(135deg, #0b1026 0%, #22e58b 45%, #28d7ff 72%, #8b5cf6 100%)',
  },
  {
    id: 'starfield',
    name: 'Constellations',
    tagline: 'Parallax stars linked to your cursor',
    preview: 'radial-gradient(circle at 30% 30%, #60a5fa 0%, #1e1b4b 48%, #050814 100%)',
  },
  {
    id: 'cyber-grid',
    name: 'Cyber Grid',
    tagline: 'Synthwave 3D horizon grid',
    preview: 'linear-gradient(180deg, #070b1a 0%, #3b0764 55%, #00f0ff 100%)',
  },
  {
    id: 'prism-beams',
    name: 'Prism Beams',
    tagline: 'Sweeping volumetric light rays',
    preview: 'linear-gradient(125deg, #090814 0%, #ff3b8d 38%, #c084fc 66%, #28d7ff 100%)',
  },
  {
    id: 'dot-spotlight',
    name: 'Dot Spotlight',
    tagline: 'Cursor-lit architectural dot grid',
    preview: 'radial-gradient(circle at 50% 45%, #3b82f6 0%, #111827 72%)',
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
 * and click feedback so users immediately feel inspired and fearless experimenting.
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
      rainDensity: 0.48,
      intensity: 0.82,
      speed: 1,
      glassStrength: 0.28,
      surface: 'glass',
      click: 'matrix-burst',
      paused: false,
      interactive: true,
    },
  },
  {
    id: 'vice-city-vi',
    name: 'Vice City VI',
    tagline: 'GTA VI sunset, neon palms & golden sparks',
    preset: 'sunset-vapor',
    swatch: 'linear-gradient(135deg, #1b0b2e 0%, #ff4d8d 48%, #ff6b4a 78%, #ffb800 100%)',
    effects: {
      backdrop: 'vice-horizon',
      intensity: 0.88,
      speed: 0.95,
      glassStrength: 0.26,
      surface: 'gradient',
      click: 'spark',
      paused: false,
      interactive: true,
    },
  },
  {
    id: 'prism-dream',
    name: 'Prism Dream',
    tagline: 'Rainbow aurora glow, gradient cards & sparks',
    preset: 'prism-aurora',
    swatch:
      'linear-gradient(135deg, #ff3b8d 0%, #ffe600 33%, #22e58b 62%, #28d7ff 82%, #8b5cf6 100%)',
    effects: {
      backdrop: 'aurora',
      intensity: 0.82,
      speed: 0.9,
      glassStrength: 0.24,
      surface: 'gradient',
      click: 'spark',
      paused: false,
      interactive: true,
    },
  },
  {
    id: 'night-city',
    name: 'Night City Grid',
    tagline: 'Cyberpunk horizon grid, neon rims & ripples',
    preset: 'cyber-neon',
    swatch: 'linear-gradient(135deg, #060913 0%, #00f0ff 50%, #ff2a85 100%)',
    effects: {
      backdrop: 'cyber-grid',
      intensity: 0.8,
      speed: 1,
      glassStrength: 0.24,
      surface: 'neon',
      click: 'ripple',
      paused: false,
      interactive: true,
    },
  },
  {
    id: 'deep-space',
    name: 'Deep Space',
    tagline: 'Interactive star constellations & aura glow',
    preset: 'midnight',
    swatch: 'linear-gradient(135deg, #0b0f17 0%, #1e3a8a 58%, #60a5fa 100%)',
    effects: {
      backdrop: 'starfield',
      intensity: 0.84,
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
    tagline: 'Daylight cobalt ink rain & crisp dot focus',
    preset: 'royal-cobalt',
    swatch: 'linear-gradient(135deg, #ebf0fa 0%, #93c5fd 55%, #1d4ed8 100%)',
    effects: {
      backdrop: 'digital-rain',
      rainLook: 'blueprint',
      rainCharset: 'binary',
      rainDensity: 0.34,
      intensity: 0.65,
      speed: 0.8,
      glassStrength: 0.2,
      surface: 'glass',
      click: 'ripple',
      paused: false,
      interactive: true,
    },
  },
];
