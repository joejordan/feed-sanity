// Prism Beams: volumetric light shafts pouring from the top edge with prism
// dispersion, gentle cursor steering, and dust motes drifting through the
// light (after React Bits "Light Rays" and Aceternity "Background Beams").

import type { Rgb, ScenePalette } from './palette';
import type { Scene, SceneFactory, SceneSpec } from './scene-host';
import { clamp, createRandom } from '../digital-rain/math';
import { wrap } from './canvas';
import { derivePalette, hexRgb, mixRgb, rgbCss, rgbUnit, rotateHue, WHITE } from './palette';
import { createShaderScene, GLSL_NOISE, GLSL_PRECISION } from './webgl';

interface PrismColors {
  readonly left: Rgb;
  readonly core: Rgb;
  readonly right: Rgb;
  readonly light: boolean;
}

const NATIVE_LEFT = hexRgb('#28d7ff');
const NATIVE_CORE = hexRgb('#c084fc');
const NATIVE_RIGHT = hexRgb('#ff3b8d');

const prismColors = derivePalette(
  (palette: ScenePalette): PrismColors => ({
    left: palette.native ? NATIVE_LEFT : rotateHue(palette.accent, -62),
    core: palette.native ? NATIVE_CORE : palette.accent,
    right: palette.native ? NATIVE_RIGHT : palette.alt,
    light: palette.scheme === 'light',
  }),
);

const PRISM_FRAGMENT = `${GLSL_PRECISION}
uniform vec2 uResolution;
uniform float uTime;
uniform vec3 uPointer;
uniform vec3 uLeft;
uniform vec3 uCore;
uniform vec3 uRight;
uniform float uLight;
${GLSL_NOISE}

float motes(vec2 p, float t) {
  vec2 g = p * 18.0 + vec2(t * 0.12, t * 0.3);
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float h = hash12(id);
  vec2 off = (vec2(hash12(id + 7.13), hash12(id + 3.71)) - 0.5) * 0.55;
  float d = length(f - off);
  float twinkle = 0.55 + 0.45 * sin(t * (0.8 + h * 1.6) + h * 40.0);
  return step(0.86, h) * smoothstep(0.11, 0.0, d) * twinkle;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  float aspect = uResolution.x / uResolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float t = uTime;
  float steer = (uPointer.x - 0.5) * uPointer.z;
  vec2 origin = vec2((0.5 + steer * 0.12) * aspect, 1.32);
  vec2 d = p - origin;
  float dist = length(d);
  float ang = atan(d.x, -d.y) - steer * 0.16;

  // Straight shafts: noise varies only with angle (plus slow time drift).
  float r1 = snoise(vec2(ang * 7.0, t * 0.06));
  float r2 = snoise(vec2(ang * 19.0 + 4.0, t * 0.09));
  float r3 = snoise(vec2(ang * 41.0 - 2.0, t * 0.05));
  float rays = 0.6 * smoothstep(-0.2, 0.9, r1)
    + 0.4 * smoothstep(0.1, 1.0, r2)
    + 0.25 * smoothstep(0.35, 1.0, r3);
  float cone = exp(-ang * ang * 1.3);
  float fall = exp(-max(dist - 0.3, 0.0) * 0.95);
  float shafts = rays * cone * fall * 1.25;
  float pulse = 0.92 + 0.08 * sin(t * 0.6);

  float k = clamp(ang * 0.85 + 0.5, 0.0, 1.0);
  vec3 tint = mix(uLeft, uCore, smoothstep(0.0, 0.5, k));
  tint = mix(tint, uRight, smoothstep(0.5, 1.0, k));
  vec3 halo = mix(uCore, vec3(1.0), 0.35);
  float source = exp(-dist * 3.0) * 0.5 + smoothstep(0.8, 1.0, uv.y) * 0.05;
  float dust = motes(p, t) * (shafts * 1.6 + 0.04);

  vec3 col = tint * shafts * pulse + halo * source + mix(tint, vec3(1.0), 0.5) * dust;
  float coverage = clamp(shafts * 0.7 + source + dust, 0.0, 1.0);
  float grain = (hash12(gl_FragCoord.xy + fract(t) * 53.0) - 0.5) / 255.0;
  if (uLight > 0.5) {
    float veil = clamp(coverage * 0.55, 0.0, 0.55);
    gl_FragColor = premultiply(tint * veil + grain, veil);
  } else {
    gl_FragColor = premultiply(col + grain, coverage * 0.5);
  }
}`;

const createPrismShader: SceneFactory = createShaderScene({
  fragment: PRISM_FRAGMENT,
  uniforms: ['uLeft', 'uCore', 'uRight', 'uLight'],
  renderScale: 0.5,
  bindPalette(gl, u, palette) {
    const colors = prismColors(palette);
    gl.uniform3fv(u.uLeft, rgbUnit(colors.left));
    gl.uniform3fv(u.uCore, rgbUnit(colors.core));
    gl.uniform3fv(u.uRight, rgbUnit(colors.right));
    gl.uniform1f(u.uLight, colors.light ? 1 : 0);
  },
});

interface Ray {
  readonly angle: number;
  readonly width: number;
  readonly phase: number;
  readonly rate: number;
}

interface Mote {
  x: number;
  y: number;
  readonly r: number;
  readonly vx: number;
  readonly vy: number;
  readonly phase: number;
}

const RAY_COUNT = 15;
const MOTE_COUNT = 46;

const createPrismCanvas: SceneFactory = (canvas) => {
  const c = canvas.getContext('2d');
  if (!c) {
    return null;
  }
  const rand = createRandom(0x9e_37_79_b9);
  const rays: Ray[] = Array.from({ length: RAY_COUNT }, (_, i) => ({
    angle: ((i + 0.5) / RAY_COUNT - 0.5) * 1.5 + (rand() - 0.5) * 0.06,
    width: 0.02 + rand() * 0.055,
    phase: rand() * Math.PI * 2,
    rate: 0.15 + rand() * 0.3,
  }));
  const motes: Mote[] = Array.from({ length: MOTE_COUNT }, () => ({
    x: rand(),
    y: rand(),
    r: 0.6 + rand() * 1.4,
    vx: (rand() - 0.5) * 0.004,
    vy: 0.003 + rand() * 0.006,
    phase: rand() * Math.PI * 2,
  }));

  // Ray, halo, and mote paints depend only on palette and size. Gradients are
  // built around the origin and drawn under a translate; shimmer rides globalAlpha.
  let cacheKey = '';
  let rayPaints: CanvasGradient[] = [];
  let halo: CanvasGradient | null = null;
  let moteColor = '';

  const scene: Scene = {
    kind: 'canvas2d',
    renderScale: 0.5,
    render({ palette, view, time, dt, pointer }) {
      const colors = prismColors(palette);
      const w = view.cssWidth;
      const h = view.cssHeight;
      const pr = view.pixelRatio;
      const reach = Math.hypot(w, h) * 1.05;
      const key = `${palette.key}|${w}|${h}`;
      if (key !== cacheKey || !halo) {
        cacheKey = key;
        rayPaints = rays.map((ray) => {
          const k = clamp(ray.angle / 1.5 + 0.5, 0, 1);
          const tint =
            k < 0.5
              ? mixRgb(colors.left, colors.core, k * 2)
              : mixRgb(colors.core, colors.right, (k - 0.5) * 2);
          const peak = (colors.light ? 0.16 : 0.34) * Math.exp(-ray.angle * ray.angle * 0.9);
          const grad = c.createRadialGradient(0, 0, 0, 0, 0, reach);
          grad.addColorStop(0, rgbCss(tint, peak));
          grad.addColorStop(0.5, rgbCss(tint, peak * 0.5));
          grad.addColorStop(1, rgbCss(tint, 0));
          return grad;
        });
        halo = c.createRadialGradient(0, 0, 0, 0, 0, h * 0.55);
        halo.addColorStop(0, rgbCss(mixRgb(colors.core, WHITE, 0.35), colors.light ? 0.16 : 0.24));
        halo.addColorStop(1, rgbCss(colors.core, 0));
        moteColor = rgbCss(mixRgb(colors.core, WHITE, colors.light ? 0 : 0.55));
      }

      const steer = (pointer.nx - 0.5) * pointer.presence;
      const ox = w * (0.5 + steer * 0.12);
      const oy = -h * 0.2;
      c.setTransform(pr, 0, 0, pr, 0, 0);
      c.clearRect(0, 0, w, h);
      c.globalCompositeOperation = colors.light ? 'source-over' : 'lighter';

      c.setTransform(pr, 0, 0, pr, ox * pr, oy * pr);
      for (const [i, ray] of rays.entries()) {
        const shimmer = 0.55 + 0.45 * Math.sin(time * ray.rate + ray.phase);
        const a = ray.angle - steer * 0.18;
        const spread = ray.width * (0.85 + 0.3 * shimmer);
        c.globalAlpha = shimmer;
        c.fillStyle = rayPaints[i] ?? halo;
        c.beginPath();
        c.moveTo(0, 0);
        c.lineTo(Math.sin(a - spread) * reach, Math.cos(a - spread) * reach);
        c.lineTo(Math.sin(a + spread) * reach, Math.cos(a + spread) * reach);
        c.closePath();
        c.fill();
      }
      c.globalAlpha = 1;

      c.setTransform(pr, 0, 0, pr, ox * pr, 0);
      c.fillStyle = halo;
      c.fillRect(-ox, 0, w, h * 0.6);

      c.setTransform(pr, 0, 0, pr, 0, 0);
      c.fillStyle = moteColor;
      for (const mote of motes) {
        mote.x = wrap(mote.x + mote.vx * dt, 1);
        mote.y = (mote.y + mote.vy * dt) % 1;
        const mx = mote.x * w;
        const my = mote.y * h;
        const beam = Math.exp(-(((mx - ox) / (w * 0.42)) ** 2));
        c.globalAlpha = (0.12 + 0.38 * beam) * (0.6 + 0.4 * Math.sin(time * 0.9 + mote.phase));
        c.beginPath();
        c.arc(mx, my, mote.r, 0, Math.PI * 2);
        c.fill();
      }
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-over';
      c.setTransform(1, 0, 0, 1, 0, 0);
    },
  };
  return scene;
};

function prismCss(palette: ScenePalette): string {
  const colors = prismColors(palette);
  const a = rgbCss(colors.left, 0.18);
  const b = rgbCss(colors.core, 0.2);
  const c = rgbCss(colors.right, 0.16);
  return [
    `radial-gradient(ellipse 50% 40% at 50% 0%, ${rgbCss(colors.core, 0.22)}, transparent 70%)`,
    `conic-gradient(from 135deg at 50% -18%, transparent 0deg, ${a} 10deg, transparent 22deg, ${b} 38deg, transparent 50deg, ${c} 66deg, transparent 80deg, transparent 360deg)`,
  ].join(', ');
}

export const PRISM_BEAMS_SCENE: SceneSpec = {
  factories: [createPrismShader, createPrismCanvas],
  cssFallback: prismCss,
  fps: 30,
  startTime: 9,
};
