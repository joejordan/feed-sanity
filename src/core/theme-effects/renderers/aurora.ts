// Aurora: billowing northern-lights curtains across the top of the viewport.
// WebGL simplex-noise shader (after React Bits "Aurora") with a soft Canvas 2D
// curtain fallback and a static CSS wash as the last resort.

import type { Rgb, ScenePalette } from './palette';
import type { Scene, SceneFactory, SceneSpec } from './scene-host';
import { clamp } from '../digital-rain/math';
import { derivePalette, hexRgb, mixRgb, rgbCss, rgbUnit, rotateHue } from './palette';
import { createShaderScene, GLSL_NOISE, GLSL_PRECISION } from './webgl';

interface AuroraColors {
  readonly low: Rgb;
  readonly core: Rgb;
  readonly fringe: Rgb;
  readonly light: boolean;
}

// Signature borealis tones when the site keeps its own colors.
const NATIVE_LOW = hexRgb('#22e58b');
const NATIVE_CORE = hexRgb('#28d7ff');
const NATIVE_FRINGE = hexRgb('#8b5cf6');

const auroraColors = derivePalette(
  (palette: ScenePalette): AuroraColors => ({
    low: palette.native ? NATIVE_LOW : rotateHue(palette.accent, -48),
    core: palette.native ? NATIVE_CORE : palette.accent,
    fringe: palette.native ? NATIVE_FRINGE : palette.alt,
    light: palette.scheme === 'light',
  }),
);

const AURORA_FRAGMENT = `${GLSL_PRECISION}
uniform vec2 uResolution;
uniform float uTime;
uniform vec3 uPointer;
uniform vec3 uLow;
uniform vec3 uCore;
uniform vec3 uFringe;
uniform float uLight;
${GLSL_NOISE}

float curtain(vec2 uv, float aspect, float seed, float base, float t) {
  float x = uv.x * aspect;
  float edge = base
    + 0.09 * snoise(vec2(x * 0.5 + seed, t * 0.05 + seed))
    + 0.028 * snoise(vec2(x * 1.7 - t * 0.045, seed * 1.7));
  float d = uv.y - edge;
  float warp = 0.4 * snoise(vec2(x * 0.7 + t * 0.035, seed + 4.0));
  float rays = 0.5 + 0.5 * snoise(vec2((x + warp) * 6.5 + seed, uv.y * 0.8 - t * 0.11));
  rays *= 0.7 + 0.3 * snoise(vec2((x + warp) * 19.0 - seed, t * 0.16));
  rays = 0.35 + 0.65 * pow(rays, 1.3);
  // Large-scale breaks so curtains drift as separate bands rather than one wall.
  float bands = smoothstep(-0.35, 0.55, snoise(vec2(x * 0.32 + seed * 3.1, t * 0.035)));
  float reachUp = 3.2 + 2.4 * (0.5 + 0.5 * snoise(vec2(x * 1.3 + seed, t * 0.05)));
  float hem = smoothstep(-0.02, 0.012, d);
  float rise = exp(-max(d, 0.0) * reachUp);
  float glowLine = exp(-abs(d) * 26.0) * 0.8;
  float spill = exp(-max(-d, 0.0) * 14.0) * 0.12;
  return max(0.0, (hem * rise * rays + glowLine * rays + spill) * bands);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  if (uv.y < 0.28) {
    gl_FragColor = vec4(0.0);
    return;
  }
  float aspect = uResolution.x / uResolution.y;
  float t = uTime;
  float c1 = curtain(uv, aspect, 3.1, 0.66, t) * 1.15;
  float c2 = curtain(uv, aspect, 11.7, 0.8, t * 0.82) * 0.75;

  float flow = uv.x + 0.14 * snoise(vec2(uv.x * 1.1 - t * 0.03, t * 0.04 + 2.0));
  vec3 base = mix(uLow, uCore, smoothstep(0.02, 0.55, flow));
  base = mix(base, uFringe, smoothstep(0.58, 1.05, flow));
  float height = smoothstep(0.7, 1.0, uv.y);
  vec3 col1 = mix(base, mix(base, uFringe, 0.7), height);
  vec3 col2 = mix(uCore, uFringe, 0.5 + 0.5 * sin(uv.x * 2.6 + t * 0.08));

  float near = exp(-pow((uv.x - uPointer.x) * aspect, 2.0) * 4.0);
  float lift = 1.0 + 0.2 * uPointer.z * near;
  float fade = smoothstep(0.28, 0.5, uv.y);
  float coverage = clamp((c1 + c2) * fade, 0.0, 1.0);
  vec3 col = (col1 * c1 + col2 * c2) * fade * lift;
  float sky = smoothstep(0.35, 1.0, uv.y) * 0.05;
  col += uCore * sky;

  float grain = (hash12(gl_FragCoord.xy + fract(t) * 61.0) - 0.5) / 255.0;
  if (uLight > 0.5) {
    float veil = clamp(coverage * 0.5 + sky, 0.0, 0.6);
    gl_FragColor = premultiply(mix(base, uFringe, height * 0.5) * veil + grain, veil);
  } else {
    gl_FragColor = premultiply(col * 0.95 + grain, coverage * 0.6 + sky);
  }
}`;

const createAuroraShader: SceneFactory = createShaderScene({
  fragment: AURORA_FRAGMENT,
  uniforms: ['uLow', 'uCore', 'uFringe', 'uLight'],
  renderScale: 0.35,
  maxPixels: 360_000,
  bindPalette(gl, u, palette) {
    const colors = auroraColors(palette);
    gl.uniform3fv(u.uLow, rgbUnit(colors.low));
    gl.uniform3fv(u.uCore, rgbUnit(colors.core));
    gl.uniform3fv(u.uFringe, rgbUnit(colors.fringe));
    gl.uniform1f(u.uLight, colors.light ? 1 : 0);
  },
});

/** Cheap smooth 1D value noise for the Canvas 2D curtains. */
function wave(x: number, seed: number): number {
  return (
    Math.sin(x * 1.7 + seed) * 0.5 +
    Math.sin(x * 3.1 - seed * 1.3) * 0.3 +
    Math.sin(x * 5.3 + seed * 2.1) * 0.2
  );
}

const STRIPS = 48;

const createAuroraCanvas: SceneFactory = (canvas) => {
  const c = canvas.getContext('2d');
  if (!c) {
    return null;
  }
  let curtainGradients: CanvasGradient[] = [];
  let gradientKey = '';

  const scene: Scene = {
    kind: 'canvas2d',
    // A quarter-resolution canvas upscaled by CSS gives free, buttery blur.
    renderScale: 0.25,
    maxPixels: 360_000,
    render({ palette, view, time, pointer }) {
      const colors = auroraColors(palette);
      const w = view.cssWidth;
      const h = view.cssHeight;
      c.setTransform(view.pixelRatio, 0, 0, view.pixelRatio, 0, 0);
      c.clearRect(0, 0, w, h);
      const key = `${palette.key}|${w}|${h}`;
      if (key !== gradientKey) {
        gradientKey = key;
        curtainGradients = [0, 1].map((idx) => {
          const span = h * (idx === 0 ? 0.36 : 0.26);
          const grad = c.createLinearGradient(0, -span, 0, h * 0.02);
          const tone = idx === 0 ? colors.core : colors.fringe;
          grad.addColorStop(0, rgbCss(colors.fringe, 0));
          grad.addColorStop(0.55, rgbCss(mixRgb(tone, colors.fringe, 0.4), 0.22));
          grad.addColorStop(0.92, rgbCss(tone, 0.55));
          grad.addColorStop(1, rgbCss(colors.low, 0));
          return grad;
        });
      }
      c.globalCompositeOperation = colors.light ? 'source-over' : 'lighter';
      const stripW = w / STRIPS + 1;
      for (let layer = 0; layer < 2; layer++) {
        const grad = curtainGradients[layer];
        if (!grad) {
          continue;
        }
        c.fillStyle = grad;
        const base = h * (layer === 0 ? 0.34 : 0.22);
        const seed = layer * 7.3;
        for (let i = 0; i < STRIPS; i++) {
          const x = (i / STRIPS) * w;
          const nx = x / w;
          const edge = base + wave(nx * 3 + time * 0.05, seed) * h * 0.06;
          const ray = 0.55 + 0.45 * wave(nx * 22 + time * 0.12, seed + 2);
          const near = Math.exp(-(((nx - pointer.nx) * 4) ** 2)) * pointer.presence * 0.25;
          c.globalAlpha = clamp((ray + near) * (colors.light ? 0.5 : 0.85), 0, 1);
          const pr = view.pixelRatio;
          c.setTransform(pr, 0, 0, pr, x * pr, edge * pr);
          c.fillRect(0, -h * 0.4, stripW, h * 0.42);
        }
      }
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-over';
      c.setTransform(1, 0, 0, 1, 0, 0);
    },
  };
  return scene;
};

function auroraCss(palette: ScenePalette): string {
  const colors = auroraColors(palette);
  return [
    `radial-gradient(ellipse 60% 32% at 24% 10%, ${rgbCss(colors.low, 0.42)}, transparent 70%)`,
    `radial-gradient(ellipse 58% 30% at 62% 6%, ${rgbCss(colors.core, 0.38)}, transparent 72%)`,
    `radial-gradient(ellipse 46% 26% at 88% 14%, ${rgbCss(colors.fringe, 0.34)}, transparent 70%)`,
  ].join(', ');
}

export const AURORA_SCENE: SceneSpec = {
  factories: [createAuroraShader, createAuroraCanvas],
  cssFallback: auroraCss,
  fps: 20,
  startTime: 18,
};
