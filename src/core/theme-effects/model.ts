// Core Theme & Effects Studio configuration types, defaults, validation,
// option metadata, and shader-free Studio Vibe descriptors.

import type {
  BackdropEffectId,
  ClickEffectId,
  EffectParamValues,
  SurfaceFinishId,
} from './param-specs';
import type { CustomSceneSpec, CustomShaderSpec } from './scene-schema';
import { isRecord } from '../storage';
import {
  BACKDROP_EFFECT_IDS,
  CLICK_EFFECT_IDS,
  getActiveBackdropParamSpecs,
  getClickParamSpecs,
  getSurfaceParamSpecs,
  SURFACE_FINISH_IDS,
  THEME_EFFECT_BOUNDS,
  validateEffectParams,
} from './param-specs';
import { isOneOf, parseCustomScene, parseCustomShader, readClampedNumber } from './scene-schema';

export type {
  BackdropEffectId,
  ClickEffectId,
  EffectParamSpec,
  EffectParamUnit,
  EffectParamValue,
  EffectParamValues,
  SurfaceFinishId,
} from './param-specs';
export {
  AURORA_PARAM_SPECS,
  BACKDROP_EFFECT_IDS,
  BACKDROP_PARAM_SPECS,
  CANOPY_PARAM_SPECS,
  CLICK_EFFECT_IDS,
  CLICK_PARAM_SPECS,
  CYBER_GRID_PARAM_SPECS,
  DIGITAL_RAIN_PARAM_SPECS,
  DOT_SPOTLIGHT_PARAM_SPECS,
  deriveEffectParams,
  getActiveBackdropParamSpecs,
  getBackdropParamSpecs,
  getClickParamSpecs,
  getSurfaceParamSpecs,
  PRISM_BEAMS_PARAM_SPECS,
  RAIN_CHARSET_NAMES,
  RAIN_INTRO_NAMES,
  RAIN_LOOK_NAMES,
  resolveEffectParams,
  SHORELINE_PARAM_SPECS,
  SILK_PARAM_SPECS,
  STARFIELD_PARAM_SPECS,
  SURFACE_FINISH_IDS,
  SURFACE_PARAM_SPECS,
  sameEffectParams,
  THEME_EFFECT_BOUNDS,
  VICE_HORIZON_PARAM_SPECS,
  validateEffectParams,
} from './param-specs';

function mergeScopedParams<T>(
  baseId: T | undefined,
  patchId: T | undefined,
  baseParams: EffectParamValues | undefined,
  patchParams: EffectParamValues | undefined,
): EffectParamValues | undefined {
  if (baseId !== undefined && patchId !== undefined && patchId !== baseId) {
    return patchParams;
  }
  if (patchParams !== undefined) {
    return { ...baseParams, ...patchParams };
  }
  return baseParams;
}

/**
 * Merges a partial `ThemeEffectsConfig` update into `base`, preserving existing
 * `backdropParams`, `surfaceParams`, and `clickParams` when staying on the same
 * effect and resetting them when switching.
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
  const nextBackdropParams = mergeScopedParams(
    base.backdrop,
    patch.backdrop,
    base.backdropParams,
    patch.backdropParams,
  );
  const nextSurfaceParams = mergeScopedParams(
    base.surface,
    patch.surface,
    base.surfaceParams,
    patch.surfaceParams,
  );
  const nextClickParams = mergeScopedParams(
    base.click,
    patch.click,
    base.clickParams,
    patch.clickParams,
  );
  const nextBackdrop = patch.backdrop ?? base.backdrop;
  const nextCustomScene =
    nextBackdrop === 'custom-scene' ? (patch.customScene ?? base.customScene) : undefined;
  const nextCustomShader =
    nextBackdrop === 'custom-shader' ? (patch.customShader ?? base.customShader) : undefined;
  const {
    backdropParams: _baseParams,
    surfaceParams: _baseSurfaceParams,
    clickParams: _baseClickParams,
    customScene: _baseScene,
    customShader: _baseShader,
    ...restBase
  } = base;
  const {
    backdropParams: _patchParams,
    surfaceParams: _patchSurfaceParams,
    clickParams: _patchClickParams,
    customScene: _patchScene,
    customShader: _patchShader,
    ...restPatch
  } = patch;
  return {
    ...restBase,
    ...restPatch,
    ...(nextBackdropParams ? { backdropParams: nextBackdropParams } : {}),
    ...(nextSurfaceParams ? { surfaceParams: nextSurfaceParams } : {}),
    ...(nextClickParams ? { clickParams: nextClickParams } : {}),
    ...(nextCustomScene ? { customScene: nextCustomScene } : {}),
    ...(nextCustomShader ? { customShader: nextCustomShader } : {}),
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
  /** Tier 2 declarative multi-layer scene spec when `backdrop === 'custom-scene'`. */
  readonly customScene?: CustomSceneSpec;
  /** Tier 3 opt-in WebGL GLSL shader spec when `backdrop === 'custom-shader'`. */
  readonly customShader?: CustomShaderSpec;
  /** Card, header, and CTA surface treatment. */
  readonly surface: SurfaceFinishId;
  /** Validated plugin-specific parameters for the active `surface` finish. */
  readonly surfaceParams?: EffectParamValues;
  /** Interactive micro-effect triggered on primary clicks. */
  readonly click: ClickEffectId;
  /** Validated plugin-specific parameters for the active `click` effect. */
  readonly clickParams?: EffectParamValues;
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
  return readClampedNumber(value, min, max) ?? fallback;
}

function readEnum<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T {
  return isOneOf(raw, allowed) ? raw : fallback;
}

/** Validates and clamps `ThemeEffectsConfig` (including active plugin `backdropParams`) safely. */
export function readThemeEffectsConfig(raw: unknown): ThemeEffectsConfig {
  if (!isRecord(raw)) {
    return { ...DEFAULT_THEME_EFFECTS };
  }
  let backdrop = readEnum(raw.backdrop, BACKDROP_EFFECT_IDS, DEFAULT_THEME_EFFECTS.backdrop);
  const customScene = backdrop === 'custom-scene' ? parseCustomScene(raw.customScene) : undefined;
  const parsedShader =
    backdrop === 'custom-shader' ? parseCustomShader(raw.customShader) : undefined;
  const customShader = parsedShader?.errors.length === 0 ? parsedShader.shader : undefined;
  if (
    (backdrop === 'custom-scene' && !customScene) ||
    (backdrop === 'custom-shader' && !customShader)
  ) {
    backdrop = 'none';
  }
  const paramSpecs = getActiveBackdropParamSpecs({
    backdrop,
    ...(customShader ? { customShader } : {}),
  });
  const backdropParams = validateEffectParams(raw.backdropParams, paramSpecs);
  const surface = readEnum(raw.surface, SURFACE_FINISH_IDS, DEFAULT_THEME_EFFECTS.surface);
  const click = readEnum(raw.click, CLICK_EFFECT_IDS, DEFAULT_THEME_EFFECTS.click);
  const surfaceParams = validateEffectParams(raw.surfaceParams, getSurfaceParamSpecs(surface));
  const clickParams = validateEffectParams(raw.clickParams, getClickParamSpecs(click));
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
    ...(customScene ? { customScene } : {}),
    ...(customShader ? { customShader } : {}),
    surface,
    ...(surfaceParams ? { surfaceParams } : {}),
    click,
    ...(clickParams ? { clickParams } : {}),
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
  {
    id: 'canopy',
    name: 'Jungle Canopy',
    tagline: 'Leaf-cast sunbeams, mist & fireflies',
    preview:
      'radial-gradient(ellipse 60% 70% at 0% 100%, #06120c 0%, transparent 70%), radial-gradient(ellipse 60% 70% at 100% 100%, #06120c 0%, transparent 70%), conic-gradient(from 152deg at 34% -20%, transparent 0deg, rgb(244 201 93 / 55%) 9deg, transparent 18deg, rgb(244 201 93 / 38%) 30deg, transparent 42deg, transparent 360deg), linear-gradient(180deg, #2c6b47 0%, #123524 60%, #06120c 100%)',
  },
  {
    id: 'shoreline',
    name: 'Coral Shoreline',
    tagline: 'Aerial lagoon caustics, lacy surf & palms',
    preview:
      'radial-gradient(ellipse 42% 48% at 72% 38%, rgb(255 250 225 / 55%) 0%, transparent 70%), linear-gradient(104deg, #f3e6cf 0%, #dcc5a0 24%, #ffffff 28%, #8be8df 36%, #24b9be 68%, #0a6f87 100%)',
  },
];

const BACKDROP_OPTION_BY_ID: ReadonlyMap<BackdropEffectId, BackdropOptionMeta> = new Map(
  BACKDROP_OPTIONS.map((option) => [option.id, option]),
);

/** Returns metadata for `id` in O(1) time. */
export function findBackdropOption(id: BackdropEffectId): BackdropOptionMeta | undefined {
  return BACKDROP_OPTION_BY_ID.get(id);
}

/** Returns a human-friendly display name for built-in, custom-scene, or custom-shader backdrops. */
export function getBackdropDisplayName(id: BackdropEffectId): string | undefined {
  if (id === 'custom-scene') {
    return 'Custom Scene';
  }
  if (id === 'custom-shader') {
    return 'GPU Shader';
  }
  return BACKDROP_OPTION_BY_ID.get(id)?.name;
}

export const SURFACE_FINISH_OPTIONS: ReadonlyArray<{
  readonly value: SurfaceFinishId;
  readonly label: string;
  readonly summary: string;
}> = [
  { value: 'default', label: 'Solid', summary: 'Crisp opaque cards' },
  { value: 'glass', label: 'Glass', summary: 'Frosted translucent blur' },
  { value: 'gradient', label: 'Gradient', summary: 'Rich directional sheen' },
  { value: 'neon', label: 'Neon', summary: 'Luminous accent borders' },
  { value: 'prism', label: 'Prism', summary: 'Pointer-tracked specular sheen' },
  { value: 'moonlit', label: 'Moonlit', summary: 'Top-lit sheen & luminous underglow' },
  { value: 'dappled', label: 'Dappled', summary: 'Sunlight through leaves & canopy glow' },
  { value: 'caustic', label: 'Sea Glass', summary: 'Refracted caustic light & sea-glass rims' },
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
  { value: 'supernova', label: 'Supernova' },
  { value: 'tide', label: 'Tide' },
  { value: 'petals', label: 'Petals' },
  { value: 'seafoam', label: 'Seafoam' },
];

const SURFACE_FINISH_LABEL_BY_ID: ReadonlyMap<SurfaceFinishId, string> = new Map(
  SURFACE_FINISH_OPTIONS.map((option) => [option.value, option.label]),
);

const CLICK_EFFECT_LABEL_BY_ID: ReadonlyMap<ClickEffectId, string> = new Map(
  CLICK_EFFECT_OPTIONS.map((option) => [option.value, option.label]),
);

/** Returns the human-friendly surface finish label (e.g. `Glass`) in O(1) time. */
export function getSurfaceFinishLabel(id: SurfaceFinishId): string | undefined {
  return SURFACE_FINISH_LABEL_BY_ID.get(id);
}

/** Returns the human-friendly click effect label (e.g. `Sparks`) in O(1) time. */
export function getClickEffectLabel(id: ClickEffectId): string | undefined {
  return CLICK_EFFECT_LABEL_BY_ID.get(id);
}

declare const STUDIO_VIBE_META_BRAND: unique symbol;

interface StudioVibeMetaData {
  readonly id: string;
  readonly name: string;
  readonly tagline: string;
  readonly preset: string;
  readonly font?: string;
  readonly swatch: string;
  readonly effects: Partial<Omit<ThemeEffectsConfig, 'customShader'>>;
}

/**
 * Shader-free Studio Vibe descriptor used for matching, naming, and clearing vibes
 * without bundling GLSL shaders. Nominally distinct from `StudioVibe` so a
 * shader-less descriptor cannot be passed to `applyStudioVibe` / `vibeToThemeDocument`.
 */
export interface StudioVibeMeta extends StudioVibeMetaData {
  readonly [STUDIO_VIBE_META_BRAND]: true;
}

export interface StudioVibe {
  readonly [STUDIO_VIBE_META_BRAND]?: never;
  readonly id: string;
  readonly name: string;
  readonly tagline: string;
  readonly preset: string;
  readonly font?: string;
  readonly swatch: string;
  readonly effects: Partial<ThemeEffectsConfig>;
}

const RAW_STUDIO_VIBE_METAS: readonly StudioVibeMetaData[] = [
  {
    id: 'luminous-tide',
    name: 'Luminous Tide',
    tagline: 'Glowing moonlit surf, live lunar phase & tidal ripples',
    preset: 'luminous-tide',
    swatch:
      'radial-gradient(circle at 14% 34%, #f1f8ff 0 4px, rgb(241 248 255 / 0%) 5px), radial-gradient(ellipse 62% 24% at 58% 76%, #45d8ff 0%, rgb(69 216 255 / 0%) 72%), linear-gradient(180deg, #050d18 0%, #0c2a40 62%, #06121f 100%)',
    effects: {
      backdrop: 'custom-shader',
      intensity: 0.96,
      speed: 1,
      glassStrength: 0.3,
      surface: 'moonlit',
      click: 'tide',
      paused: false,
      interactive: true,
    },
  },
  {
    id: 'rainforest-canopy',
    name: 'Rainforest Canopy',
    tagline: 'Leaf-cast sunbeams, drifting fireflies, dappled cards & petals',
    preset: 'rainforest-canopy',
    swatch:
      'radial-gradient(ellipse 46% 74% at 0% 100%, #06120c 0%, rgb(6 18 12 / 0%) 72%), radial-gradient(ellipse 46% 74% at 100% 100%, #06120c 0%, rgb(6 18 12 / 0%) 72%), conic-gradient(from 150deg at 30% -24%, rgb(244 201 93 / 0%) 0deg, rgb(244 201 93 / 60%) 8deg, rgb(244 201 93 / 0%) 17deg, rgb(244 201 93 / 42%) 28deg, rgb(244 201 93 / 0%) 40deg, rgb(244 201 93 / 0%) 360deg), linear-gradient(180deg, #2f7a4f 0%, #134029 58%, #06120c 100%)',
    effects: {
      backdrop: 'canopy',
      intensity: 0.92,
      speed: 1,
      glassStrength: 0.28,
      surface: 'dappled',
      click: 'petals',
      paused: false,
      interactive: true,
    },
  },
  {
    id: 'coral-lagoon',
    name: 'Coral Lagoon',
    tagline: 'Aerial turquoise cove, dancing caustics, sea-glass cards & seafoam',
    preset: 'coral-lagoon',
    swatch:
      'radial-gradient(ellipse 42% 48% at 72% 38%, rgb(255 250 225 / 55%) 0%, rgb(255 250 225 / 0%) 70%), linear-gradient(106deg, #f3e6cf 0%, #ddc7a3 24%, #ffffff 28%, #8be8df 36%, #24b9be 68%, #0a6f87 100%)',
    effects: {
      backdrop: 'shoreline',
      intensity: 0.92,
      speed: 1,
      glassStrength: 0.24,
      surface: 'caustic',
      click: 'seafoam',
      paused: false,
      interactive: true,
    },
  },
  {
    id: 'event-horizon',
    name: 'Event Horizon',
    tagline: 'WebGL gravitational black hole, prism sheen & shockwaves',
    preset: 'event-horizon',
    swatch:
      'radial-gradient(circle at 38% 52%, #05050a 0%, #05050a 17%, #fef3c7 22%, #f59e0b 32%, #a855f7 56%, #130b24 80%, #05050a 100%)',
    effects: {
      backdrop: 'custom-shader',
      intensity: 0.94,
      speed: 0.95,
      glassStrength: 0.28,
      surface: 'prism',
      click: 'supernova',
      paused: false,
      interactive: true,
    },
  },
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

/**
 * Shader-free Studio Vibe metadata for matching, naming, and clearing vibes
 * without pulling flagship WebGL GLSL shader sources into lightweight bundles
 * (such as `popup.html`). Full `STUDIO_VIBES` with `customShader` attached live
 * in `./vibes.ts`.
 */
export const STUDIO_VIBE_METAS: readonly StudioVibeMeta[] =
  RAW_STUDIO_VIBE_METAS as readonly StudioVibeMeta[];
