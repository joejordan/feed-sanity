// Pluggable live backdrop registry: Matrix Digital Rain, Vice City VI Horizon,
// Aurora, Silk, Constellations, Cyber Grid, Prism Beams, and Dot Spotlight.
//
// Every renderer is Trusted Types safe (canvas drawing and CSSOM styling only,
// zero innerHTML), loads zero external assets, caps its resolution and frame
// rate, and pauses on hidden tabs, the Pause switch, and reduced motion. The
// WebGL scenes fall back to Canvas 2D, then to a static CSS wash.

import type { DigitalRainOptions } from './digital-rain/settings';
import type { BackdropEffectId } from './model';
import type { BackdropContext, BackdropInstance } from './renderers/types';
import { RAIN_CHARSETS } from './digital-rain/charsets';
import { mountDigitalRain } from './digital-rain/mount';
import { RAIN_PRESETS } from './digital-rain/settings';
import { AURORA_SCENE } from './renderers/aurora';
import { CYBER_GRID_SCENE } from './renderers/cyber-grid';
import { DOT_SPOTLIGHT_SCENE } from './renderers/dot-spotlight';
import { FALLBACK_COLORS } from './renderers/palette';
import { PRISM_BEAMS_SCENE } from './renderers/prism-beams';
import { createSceneCanvas, mountScene } from './renderers/scene-host';
import { SILK_SCENE } from './renderers/silk';
import { STARFIELD_SCENE } from './renderers/starfield';
import { VICE_HORIZON_SCENE } from './renderers/vice-horizon';

export type { BackdropContext, BackdropInstance } from './renderers/types';

export interface BackdropPlugin {
  readonly id: Exclude<BackdropEffectId, 'none'>;
  readonly mount: (ctx: BackdropContext) => BackdropInstance;
}

/* -------------------------------------------------------------------------- */
/* Matrix Digital Rain (`@ignitesoftware/digital-rain` engine)                */
/* -------------------------------------------------------------------------- */

function buildDigitalRainOptions(ctx: BackdropContext): DigitalRainOptions {
  const { effects, palette } = ctx;
  const scheme = palette?.colorScheme ?? ctx.hostScheme;
  const charset = RAIN_CHARSETS[effects.rainCharset] ?? RAIN_CHARSETS.matrix;

  let colorOptions: DigitalRainOptions;
  if (effects.rainLook === 'theme') {
    const fallbackHead = scheme === 'light' ? '#0f172a' : '#e4ffe9';
    colorOptions = {
      trailColor: palette?.accent ?? FALLBACK_COLORS[scheme].accent,
      headColor: palette ? palette.text : fallbackHead,
      appearance: scheme === 'light' ? 'ink' : 'emissive',
      bloom: scheme === 'light' ? 0 : 0.35,
    };
  } else {
    colorOptions = RAIN_PRESETS[effects.rainLook];
  }

  return {
    ...colorOptions,
    backgroundColor: 'transparent',
    charset,
    density: effects.rainDensity,
    speed: effects.speed,
    paused: effects.paused,
    interactive: effects.interactive,
    timeWarp: effects.interactive,
    // Click cascades are routed through `burst` by the click-effects layer, which
    // owns click policy (Glyphs only, never on text-selection drags).
    clickCascade: false,
    intro: effects.rainIntro,
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
  'digital-rain': { id: 'digital-rain', mount: mountDigitalRainBackdrop },
  'vice-horizon': { id: 'vice-horizon', mount: (ctx) => mountScene(ctx, VICE_HORIZON_SCENE) },
  aurora: { id: 'aurora', mount: (ctx) => mountScene(ctx, AURORA_SCENE) },
  silk: { id: 'silk', mount: (ctx) => mountScene(ctx, SILK_SCENE) },
  starfield: { id: 'starfield', mount: (ctx) => mountScene(ctx, STARFIELD_SCENE) },
  'cyber-grid': { id: 'cyber-grid', mount: (ctx) => mountScene(ctx, CYBER_GRID_SCENE) },
  'prism-beams': { id: 'prism-beams', mount: (ctx) => mountScene(ctx, PRISM_BEAMS_SCENE) },
  'dot-spotlight': { id: 'dot-spotlight', mount: (ctx) => mountScene(ctx, DOT_SPOTLIGHT_SCENE) },
};
