// Pluggable live backdrop registry: Matrix Digital Rain, Vice City VI Horizon,
// Aurora, Silk, Constellations, Cyber Grid, Prism Beams, Dot Spotlight,
// Jungle Canopy, and Coral Shoreline.
//
// Every renderer is Trusted Types safe (canvas drawing and CSSOM styling only,
// zero innerHTML), loads zero external assets, caps its resolution and frame
// rate, and pauses on hidden tabs, the Pause switch, and reduced motion. The
// WebGL scenes fall back to Canvas 2D, then to a static CSS wash.

import type { RainCharsetName } from './digital-rain/charsets';
import type { DigitalRainOptions, RainIntro, RainLookName } from './digital-rain/settings';
import type { BackdropEffectId } from './model';
import type { BackdropContext, BackdropInstance } from './renderers/types';
import { RAIN_CHARSETS } from './digital-rain/charsets';
import { mountDigitalRain } from './digital-rain/mount';
import { RAIN_PRESETS } from './digital-rain/settings';
import { DIGITAL_RAIN_PARAM_SPECS, resolveEffectParams } from './model';
import { AURORA_SCENE } from './renderers/aurora';
import { CANOPY_SCENE } from './renderers/canopy';
import { mountCustomSceneBackdrop } from './renderers/custom-scene';
import { mountCustomShaderBackdrop } from './renderers/custom-shader';
import { CYBER_GRID_SCENE } from './renderers/cyber-grid';
import { DOT_SPOTLIGHT_SCENE } from './renderers/dot-spotlight';
import { FALLBACK_COLORS } from './renderers/palette';
import { PRISM_BEAMS_SCENE } from './renderers/prism-beams';
import { createSceneCanvas, mountScene } from './renderers/scene-host';
import { SHORELINE_SCENE } from './renderers/shoreline';
import { SILK_SCENE } from './renderers/silk';
import { STARFIELD_SCENE } from './renderers/starfield';
import { VICE_HORIZON_SCENE } from './renderers/vice-horizon';

export type { BackdropContext, BackdropInstance } from './renderers/types';

export interface BackdropPlugin {
  readonly id: Exclude<BackdropEffectId, 'none'>;
  readonly mount: (ctx: BackdropContext) => BackdropInstance;
  /**
   * The scene answers clicks itself, so every primary click is fed to `burst`
   * whatever click effect is active. Other backdrops burst only under Glyphs.
   */
  readonly reactsToClicks?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Matrix Digital Rain (`@ignitesoftware/digital-rain` engine)                */
/* -------------------------------------------------------------------------- */

function buildDigitalRainOptions(ctx: BackdropContext): DigitalRainOptions {
  const { effects, palette } = ctx;
  const scheme = palette?.colorScheme ?? ctx.hostScheme;
  const params = resolveEffectParams(DIGITAL_RAIN_PARAM_SPECS, effects.backdropParams);
  const rainLook = params.look as RainLookName;
  const rainCharset = params.charset as RainCharsetName;
  const rainDensity = params.density as number;
  const rainIntro = params.intro as RainIntro;
  const customGlyphs = params.customGlyphs as string;
  const charset =
    customGlyphs.length > 0 ? customGlyphs : (RAIN_CHARSETS[rainCharset] ?? RAIN_CHARSETS.matrix);

  let colorOptions: DigitalRainOptions;
  if (rainLook === 'theme') {
    const fallbackHead = scheme === 'light' ? '#0f172a' : '#e4ffe9';
    colorOptions = {
      trailColor: palette?.accent ?? FALLBACK_COLORS[scheme].accent,
      headColor: palette ? palette.text : fallbackHead,
      appearance: scheme === 'light' ? 'ink' : 'emissive',
      bloom: scheme === 'light' ? 0 : 0.35,
    };
  } else {
    colorOptions = RAIN_PRESETS[rainLook];
  }

  return {
    ...colorOptions,
    backgroundColor: 'transparent',
    charset,
    density: rainDensity,
    speed: effects.speed,
    paused: effects.paused,
    interactive: effects.interactive,
    timeWarp: effects.interactive,
    // Click cascades are routed through `burst` by the click-effects layer, which
    // owns click policy (Glyphs only, never on text-selection drags).
    clickCascade: false,
    intro: rainIntro,
    exposure: Math.max(0.3, Math.min(1.4, effects.intensity * 1.15)),
    resolution: 0.75,
  };
}

function mountDigitalRainBackdrop(ctx: BackdropContext): BackdropInstance {
  const canvas = createSceneCanvas(ctx.doc);
  ctx.container.append(canvas);
  const rain = mountDigitalRain(canvas, {
    pointerTarget: ctx.doc.documentElement,
    ...buildDigitalRainOptions(ctx),
  });
  return {
    update(next) {
      rain.update(buildDigitalRainOptions(next));
    },
    burst(x, y) {
      rain.cascade(x, y);
    },
    destroy() {
      rain.destroy();
      canvas.remove();
    },
  };
}

export const BACKDROP_REGISTRY: Readonly<
  Record<Exclude<BackdropEffectId, 'none'>, BackdropPlugin>
> = {
  'digital-rain': {
    id: 'digital-rain',
    mount: mountDigitalRainBackdrop,
  },
  'vice-horizon': { id: 'vice-horizon', mount: (ctx) => mountScene(ctx, VICE_HORIZON_SCENE) },
  aurora: { id: 'aurora', mount: (ctx) => mountScene(ctx, AURORA_SCENE) },
  silk: { id: 'silk', mount: (ctx) => mountScene(ctx, SILK_SCENE) },
  starfield: { id: 'starfield', mount: (ctx) => mountScene(ctx, STARFIELD_SCENE) },
  'cyber-grid': { id: 'cyber-grid', mount: (ctx) => mountScene(ctx, CYBER_GRID_SCENE) },
  'prism-beams': { id: 'prism-beams', mount: (ctx) => mountScene(ctx, PRISM_BEAMS_SCENE) },
  'dot-spotlight': { id: 'dot-spotlight', mount: (ctx) => mountScene(ctx, DOT_SPOTLIGHT_SCENE) },
  canopy: {
    id: 'canopy',
    mount: (ctx) => mountScene(ctx, CANOPY_SCENE),
    reactsToClicks: true,
  },
  shoreline: {
    id: 'shoreline',
    mount: (ctx) => mountScene(ctx, SHORELINE_SCENE),
    reactsToClicks: true,
  },
  'custom-scene': { id: 'custom-scene', mount: mountCustomSceneBackdrop, reactsToClicks: true },
  'custom-shader': { id: 'custom-shader', mount: mountCustomShaderBackdrop, reactsToClicks: true },
};
