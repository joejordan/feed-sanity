// Jungle Canopy: a rainforest clearing seen from the forest floor. Real leaf
// silhouettes frame the viewport corners and sway in the breeze, light shafts
// fall through the gaps between them into drifting mist, and pollen or
// fireflies wander between the leaf layers. The light follows a time of day,
// which can track the viewer's own clock.
//
// The foliage is painted once from shared polygons (`canopy-foliage.ts`). The
// WebGL renderer reads it as a data texture, so the shafts are cast by the same
// leaves that sway in front of them; the Canvas 2D fallback draws the same
// leaves as sprites; the last resort is a static CSS wash.

import type { CanopyTime } from '../param-specs';
import type { CanopyLook } from './canopy-look';
import type { Layer } from './canvas';
import type { Rgb, ScenePalette } from './palette';
import type { Scene, SceneFactory, SceneSpec } from './scene-host';
import type { UniformMap } from './webgl';
import { dayPhaseAt } from '../celestial';
import { clamp, createRandom, GOLDEN_ANGLE } from '../digital-rain/math';
import { CANOPY_PARAM_SPECS, deriveEffectParams } from '../model';
import { CANOPY_TONE_BAND, paintCanopyAtlas, paintCanopyLayer } from './canopy-foliage';
import { canopyMoodAt, resolveCanopyLook } from './canopy-look';
import { createLayer, createRadialSprite, releaseLayer, wrap } from './canvas';
import { mixRgb, rgbCss, rgbUnit } from './palette';
import { BUILTIN_SHADER_WATCHDOG } from './scene-host';
import {
  createFullscreenWebglScene,
  GLSL_NOISE,
  GLSL_PRECISION,
  uploadAtlasTexture,
} from './webgl';

const canopyParams = deriveEffectParams(CANOPY_PARAM_SPECS, (p) => ({
  time: p.time as CanopyTime,
  rays: p.rays as number,
  foliage: p.foliage as number,
  mist: p.mist as number,
  motes: p.motes as number,
  breeze: p.breeze as number,
}));

/** Side length of one corner of foliage, in viewport heights, at 1× Foliage. */
const CORNER_SIZE = 0.64;
/** Pixel size of the square WebGL foliage frame (four 512px corners). */
const FRAME_PIXELS = 1024;
/** Half-res foliage sprites for the Canvas 2D fallback (4× less RAM & faster initial paint). */
const CANVAS_FRAME_PIXELS = 512;
/** How often "Follow my clock" re-reads the time. The light moves too slowly to need more. */
const CLOCK_STEP_MS = 60_000;

/** Corner size on screen; corners never cross the centre line, however narrow the viewport. */
function cornerSize(foliage: number, aspect: number): number {
  return Math.min(foliage * CORNER_SIZE, aspect * 0.5);
}

/** Resolves the look once per palette, time setting, and clock minute instead of every frame. */
function createLookResolver(): (palette: ScenePalette, time: CanopyTime) => CanopyLook {
  let lastPalette: ScenePalette | null = null;
  let lastTime: CanopyTime | null = null;
  let lastMinute = -1;
  let look: CanopyLook | null = null;
  return (palette, time) => {
    const minute = time === 'clock' ? Math.floor(Date.now() / CLOCK_STEP_MS) : 0;
    if (!look || palette !== lastPalette || time !== lastTime || minute !== lastMinute) {
      lastPalette = palette;
      lastTime = time;
      lastMinute = minute;
      const dayPhase = time === 'clock' ? dayPhaseAt(new Date()) : 0;
      look = resolveCanopyLook(palette, canopyMoodAt(time, dayPhase));
    }
    return look;
  };
}

const TONE = CANOPY_TONE_BAND;
/** Formats a number as a GLSL float literal. */
const glsl = (value: number): string => value.toFixed(3);

export const CANOPY_FRAGMENT = `${GLSL_PRECISION}
uniform vec2 uResolution;
uniform float uTime;
uniform vec3 uPointer;
uniform sampler2D uFoliage;
uniform vec4 uClick;
uniform vec2 uScroll;
uniform vec3 uDeep;
uniform vec3 uHaze;
uniform vec3 uLeafNear;
uniform vec3 uLeafLit;
uniform vec3 uLeafMid;
uniform vec3 uLight;
uniform vec3 uMote;
// x across the viewport, y in viewport heights, light strength, firefly blink.
uniform vec4 uSun;
// Sunbeams, corner size in viewport heights, mist, motes.
uniform vec4 uTune;
uniform float uBreeze;
${GLSL_NOISE}

vec2 frameUv(vec2 a, float right, float bottom) {
  vec2 c = min(a, vec2(0.985)) * 0.5;
  return vec2(mix(c.x, 1.0 - c.x, right), mix(c.y, 1.0 - c.y, bottom));
}

// Leaves bend more the farther they reach from the corner they grow out of.
vec2 sway(vec2 a, float t, float amp) {
  float reach = clamp(length(a) * 1.3, 0.0, 1.0);
  float gust = 0.6 + 0.4 * sin(t * 0.23 + a.y * 2.0);
  vec2 w = vec2(
    sin(t * 0.9 + a.y * 5.0) + 0.5 * sin(t * 1.7 + a.x * 9.0 + 1.7),
    0.7 * sin(t * 0.75 + a.x * 6.0 + 0.9)
  );
  return a + w * (0.0065 * amp * reach * gust);
}

// One corner of the frame at corner coordinates a (x inward from the side edge,
// y inward from the top or bottom edge): near coverage, mid coverage, near tone.
// Leaves stop at CANOPY_QUADRANT_LIMIT (0.975), leaving a pure-black border around
// each quadrant so skipping sway + texture reads beyond 1.02 has zero mip seam.
vec3 corner(vec2 a, float right, float bottom, float t, float amp, float bias) {
  if (a.x > 1.02 || a.y > 1.02) {
    return vec3(0.0);
  }
  vec3 leafy = texture2D(uFoliage, frameUv(sway(a, t, amp), right, bottom), bias).rgb;
  return leafy * step(a.x, 1.0) * step(a.y, 1.0);
}

// Foliage at scene point q (x in viewport heights, y up), from the top and
// bottom corners on q's side of the viewport.
vec3 foliage(vec2 q, float aspect, float t, float amp) {
  float right = step(aspect * 0.5, q.x);
  float u = mix(q.x, aspect - q.x, right) / uTune.y;
  vec3 top = corner(vec2(u, (1.0 - q.y) / uTune.y), right, 0.0, t, amp, 0.0);
  vec3 low = corner(vec2(u, q.y / uTune.y), right, 1.0, t + 3.1, amp, 0.0);
  return max(top, low);
}

// How open the canopy is above q: only the top corner hangs over the line the
// rays are traced back to, read from a blurred mip so the shafts stay soft.
float canopyGap(vec2 q, float aspect, float t, float amp) {
  float right = step(aspect * 0.5, q.x);
  float u = mix(q.x, aspect - q.x, right) / uTune.y;
  vec3 leafy = corner(vec2(u, (1.0 - q.y) / uTune.y), right, 0.0, t, amp, 1.5);
  return 1.0 - clamp(leafy.r + leafy.g * 0.8, 0.0, 1.0);
}

float trunkRow(vec2 p, float n, float seed) {
  float x = p.x * n + seed + 0.16 * sin(p.y * 1.9 + seed * 2.3);
  float id = floor(x);
  float h = hash12(vec2(id, seed));
  float centre = 0.3 + 0.4 * hash12(vec2(id + 9.0, seed));
  float w = 0.05 + 0.11 * h;
  return step(0.34, h) * (1.0 - smoothstep(w * 0.55, w, abs(fract(x) - centre)));
}

// One mote per cell, wandering on its own loop. Pollen glints steadily;
// fireflies stay dark most of the time and pulse on their own clocks.
float moteLayer(vec2 p, float t, float cells, float seed, float amount, float blink) {
  vec2 g = p * cells + vec2(seed * 3.7 + t * 0.04, seed - t * 0.025);
  vec2 id = floor(g);
  float h2 = hash12(id + seed + 19.19);
  if (h2 < 1.0 - 0.42 * amount) {
    return 0.0;
  }
  vec2 f = fract(g) - 0.5;
  float h = hash12(id + seed);
  vec2 off = 0.27 * vec2(
    sin(t * (0.3 + h * 0.45) + h * 40.0),
    cos(t * (0.24 + h2 * 0.4) + h2 * 30.0)
  );
  float d = length(f - off);
  float phase = t * (0.55 + h * 0.6) + h2 * 6.2832;
  float pulse = max(sin(phase), 0.0);
  pulse *= pulse * pulse;
  float lum = mix(0.7 + 0.3 * sin(phase * 2.7), pulse, blink);
  float body = (1.0 - smoothstep(0.0, 0.05, d)) + exp(-d * d * 110.0) * 0.5;
  return body * lum;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  float aspect = uResolution.x / uResolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float t = uTime;
  vec2 pan = (uPointer.xy - 0.5) * uPointer.z;
  float drift = (uScroll.x - 0.5) * 0.03;
  float breeze = uBreeze * (1.0 + min(abs(uScroll.y), 1.0) * 1.6);

  vec2 sun = vec2((uSun.x + pan.x * 0.05) * aspect, uSun.y + pan.y * 0.03);
  vec2 toP = p - sun;
  float dist = length(toP);
  float ang = atan(toP.x, -toP.y);

  // Depth: shadow at the forest floor, opening to a hazy clearing near the light.
  float clearing = exp(-dist * 1.3);
  vec3 col = mix(uDeep, uHaze, clamp(0.14 + 0.3 * uv.y * uv.y + 0.34 * clearing, 0.0, 1.0));
  col = mix(col, uLight, clearing * clearing * 0.2 * uSun.z);

  // Far trunks and crowns, almost lost in the haze.
  vec2 fp = p + pan * 0.008;
  float trunks = max(trunkRow(fp, 2.9, 1.7), 0.75 * trunkRow(fp + 0.37, 5.1, 8.2));
  float crown = smoothstep(0.66, 1.02, uv.y + 0.15 * snoise(vec2(fp.x * 1.3, 2.0)));
  float farMass = max(trunks * (0.3 + 0.7 * smoothstep(0.02, 0.6, uv.y)), crown * 0.9);
  col = mix(col, mix(uDeep, uHaze, 0.24), farMass * 0.62);

  float fog = 0.0;
  if (uTune.z > 0.001) {
    float mistNoise = 0.5
      + 0.34 * snoise(vec2(p.x * 0.8 - t * 0.012, p.y * 2.0 + t * 0.005))
      + 0.16 * snoise(vec2(p.x * 2.2 + t * 0.018, p.y * 4.4 - 3.0));
    float mistY = (uv.y - 0.3) * 2.3;
    float band = exp(-mistY * mistY);
    fog = clamp(mistNoise, 0.0, 1.0) * (0.28 + 0.72 * band) * uTune.z;
    col = mix(col, uHaze, clamp(fog * 0.42, 0.0, 0.7));
  }

  // Light shafts. Each ray is traced back to the canopy line, and it is lit only
  // where it passes between the leaves there, so the shafts move as they sway.
  float beam = 0.0;
  float lightAmt = 0.0;
  if (uTune.x > 0.001) {
    float r1 = snoise(vec2(ang * 9.0, t * 0.05));
    float r2 = snoise(vec2(ang * 19.0 + 4.0, t * 0.08));
    float rays = 0.72 * smoothstep(-0.3, 0.75, r1) + 0.28 * smoothstep(-0.05, 0.9, r2);
    float gap = 0.0;
    for (int i = 0; i < 3; i++) {
      float yk = 0.84 + 0.05 * float(i);
      float k = p.y < yk ? (yk - sun.y) / min(p.y - sun.y, -0.001) : 1.0;
      gap += canopyGap(sun + toP * k, aspect, t, breeze);
    }
    gap /= 3.0;
    vec2 aim = vec2(aspect * 0.5, 0.25) - sun;
    float spread = (ang - atan(aim.x, -aim.y)) / 0.62;
    beam = gap * mix(0.25, 1.0, rays) * exp(-spread * spread)
      * exp(-max(dist - 0.2, 0.0) * 0.85) * uTune.x * uSun.z;
    lightAmt = clamp(beam * (0.42 + 0.3 * fog), 0.0, 0.62);
    col = mix(col, uLight, lightAmt);
  }

  // Motes behind the leaves. Pollen shows only where light catches it.
  float company = 1.0;
  if (uPointer.z > 0.001 && uTune.w > 0.001) {
    vec2 toPtr = p - vec2(uPointer.x * aspect, uPointer.y);
    company += 1.6 * uPointer.z * exp(-dot(toPtr, toPtr) * 16.0);
  }
  if (uTune.w > 0.001) {
    float catchLight = mix(0.2 + beam * 2.2, 1.0, uSun.w);
    float motes = moteLayer(p + pan * 0.012, t, 9.0, 1.3, uTune.w, uSun.w) * catchLight * company;
    col = mix(col, uMote, clamp(motes * 0.85, 0.0, 1.0));
  }

  vec3 midF = foliage(p + pan * 0.014 + vec2(0.0, drift * 0.5), aspect, t * 0.8 + 2.0, breeze * 0.6);
  float midTone = clamp((midF.g - ${glsl(TONE.mid)}) / ${glsl(1 - TONE.mid)}, 0.0, 1.0);
  vec3 midCol = mix(uLeafMid * (0.85 + 0.3 * midTone), uHaze, clamp(0.12 + fog * 0.4, 0.0, 0.6));
  midCol = mix(midCol, uLight, lightAmt * 0.35);
  col = mix(col, midCol, smoothstep(0.2, 0.5, midF.g));

  // Closest leaves: dark in shade, glowing where light comes through the blade.
  vec3 nearF = foliage(p + pan * 0.034 + vec2(0.0, drift), aspect, t, breeze);
  float tone = clamp((nearF.b - ${glsl(TONE.min)}) / ${glsl(TONE.max - TONE.min)}, 0.0, 1.0);
  float vein = smoothstep(${glsl(TONE.max + 0.05)}, ${glsl(TONE.sideVein - 0.02)}, nearF.b)
    * (0.45 + 0.55 * smoothstep(${glsl(TONE.sideVein + 0.06)}, 0.96, nearF.b));
  float through = clamp(lightAmt * 2.2 + clearing * 0.35 * uSun.z, 0.0, 1.0);
  vec3 leaf = mix(uLeafNear * (0.75 + 0.5 * tone), uLeafLit, through * (0.3 + 0.5 * tone));
  leaf = mix(leaf, uLeafLit, vein * (0.1 + 0.3 * through));
  float rim = nearF.r * (1.0 - nearF.r) * 4.0;
  leaf = mix(leaf, uLight, rim * through * 0.45);
  col = mix(col, leaf, smoothstep(0.3, 0.62, nearF.r));

  // A few large, soft motes drift in front of everything.
  if (uTune.w > 0.001) {
    float front = moteLayer(p * 0.5 + pan * 0.05, t * 0.8, 8.4, 5.9, uTune.w * 0.4, uSun.w);
    col = mix(col, uMote, clamp(front * mix(0.25, 0.55, uSun.w) * company, 0.0, 1.0));
  }

  // A click shakes loose a ring of pollen.
  if (uClick.w > 0.5 && uClick.z < 2.4) {
    float cd = length(p - vec2(uClick.x * aspect, uClick.y));
    float ringAt = (cd - uClick.z * 0.16) / 0.035;
    float ring = exp(-ringAt * ringAt - uClick.z * 1.6);
    if (ring > 0.002) {
      float puff = moteLayer(p, t * 2.0, 22.0, 7.7, 2.2, 0.0);
      col = mix(col, uMote, clamp(ring * (0.12 + puff * 1.4), 0.0, 0.85));
    }
  }

  col = mix(col, uDeep, (1.0 - smoothstep(0.0, 0.5, uv.y)) * 0.3);
  float grain = (hash12(gl_FragCoord.xy + fract(t) * 37.0) - 0.5) / 255.0;
  gl_FragColor = premultiply(col + grain, 1.0);
}`;

const CANOPY_UNIFORMS = [
  'uResolution',
  'uTime',
  'uPointer',
  'uFoliage',
  'uClick',
  'uScroll',
  'uDeep',
  'uHaze',
  'uLeafNear',
  'uLeafLit',
  'uLeafMid',
  'uLight',
  'uMote',
  'uSun',
  'uTune',
  'uBreeze',
] as const;

interface CanopyGlState {
  readonly u: UniformMap<(typeof CANOPY_UNIFORMS)[number]>;
  readonly texture: WebGLTexture | null;
  look: CanopyLook | null;
  tuneKey: string;
  breeze: number;
  ringActive: boolean;
}

const createCanopyShader: SceneFactory = (canvas, hooks) => {
  const resolveLook = createLookResolver();
  return createFullscreenWebglScene<CanopyGlState>({
    fragment: CANOPY_FRAGMENT,
    renderScale: 0.5,
    maxPixels: 620_000,
    init(gl, program) {
      const u = Object.fromEntries(
        CANOPY_UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)]),
      ) as CanopyGlState['u'];
      const texture = uploadAtlasTexture(gl, canvas.ownerDocument, FRAME_PIXELS, paintCanopyAtlas);
      gl.uniform1i(u.uFoliage, 0);
      return { u, texture, look: null, tuneKey: '', breeze: -1, ringActive: true };
    },
    onResize(gl, state, width, height) {
      gl.uniform2f(state.u.uResolution, width, height);
    },
    onRender(gl, state, frame) {
      const { u } = state;
      const params = canopyParams(frame.ctx.effects.backdropParams);
      const look = resolveLook(frame.palette, params.time);
      const { mood } = look;
      if (look !== state.look) {
        state.look = look;
        gl.uniform3fv(u.uDeep, rgbUnit(look.deep));
        gl.uniform3fv(u.uHaze, rgbUnit(look.haze));
        gl.uniform3fv(u.uLeafNear, rgbUnit(look.leafNear));
        gl.uniform3fv(u.uLeafLit, rgbUnit(look.leafLit));
        gl.uniform3fv(u.uLeafMid, rgbUnit(look.leafMid));
        gl.uniform3fv(u.uLight, rgbUnit(look.light));
        gl.uniform3fv(u.uMote, rgbUnit(look.mote));
        gl.uniform4f(u.uSun, mood.sunX, mood.sunY, mood.light, mood.fireflies);
      }
      const { view, pointer, click, scroll } = frame;
      const aspect = view.height > 0 ? view.width / view.height : 1;
      const corner = cornerSize(params.foliage, aspect);
      const mist = params.mist * mood.mist;
      const motes = params.motes * mood.motes;
      const tuneKey = `${params.rays}|${corner.toFixed(4)}|${mist.toFixed(4)}|${motes.toFixed(4)}`;
      if (tuneKey !== state.tuneKey) {
        state.tuneKey = tuneKey;
        gl.uniform4f(u.uTune, params.rays, corner, mist, motes);
      }
      if (params.breeze !== state.breeze) {
        state.breeze = params.breeze;
        gl.uniform1f(u.uBreeze, params.breeze);
      }
      gl.uniform1f(u.uTime, frame.time);
      gl.uniform3f(u.uPointer, pointer.nx, 1 - pointer.ny, pointer.presence);
      // A click's age only advances while frames run, so a still frame would freeze its ring in place.
      const ringActive = click.count > 0 && click.age < 2.4 && !frame.still;
      if (ringActive || state.ringActive) {
        state.ringActive = ringActive;
        gl.uniform4f(u.uClick, click.x, 1 - click.y, click.age, ringActive ? 1 : 0);
      }
      gl.uniform2f(u.uScroll, scroll.y, scroll.velocity);
    },
    onDispose(gl, state) {
      gl.deleteTexture(state.texture);
    },
  })(canvas, hooks);
};

interface Mote {
  x: number;
  y: number;
  readonly size: number;
  readonly vx: number;
  readonly vy: number;
  readonly phase: number;
  readonly rate: number;
}

interface Shaft {
  readonly angle: number;
  readonly width: number;
  readonly phase: number;
  readonly rate: number;
}

interface Trunk {
  readonly x: number;
  readonly width: number;
  readonly lean: number;
}

/** Gradients of the Canvas 2D renderer, with the inputs they were built from. */
interface CanopyPaints {
  readonly look: CanopyLook;
  readonly w: number;
  readonly h: number;
  readonly mist: number;
  /** How far a shaft runs: past the far corner of the viewport. */
  readonly reach: number;
  readonly depth: CanvasGradient;
  readonly clearing: CanvasGradient;
  readonly shaft: CanvasGradient;
  readonly veil: CanvasGradient;
}

const MOTE_COUNT = 44;
const SHAFT_COUNT = 7;
/** Backing-store scale of the Canvas 2D shaft layer; stretching it back up softens the beams. */
const SHAFT_SCALE = 1 / 10;
const SHAFT_FEATHERS = [1.7, 1, 0.45] as const;
/** How far the Canvas 2D foliage slides across the viewport as the pointer crosses it. */
const FOLIAGE_PARALLAX = 0.034;
/** How far a Canvas 2D corner rocks at 1× Breeze, in radians. */
const FOLIAGE_ROCK = 0.011;
/** Extra rocking while the page scrolls at full speed. */
const RUSTLE_GAIN = 1.6;
/** Source rectangles of the four corners inside the square foliage frame, as `[right, bottom]`. */
const CORNER_FLIPS: ReadonlyArray<readonly [right: boolean, bottom: boolean]> = [
  [false, false],
  [true, false],
  [false, true],
  [true, true],
];

const createCanopyCanvas: SceneFactory = (canvas) => {
  const c = canvas.getContext('2d');
  if (!c) {
    return null;
  }
  const doc = canvas.ownerDocument;
  const resolveLook = createLookResolver();
  const rand = createRandom(0x51_7e_c0_de);
  const motes: Mote[] = Array.from({ length: MOTE_COUNT }, () => ({
    x: rand(),
    y: rand(),
    size: 1.2 + rand() * 2.2,
    vx: (rand() - 0.5) * 0.008,
    vy: -0.002 - rand() * 0.005,
    phase: rand() * Math.PI * 2,
    rate: 0.5 + rand() * 0.7,
  }));
  const shafts: Shaft[] = Array.from({ length: SHAFT_COUNT }, (_, i) => ({
    angle: ((i + 0.5) / SHAFT_COUNT - 0.5) * 1.15 + (rand() - 0.5) * 0.08,
    width: 0.022 + rand() * 0.05,
    phase: rand() * Math.PI * 2,
    rate: 0.12 + rand() * 0.22,
  }));
  const trunks: Trunk[] = Array.from({ length: 9 }, (_, i) => ({
    x: (i + 0.2 + rand() * 0.6) / 9,
    width: 0.012 + rand() * 0.03,
    lean: (rand() - 0.5) * 0.06,
  }));

  // Sprites repaint when a colour changes. Gradients are rebuilt when the look,
  // the viewport, or the mist changes, and never from one frame to the next.
  let spriteKey = '';
  let nearLayer: Layer | null = null;
  let midLayer: Layer | null = null;
  let shaftLayer: Layer | null = null;
  let moteSprite: HTMLCanvasElement | null = null;
  let paints: CanopyPaints | null = null;

  const paintSprites = (look: CanopyLook): void => {
    nearLayer ??= createLayer(doc, CANVAS_FRAME_PIXELS, CANVAS_FRAME_PIXELS);
    midLayer ??= createLayer(doc, CANVAS_FRAME_PIXELS, CANVAS_FRAME_PIXELS);
    if (nearLayer) {
      paintCanopyLayer(nearLayer.g, CANVAS_FRAME_PIXELS, 'near', {
        shade: look.leafNear,
        lit: mixRgb(look.leafNear, look.leafLit, 0.34),
        vein: look.leafLit,
      });
    }
    if (midLayer) {
      const hazy = mixRgb(look.leafMid, look.haze, 0.3);
      paintCanopyLayer(midLayer.g, CANVAS_FRAME_PIXELS, 'mid', {
        shade: hazy,
        lit: mixRgb(hazy, look.leafLit, 0.25),
      });
    }
    moteSprite = createRadialSprite(doc, 32, [
      [0, rgbCss(look.mote, 1)],
      [0.22, rgbCss(look.mote, 0.75)],
      [1, rgbCss(look.mote, 0)],
    ]);
  };

  const buildPaints = (look: CanopyLook, w: number, h: number, mist: number): CanopyPaints => {
    const { light } = look.mood;
    const depth = c.createLinearGradient(0, 0, 0, h);
    depth.addColorStop(0, rgbCss(mixRgb(look.deep, look.haze, 0.52)));
    depth.addColorStop(0.55, rgbCss(mixRgb(look.deep, look.haze, 0.24)));
    depth.addColorStop(1, rgbCss(look.deep));
    const clearing = c.createRadialGradient(0, 0, 0, 0, 0, h * 0.95);
    clearing.addColorStop(0, rgbCss(look.light, 0.3 * light));
    clearing.addColorStop(0.4, rgbCss(look.haze, 0.26));
    clearing.addColorStop(1, rgbCss(look.haze, 0));
    const reach = Math.hypot(w, h) * 1.1;
    const shaft = c.createRadialGradient(0, 0, 0, 0, 0, reach);
    const peak = (look.inked ? 0.34 : 0.3) * light;
    shaft.addColorStop(0, rgbCss(look.light, peak));
    shaft.addColorStop(0.5, rgbCss(look.light, peak * 0.5));
    shaft.addColorStop(1, rgbCss(look.light, 0));
    const veil = c.createLinearGradient(0, h * 0.45, 0, h);
    veil.addColorStop(0, rgbCss(look.haze, 0));
    veil.addColorStop(0.55, rgbCss(look.haze, mist));
    veil.addColorStop(1, rgbCss(look.haze, 0));
    return { look, w, h, mist, reach, depth, clearing, shaft, veil };
  };

  const scene: Scene = {
    kind: 'canvas2d',
    renderScale: 0.75,
    maxPixels: 900_000,
    render({ ctx, palette, view, time, dt, pointer, click, scroll, still }) {
      const params = canopyParams(ctx.effects.backdropParams);
      const look = resolveLook(palette, params.time);
      const { mood } = look;
      const w = view.cssWidth;
      const h = view.cssHeight;
      const pr = view.pixelRatio;
      const panX = (pointer.nx - 0.5) * pointer.presence;
      const panY = (pointer.ny - 0.5) * pointer.presence;
      const sunX = w * (mood.sunX + panX * 0.05);
      const sunY = -h * (mood.sunY - 1);
      const mistAmount = clamp(0.2 * params.mist * mood.mist, 0, 0.5);

      if (look.key !== spriteKey) {
        spriteKey = look.key;
        paintSprites(look);
      }
      if (!shaftLayer || paints?.w !== w || paints.h !== h) {
        if (shaftLayer) {
          shaftLayer.canvas.width = 0;
        }
        shaftLayer = createLayer(doc, w, h, SHAFT_SCALE);
      }
      if (
        !paints ||
        paints.look !== look ||
        paints.w !== w ||
        paints.h !== h ||
        paints.mist !== mistAmount
      ) {
        paints = buildPaints(look, w, h, mistAmount);
      }
      const { reach } = paints;

      c.setTransform(pr, 0, 0, pr, 0, 0);
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = 1;
      c.fillStyle = paints.depth;
      c.fillRect(0, 0, w, h);

      c.fillStyle = rgbCss(mixRgb(look.deep, look.haze, 0.32), 0.42);
      for (const trunk of trunks) {
        const x = (trunk.x + panX * 0.008) * w;
        const half = trunk.width * h * 0.5;
        c.beginPath();
        c.moveTo(x - half * 1.25, h);
        c.lineTo(x + trunk.lean * h - half, 0);
        c.lineTo(x + trunk.lean * h + half, 0);
        c.lineTo(x + half * 1.25, h);
        c.closePath();
        c.fill();
      }

      c.setTransform(pr, 0, 0, pr, sunX * pr, sunY * pr);
      c.fillStyle = paints.clearing;
      c.fillRect(-sunX, -sunY, w, h);

      // Shafts fan out from the light toward the middle of the viewport. They are
      // drawn small and stretched back up, which blurs their edges for free.
      if (shaftLayer) {
        const g = shaftLayer.g;
        const aim = Math.atan2(w * 0.5 - sunX, h * 0.75 - sunY);
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, shaftLayer.canvas.width, shaftLayer.canvas.height);
        g.setTransform(SHAFT_SCALE, 0, 0, SHAFT_SCALE, sunX * SHAFT_SCALE, sunY * SHAFT_SCALE);
        g.fillStyle = paints.shaft;
        for (const shaft of shafts) {
          const shimmer = 0.5 + 0.5 * Math.sin(time * shaft.rate + shaft.phase);
          const a = aim + shaft.angle;
          g.globalAlpha = clamp(params.rays * (0.35 + 0.65 * shimmer), 0, 1) * 0.4;
          // Three nested wedges feather each shaft from a bright core to a faint edge.
          for (const feather of SHAFT_FEATHERS) {
            const spread = shaft.width * (0.8 + 0.4 * shimmer) * feather;
            g.beginPath();
            g.moveTo(0, 0);
            g.lineTo(Math.sin(a - spread) * reach, Math.cos(a - spread) * reach);
            g.lineTo(Math.sin(a + spread) * reach, Math.cos(a + spread) * reach);
            g.closePath();
            g.fill();
          }
        }
        c.setTransform(pr, 0, 0, pr, 0, 0);
        c.globalCompositeOperation = look.inked ? 'source-over' : 'lighter';
        c.drawImage(shaftLayer.canvas, 0, 0, w, h);
        c.globalCompositeOperation = 'source-over';
      }

      // Foliage: each corner of the frame pinned to its viewport corner, rocking in the breeze.
      const size = cornerSize(params.foliage, h > 0 ? w / h : 1) * h;
      const half = CANVAS_FRAME_PIXELS / 2;
      const rustle = 1 + Math.min(1, Math.abs(scroll.velocity)) * RUSTLE_GAIN;
      const drawFoliage = (layer: Layer | null, depthScale: number): void => {
        if (!layer) {
          return;
        }
        // A sprite ends where the frame does, so each corner is drawn slightly oversized with
        // its outer edges past the viewport. The bleed covers the farthest the parallax and the
        // rocking can pull a corner inward, so the cut edges of the leaves never come into view.
        const bleed =
          (Math.max(w, h) * FOLIAGE_PARALLAX * 0.5 +
            size * FOLIAGE_ROCK * params.breeze * (1 + RUSTLE_GAIN)) *
          depthScale;
        const span = size + bleed;
        for (const [index, [right, bottom]] of CORNER_FLIPS.entries()) {
          const rock =
            Math.sin(time * (0.55 + index * 0.07) * depthScale + index * 1.9) *
            FOLIAGE_ROCK *
            params.breeze *
            rustle *
            depthScale;
          const originX = (right ? w : 0) - panX * w * FOLIAGE_PARALLAX * depthScale;
          const originY = (bottom ? h : 0) - panY * h * FOLIAGE_PARALLAX * depthScale;
          c.setTransform(pr, 0, 0, pr, originX * pr, originY * pr);
          c.rotate(rock);
          c.drawImage(
            layer.canvas,
            right ? half : 0,
            bottom ? half : 0,
            half,
            half,
            right ? -size : -bleed,
            bottom ? -size : -bleed,
            span,
            span,
          );
        }
      };
      c.globalAlpha = 1;
      drawFoliage(midLayer, 0.6);

      c.setTransform(pr, 0, 0, pr, 0, 0);
      c.fillStyle = paints.veil;
      c.fillRect(0, h * 0.45, w, h * 0.55);

      drawFoliage(nearLayer, 1);

      c.setTransform(pr, 0, 0, pr, 0, 0);
      if (moteSprite) {
        const count = Math.round(clamp(params.motes * mood.motes * 0.6, 0, 1) * motes.length);
        c.globalCompositeOperation = look.inked ? 'source-over' : 'lighter';
        const companyReach = (h * 0.25) ** 2;
        for (let i = 0; i < count; i++) {
          const mote = motes[i];
          if (!mote) {
            continue;
          }
          mote.x = wrap(mote.x + (mote.vx + Math.sin(time * 0.4 + mote.phase) * 0.004) * dt, 1);
          mote.y = wrap(mote.y + mote.vy * dt, 1);
          const pulse = Math.max(0, Math.sin(time * mote.rate + mote.phase)) ** 3;
          const glint = 0.55 + 0.45 * Math.sin(time * mote.rate * 2.7 + mote.phase);
          const mx = mote.x * w;
          const my = mote.y * h;
          const company =
            1 +
            1.2 *
              pointer.presence *
              Math.exp(-((mx - pointer.x) ** 2 + (my - pointer.y) ** 2) / companyReach);
          c.globalAlpha = clamp((glint + (pulse - glint) * mood.fireflies) * 0.8 * company, 0, 1);
          const d = mote.size * 5;
          c.drawImage(moteSprite, mx - d / 2, my - d / 2, d, d);
        }
        if (click.count > 0 && click.age < 2.4 && !still) {
          // A click shakes loose a ring of pollen. Its age only advances while frames run, so a
          // still frame skips the ring instead of freezing it in place.
          const cx = click.x * w;
          const cy = click.y * h;
          const radius = click.age * 0.16 * h;
          c.globalAlpha = clamp(Math.exp(-click.age * 1.6), 0, 1);
          for (let i = 0; i < 14; i++) {
            const a = i * GOLDEN_ANGLE + click.count;
            const d = 7 + (i % 3) * 3;
            c.drawImage(
              moteSprite,
              cx + Math.cos(a) * radius - d / 2,
              cy + Math.sin(a) * radius - d / 2,
              d,
              d,
            );
          }
        }
      }
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-over';
      c.setTransform(1, 0, 0, 1, 0, 0);
    },
    dispose() {
      // Hand the sprite memory back at once instead of waiting for garbage collection.
      for (const layer of [nearLayer, midLayer, shaftLayer]) {
        releaseLayer(layer);
      }
      nearLayer = null;
      midLayer = null;
      shaftLayer = null;
      moteSprite = null;
    },
  };
  return scene;
};

function shaftStop(color: Rgb, alpha: number, from: number, to: number): string {
  return `transparent ${from}deg, ${rgbCss(color, alpha)} ${(from + to) / 2}deg, transparent ${to}deg`;
}

/** Static wash for the "Sunlit morning" look, shown when no canvas context is available. */
function canopyCss(palette: ScenePalette): string {
  const look = resolveCanopyLook(palette, canopyMoodAt('morning', 0));
  const shade = rgbCss(mixRgb(look.leafNear, look.deep, 0.3), look.inked ? 0.5 : 0.92);
  return [
    `radial-gradient(ellipse 46% 60% at 0% 100%, ${shade}, transparent 72%)`,
    `radial-gradient(ellipse 46% 60% at 100% 100%, ${shade}, transparent 72%)`,
    `radial-gradient(ellipse 40% 44% at 0% 0%, ${shade}, transparent 70%)`,
    `radial-gradient(ellipse 40% 44% at 100% 0%, ${shade}, transparent 70%)`,
    `conic-gradient(from 150deg at 30% -12%, ${shaftStop(look.light, 0.2, 0, 14)}, ${shaftStop(look.light, 0.16, 22, 34)}, ${shaftStop(look.light, 0.12, 44, 60)}, transparent 360deg)`,
    `radial-gradient(ellipse 60% 50% at 30% 0%, ${rgbCss(look.haze, 0.7)}, transparent 72%)`,
    `linear-gradient(180deg, ${rgbCss(mixRgb(look.deep, look.haze, 0.45))}, ${rgbCss(look.deep)})`,
  ].join(', ');
}

export const CANOPY_SCENE: SceneSpec = {
  factories: [createCanopyShader, createCanopyCanvas],
  cssFallback: canopyCss,
  fps: 24,
  startTime: 12,
  trackScroll: true,
  acceptsBursts: true,
  watchdog: BUILTIN_SHADER_WATCHDOG,
};
