// Silk: slow liquid satin folds tinted to the active palette (after React Bits
// "Silk"). A lit height-field shader gives soft diffuse folds with a satin sheen
// and specular glints; Canvas 2D draws layered drapes when WebGL is unavailable.

import type { Rgb, ScenePalette } from './palette';
import type { Scene, SceneFactory, SceneSpec } from './scene-host';
import { degreesToRadians } from '../digital-rain/math';
import { deriveEffectParams, SILK_PARAM_SPECS } from '../model';
import { BLACK, derivePalette, mixRgb, rgbCss, rgbUnit, WHITE } from './palette';
import { createShaderScene, GLSL_NOISE, GLSL_PRECISION } from './webgl';

const silkParams = deriveEffectParams(SILK_PARAM_SPECS, (p) => {
  const rad = degreesToRadians(p.angle as number);
  return {
    scale: p.scale as number,
    sheen: p.sheen as number,
    rad,
    cos: Math.cos(rad),
    sin: Math.sin(rad),
  };
});

interface SilkColors {
  readonly shadow: Rgb;
  readonly base: Rgb;
  readonly sheen: Rgb;
  readonly glint: Rgb;
}

const silkColors = derivePalette((palette: ScenePalette): SilkColors => {
  if (palette.scheme === 'light') {
    // Pearl satin: bright cloth with accent-tinted shadows in the folds.
    const cloth = mixRgb(palette.background, WHITE, 0.35);
    return {
      shadow: mixRgb(mixRgb(palette.background, palette.accent, 0.22), palette.text, 0.1),
      base: mixRgb(cloth, palette.accent, 0.06),
      sheen: mixRgb(WHITE, palette.accent, 0.08),
      glint: WHITE,
    };
  }
  return {
    shadow: mixRgb(palette.background, BLACK, 0.4),
    base: mixRgb(palette.background, palette.accent, 0.4),
    sheen: mixRgb(palette.accent, palette.text, 0.38),
    glint: mixRgb(palette.text, WHITE, 0.4),
  };
});

const SILK_FRAGMENT = `${GLSL_PRECISION}
uniform vec2 uResolution;
uniform float uTime;
uniform vec3 uPointer;
uniform vec3 uShadow;
uniform vec3 uBase;
uniform vec3 uSheen;
uniform vec3 uGlint;
uniform float uLight;
uniform float uScale;
uniform float uSheenGain;
uniform float uAngle;
${GLSL_NOISE}

// Long sinuous ridges running along y: the cloth's folds, gently swaying.
// Low-frequency simplex warp is sampled once per fragment and reused for normals.
float drape(vec2 p, float t, float noiseWarp) {
  float warp = 0.5 * sin(p.y * 1.25 + t * 0.5) + 0.26 * sin(p.y * 2.6 - t * 0.33 + p.x * 0.7) + noiseWarp;
  float x = p.x + warp;
  float h = 0.62 * sin(x * 5.2 + t * 0.28);
  h += 0.27 * sin(x * 9.1 - p.y * 0.7 - t * 0.21 + 1.3);
  h += 0.11 * sin(x * 15.5 + p.y * 1.6 + t * 0.37);
  return h;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 p = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;
  float a = uAngle;
  p = mat2(cos(a), -sin(a), sin(a), cos(a)) * p * (1.35 * uScale);
  float t = uTime * 0.55;

  float noiseWarp = 0.08 * snoise(vec2(p.x * 0.6, p.y * 0.5 - t * 0.08));
  float eps = 0.012;
  float h = drape(p, t, noiseWarp);
  float hx = drape(p + vec2(eps, 0.0), t, noiseWarp);
  float hy = drape(p + vec2(0.0, eps), t, noiseWarp);
  vec3 n = normalize(vec3(-(hx - h) / eps * 0.085, -(hy - h) / eps * 0.085, 1.0));

  vec3 L = normalize(vec3(-0.42, 0.58, 0.7));
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float diffuse = clamp(dot(n, L), 0.0, 1.0);
  float facing = clamp(dot(n, H), 0.0, 1.0);
  float sheen = pow(facing, 9.0) * uSheenGain;
  float glint = pow(facing, 56.0) * uSheenGain;

  vec3 col = mix(uShadow, uBase, smoothstep(0.15, 0.98, diffuse));
  col += uSheen * sheen * (uLight > 0.5 ? 0.25 : 0.38);
  col += uGlint * glint * (uLight > 0.5 ? 0.35 : 0.45);

  vec2 m = vec2(uPointer.x, uPointer.y) - uv;
  m.x *= uResolution.x / uResolution.y;
  col += uSheen * 0.07 * uPointer.z * exp(-dot(m, m) * 7.0);

  float vig = smoothstep(1.2, 0.2, length((uv - 0.5) * vec2(1.05, 1.3)));
  col = mix(mix(uShadow, uBase, 0.25), col, 0.6 + 0.4 * vig);
  col += (hash12(gl_FragCoord.xy + fract(t) * 37.0) - 0.5) * (2.0 / 255.0);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const createSilkShader: SceneFactory = createShaderScene({
  fragment: SILK_FRAGMENT,
  uniforms: ['uShadow', 'uBase', 'uSheen', 'uGlint', 'uLight', 'uScale', 'uSheenGain', 'uAngle'],
  renderScale: 0.45,
  maxPixels: 450_000,
  bindPalette(gl, u, palette) {
    const colors = silkColors(palette);
    gl.uniform3fv(u.uShadow, rgbUnit(colors.shadow));
    gl.uniform3fv(u.uBase, rgbUnit(colors.base));
    gl.uniform3fv(u.uSheen, rgbUnit(colors.sheen));
    gl.uniform3fv(u.uGlint, rgbUnit(colors.glint));
    gl.uniform1f(u.uLight, palette.scheme === 'light' ? 1 : 0);
  },
  bindParams(gl, u, rawParams) {
    const params = silkParams(rawParams);
    gl.uniform1f(u.uScale, params.scale);
    gl.uniform1f(u.uSheenGain, params.sheen);
    gl.uniform1f(u.uAngle, params.rad);
  },
});

const DRAPES = 7;
const DRAPE_SAMPLES = 20;

function drapeAmplitude(h: number, i: number): number {
  return h * (0.05 + 0.02 * Math.sin(i * 1.7));
}

const createSilkCanvas: SceneFactory = (canvas) => {
  const c = canvas.getContext('2d');
  if (!c) {
    return null;
  }
  // Gradients depend only on palette, sheen, and size, so they are built once per change.
  let cacheKey = '';
  let ground: CanvasGradient | null = null;
  let folds: CanvasGradient[] = [];
  const scene: Scene = {
    kind: 'canvas2d',
    renderScale: 0.3,
    maxPixels: 360_000,
    render({ ctx, palette, view, time }) {
      const { scale, sheen, cos: drapeCos, sin: drapeSin } = silkParams(ctx.effects.backdropParams);
      const w = view.cssWidth;
      const h = view.cssHeight;
      const pr = view.pixelRatio;
      const span = Math.hypot(w, h);
      const key = `${palette.key}|${w}|${h}|${sheen}`;
      if (key !== cacheKey || !ground) {
        cacheKey = key;
        const colors = silkColors(palette);
        ground = c.createLinearGradient(0, 0, w, h);
        ground.addColorStop(0, rgbCss(colors.shadow));
        ground.addColorStop(0.5, rgbCss(colors.base));
        ground.addColorStop(1, rgbCss(colors.shadow));
        folds = Array.from({ length: DRAPES }, (_, i) => {
          const offset = ((i + 0.5) / DRAPES - 0.5) * span * 0.95;
          const fold = c.createLinearGradient(
            0,
            offset - drapeAmplitude(h, i),
            0,
            offset + span * 0.09,
          );
          fold.addColorStop(0, rgbCss(colors.glint, Math.min(0.45, 0.16 * sheen)));
          fold.addColorStop(0.12, rgbCss(colors.sheen, Math.min(0.5, 0.2 * sheen)));
          fold.addColorStop(0.55, rgbCss(colors.base, 0.1));
          fold.addColorStop(1, rgbCss(colors.shadow, 0.28));
          return fold;
        });
      }
      c.setTransform(pr, 0, 0, pr, 0, 0);
      c.fillStyle = ground;
      c.fillRect(0, 0, w, h);

      // Diagonal drapes: each fold is a sinuous band with a lit crest and shaded trough.
      c.setTransform(
        drapeCos * pr,
        drapeSin * pr,
        -drapeSin * pr,
        drapeCos * pr,
        (w / 2) * pr,
        (h / 2) * pr,
      );
      const t = time * 0.5;
      for (let i = 0; i < DRAPES; i++) {
        const offset = ((i + 0.5) / DRAPES - 0.5) * span * 0.95;
        const amp = drapeAmplitude(h, i);
        c.beginPath();
        for (let s = 0; s <= DRAPE_SAMPLES; s++) {
          const x = (s / DRAPE_SAMPLES - 0.5) * span;
          const y =
            offset +
            Math.sin(x * 0.004 * scale + t * 0.6 + i * 0.9) * amp +
            Math.sin(x * 0.0091 * scale - t * 0.4 + i) * amp * 0.4;
          if (s === 0) {
            c.moveTo(x, y);
          } else {
            c.lineTo(x, y);
          }
        }
        c.lineTo(span / 2, offset + span * 0.09);
        c.lineTo(-span / 2, offset + span * 0.09);
        c.closePath();
        c.fillStyle = folds[i] ?? ground;
        c.fill();
      }
      c.setTransform(1, 0, 0, 1, 0, 0);
    },
  };
  return scene;
};

function silkCss(palette: ScenePalette): string {
  const colors = silkColors(palette);
  return `linear-gradient(128deg, ${rgbCss(colors.shadow)} 0%, ${rgbCss(colors.base)} 34%, ${rgbCss(colors.sheen, 0.9)} 48%, ${rgbCss(colors.base)} 60%, ${rgbCss(colors.shadow)} 100%)`;
}

export const SILK_SCENE: SceneSpec = {
  factories: [createSilkShader, createSilkCanvas],
  cssFallback: silkCss,
  fps: 20,
  startTime: 6,
};
