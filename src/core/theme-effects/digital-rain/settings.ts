// Adapted from `@ignitesoftware/digital-rain` (Joe Jordan / Ignite Software).
// Color parsing, presets, and clamped settings resolution.

import { RAIN_CHARSETS } from './charsets';
import { clamp } from './math';

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const HEX_COLOR = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i;

export function parseHexColor(input: string): Rgba | null {
  const value = input.trim();
  if (!HEX_COLOR.test(value)) {
    return null;
  }
  const digits = value.slice(1);
  const wide = digits.length <= 4 ? Array.from(digits, (digit) => digit + digit).join('') : digits;
  const channel = (offset: number): number => Number.parseInt(wide.slice(offset, offset + 2), 16);
  return {
    r: channel(0),
    g: channel(2),
    b: channel(4),
    a: wide.length === 8 ? channel(6) / 255 : 1,
  };
}

function relativeLuminance({ r, g, b }: Rgba): number {
  const linear = (channel: number): number => {
    const value = channel / 255;
    return value <= 0.040_45 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function isLightBackground(color: string): boolean {
  const rgba = parseHexColor(color);
  if (!rgba || rgba.a < 0.5) {
    return false;
  }
  return relativeLuminance(rgba) > 0.4;
}

export const RAIN_APPEARANCES = ['auto', 'emissive', 'ink'] as const;
export type RainAppearance = (typeof RAIN_APPEARANCES)[number];

export const RAIN_INTROS = ['filled', 'rain-in'] as const;
export type RainIntro = (typeof RAIN_INTROS)[number];

export interface DigitalRainOptions {
  trailColor?: string | undefined;
  headColor?: string | undefined;
  backgroundColor?: string | undefined;
  appearance?: RainAppearance | undefined;
  charset?: string | undefined;
  fontFamily?: string | undefined;
  fontWeight?: number | undefined;
  fontSize?: number | undefined;
  columnSpacing?: number | undefined;
  density?: number | undefined;
  trailLength?: number | undefined;
  speed?: number | undefined;
  speedVariance?: number | undefined;
  angle?: number | undefined;
  mutationRate?: number | undefined;
  mirrored?: boolean | undefined;
  depth?: number | undefined;
  bloom?: number | undefined;
  exposure?: number | undefined;
  resolution?: number | undefined;
  interactive?: boolean | undefined;
  timeWarp?: boolean | undefined;
  warpRadius?: number | undefined;
  warpStrength?: number | undefined;
  clickCascade?: boolean | undefined;
  cascadeSpread?: number | undefined;
  intro?: RainIntro | undefined;
  paused?: boolean | undefined;
  seed?: number | undefined;
}

type Resolved<Options> = {
  [Key in keyof Options]-?: Exclude<Options[Key], undefined>;
};

export interface RainSettings extends Resolved<Omit<DigitalRainOptions, 'seed'>> {
  seed: number | undefined;
}

const DEFAULT_FONT_FAMILY = [
  'ui-monospace',
  '"Cascadia Mono"',
  '"SF Mono"',
  'Menlo',
  'Consolas',
  '"Noto Sans Mono CJK JP"',
  'monospace',
].join(', ');

export const DEFAULT_RAIN_SETTINGS: Readonly<RainSettings> = {
  trailColor: '#1FDF64',
  headColor: '#E4FFE9',
  backgroundColor: 'transparent',
  appearance: 'auto',
  charset: RAIN_CHARSETS.matrix,
  fontFamily: DEFAULT_FONT_FAMILY,
  fontWeight: 700,
  fontSize: 18,
  columnSpacing: 1,
  density: 0.42,
  trailLength: 16,
  speed: 1,
  speedVariance: 0.5,
  angle: 0,
  mutationRate: 0.35,
  mirrored: false,
  depth: 0.55,
  bloom: 0.3,
  exposure: 1,
  resolution: 0.85,
  interactive: true,
  timeWarp: true,
  warpRadius: 170,
  warpStrength: 0.55,
  clickCascade: true,
  cascadeSpread: 1,
  intro: 'filled',
  paused: false,
  seed: undefined,
};

export type RainLookName =
  | 'theme'
  | 'phosphor'
  | 'ultraviolet'
  | 'ember'
  | 'glacier'
  | 'newsprint'
  | 'blueprint';

export const RAIN_PRESETS: Readonly<Record<Exclude<RainLookName, 'theme'>, DigitalRainOptions>> = {
  phosphor: {
    trailColor: '#1FDF64',
    headColor: '#E4FFE9',
    appearance: 'emissive',
  },
  ultraviolet: {
    trailColor: '#9277FF',
    headColor: '#FFE3FA',
    appearance: 'emissive',
  },
  ember: {
    trailColor: '#FF6A1F',
    headColor: '#FFEBC9',
    appearance: 'emissive',
    speed: 0.85,
    trailLength: 20,
  },
  glacier: {
    trailColor: '#38BDF8',
    headColor: '#F0FBFF',
    appearance: 'emissive',
    density: 0.36,
  },
  newsprint: {
    trailColor: '#27303F',
    headColor: '#D92D20',
    appearance: 'ink',
    bloom: 0,
    depth: 0.35,
  },
  blueprint: {
    trailColor: '#2F5BEA',
    headColor: '#0B1B4D',
    appearance: 'ink',
    bloom: 0,
    columnSpacing: 1.15,
  },
};

const RANGES = {
  fontWeight: [100, 900],
  fontSize: [6, 120],
  columnSpacing: [0.6, 3],
  density: [0, 1],
  trailLength: [1, 64],
  speed: [0, 4],
  speedVariance: [0, 1],
  angle: [-90, 90],
  mutationRate: [0, 1],
  depth: [0, 1],
  bloom: [0, 3],
  exposure: [0, 2],
  resolution: [0.25, 1],
  warpRadius: [0, 600],
  warpStrength: [0, 1],
  cascadeSpread: [0, 3],
} as const;

type NumericKey = keyof typeof RANGES;

const NUMERIC_KEYS = Object.keys(RANGES) as NumericKey[];
const BOOLEAN_KEYS = ['mirrored', 'interactive', 'timeWarp', 'clickCascade', 'paused'] as const;
const TEXT_KEYS = ['trailColor', 'headColor', 'backgroundColor', 'charset', 'fontFamily'] as const;
const ALL_KEYS = Object.keys(DEFAULT_RAIN_SETTINGS) as Array<keyof RainSettings>;

export function resolveRainSettings(options: DigitalRainOptions = {}): RainSettings {
  const settings: RainSettings = { ...DEFAULT_RAIN_SETTINGS };
  for (const key of NUMERIC_KEYS) {
    const value = options[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      const [min, max] = RANGES[key];
      settings[key] = clamp(value, min, max);
    }
  }
  for (const key of BOOLEAN_KEYS) {
    const value = options[key];
    if (typeof value === 'boolean') {
      settings[key] = value;
    }
  }
  for (const key of TEXT_KEYS) {
    const value = options[key];
    if (typeof value === 'string' && value.trim() !== '') {
      settings[key] = value;
    }
  }
  if (options.appearance && RAIN_APPEARANCES.includes(options.appearance)) {
    settings.appearance = options.appearance;
  }
  if (options.intro && RAIN_INTROS.includes(options.intro)) {
    settings.intro = options.intro;
  }
  if (typeof options.seed === 'number' && Number.isFinite(options.seed)) {
    settings.seed = Math.trunc(options.seed);
  }
  settings.trailLength = Math.round(settings.trailLength);
  return settings;
}

export function rainSettingsEqual(a: RainSettings, b: RainSettings): boolean {
  return ALL_KEYS.every((key) => a[key] === b[key]);
}
