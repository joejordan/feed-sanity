// Curated Studio Vibes with flagship WebGL GLSL shaders attached.
// Kept separate from `model.ts` so lightweight consumers (such as `popup.html`)
// can match and display active vibes without bundling GLSL shader source strings.

import type { StudioVibe } from './model';
import type { CustomShaderSpec } from './scene-schema';
import { EVENT_HORIZON_SHADER } from './event-horizon-shader';
import { LUMINOUS_TIDE_SHADER } from './luminous-tide-shader';
import { STUDIO_VIBE_METAS } from './model';

const VIBE_SHADERS: Readonly<Record<string, CustomShaderSpec>> = {
  'luminous-tide': LUMINOUS_TIDE_SHADER,
  'event-horizon': EVENT_HORIZON_SHADER,
};

/**
 * Curated one-click Studio Vibes combining palette, live backdrop (including
 * flagship Tier 3 GLSL shaders), surface finish, and click feedback.
 */
export const STUDIO_VIBES: readonly StudioVibe[] = STUDIO_VIBE_METAS.map((meta): StudioVibe => {
  const customShader = VIBE_SHADERS[meta.id];
  if (meta.effects.backdrop === 'custom-shader' && !customShader) {
    throw new Error(`Missing shader definition for Studio Vibe "${meta.id}".`);
  }
  const base: Omit<StudioVibe, 'effects'> = {
    id: meta.id,
    name: meta.name,
    tagline: meta.tagline,
    preset: meta.preset,
    swatch: meta.swatch,
    ...(meta.font ? { font: meta.font } : {}),
  };
  return {
    ...base,
    effects: customShader ? { ...meta.effects, customShader } : meta.effects,
  };
});
