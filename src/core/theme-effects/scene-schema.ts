// Pure, zero-DOM declarative schemas and static safety validators for:
// - Tier 2: Composable multi-layer Canvas 2D scenes (`CustomSceneSpec`, safe by default)
// - Tier 3: Opt-in custom WebGL 1 GLSL fragment shaders (`CustomShaderSpec`)
//
// Imported by both the popup/background pure theme codec and the content-script
// renderers without pulling in any DOM or WebGL code.

import type { EffectParamSpec } from './model';
import { isRecord } from '../storage';
import { normalizeHex } from '../theming/color';

export const MAX_SCENE_LAYERS = 6;
export const MAX_CUSTOM_SHADER_BYTES = 16 * 1024;
export const MAX_CUSTOM_SHADER_PARAMS = 8;
export const MAX_SHADER_LOOP_ITERATIONS = 256;
export const MAX_SHADER_CLICKS = 4;

export const SCENE_BLEND_MODES = [
  'source-over',
  'screen',
  'lighter',
  'multiply',
  'overlay',
  'soft-light',
] as const;
export type SceneBlendMode = (typeof SCENE_BLEND_MODES)[number];

export const SCENE_COLOR_TOKENS = ['accent', 'alt', 'background', 'surface', 'text'] as const;
export type SceneColorToken = (typeof SCENE_COLOR_TOKENS)[number];

/** Either a semantic palette token (adapts to user theme/polarity) or a `#rrggbb` hex color. */
export type SceneColorRef = SceneColorToken | `#${string}`;

export const PARTICLE_SHAPES = [
  'circle',
  'glow',
  'petal',
  'snow',
  'rain',
  'star',
  'ring',
  'glyph',
] as const;
export type ParticleShape = (typeof PARTICLE_SHAPES)[number];

export const SILHOUETTE_STYLES = ['mountains', 'hills', 'skyline', 'sun', 'moon'] as const;
export type SilhouetteStyle = (typeof SILHOUETTE_STYLES)[number];

export interface SceneLayerBase {
  /** Layer opacity (`0.05..1`, default `1`). */
  readonly opacity?: number;
  /** Canvas 2D composite mode (default `'source-over'`). */
  readonly blendMode?: SceneBlendMode;
  /** Pointer/scroll parallax multiplier (`0..1`, default `0`). */
  readonly parallax?: number;
}

export interface GradientSceneLayer extends SceneLayerBase {
  readonly kind: 'gradient';
  readonly style: 'linear' | 'radial';
  readonly colors: readonly SceneColorRef[];
  /** Angle in degrees for linear gradients (`0..360`, default `180`). */
  readonly angle?: number;
  /** Center X (`0..1`, default `0.5`) for radial gradients. */
  readonly x?: number;
  /** Center Y (`0..1`, default `0.5`) for radial gradients. */
  readonly y?: number;
  /** Subtle motion drift speed (`0..2`, default `0.2`). */
  readonly drift?: number;
}

export interface ParticlesSceneLayer extends SceneLayerBase {
  readonly kind: 'particles';
  readonly shape: ParticleShape;
  /** Optional custom characters when `shape === 'glyph'` (max 32 chars). */
  readonly glyphs?: string;
  readonly count: number;
  readonly sizeMin: number;
  readonly sizeMax: number;
  readonly speed: number;
  /** Primary travel direction in degrees (`0` = right, `90` = down, `270` = up). */
  readonly angle: number;
  /** Directional variance in degrees (`0..180`). */
  readonly spread: number;
  /** Sinusoidal cross-drift turbulence (`0..2`). */
  readonly swirl?: number;
  readonly twinkle?: boolean;
  /** React to click bursts with a localized radial impulse. */
  readonly clickBurst?: boolean;
  readonly color: SceneColorRef;
  readonly secondaryColor?: SceneColorRef;
}

export interface WavesSceneLayer extends SceneLayerBase {
  readonly kind: 'waves';
  readonly count: number;
  readonly amplitude: number;
  readonly frequency: number;
  readonly thickness: number;
  readonly y: number;
  readonly color: SceneColorRef;
  readonly secondaryColor?: SceneColorRef;
}

export interface GridSceneLayer extends SceneLayerBase {
  readonly kind: 'grid';
  readonly horizon: number;
  readonly spacing: number;
  readonly glow?: number;
  readonly color: SceneColorRef;
  readonly secondaryColor?: SceneColorRef;
}

export interface RaysSceneLayer extends SceneLayerBase {
  readonly kind: 'rays';
  readonly count: number;
  readonly originX: number;
  readonly originY: number;
  readonly spread: number;
  readonly rotationSpeed: number;
  readonly color: SceneColorRef;
  readonly secondaryColor?: SceneColorRef;
}

export interface SilhouetteSceneLayer extends SceneLayerBase {
  readonly kind: 'silhouette';
  readonly style: SilhouetteStyle;
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly color: SceneColorRef;
  readonly secondaryColor?: SceneColorRef;
}

export type SceneLayerSpec =
  | GradientSceneLayer
  | ParticlesSceneLayer
  | WavesSceneLayer
  | GridSceneLayer
  | RaysSceneLayer
  | SilhouetteSceneLayer;

export interface CustomSceneSpec {
  readonly layers: readonly SceneLayerSpec[];
  /** Target frame rate cap (`10..30`, default `24`). */
  readonly fps?: number;
}

export type CustomShaderParamSpec = Extract<
  EffectParamSpec,
  { readonly kind: 'number' | 'boolean' | 'color' | 'enum' }
>;

export interface CustomShaderSpec {
  /** Validated GLSL ES 1.00 fragment body (`main()` or Shadertoy-style `mainImage(...)`). */
  readonly fragment: string;
  /** Backing-store resolution scale (`0.25..1`, default `0.5`). */
  readonly renderScale?: number;
  /** Target frame rate cap (`10..30`, default `24`). */
  readonly fps?: number;
  /** Optional user-tunable uniforms automatically surfaced in Theme Studio. */
  readonly params?: readonly CustomShaderParamSpec[];
  /** Optional safe two-stop hex fallback gradient when WebGL is unavailable or throttled. */
  readonly fallbackColors?: readonly [string, string];
}

export interface ShaderValidationResult {
  readonly ok: boolean;
  readonly source: string;
  readonly entrypoint: 'main' | 'mainImage' | null;
  readonly errors: readonly string[];
}

/**
 * Single source of truth for standard uniforms injected into Tier 3 GLSL fragment
 * shaders (`u_<name>`). Also reserves these names against user-declared params.
 */
export const STANDARD_SHADER_UNIFORMS = [
  ['resolution', 'vec2'],
  ['time', 'float'],
  ['delta', 'float'],
  ['frame', 'float'],
  ['pointer', 'vec4'],
  ['pointerVel', 'vec2'],
  ['click', 'vec4'],
  ['clicks', `vec4[${MAX_SHADER_CLICKS}]`],
  ['scroll', 'vec2'],
  ['dayPhase', 'float'],
  ['moonPhase', 'float'],
  ['bg', 'vec3'],
  ['surface', 'vec3'],
  ['text', 'vec3'],
  ['border', 'vec3'],
  ['accent', 'vec3'],
  ['accent2', 'vec3'],
  ['danger', 'vec3'],
  ['isDark', 'float'],
] as const;

export type StandardShaderUniformName = (typeof STANDARD_SHADER_UNIFORMS)[number][0];

const TEXT_ENCODER = new TextEncoder();
const SHADER_PARAM_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,23}$/;
const RESERVED_SHADER_UNIFORMS: ReadonlySet<string> = new Set(
  STANDARD_SHADER_UNIFORMS.map(([name]) => name),
);
const VALIDATED_SCENES = new WeakSet<CustomSceneSpec>();
const VALIDATED_SHADERS = new WeakSet<CustomShaderSpec>();

/** Clamps and rounds an optional finite number to `[min, max]`, returning `undefined` for non-numbers. */
export function readClampedNumber(
  raw: unknown,
  min: number,
  max: number,
  decimals = 2,
): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return undefined;
  }
  const factor = 10 ** decimals;
  return Math.round(Math.min(max, Math.max(min, raw)) * factor) / factor;
}

/** Type guard checking whether `raw` is a string member of `list`. */
export function isOneOf<T extends string>(raw: unknown, list: readonly T[]): raw is T {
  return typeof raw === 'string' && (list as readonly string[]).includes(raw);
}

function parseColorRef(raw: unknown): SceneColorRef | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const trimmed = raw.trim();
  if (isOneOf(trimmed, SCENE_COLOR_TOKENS)) {
    return trimmed;
  }
  const hex = normalizeHex(trimmed);
  return hex ? (hex as `#${string}`) : undefined;
}

function parseLayerBase(raw: Record<string, unknown>): SceneLayerBase {
  const opacity = readClampedNumber(raw.opacity, 0.05, 1);
  const blendMode = isOneOf(raw.blendMode, SCENE_BLEND_MODES) ? raw.blendMode : undefined;
  const parallax = readClampedNumber(raw.parallax, 0, 1);
  return {
    ...(opacity === undefined ? {} : { opacity }),
    ...(blendMode && blendMode !== 'source-over' ? { blendMode } : {}),
    ...(parallax !== undefined && parallax > 0 ? { parallax } : {}),
  };
}

function parseGradientLayer(
  raw: Record<string, unknown>,
  base: SceneLayerBase,
): GradientSceneLayer | null {
  if (!Array.isArray(raw.colors)) {
    return null;
  }
  const colors: SceneColorRef[] = [];
  for (const item of raw.colors.slice(0, 6)) {
    const parsed = parseColorRef(item);
    if (parsed) {
      colors.push(parsed);
    }
  }
  if (colors.length < 2) {
    return null;
  }
  const style = raw.style === 'radial' ? 'radial' : 'linear';
  const angle = readClampedNumber(raw.angle, 0, 360, 0);
  const x = readClampedNumber(raw.x, 0, 1);
  const y = readClampedNumber(raw.y, 0, 1);
  const drift = readClampedNumber(raw.drift, 0, 2);
  return {
    kind: 'gradient',
    ...base,
    style,
    colors,
    ...(angle === undefined ? {} : { angle }),
    ...(x === undefined ? {} : { x }),
    ...(y === undefined ? {} : { y }),
    ...(drift === undefined ? {} : { drift }),
  };
}

function parseParticlesLayer(
  raw: Record<string, unknown>,
  base: SceneLayerBase,
): ParticlesSceneLayer {
  const shape = isOneOf(raw.shape, PARTICLE_SHAPES) ? raw.shape : 'circle';
  const rawGlyphs =
    shape === 'glyph' && typeof raw.glyphs === 'string'
      ? Array.from(raw.glyphs.replace(/\s+/g, '')).slice(0, 32).join('')
      : '';
  const sizeMin = readClampedNumber(raw.sizeMin, 1, 32, 1) ?? 2;
  const sizeMax = Math.max(
    sizeMin,
    readClampedNumber(raw.sizeMax, 1, 48, 1) ?? Math.max(sizeMin, 6),
  );
  const swirl = readClampedNumber(raw.swirl, 0, 2);
  const color = parseColorRef(raw.color) ?? 'accent';
  const secondaryColor = parseColorRef(raw.secondaryColor);
  return {
    kind: 'particles',
    ...base,
    shape,
    ...(rawGlyphs.length > 0 ? { glyphs: rawGlyphs } : {}),
    count: readClampedNumber(raw.count, 8, 160, 0) ?? 48,
    sizeMin,
    sizeMax,
    speed: readClampedNumber(raw.speed, 0.05, 4) ?? 0.6,
    angle: readClampedNumber(raw.angle, 0, 360, 0) ?? 90,
    spread: readClampedNumber(raw.spread, 0, 180, 0) ?? 25,
    ...(swirl !== undefined && swirl > 0 ? { swirl } : {}),
    ...(raw.twinkle === true ? { twinkle: true } : {}),
    ...(raw.clickBurst === true ? { clickBurst: true } : {}),
    color,
    ...(secondaryColor ? { secondaryColor } : {}),
  };
}

function parseWavesLayer(raw: Record<string, unknown>, base: SceneLayerBase): WavesSceneLayer {
  const color = parseColorRef(raw.color) ?? 'accent';
  const secondaryColor = parseColorRef(raw.secondaryColor);
  return {
    kind: 'waves',
    ...base,
    count: readClampedNumber(raw.count, 1, 6, 0) ?? 3,
    amplitude: readClampedNumber(raw.amplitude, 0.01, 0.35, 3) ?? 0.08,
    frequency: readClampedNumber(raw.frequency, 0.5, 6) ?? 1.8,
    thickness: readClampedNumber(raw.thickness, 1, 48, 1) ?? 14,
    y: readClampedNumber(raw.y, 0.05, 0.95) ?? 0.5,
    color,
    ...(secondaryColor ? { secondaryColor } : {}),
  };
}

function parseGridLayer(raw: Record<string, unknown>, base: SceneLayerBase): GridSceneLayer {
  const color = parseColorRef(raw.color) ?? 'accent';
  const secondaryColor = parseColorRef(raw.secondaryColor);
  const glow = readClampedNumber(raw.glow, 0, 1);
  return {
    kind: 'grid',
    ...base,
    horizon: readClampedNumber(raw.horizon, 0.2, 0.85) ?? 0.58,
    spacing: readClampedNumber(raw.spacing, 14, 120, 0) ?? 44,
    ...(glow === undefined ? {} : { glow }),
    color,
    ...(secondaryColor ? { secondaryColor } : {}),
  };
}

function parseRaysLayer(raw: Record<string, unknown>, base: SceneLayerBase): RaysSceneLayer {
  const color = parseColorRef(raw.color) ?? 'accent';
  const secondaryColor = parseColorRef(raw.secondaryColor);
  return {
    kind: 'rays',
    ...base,
    count: readClampedNumber(raw.count, 2, 12, 0) ?? 5,
    originX: readClampedNumber(raw.originX, -0.2, 1.2) ?? 0.5,
    originY: readClampedNumber(raw.originY, -0.3, 1.2) ?? -0.1,
    spread: readClampedNumber(raw.spread, 0.05, 1) ?? 0.28,
    rotationSpeed: readClampedNumber(raw.rotationSpeed, -2, 2) ?? 0.25,
    color,
    ...(secondaryColor ? { secondaryColor } : {}),
  };
}

function parseSilhouetteLayer(
  raw: Record<string, unknown>,
  base: SceneLayerBase,
): SilhouetteSceneLayer {
  const style = isOneOf(raw.style, SILHOUETTE_STYLES) ? raw.style : 'mountains';
  const color = parseColorRef(raw.color) ?? 'surface';
  const secondaryColor = parseColorRef(raw.secondaryColor);
  return {
    kind: 'silhouette',
    ...base,
    style,
    x: readClampedNumber(raw.x, 0, 1) ?? 0.5,
    y: readClampedNumber(raw.y, 0.1, 0.95) ?? 0.72,
    scale: readClampedNumber(raw.scale, 0.2, 2) ?? 1,
    color,
    ...(secondaryColor ? { secondaryColor } : {}),
  };
}

function parseSceneLayer(raw: unknown, index: number, warnings?: string[]): SceneLayerSpec | null {
  if (!isRecord(raw) || typeof raw.kind !== 'string') {
    warnings?.push(`Skipped invalid scene layer at index ${index}.`);
    return null;
  }
  const base = parseLayerBase(raw);
  switch (raw.kind) {
    case 'gradient': {
      const parsed = parseGradientLayer(raw, base);
      if (!parsed) {
        warnings?.push(
          `Skipped gradient scene layer at index ${index} (requires 2–6 valid colors).`,
        );
      }
      return parsed;
    }
    case 'particles':
      return parseParticlesLayer(raw, base);
    case 'waves':
      return parseWavesLayer(raw, base);
    case 'grid':
      return parseGridLayer(raw, base);
    case 'rays':
      return parseRaysLayer(raw, base);
    case 'silhouette':
      return parseSilhouetteLayer(raw, base);
    default:
      warnings?.push(`Ignored unsupported scene layer kind "${raw.kind.slice(0, 32)}".`);
      return null;
  }
}

/** Validates and clamps a Tier 2 declarative `CustomSceneSpec` (pure data, zero code). */
export function parseCustomScene(raw: unknown, warnings?: string[]): CustomSceneSpec | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  if (!warnings && VALIDATED_SCENES.has(raw as unknown as CustomSceneSpec)) {
    return raw as unknown as CustomSceneSpec;
  }
  if (!Array.isArray(raw.layers)) {
    return undefined;
  }
  if (raw.layers.length > MAX_SCENE_LAYERS) {
    warnings?.push(`Truncated custom scene to the maximum ${MAX_SCENE_LAYERS} layers.`);
  }
  const layers: SceneLayerSpec[] = [];
  for (let i = 0; i < Math.min(raw.layers.length, MAX_SCENE_LAYERS); i++) {
    const parsed = parseSceneLayer(raw.layers[i], i, warnings);
    if (parsed) {
      layers.push(parsed);
    }
  }
  if (layers.length === 0) {
    return undefined;
  }
  const fps = readClampedNumber(raw.fps, 10, 30, 0);
  const spec: CustomSceneSpec = {
    layers,
    ...(fps === undefined ? {} : { fps }),
  };
  VALIDATED_SCENES.add(spec);
  return spec;
}

/* -------------------------------------------------------------------------- */
/* Tier 3: Static GLSL ES 1.00 Fragment Shader Validator                      */
/* -------------------------------------------------------------------------- */

function stripGlslComments(source: string): string {
  const chunks: string[] = [];
  let start = 0;
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      if (i > start) {
        chunks.push(source.slice(start, i));
      }
      const eol = source.indexOf('\n', i + 2);
      if (eol === -1) {
        start = source.length;
        break;
      }
      chunks.push('\n');
      i = eol + 1;
      start = i;
      continue;
    }
    if (ch === '/' && next === '*') {
      if (i > start) {
        chunks.push(source.slice(start, i));
      }
      const close = source.indexOf('*/', i + 2);
      if (close === -1) {
        start = source.length;
        break;
      }
      chunks.push(' ');
      i = close + 2;
      start = i;
      continue;
    }
    i++;
  }
  if (start < source.length) {
    chunks.push(source.slice(start));
  }
  return chunks.join('');
}

function exceedsMaxShaderBytes(source: string): boolean {
  if (source.length > MAX_CUSTOM_SHADER_BYTES) {
    return true;
  }
  if (source.length * 3 <= MAX_CUSTOM_SHADER_BYTES) {
    return false;
  }
  return TEXT_ENCODER.encode(source).byteLength > MAX_CUSTOM_SHADER_BYTES;
}

const MAX_SHADER_PARAM_ABS = 10_000;
const MIN_SHADER_PARAM_RANGE = 0.001;

function splitBalancedForHeader(code: string, openParen: number): string | null {
  let depth = 1;
  let i = openParen + 1;
  while (i < code.length && depth > 0) {
    const ch = code[i];
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0) {
        return code.slice(openParen + 1, i);
      }
    }
    i++;
  }
  return null;
}

const FOR_INIT_RE = /^(?:int\s+)?([a-zA-Z_]\w*)\s*=\s*(-?\d+)$/;
const FOR_COND_RE = /^([a-zA-Z_]\w*)\s*(<=|<|>=|>)\s*(-?\d+)$/;
const FOR_STEP_RE = /^([a-zA-Z_]\w*)\s*(\+\+|--|\+=\s*(\d+)|-=\s*(\d+))$/;

function checkForLoopBounds(code: string, errors: string[]): void {
  const forStartRe = /\bfor\s*\(/g;
  let match: RegExpExecArray | null = forStartRe.exec(code);
  while (match !== null) {
    const openParen = match.index + match[0].length - 1;
    const header = splitBalancedForHeader(code, openParen);
    const clauses = header?.split(';').map((part) => part.trim());
    if (!clauses || clauses.length !== 3) {
      errors.push(
        'Shader for-loop must use a bounded literal integer header (for (int i = 0; i < N; i++)).',
      );
      return;
    }
    const initMatch = clauses[0]?.match(FOR_INIT_RE);
    const condMatch = clauses[1]?.match(FOR_COND_RE);
    const stepMatch = clauses[2]?.match(FOR_STEP_RE);
    if (!initMatch || !condMatch || !stepMatch) {
      errors.push(
        'Shader for-loop must use a bounded literal integer header (for (int i = 0; i < N; i++)).',
      );
      return;
    }
    const ident = initMatch[1];
    if (condMatch[1] !== ident || stepMatch[1] !== ident) {
      errors.push('Shader for-loop counter variable must match across init, condition, and step.');
      return;
    }
    const start = Number.parseInt(initMatch[2]!, 10);
    const op = condMatch[2]!;
    const end = Number.parseInt(condMatch[3]!, 10);
    const stepToken = stepMatch[2]!;
    const isInc = stepToken === '++' || stepToken.startsWith('+=');
    const stepMag =
      stepToken === '++' || stepToken === '--'
        ? 1
        : Number.parseInt(stepMatch[3] ?? stepMatch[4] ?? '0', 10);
    const validDir =
      (isInc && (op === '<' || op === '<=')) || (!isInc && (op === '>' || op === '>='));
    if (!validDir || stepMag <= 0) {
      errors.push('Shader for-loop must step monotonically toward its bound.');
      return;
    }
    const delta = isInc ? end - start : start - end;
    const inclusive = op === '<=' || op === '>=';
    const iterations =
      delta < 0 || (delta === 0 && !inclusive)
        ? 0
        : Math.floor((delta - (inclusive ? 0 : 1)) / stepMag) + 1;
    if (iterations > MAX_SHADER_LOOP_ITERATIONS) {
      errors.push(
        `Shader for-loop (${iterations} iterations) exceeds the ${MAX_SHADER_LOOP_ITERATIONS} iteration safety cap.`,
      );
      return;
    }
    match = forStartRe.exec(code);
  }
}

/**
 * Statically validates a Tier 3 GLSL ES 1.00 fragment shader before it ever
 * reaches `gl.compileShader`. Rejects oversized sources, preprocessor
 * directives (`#version`, `#extension`, `#define`, etc.), `while`/`do` loops,
 * `gl_FragDepth`/`gl_FragData`, unbounded or excessive `for` loops, and
 * missing entrypoints.
 */
export function validateCustomShaderSource(raw: unknown): ShaderValidationResult {
  if (typeof raw !== 'string') {
    return {
      ok: false,
      source: '',
      entrypoint: null,
      errors: ['shader.fragment must be a GLSL source string.'],
    };
  }
  const source = raw
    .replace(/\r\n?|\f/g, '\n')
    .replace(/\0/g, '')
    .trim();
  const errors: string[] = [];

  if (source.length === 0) {
    errors.push('shader.fragment cannot be empty.');
    return { ok: false, source: '', entrypoint: null, errors };
  }
  if (exceedsMaxShaderBytes(source)) {
    errors.push(`shader.fragment exceeds the ${MAX_CUSTOM_SHADER_BYTES / 1024} KB limit.`);
    return { ok: false, source: '', entrypoint: null, errors };
  }

  const stripped = stripGlslComments(source);

  if (/^\s*#/m.test(stripped)) {
    errors.push(
      'shader.fragment cannot use preprocessor directives (#version, #extension, #define, etc.).',
    );
  }
  if (/\bwhile\s*\(/.test(stripped) || /\bdo\s*\{/.test(stripped)) {
    errors.push('shader.fragment cannot use while/do loops (use bounded for loops instead).');
  }
  if (/\bgl_FragDepth(?:EXT)?\b|\bgl_FragData\b/.test(stripped)) {
    errors.push('shader.fragment cannot write to gl_FragDepth or gl_FragData.');
  }
  checkForLoopBounds(stripped, errors);

  const hasMain = /\bvoid\s+main\s*\(\s*(?:void\s*)?\)/.test(stripped);
  const hasMainImage = /\bvoid\s+mainImage\s*\(/.test(stripped);
  let entrypoint: 'main' | 'mainImage' | null = null;
  if (hasMain) {
    entrypoint = 'main';
  } else if (hasMainImage) {
    entrypoint = 'mainImage';
  } else {
    errors.push(
      'shader.fragment must define void mainImage(out vec4 fragColor, in vec2 fragCoord) or void main().',
    );
  }

  return {
    ok: errors.length === 0,
    source,
    entrypoint,
    errors,
  };
}

function parseShaderParamSpec(
  raw: unknown,
  seen: Set<string>,
  warnings?: string[],
): CustomShaderParamSpec | null {
  if (!isRecord(raw) || typeof raw.key !== 'string' || typeof raw.kind !== 'string') {
    return null;
  }
  const key = raw.key.trim();
  if (!SHADER_PARAM_KEY_RE.test(key) || RESERVED_SHADER_UNIFORMS.has(key) || seen.has(key)) {
    warnings?.push(`Skipped invalid or duplicate shader parameter "${key.slice(0, 24)}".`);
    return null;
  }
  const label =
    typeof raw.label === 'string' && raw.label.trim().length > 0
      ? raw.label.trim().slice(0, 32)
      : key;

  if (raw.kind === 'number') {
    const min = readClampedNumber(raw.min, -MAX_SHADER_PARAM_ABS, MAX_SHADER_PARAM_ABS, 4) ?? 0;
    const max = readClampedNumber(raw.max, -MAX_SHADER_PARAM_ABS, MAX_SHADER_PARAM_ABS, 4) ?? 1;
    const range = max - min;
    if (range < MIN_SHADER_PARAM_RANGE) {
      warnings?.push(`Skipped shader number parameter "${key}" with invalid range.`);
      return null;
    }
    const rawStep =
      typeof raw.step === 'number' && Number.isFinite(raw.step) && raw.step > 0
        ? raw.step
        : range / 20;
    const step = Number(Math.min(range, Math.max(MIN_SHADER_PARAM_RANGE, rawStep)).toFixed(4));
    const defaultValue = readClampedNumber(raw.defaultValue, min, max, 4) ?? min;
    seen.add(key);
    return {
      key,
      kind: 'number',
      label,
      min,
      max,
      step,
      defaultValue,
    };
  }

  if (raw.kind === 'boolean') {
    seen.add(key);
    return {
      key,
      kind: 'boolean',
      label,
      defaultValue: raw.defaultValue === true,
    };
  }

  if (raw.kind === 'color') {
    const defaultValue =
      typeof raw.defaultValue === 'string' ? normalizeHex(raw.defaultValue) : null;
    if (!defaultValue) {
      warnings?.push(`Skipped shader color parameter "${key}" with invalid hex default.`);
      return null;
    }
    seen.add(key);
    return {
      key,
      kind: 'color',
      label,
      defaultValue,
    };
  }

  if (raw.kind === 'enum') {
    if (!Array.isArray(raw.options)) {
      warnings?.push(`Skipped shader enum parameter "${key}" without options.`);
      return null;
    }
    const options: string[] = [];
    for (const item of raw.options.slice(0, 12)) {
      if (typeof item !== 'string') {
        continue;
      }
      const clean = item.trim().slice(0, 28);
      if (clean && !options.includes(clean)) {
        options.push(clean);
      }
    }
    const [firstOption] = options;
    if (options.length < 2 || !firstOption) {
      warnings?.push(`Skipped shader enum parameter "${key}" (requires at least 2 options).`);
      return null;
    }
    let optionLabels: Record<string, string> | undefined;
    if (isRecord(raw.optionLabels)) {
      const labels: Record<string, string> = {};
      for (const opt of options) {
        const rawLabel = raw.optionLabels[opt];
        const trimmed = typeof rawLabel === 'string' ? rawLabel.trim() : '';
        if (trimmed) {
          labels[opt] = trimmed.slice(0, 32);
        }
      }
      if (Object.keys(labels).length > 0) {
        optionLabels = labels;
      }
    }
    const defaultValue =
      typeof raw.defaultValue === 'string' && options.includes(raw.defaultValue)
        ? raw.defaultValue
        : firstOption;
    seen.add(key);
    return {
      key,
      kind: 'enum',
      label,
      options,
      ...(optionLabels ? { optionLabels } : {}),
      defaultValue,
    };
  }

  warnings?.push(`Ignored unsupported shader parameter kind "${raw.kind.slice(0, 24)}".`);
  return null;
}

/** Validates and normalizes a Tier 3 `CustomShaderSpec` (opt-in GPU sandbox). */
export function parseCustomShader(
  raw: unknown,
  warnings?: string[],
): { readonly shader?: CustomShaderSpec; readonly errors: readonly string[] } {
  if (!isRecord(raw)) {
    return { errors: ['effects.backdrop.shader must be an object.'] };
  }
  if (!warnings && VALIDATED_SHADERS.has(raw as unknown as CustomShaderSpec)) {
    return { shader: raw as unknown as CustomShaderSpec, errors: [] };
  }
  const checked = validateCustomShaderSource(raw.fragment);
  if (!checked.ok) {
    return { errors: checked.errors };
  }

  const renderScale = readClampedNumber(raw.renderScale, 0.25, 1);
  const fps = readClampedNumber(raw.fps, 10, 30, 0);

  let params: CustomShaderParamSpec[] | undefined;
  if (Array.isArray(raw.params)) {
    if (raw.params.length > MAX_CUSTOM_SHADER_PARAMS) {
      warnings?.push(`Truncated shader parameters to ${MAX_CUSTOM_SHADER_PARAMS}.`);
    }
    const seen = new Set<string>();
    const valid: CustomShaderParamSpec[] = [];
    for (const item of raw.params.slice(0, MAX_CUSTOM_SHADER_PARAMS)) {
      const spec = parseShaderParamSpec(item, seen, warnings);
      if (spec) {
        valid.push(spec);
      }
    }
    if (valid.length > 0) {
      params = valid;
    }
  }

  let fallbackColors: readonly [string, string] | undefined;
  if (Array.isArray(raw.fallbackColors) && raw.fallbackColors.length >= 2) {
    const first =
      typeof raw.fallbackColors[0] === 'string' ? normalizeHex(raw.fallbackColors[0]) : null;
    const second =
      typeof raw.fallbackColors[1] === 'string' ? normalizeHex(raw.fallbackColors[1]) : null;
    if (first && second) {
      fallbackColors = [first, second];
    }
  }

  const shader: CustomShaderSpec = {
    fragment: checked.source,
    ...(renderScale === undefined ? {} : { renderScale }),
    ...(fps === undefined ? {} : { fps }),
    ...(params ? { params } : {}),
    ...(fallbackColors ? { fallbackColors } : {}),
  };
  VALIDATED_SHADERS.add(shader);
  return { shader, errors: [] };
}
