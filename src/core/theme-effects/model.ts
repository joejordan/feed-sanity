// Declarative effect plugin parameter schemas, validation, safe clamping,
// and curated Studio Vibes for Feed Sanity's Creative Theme & Effects Studio.

import type { RainCharsetName } from './digital-rain/charsets';
import type { RainLookName } from './digital-rain/settings';
import { isRecord } from '../storage';
import { normalizeHex } from '../theming/color-utils';
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

export type EffectParamValue = string | number | boolean;
export type EffectParamValues = Readonly<Record<string, EffectParamValue>>;

/**
 * Single-source-of-truth declarative parameter schema for effect plugins.
 * One spec drives `.fstheme.json` validation, runtime clamping/defaults,
 * and automatic Customize Effects UI controls.
 */
export type EffectParamUnit = '%' | '×' | 'px' | '°';

export type EffectParamSpec =
  | {
      readonly key: string;
      readonly kind: 'number';
      readonly label: string;
      readonly ariaLabel?: string;
      readonly min: number;
      readonly max: number;
      readonly step: number;
      readonly defaultValue: number;
      readonly unit?: EffectParamUnit;
    }
  | {
      readonly key: string;
      readonly kind: 'enum';
      readonly label: string;
      readonly ariaLabel?: string;
      readonly options: readonly string[];
      readonly optionLabels?: Readonly<Record<string, string>>;
      readonly defaultValue: string;
    }
  | {
      readonly key: string;
      readonly kind: 'boolean';
      readonly label: string;
      readonly ariaLabel?: string;
      readonly defaultValue: boolean;
    }
  | {
      readonly key: string;
      readonly kind: 'color';
      readonly label: string;
      readonly ariaLabel?: string;
      readonly defaultValue: string;
    }
  | {
      readonly key: string;
      readonly kind: 'string';
      readonly label: string;
      readonly ariaLabel?: string;
      readonly placeholder?: string;
      readonly maxLength: number;
      readonly defaultValue: string;
    };

export const THEME_EFFECT_BOUNDS = {
  intensity: { min: 0.15, max: 1 },
  speed: { min: 0.25, max: 2 },
  glassStrength: { min: 0, max: 0.65 },
  rainDensity: { min: 0.15, max: 0.9 },
} as const;

export const DIGITAL_RAIN_PARAM_SPECS: readonly EffectParamSpec[] = [
  {
    key: 'look',
    kind: 'enum',
    label: 'Rain style',
    options: RAIN_LOOK_NAMES,
    optionLabels: {
      theme: 'Match active theme',
      phosphor: 'Matrix Phosphor',
      ultraviolet: 'Ultraviolet',
      ember: 'Solar Ember',
      glacier: 'Arctic Glacier',
      newsprint: 'Newsprint Ink (Light)',
      blueprint: 'Blueprint Ink (Light)',
    },
    defaultValue: 'theme',
  },
  {
    key: 'charset',
    kind: 'enum',
    label: 'Glyph charset',
    options: RAIN_CHARSET_NAMES,
    optionLabels: {
      matrix: 'Classic Matrix (Katakana + Digits)',
      katakana: 'Half-width Katakana',
      binary: 'Binary (0 / 1)',
      decimal: 'Decimal (0–9)',
      hex: 'Hexadecimal (0–F)',
      latin: 'Latin (A–Z)',
      symbols: 'Code Symbols',
      braille: 'Braille Patterns',
    },
    defaultValue: 'matrix',
  },
  {
    key: 'intro',
    kind: 'enum',
    label: 'Intro',
    ariaLabel: 'Rain intro',
    options: RAIN_INTRO_NAMES,
    optionLabels: {
      filled: 'Already falling',
      'rain-in': 'Rain in from top',
    },
    defaultValue: 'filled',
  },
  {
    key: 'density',
    kind: 'number',
    label: 'Rain density',
    min: THEME_EFFECT_BOUNDS.rainDensity.min,
    max: THEME_EFFECT_BOUNDS.rainDensity.max,
    step: 0.05,
    defaultValue: 0.45,
    unit: '%',
  },
  {
    key: 'customGlyphs',
    kind: 'string',
    label: 'Custom glyphs',
    ariaLabel: 'Custom rain glyphs',
    placeholder: 'Optional (e.g. ❄❅❆*· or 01)',
    maxLength: 64,
    defaultValue: '',
  },
];

export const VICE_HORIZON_PARAM_SPECS: readonly EffectParamSpec[] = [
  {
    key: 'sunScale',
    kind: 'number',
    label: 'Sun size',
    min: 0.6,
    max: 1.35,
    step: 0.05,
    defaultValue: 1,
    unit: '×',
  },
  {
    key: 'palms',
    kind: 'boolean',
    label: 'Palm silhouettes',
    defaultValue: true,
  },
  {
    key: 'sunSlices',
    kind: 'boolean',
    label: 'Retro sun slices',
    defaultValue: true,
  },
  {
    key: 'clouds',
    kind: 'boolean',
    label: 'Twilight clouds',
    defaultValue: true,
  },
];

export const SILK_PARAM_SPECS: readonly EffectParamSpec[] = [
  {
    key: 'scale',
    kind: 'number',
    label: 'Fold scale',
    min: 0.65,
    max: 1.65,
    step: 0.05,
    defaultValue: 1,
    unit: '×',
  },
  {
    key: 'sheen',
    kind: 'number',
    label: 'Satin sheen',
    min: 0.2,
    max: 1.6,
    step: 0.05,
    defaultValue: 1,
    unit: '×',
  },
  {
    key: 'angle',
    kind: 'number',
    label: 'Drape angle',
    ariaLabel: 'Silk drape angle',
    min: -60,
    max: 60,
    step: 5,
    defaultValue: -30,
    unit: '°',
  },
];

export const AURORA_PARAM_SPECS: readonly EffectParamSpec[] = [
  {
    key: 'height',
    kind: 'number',
    label: 'Curtain reach',
    min: 0.55,
    max: 1.35,
    step: 0.05,
    defaultValue: 1,
    unit: '×',
  },
  {
    key: 'shimmer',
    kind: 'number',
    label: 'Ray intensity',
    min: 0.3,
    max: 1.5,
    step: 0.05,
    defaultValue: 1,
    unit: '×',
  },
];

export const STARFIELD_PARAM_SPECS: readonly EffectParamSpec[] = [
  {
    key: 'density',
    kind: 'number',
    label: 'Star density',
    min: 0.4,
    max: 1.8,
    step: 0.1,
    defaultValue: 1,
    unit: '×',
  },
  {
    key: 'constellations',
    kind: 'boolean',
    label: 'Cursor constellations',
    defaultValue: true,
  },
  {
    key: 'shootingStars',
    kind: 'boolean',
    label: 'Shooting stars',
    defaultValue: true,
  },
];

export const CYBER_GRID_PARAM_SPECS: readonly EffectParamSpec[] = [
  {
    key: 'gridDensity',
    kind: 'number',
    label: 'Grid density',
    min: 0.6,
    max: 1.6,
    step: 0.1,
    defaultValue: 1,
    unit: '×',
  },
  {
    key: 'mountains',
    kind: 'boolean',
    label: 'Wireframe mountains',
    defaultValue: true,
  },
  {
    key: 'scanPulse',
    kind: 'boolean',
    label: 'Horizon scan pulse',
    defaultValue: true,
  },
];

export const PRISM_BEAMS_PARAM_SPECS: readonly EffectParamSpec[] = [
  {
    key: 'spread',
    kind: 'number',
    label: 'Beam spread',
    min: 0.55,
    max: 1.5,
    step: 0.05,
    defaultValue: 1,
    unit: '×',
  },
  {
    key: 'dust',
    kind: 'boolean',
    label: 'Floating dust motes',
    defaultValue: true,
  },
];

export const DOT_SPOTLIGHT_PARAM_SPECS: readonly EffectParamSpec[] = [
  {
    key: 'spacing',
    kind: 'number',
    label: 'Dot spacing',
    min: 14,
    max: 36,
    step: 2,
    defaultValue: 22,
    unit: 'px',
  },
  {
    key: 'spotRadius',
    kind: 'number',
    label: 'Spotlight size',
    min: 140,
    max: 380,
    step: 20,
    defaultValue: 250,
    unit: 'px',
  },
];

/** Declarative parameter specifications keyed by backdrop engine ID. */
export const BACKDROP_PARAM_SPECS: Readonly<
  Record<Exclude<BackdropEffectId, 'none'>, readonly EffectParamSpec[]>
> = {
  'digital-rain': DIGITAL_RAIN_PARAM_SPECS,
  'vice-horizon': VICE_HORIZON_PARAM_SPECS,
  aurora: AURORA_PARAM_SPECS,
  silk: SILK_PARAM_SPECS,
  starfield: STARFIELD_PARAM_SPECS,
  'cyber-grid': CYBER_GRID_PARAM_SPECS,
  'prism-beams': PRISM_BEAMS_PARAM_SPECS,
  'dot-spotlight': DOT_SPOTLIGHT_PARAM_SPECS,
};

const EMPTY_PARAM_SPECS: readonly EffectParamSpec[] = [];

/** Returns the declarative `EffectParamSpec[]` for `backdropId` (empty when it has no extra params). */
export function getBackdropParamSpecs(backdropId: BackdropEffectId): readonly EffectParamSpec[] {
  if (backdropId === 'none') {
    return EMPTY_PARAM_SPECS;
  }
  return BACKDROP_PARAM_SPECS[backdropId] ?? EMPTY_PARAM_SPECS;
}

function clampOptionalNumber(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.round(Math.min(max, Math.max(min, value)) * 100) / 100;
}

function stripControlChars(input: string): string {
  let out = '';
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x20 && code !== 0x7f && !(code >= 0x80 && code <= 0x9f)) {
      out += ch;
    }
  }
  return out;
}

function validateParamValue(spec: EffectParamSpec, val: unknown): EffectParamValue | undefined {
  if (val === undefined) {
    return undefined;
  }
  switch (spec.kind) {
    case 'number':
      return clampOptionalNumber(val, spec.min, spec.max);
    case 'enum':
      return typeof val === 'string' && spec.options.includes(val) ? val : undefined;
    case 'boolean':
      return typeof val === 'boolean' ? val : undefined;
    case 'color':
      return typeof val === 'string' ? (normalizeHex(val) ?? undefined) : undefined;
    case 'string': {
      if (typeof val !== 'string') {
        return undefined;
      }
      const trimmed = stripControlChars(val).trim();
      const cleaned = Array.from(trimmed).slice(0, spec.maxLength).join('');
      return cleaned.length > 0 ? cleaned : undefined;
    }
  }
}

/**
 * Validates and clamps a raw effect `params` record against `specs`.
 * Omits invalid entries (and empty optional string defaults); optionally records
 * forward-compatibility warnings for unrecognized parameter keys.
 */
export function validateEffectParams(
  raw: unknown,
  specs: readonly EffectParamSpec[],
  warnings?: string[],
): EffectParamValues | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  if (warnings) {
    const knownKeys = new Set(specs.map((spec) => spec.key));
    const unknownKeys = Object.keys(raw)
      .filter((key) => !knownKeys.has(key))
      .map((key) => stripControlChars(key).trim().slice(0, 40) || '(unnamed)')
      .slice(0, 8);
    if (unknownKeys.length > 0) {
      warnings.push(`Ignored unrecognized effect parameter(s): ${unknownKeys.join(', ')}.`);
    }
  }
  if (specs.length === 0) {
    return undefined;
  }
  const out: Record<string, EffectParamValue> = {};
  for (const spec of specs) {
    const valid = validateParamValue(spec, raw[spec.key]);
    if (valid !== undefined) {
      out[spec.key] = valid;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Resolves every parameter in `specs` to a concrete validated value (with defaults filled). */
export function resolveEffectParams(
  specs: readonly EffectParamSpec[],
  raw: EffectParamValues | undefined,
): Record<string, EffectParamValue> {
  const resolved: Record<string, EffectParamValue> = {};
  for (const spec of specs) {
    const valid = raw ? validateParamValue(spec, raw[spec.key]) : undefined;
    resolved[spec.key] = valid ?? spec.defaultValue;
  }
  return resolved;
}

/**
 * Memoizes typed parameter extraction for a backdrop renderer (mirroring
 * `derivePalette`), avoiding per-frame validation and allocations in 20–30fps
 * animation loops whenever `backdropParams` is unchanged.
 */
export function deriveEffectParams<T>(
  specs: readonly EffectParamSpec[],
  project: (resolved: Readonly<Record<string, EffectParamValue>>) => T,
): (raw: EffectParamValues | undefined) => T {
  let hasValue = false;
  let lastRaw: EffectParamValues | undefined;
  let cached: T;
  return (raw) => {
    if (hasValue && (raw === lastRaw || sameEffectParams(raw, lastRaw))) {
      return cached;
    }
    lastRaw = raw;
    cached = project(resolveEffectParams(specs, raw));
    hasValue = true;
    return cached;
  };
}

/** Shallow value equality for two optional `EffectParamValues` records. */
export function sameEffectParams(
  a: EffectParamValues | undefined,
  b: EffectParamValues | undefined,
): boolean {
  if (a === b) {
    return true;
  }
  const aKeys = a ? Object.keys(a) : [];
  const bKeys = b ? Object.keys(b) : [];
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  return aKeys.every((key) => a?.[key] === b?.[key]);
}

/**
 * Merges a partial `ThemeEffectsConfig` update into `base`, preserving existing
 * `backdropParams` when staying on the same backdrop and resetting them when switching.
 */
export function mergeEffectsPatch(
  base: ThemeEffectsConfig,
  patch: Partial<ThemeEffectsConfig>,
): ThemeEffectsConfig;
export function mergeEffectsPatch(
  base: Partial<ThemeEffectsConfig>,
  patch: Partial<ThemeEffectsConfig>,
): Partial<ThemeEffectsConfig>;
export function mergeEffectsPatch(
  base: Partial<ThemeEffectsConfig>,
  patch: Partial<ThemeEffectsConfig>,
): Partial<ThemeEffectsConfig> {
  const switchingBackdrop =
    base.backdrop !== undefined && patch.backdrop !== undefined && patch.backdrop !== base.backdrop;
  let nextBackdropParams = base.backdropParams;
  if (switchingBackdrop) {
    nextBackdropParams = patch.backdropParams;
  } else if (patch.backdropParams !== undefined) {
    nextBackdropParams = { ...base.backdropParams, ...patch.backdropParams };
  }
  const { backdropParams: _baseParams, ...restBase } = base;
  const { backdropParams: _patchParams, ...restPatch } = patch;
  return {
    ...restBase,
    ...restPatch,
    ...(nextBackdropParams ? { backdropParams: nextBackdropParams } : {}),
  };
}

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
  /** Validated plugin-specific parameters for the active `backdrop` engine. */
  readonly backdropParams?: EffectParamValues;
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
  surface: 'default',
  click: 'none',
};

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return clampOptionalNumber(value, min, max) ?? fallback;
}

function readEnum<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T {
  return typeof raw === 'string' && (allowed as readonly string[]).includes(raw)
    ? (raw as T)
    : fallback;
}

/** Validates and clamps `ThemeEffectsConfig` (including active plugin `backdropParams`) safely. */
export function readThemeEffectsConfig(raw: unknown): ThemeEffectsConfig {
  if (!isRecord(raw)) {
    return { ...DEFAULT_THEME_EFFECTS };
  }
  const backdrop = readEnum(raw.backdrop, BACKDROP_EFFECT_IDS, DEFAULT_THEME_EFFECTS.backdrop);
  const backdropParams = validateEffectParams(raw.backdropParams, getBackdropParamSpecs(backdrop));
  return {
    backdrop,
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
    ...(backdropParams ? { backdropParams } : {}),
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

const BACKDROP_OPTION_BY_ID: ReadonlyMap<BackdropEffectId, BackdropOptionMeta> = new Map(
  BACKDROP_OPTIONS.map((option) => [option.id, option]),
);

/** Returns metadata for `id` in O(1) time. */
export function findBackdropOption(id: BackdropEffectId): BackdropOptionMeta | undefined {
  return BACKDROP_OPTION_BY_ID.get(id);
}

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
      backdropParams: {
        look: 'phosphor',
        charset: 'matrix',
        density: 0.46,
        intro: 'rain-in',
      },
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
      backdropParams: {
        look: 'blueprint',
        charset: 'binary',
        density: 0.32,
        intro: 'filled',
      },
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
