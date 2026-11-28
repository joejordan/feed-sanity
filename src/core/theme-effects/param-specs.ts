// Declarative effect plugin parameter schemas, validation, safe clamping,
// and memoized parameter resolution for Feed Sanity's Theme & Effects Studio.

import type { RainCharsetName } from './digital-rain/charsets';
import type { RainIntro, RainLookName } from './digital-rain/settings';
import type { CustomShaderSpec } from './scene-schema';
import { isRecord } from '../storage';
import { normalizeHex } from '../theming/color';
import { readClampedNumber } from './scene-schema';

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
  'canopy',
  'shoreline',
  'custom-scene',
  'custom-shader',
] as const;

export type BackdropEffectId = (typeof BACKDROP_EFFECT_IDS)[number];

export const SURFACE_FINISH_IDS = [
  'default',
  'glass',
  'gradient',
  'neon',
  'prism',
  'moonlit',
  'dappled',
  'caustic',
] as const;
export type SurfaceFinishId = (typeof SURFACE_FINISH_IDS)[number];

export const CLICK_EFFECT_IDS = [
  'none',
  'ripple',
  'spark',
  'matrix-burst',
  'glow-pulse',
  'supernova',
  'tide',
  'petals',
  'seafoam',
] as const;
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

export const RAIN_CHARSET_NAMES: readonly RainCharsetName[] = [
  'matrix',
  'katakana',
  'binary',
  'decimal',
  'hex',
  'latin',
  'symbols',
  'braille',
];
export const RAIN_INTRO_NAMES: readonly RainIntro[] = ['filled', 'rain-in'];

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

export const CANOPY_TIMES = ['dawn', 'morning', 'golden', 'dusk', 'night', 'clock'] as const;
export type CanopyTime = (typeof CANOPY_TIMES)[number];

function backdropScaleParam(key: string, label: string): EffectParamSpec {
  return { key, kind: 'number', label, min: 0, max: 1.6, step: 0.05, defaultValue: 1, unit: '×' };
}

export const CANOPY_PARAM_SPECS: readonly EffectParamSpec[] = [
  {
    key: 'time',
    kind: 'enum',
    label: 'Time of day',
    options: CANOPY_TIMES,
    optionLabels: {
      dawn: 'Misty dawn',
      morning: 'Sunlit morning',
      golden: 'Golden hour',
      dusk: 'Firefly dusk',
      night: 'Moonlit night',
      clock: 'Follow my clock',
    },
    defaultValue: 'morning',
  },
  backdropScaleParam('rays', 'Sunbeams'),
  {
    key: 'foliage',
    kind: 'number',
    label: 'Foliage',
    min: 0.5,
    max: 1.4,
    step: 0.05,
    defaultValue: 1,
    unit: '×',
  },
  backdropScaleParam('mist', 'Mist'),
  backdropScaleParam('motes', 'Fireflies & pollen'),
  backdropScaleParam('breeze', 'Breeze'),
];

export const SHORELINE_TIMES = ['noon', 'sunrise', 'sunset', 'moonlit', 'clock'] as const;
export type ShorelineTime = (typeof SHORELINE_TIMES)[number];

export const SHORELINE_PARAM_SPECS: readonly EffectParamSpec[] = [
  {
    key: 'time',
    kind: 'enum',
    label: 'Time of day',
    options: SHORELINE_TIMES,
    optionLabels: {
      noon: 'Sunlit lagoon',
      sunrise: 'Coral sunrise',
      sunset: 'Mango sunset',
      moonlit: 'Moonlit cove',
      clock: 'Follow my clock',
    },
    defaultValue: 'noon',
  },
  backdropScaleParam('caustics', 'Water caustics'),
  {
    key: 'tide',
    kind: 'number',
    label: 'Tide level',
    min: 0.3,
    max: 1.4,
    step: 0.05,
    defaultValue: 1,
    unit: '×',
  },
  backdropScaleParam('surf', 'Surf & foam'),
  backdropScaleParam('breeze', 'Trade wind'),
  {
    key: 'palms',
    kind: 'boolean',
    label: 'Palm shadows',
    defaultValue: true,
  },
  {
    key: 'marineLife',
    kind: 'boolean',
    label: 'Lagoon wildlife',
    defaultValue: true,
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
  canopy: CANOPY_PARAM_SPECS,
  shoreline: SHORELINE_PARAM_SPECS,
  'custom-scene': [],
  'custom-shader': [],
};

const EMPTY_PARAM_SPECS: readonly EffectParamSpec[] = [];

/** Returns the declarative `EffectParamSpec[]` for `backdropId` (empty when it has no extra params). */
export function getBackdropParamSpecs(backdropId: BackdropEffectId): readonly EffectParamSpec[] {
  if (backdropId === 'none') {
    return EMPTY_PARAM_SPECS;
  }
  return BACKDROP_PARAM_SPECS[backdropId] ?? EMPTY_PARAM_SPECS;
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
    case 'number': {
      const decimals = spec.step < 0.01 ? 4 : 2;
      const rounded = readClampedNumber(val, spec.min, spec.max, decimals);
      return rounded === undefined ? undefined : Math.min(spec.max, Math.max(spec.min, rounded));
    }
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

function surfaceScaleParam(key: string, label: string): EffectParamSpec {
  return {
    key,
    kind: 'number',
    label,
    min: 0.3,
    max: 1.8,
    step: 0.05,
    defaultValue: 1,
    unit: '×',
  };
}

const EDGE_GLOW_PARAM: EffectParamSpec = surfaceScaleParam('glow', 'Edge glow');

function clickScaleParam(label: string): EffectParamSpec {
  return {
    key: 'scale',
    kind: 'number',
    label,
    min: 0.6,
    max: 1.6,
    step: 0.05,
    defaultValue: 1,
    unit: '×',
  };
}

export const SURFACE_PARAM_SPECS: Readonly<Record<SurfaceFinishId, readonly EffectParamSpec[]>> = {
  default: EMPTY_PARAM_SPECS,
  glass: [
    {
      key: 'saturation',
      kind: 'number',
      label: 'Glass saturation',
      min: 1,
      max: 1.8,
      step: 0.05,
      defaultValue: 1.25,
      unit: '%',
    },
  ],
  gradient: [
    {
      key: 'angle',
      kind: 'number',
      label: 'Sheen angle',
      min: 0,
      max: 360,
      step: 5,
      defaultValue: 145,
      unit: '°',
    },
    surfaceScaleParam('strength', 'Sheen strength'),
  ],
  neon: [EDGE_GLOW_PARAM],
  prism: [
    surfaceScaleParam('strength', 'Prism sheen'),
    EDGE_GLOW_PARAM,
    {
      key: 'baseAngle',
      kind: 'number',
      label: 'Base light angle',
      min: 0,
      max: 360,
      step: 4,
      defaultValue: 132,
      unit: '°',
    },
    {
      key: 'sweep',
      kind: 'number',
      label: 'Pointer tilt sweep',
      min: 0,
      max: 120,
      step: 4,
      defaultValue: 56,
      unit: '°',
    },
  ],
  moonlit: [surfaceScaleParam('sheen', 'Moonlight sheen'), surfaceScaleParam('glow', 'Underglow')],
  dappled: [surfaceScaleParam('light', 'Dappled light'), surfaceScaleParam('glow', 'Canopy glow')],
  caustic: [
    surfaceScaleParam('caustics', 'Caustic light'),
    surfaceScaleParam('rim', 'Sea-glass rim'),
  ],
};

export const CLICK_PARAM_SPECS: Readonly<Record<ClickEffectId, readonly EffectParamSpec[]>> = {
  none: EMPTY_PARAM_SPECS,
  ripple: [clickScaleParam('Ripple size')],
  spark: [
    clickScaleParam('Spark spread'),
    {
      key: 'count',
      kind: 'number',
      label: 'Spark count',
      min: 4,
      max: 12,
      step: 2,
      defaultValue: 8,
    },
  ],
  'matrix-burst': [
    {
      key: 'glyphs',
      kind: 'string',
      label: 'Burst glyphs',
      placeholder: 'e.g. ｱｳｶ01λ',
      maxLength: 24,
      defaultValue: '',
    },
  ],
  'glow-pulse': [clickScaleParam('Glow size')],
  supernova: [
    {
      key: 'style',
      kind: 'enum',
      label: 'Burst style',
      options: ['both', 'rings', 'embers'],
      optionLabels: {
        both: 'Rings & Embers',
        rings: 'Lensing Rings',
        embers: 'Orbital Embers',
      },
      defaultValue: 'both',
    },
    clickScaleParam('Burst size'),
  ],
  tide: [
    {
      key: 'style',
      kind: 'enum',
      label: 'Splash style',
      options: ['both', 'ripples', 'sparkle'],
      optionLabels: {
        both: 'Ripples & Sea Sparkle',
        ripples: 'Ripples',
        sparkle: 'Sea Sparkle',
      },
      defaultValue: 'both',
    },
    clickScaleParam('Splash size'),
  ],
  petals: [
    {
      key: 'style',
      kind: 'enum',
      label: 'Scatter style',
      options: ['both', 'petals', 'dew'],
      optionLabels: {
        both: 'Dewdrop & Petals',
        petals: 'Petals',
        dew: 'Dewdrop',
      },
      defaultValue: 'both',
    },
    clickScaleParam('Scatter size'),
  ],
  seafoam: [
    {
      key: 'style',
      kind: 'enum',
      label: 'Splash style',
      options: ['both', 'bubbles', 'spray'],
      optionLabels: {
        both: 'Spray & Bubbles',
        bubbles: 'Sea Bubbles',
        spray: 'Surf Spray',
      },
      defaultValue: 'both',
    },
    clickScaleParam('Splash size'),
  ],
};

/** Returns the declarative parameter specs for `surfaceId`. */
export function getSurfaceParamSpecs(surfaceId: SurfaceFinishId): readonly EffectParamSpec[] {
  return SURFACE_PARAM_SPECS[surfaceId] ?? EMPTY_PARAM_SPECS;
}

/** Returns the declarative parameter specs for `clickId`. */
export function getClickParamSpecs(clickId: ClickEffectId): readonly EffectParamSpec[] {
  return CLICK_PARAM_SPECS[clickId] ?? EMPTY_PARAM_SPECS;
}

/** Returns the active parameter specs for either a built-in backdrop or a Tier 3 custom shader. */
export function getActiveBackdropParamSpecs(effects: {
  readonly backdrop: BackdropEffectId;
  readonly customShader?: CustomShaderSpec;
}): readonly EffectParamSpec[] {
  if (effects.backdrop === 'custom-shader') {
    return effects.customShader?.params ?? EMPTY_PARAM_SPECS;
  }
  return getBackdropParamSpecs(effects.backdrop);
}
