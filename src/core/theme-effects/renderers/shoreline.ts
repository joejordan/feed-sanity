// Coral Shoreline: an aerial view looking straight down over a tropical island
// cove. Warm sun-bleached coral sand with ribbed shells and starfish curves
// along the shore while crystal-clear turquoise lagoon water sweeps across the
// viewport with refracted underwater caustics, lacy cellular sea-foam waves,
// glistening wet-sand swash memory, swaying coconut palm frond shadows,
// submerged coral reef heads, and a gliding manta ray casting its shadow onto
// the sunlit seabed below.
//
// Follows the local clock and real lunar spring/neap tide cycle (`celestial.ts`),
// reacts to pointer wakes, overlapping 4-click splash ripples, and scroll tide
// surges. Renders in WebGL 1, falls back to Canvas 2D with the same coastal
// geometry, then to a static CSS wash.

import type { ShorelineTime } from '../param-specs';
import type { Layer } from './canvas';
import type { ScenePalette } from './palette';
import type { Scene, SceneFactory, SceneSpec } from './scene-host';
import type { ShorelineLook } from './shoreline-look';
import type { UniformMap } from './webgl';
import { dayPhaseAt, moonPhaseAt } from '../celestial';
import { clamp } from '../digital-rain/math';
import { deriveEffectParams, SHORELINE_PARAM_SPECS } from '../model';
import { MAX_SHADER_CLICKS } from '../scene-schema';
import { createLayer, releaseLayer } from './canvas';
import { mixRgb, rgbCss, rgbUnit } from './palette';
import { BUILTIN_SHADER_WATCHDOG } from './scene-host';
import {
  paintPalmShadowLayer,
  paintShoreDetailsLayer,
  paintShorelineAtlas,
} from './shoreline-atlas';
import { resolveShorelineLook, shorelineMoodAt } from './shoreline-look';
import {
  createFullscreenWebglScene,
  GLSL_NOISE,
  GLSL_PRECISION,
  uploadAtlasTexture,
} from './webgl';

const shorelineParams = deriveEffectParams(SHORELINE_PARAM_SPECS, (p) => ({
  time: p.time as ShorelineTime,
  caustics: p.caustics as number,
  tide: p.tide as number,
  surf: p.surf as number,
  breeze: p.breeze as number,
  palms: p.palms as boolean,
  marineLife: p.marineLife as boolean,
}));

const ATLAS_PIXELS = 1024;
/** Half-res sprite backing store for the Canvas 2D fallback (4× less RAM and faster paint). */
const CANVAS_ATLAS_PIXELS = 512;
const CLOCK_STEP_MS = 60_000;
const LUNAR_STEP_MS = 3_600_000;

/** Spring-tide factor (`0` at quarter neap tide, `1` at full/new spring tide). */
export function lunarSpringTideAt(timeMs: number): number {
  const phase = moonPhaseAt(timeMs);
  return Math.abs(Math.cos(phase * Math.PI * 2));
}

function createLunarSpringResolver(): () => number {
  let lastHour = -1;
  let spring = 0.5;
  return () => {
    const now = Date.now();
    const hour = Math.floor(now / LUNAR_STEP_MS);
    if (hour !== lastHour) {
      lastHour = hour;
      spring = lunarSpringTideAt(now);
    }
    return spring;
  };
}

function createLookResolver(): (palette: ScenePalette, time: ShorelineTime) => ShorelineLook {
  let lastPalette: ScenePalette | null = null;
  let lastTime: ShorelineTime | null = null;
  let lastMinute = -1;
  let look: ShorelineLook | null = null;
  return (palette, time) => {
    const minute = time === 'clock' ? Math.floor(Date.now() / CLOCK_STEP_MS) : 0;
    if (!look || palette !== lastPalette || time !== lastTime || minute !== lastMinute) {
      lastPalette = palette;
      lastTime = time;
      lastMinute = minute;
      const dayPhase = time === 'clock' ? dayPhaseAt(new Date()) : 0;
      look = resolveShorelineLook(palette, shorelineMoodAt(time, dayPhase));
    }
    return look;
  };
}

export const SHORELINE_FRAGMENT = `${GLSL_PRECISION}
uniform vec2 uResolution;
uniform float uTime;
uniform vec3 uPointer;
uniform vec2 uPointerVel;
uniform sampler2D uAtlas;
uniform vec4 uClicks[${MAX_SHADER_CLICKS}];
uniform vec2 uScroll;
uniform vec3 uSandDry;
uniform vec3 uSandWet;
uniform vec3 uWaterShallow;
uniform vec3 uWaterMid;
uniform vec3 uWaterDeep;
uniform vec3 uCaustic;
uniform vec3 uFoam;
uniform vec3 uCoral;
uniform vec3 uPalmShadow;
uniform vec3 uSkySpec;
// x = sunDirX, y = sunDirY, z = causticGain, w = sparkle
uniform vec4 uMood;
// x = caustics, y = tide, z = surf, w = breeze
uniform vec4 uTune;
// x = palms (0/1), y = marineLife (0/1), z = lightMode (0/1), w = lunarSpring (0..1)
uniform vec4 uFlags;
// CPU-computed per-frame wildlife orbits: xy = centre (aspect-scaled), zw = unit heading.
uniform vec4 uManta;
uniform vec4 uSchool;
${GLSL_NOISE}

float sat(float x) {
  return clamp(x, 0.0, 1.0);
}

// Organic curved tropical cove contour along the left edge (x in 0..1).
float coveContour(float y) {
  return 0.245
    + 0.072 * sin(y * 3.15 + 0.55)
    + 0.048 * cos(y * 1.85 - 0.7)
    + 0.02 * snoise(vec2(y * 3.8, 1.9));
}

// Domain-warped ridged simplex web returning (main intensity, bright secondary crest shimmer)
// in one 3-noise pass instead of sampling twice.
vec2 causticWeb(vec2 q, float t) {
  vec2 a = q + vec2(t * 0.13, -t * 0.085);
  vec2 b = mat2(0.78, -0.62, 0.62, 0.78) * q * 1.32 + vec2(-t * 0.1, t * 0.12);
  float n1 = snoise(a);
  float n2 = snoise(b + n1 * 0.62);
  float n3 = snoise(a * 1.8 - b * 0.68 + n2 * 0.48);
  float r1 = 1.0 - abs(n2);
  float r2 = 1.0 - abs(n3);
  float w1 = r1 * r1;
  w1 *= w1;
  float w2 = r2 * r2;
  w2 *= w2 * r2;
  return vec2(w1 * 0.74 + w2 * 0.56, w2 * 0.65);
}

// Graceful winged manta ray silhouette in local space (+x = nose, +y = right wing).
float mantaShape(vec2 lp, float t) {
  float span = abs(lp.y);
  float flap = 0.006 * sin(t * 2.1 - span * 42.0) * smoothstep(0.008, 0.055, span);
  vec2 q = vec2(lp.x + flap, span);
  float leading = 0.026 - q.y * 0.52 - q.y * q.y * 3.6;
  float trailing = -0.028 + q.y * 0.34 - 0.006 * sin(q.y * 55.0);
  float insideX = smoothstep(trailing - 0.005, trailing + 0.004, q.x)
    * (1.0 - smoothstep(leading - 0.005, leading + 0.004, q.x));
  float wingSpan = 1.0 - smoothstep(0.052, 0.062, q.y);
  float body = insideX * wingSpan;
  float tailMask = smoothstep(-0.075, -0.024, lp.x) * (1.0 - smoothstep(-0.024, -0.014, lp.x));
  float tailWave = 0.0025 * sin(lp.x * 110.0 + t * 3.4);
  float tail = tailMask * (1.0 - smoothstep(0.0012, 0.0036, abs(lp.y - tailWave)));
  return sat(max(body, tail * 0.85));
}

// Evaluates a manta ray at scene point p given its precomputed orbit centre and heading.
float sampleManta(vec2 p, vec2 center, vec2 fwd, float t) {
  vec2 rel = p - center;
  if (dot(rel, rel) > 0.022) {
    return 0.0;
  }
  vec2 right = vec2(-fwd.y, fwd.x);
  vec2 lp = vec2(dot(rel, fwd), dot(rel, right)) * 0.82;
  return mantaShape(lp, t);
}

// Evaluates a school of 4 reef minnows at scene point p given its precomputed school centre & heading.
float sampleMinnows(vec2 p, vec2 school, vec2 heading, float t) {
  vec2 relSchool = p - school;
  if (dot(relSchool, relSchool) > 0.015) {
    return 0.0;
  }
  vec2 perp = vec2(-heading.y, heading.x);
  float total = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec2 off = heading * (0.022 - fi * 0.014) + perp * (sin(fi * 2.4 + t * 1.6) * 0.014);
    vec2 q = p - (school + off);
    float lx = dot(q, heading);
    float ly = dot(q, perp) - 0.0014 * sin(lx * 240.0 - t * 9.0 + fi);
    float d = length(vec2(lx * 0.42, ly * 2.1));
    total = max(total, 1.0 - smoothstep(0.0035, 0.0072, d));
  }
  return total;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  float aspect = uResolution.x / uResolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float t = uTime;
  float grain = hash12(gl_FragCoord.xy);
  bool isLight = uFlags.z > 0.5;

  vec2 pan = (uPointer.xy - 0.5) * uPointer.z;
  vec2 ptrP = vec2(uPointer.x * aspect, uPointer.y);
  float scrollSurge = sat(abs(uScroll.y)) * 0.032;
  float scrollDrift = (uScroll.x - 0.5) * 0.018;
  float surfAmt = uTune.z;
  float breeze = uTune.w * (1.0 + sat(abs(uScroll.y)) * 1.4);

  // Curved island cove shoreline shifted by tide slider, real lunar spring tide & scroll.
  float tideShift = (1.0 - uTune.y) * 0.13 - uFlags.w * 0.022 + scrollDrift;
  float baseShore = coveContour(uv.y) + tideShift;

  // Two staggered rolling swash waves lapping up onto the coral sand.
  float wNoise = snoise(vec2(uv.y * 4.4, t * 0.14));
  float phaseA = t * 0.58 + uv.y * 2.2 + wNoise * 0.55;
  float phaseB = t * 0.58 - 1.55 + uv.y * 2.6 + wNoise * 0.45;
  float swashA = pow(max(0.5 + 0.5 * sin(phaseA), 0.0001), 1.35);
  float swashB = pow(max(0.5 + 0.5 * sin(phaseB), 0.0001), 1.55);
  float reach = (0.068 + scrollSurge + uFlags.w * 0.016) * clamp(0.35 + surfAmt * 0.65, 0.15, 1.5);
  float waterEdgeA = baseShore - reach * swashA;
  float waterEdgeB = baseShore - reach * 0.56 * swashB + 0.042;
  float highWater = baseShore - reach * 1.12;

  float depthA = uv.x - waterEdgeA;
  float depthB = uv.x - waterEdgeB;
  float waterDepth = max(depthA, 0.0);

  // Overlapping 4-click splash rings + pointer water wake (bends caustics & glints).
  vec2 rippleGrad = vec2(0.0);
  float rippleHighlight = 0.0;
  float sandSplash = 0.0;
  vec2 sunDir = normalize(vec2(-uMood.x, -uMood.y) + vec2(0.0, 0.0001));
  for (int i = 0; i < ${MAX_SHADER_CLICKS}; i++) {
    vec4 clk = uClicks[i];
    if (clk.w > 0.5 && clk.z < 3.4) {
      vec2 cq = p - vec2(clk.x * aspect, clk.y);
      float r = clk.z * 0.24;
      float rMax = r + 0.09;
      if (dot(cq, cq) < rMax * rMax) {
        float cd = length(cq);
        float band = (cd - r) / 0.022;
        float env = exp(-band * band) * exp(-clk.z * 1.15);
        float band2 = (cd - r * 0.62) / 0.018;
        float ring2 = exp(-band2 * band2) * exp(-clk.z * 1.35) * 0.55;
        float wave = sin((cd - r) * 140.0) * env + sin((cd - r * 0.62) * 165.0) * ring2;
        vec2 dir = cq / (cd + 0.001);
        rippleGrad += dir * wave * 0.026;
        rippleHighlight += (env + ring2 * 0.7) * (0.45 + 0.55 * sat(dot(dir, sunDir)));
        sandSplash += env * 0.45;
      }
    }
  }
  if (uPointer.z > 0.001) {
    vec2 pq = p - ptrP;
    float pDistSq = dot(pq, pq);
    if (pDistSq < 0.09) {
      float pDist = sqrt(pDistSq);
      float wake = exp(-pDistSq * 95.0) * uPointer.z;
      float speed = min(length(uPointerVel), 2.5);
      vec2 dir = pq / (pDist + 0.001);
      rippleGrad += dir * sin(pDist * 130.0 - t * 7.0) * wake * (0.008 + speed * 0.014);
      rippleHighlight += wake * (0.14 + speed * 0.28);
    }
  }

  // Spatially gated atlas reads (each feature is surrounded by pure-black padding so
  // skipping reads outside its half of the viewport never causes a mip-boundary seam).
  // atlasUv is Y-down (0 = top), so negate Y components of Y-up pan & rippleGrad offsets.
  vec2 atlasUv = vec2(uv.x, 1.0 - uv.y);
  vec2 atlasPan = vec2(pan.x, -pan.y);
  vec2 atlasRipple = vec2(rippleGrad.x, -rippleGrad.y);
  float palmMask = 0.0;
  if (uFlags.x > 0.5 && uv.x < 0.50) {
    float swayReach = sat(length(vec2(uv.x, min(uv.y, 1.0 - uv.y))) * 1.6);
    vec2 palmSway = vec2(
      sin(t * 0.82 + uv.y * 4.5) + 0.45 * sin(t * 1.55 + uv.x * 7.0),
      0.7 * cos(t * 0.7 + uv.x * 5.2)
    ) * (0.006 * breeze * swayReach);
    vec2 palmRefract = atlasRipple * 0.9 * smoothstep(-0.01, 0.08, depthA);
    palmMask = texture2D(uAtlas, clamp(atlasUv + palmSway + palmRefract + atlasPan * 0.014, 0.002, 0.998), 0.7).r;
  }
  float shellMask = 0.0;
  float shellShadow = 0.0;
  if (uv.x < 0.28) {
    shellMask = texture2D(uAtlas, clamp(atlasUv, 0.002, 0.998), 0.0).g;
    shellShadow = texture2D(uAtlas, clamp(atlasUv - vec2(uMood.x, -uMood.y) * 0.22, 0.002, 0.998), 0.4).g;
  }
  float reefMask = 0.0;
  if (uv.x > 0.62) {
    vec2 reefUv = clamp(atlasUv + atlasRipple * 1.4 + atlasPan * 0.01, 0.002, 0.998);
    reefMask = texture2D(uAtlas, reefUv, 0.3).b;
  }

  // 1. Coral Sand Base (only shaded on beach & feathered swash edge).
  vec3 sandCol = uSandDry;
  if (depthA < 0.014) {
    float sandMicro = 0.5 + 0.5 * snoise(vec2(p.x * 28.0, p.y * 14.0 + snoise(p * 4.0)));
    float sandFine = (grain - 0.5) * 0.055;
    sandCol = mix(uSandDry, uSandWet, sandMicro * 0.14) + sandFine;

    float wetBand = smoothstep(highWater - 0.016, highWater + 0.032, uv.x);
    float freshWet = wetBand * (0.55 + 0.45 * exp(-max(-depthA, 0.0) * 18.0));
    sandCol = mix(sandCol, uSandWet, freshWet * 0.85);
    float wetSpark = pow(hash12(floor(gl_FragCoord.xy * 0.5) + floor(t * 2.0) * 0.13), 24.0) * freshWet * uMood.w;
    sandCol = mix(sandCol, uSkySpec, freshWet * (isLight ? 0.16 : 0.22));
    sandCol += uCaustic * wetSpark * (isLight ? 0.45 : 0.7);
    sandCol = mix(sandCol, uSandWet, sandSplash * (1.0 - smoothstep(-0.01, 0.02, depthA)) * 0.35);

    float beachOnly = 1.0 - smoothstep(baseShore - 0.01, baseShore + 0.05, uv.x);
    if (beachOnly > 0.005) {
      float sDrop = max(shellShadow - shellMask, 0.0) * beachOnly;
      sandCol = mix(sandCol, uPalmShadow, sDrop * (isLight ? 0.14 : 0.26));
      vec3 pearlShell = mix(uSandDry, uFoam, isLight ? 0.58 : 0.24);
      vec3 shellTint = mix(pearlShell, uCoral, smoothstep(0.84, 0.96, shellMask) * (isLight ? 0.68 : 0.5));
      sandCol = mix(sandCol, shellTint, smoothstep(0.18, 0.68, shellMask) * beachOnly * (isLight ? 0.64 : 0.52));
    }
  }

  // 2. Crystal-Clear Tropical Lagoon Water (only shaded inside the lagoon & swash edge).
  vec3 waterCol = uWaterMid;
  if (depthA > -0.006) {
    vec2 swellGrad = vec2(
      snoise(vec2(p.x * 4.5 - t * 0.45, p.y * 3.8 + t * 0.18)),
      snoise(vec2(p.x * 4.2 + 9.1, p.y * 4.6 - t * 0.32))
    ) * 0.016 * clamp(0.4 + surfAmt * 0.6, 0.2, 1.5);
    vec2 refractUv = p + swellGrad + rippleGrad * 1.8;

    float seabedRipples = waterDepth < 0.45
      ? 0.5 + 0.5 * sin(refractUv.x * 54.0 + snoise(refractUv * 5.0) * 2.2)
      : 0.5;
    vec3 seabed = mix(uSandWet, uSandDry, 0.35 + 0.2 * seabedRipples);

    if (reefMask > 0.02) {
      vec3 reefCol = mix(mix(uWaterDeep, uCoral, 0.34), uCoral, reefMask * 0.36);
      seabed = mix(seabed, reefCol, smoothstep(0.08, 0.62, reefMask) * (isLight ? 0.52 : 0.58));
    }

    float mantaBody = 0.0;
    float minnowBody = 0.0;
    if (uFlags.y > 0.5 && depthA > 0.04) {
      vec2 shadowShift = vec2(uMood.x, uMood.y) * (0.6 + waterDepth * 1.25);
      float mantaShad = sampleManta(refractUv - shadowShift, uManta.xy, uManta.zw, t);
      mantaBody = sampleManta(refractUv, uManta.xy, uManta.zw, t);
      float minnowShad = sampleMinnows(refractUv - shadowShift * 0.55, uSchool.xy, uSchool.zw, t);
      minnowBody = sampleMinnows(refractUv, uSchool.xy, uSchool.zw, t);
      seabed = mix(seabed, uWaterDeep * 0.52, max(mantaShad * 0.62, minnowShad * 0.42));
    }

    float cDepthMask = smoothstep(0.008, 0.12, waterDepth) * exp(-waterDepth * 0.95);
    vec2 cPair = causticWeb(refractUv * 6.2, t);
    float cMain = cPair.x;
    float cStrength = uTune.x * uMood.z * cDepthMask;
    if (cStrength > 0.005) {
      vec3 causticLight = mix(uCaustic, uSkySpec, 0.25) * cMain + uCaustic * cPair.y * 0.65;
      seabed = mix(seabed, clamp(seabed + causticLight * (isLight ? 0.72 : 0.88), 0.0, 1.0), sat(cStrength));
    }

    float shallowMix = 1.0 - exp(-waterDepth * 6.2);
    float deepMix = smoothstep(0.24, 0.88, waterDepth);
    vec3 waterBody = mix(uWaterShallow, uWaterMid, smoothstep(0.03, 0.44, waterDepth));
    waterBody = mix(waterBody, uWaterDeep, deepMix);
    waterCol = mix(seabed, waterBody, shallowMix * (isLight ? 0.86 : 0.84));
    if (reefMask > 0.02) {
      waterCol = mix(waterCol, mix(uWaterDeep, uCoral, 0.28), smoothstep(0.12, 0.68, reefMask) * (isLight ? 0.22 : 0.34));
    }

    if (mantaBody > 0.005) {
      vec3 mantaTint = mix(uWaterDeep, uPalmShadow, 0.42);
      mantaTint = mix(mantaTint, uCaustic, cMain * cStrength * 0.5);
      waterCol = mix(waterCol, mantaTint, mantaBody * (isLight ? 0.5 : 0.58));
    }
    if (minnowBody > 0.005) {
      vec3 fishTint = mix(uWaterDeep, uCaustic, 0.38);
      waterCol = mix(waterCol, fishTint, minnowBody * 0.48);
    }

    float spBase = sat(cMain * 0.92 + 0.25 * snoise(refractUv * 18.0 - t * 0.8));
    float waveSpark = (spBase * spBase * spBase) * smoothstep(0.02, 0.26, waterDepth) * uMood.w;
    waterCol = mix(waterCol, uCaustic, sat(cMain * cStrength * (isLight ? 0.42 : 0.52)));
    waterCol = mix(waterCol, uSkySpec, sat(waveSpark * (isLight ? 0.32 : 0.36)));
    waterCol = mix(waterCol, uFoam, sat(rippleHighlight * (isLight ? 0.42 : 0.52) * smoothstep(-0.01, 0.04, depthA)));
  }

  // 3. Lacy Cellular Sea-Foam Ribbons on incoming swash fronts and offshore swells.
  float foamMask = 0.0;
  if (surfAmt > 0.001) {
    float crestA = exp(-abs(depthA) * 78.0);
    float trailA = exp(-max(depthA, 0.0) * 16.0) * smoothstep(-0.006, 0.004, depthA) * 0.72;
    float crestB = exp(-abs(depthB) * 62.0) * 0.68;
    float trailB = exp(-max(depthB, 0.0) * 20.0) * smoothstep(-0.005, 0.004, depthB) * 0.58 * 0.68;
    float sw = sat(sin((uv.x - baseShore) * 22.0 + t * 1.1 + wNoise * 2.1));
    float sw2 = sw * sw;
    float offshoreEnv = (sw2 * sw2 * sw2 * sw) * smoothstep(0.14, 0.26, waterDepth) * (1.0 - smoothstep(0.45, 0.75, waterDepth)) * 0.42;
    float laceWeight = trailA + trailB + offshoreEnv;
    float lace = 0.0;
    if (laceWeight > 0.01) {
      float foamCell = 0.5 + 0.5 * snoise(vec2(uv.x * 38.0 - t * 0.6, uv.y * 24.0 + snoise(p * 8.0) * 1.6));
      lace = smoothstep(0.26, 0.74, foamCell);
    }
    foamMask = sat((crestA + crestB + laceWeight * lace) * clamp(surfAmt, 0.0, 1.5));
  }

  float waterMask = smoothstep(-0.006, 0.014, depthA);
  vec3 col = mix(sandCol, waterCol, waterMask);
  col = mix(col, uFoam, foamMask * (isLight ? 0.88 : 0.72));

  // 4. Swaying Overhanging Coconut Palm Frond Shadows cast over sand & refracted across shallows.
  if (uFlags.x > 0.5 && palmMask > 0.01) {
    float shadeStrength = smoothstep(0.08, 0.72, palmMask) * uMood.z * 0.16;
    float onSand = 1.0 - smoothstep(0.05, 0.32, waterDepth) * 0.55;
    float alpha = sat(shadeStrength * onSand * (isLight ? 1.15 : 1.6));
    col = mix(col, uPalmShadow, alpha);
  }

  col += (grain - 0.5) / 255.0;
  gl_FragColor = premultiply(col, 1.0);
}`;

const SHORELINE_UNIFORMS = [
  'uResolution',
  'uTime',
  'uPointer',
  'uPointerVel',
  'uAtlas',
  'uClicks[0]',
  'uScroll',
  'uSandDry',
  'uSandWet',
  'uWaterShallow',
  'uWaterMid',
  'uWaterDeep',
  'uCaustic',
  'uFoam',
  'uCoral',
  'uPalmShadow',
  'uSkySpec',
  'uMood',
  'uTune',
  'uFlags',
  'uManta',
  'uSchool',
] as const;

interface ShorelineGlState {
  readonly u: UniformMap<(typeof SHORELINE_UNIFORMS)[number]>;
  readonly texture: WebGLTexture | null;
  readonly clickData: Float32Array;
  look: ShorelineLook | null;
  tuneKey: string;
  flagsKey: string;
  clicksActive: boolean;
}

const createShorelineShader: SceneFactory = (canvas, hooks) => {
  const resolveLook = createLookResolver();
  const resolveLunarSpring = createLunarSpringResolver();
  return createFullscreenWebglScene<ShorelineGlState>({
    fragment: SHORELINE_FRAGMENT,
    renderScale: 0.5,
    maxPixels: 620_000,
    init(gl, program) {
      const u = Object.fromEntries(
        SHORELINE_UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)]),
      ) as ShorelineGlState['u'];
      const texture = uploadAtlasTexture(
        gl,
        canvas.ownerDocument,
        ATLAS_PIXELS,
        paintShorelineAtlas,
      );
      gl.uniform1i(u.uAtlas, 0);
      return {
        u,
        texture,
        clickData: new Float32Array(MAX_SHADER_CLICKS * 4),
        look: null,
        tuneKey: '',
        flagsKey: '',
        clicksActive: true,
      };
    },
    onResize(gl, state, width, height) {
      gl.uniform2f(state.u.uResolution, width, height);
    },
    onRender(gl, state, frame) {
      const { u } = state;
      const params = shorelineParams(frame.ctx.effects.backdropParams);
      const look = resolveLook(frame.palette, params.time);
      const { mood } = look;
      const lunarSpring = resolveLunarSpring();
      if (look !== state.look) {
        state.look = look;
        gl.uniform3fv(u.uSandDry, rgbUnit(look.sandDry));
        gl.uniform3fv(u.uSandWet, rgbUnit(look.sandWet));
        gl.uniform3fv(u.uWaterShallow, rgbUnit(look.waterShallow));
        gl.uniform3fv(u.uWaterMid, rgbUnit(look.waterMid));
        gl.uniform3fv(u.uWaterDeep, rgbUnit(look.waterDeep));
        gl.uniform3fv(u.uCaustic, rgbUnit(look.caustic));
        gl.uniform3fv(u.uFoam, rgbUnit(look.foam));
        gl.uniform3fv(u.uCoral, rgbUnit(look.coral));
        gl.uniform3fv(u.uPalmShadow, rgbUnit(look.palmShadow));
        gl.uniform3fv(u.uSkySpec, rgbUnit(look.skySpec));
        gl.uniform4f(u.uMood, mood.sunDirX, mood.sunDirY, mood.causticGain, mood.sparkle);
      }
      const tuneKey = `${params.caustics}|${params.tide}|${params.surf}|${params.breeze}`;
      if (tuneKey !== state.tuneKey) {
        state.tuneKey = tuneKey;
        gl.uniform4f(u.uTune, params.caustics, params.tide, params.surf, params.breeze);
      }
      const flagsKey = `${params.palms ? 1 : 0}|${params.marineLife ? 1 : 0}|${look.lightMode ? 1 : 0}|${lunarSpring.toFixed(4)}`;
      if (flagsKey !== state.flagsKey) {
        state.flagsKey = flagsKey;
        gl.uniform4f(
          u.uFlags,
          params.palms ? 1 : 0,
          params.marineLife ? 1 : 0,
          look.lightMode ? 1 : 0,
          lunarSpring,
        );
      }
      const { view, pointer, scroll } = frame;
      if (params.marineLife) {
        const aspect = view.height > 0 ? view.width / view.height : 1;
        const mOrbit = frame.time * 0.065;
        const mCx = aspect * (0.83 + 0.068 * Math.sin(mOrbit));
        const mCy = 0.34 + 0.18 * Math.cos(mOrbit * 0.72 + 0.3);
        const mVx = aspect * 0.068 * Math.cos(mOrbit);
        const mVy = -0.18 * 0.72 * Math.sin(mOrbit * 0.72 + 0.3);
        const mLen = Math.hypot(mVx, mVy) || 1;
        gl.uniform4f(u.uManta, mCx, mCy, mVx / mLen, mVy / mLen);

        const fLead = frame.time * 0.11;
        let fSx = aspect * (0.64 + 0.08 * Math.cos(fLead + 1.1));
        let fSy = 0.26 + 0.14 * Math.sin(fLead * 1.25);
        if (pointer.presence > 0.001) {
          const dx = fSx - pointer.nx * aspect;
          const dy = fSy - (1 - pointer.ny);
          const dSq = dx * dx + dy * dy;
          const d = Math.sqrt(dSq) + 0.001;
          const flee = pointer.presence * Math.exp(-dSq * 22) * 0.055;
          fSx += (dx / d) * flee;
          fSy += (dy / d) * flee;
        }
        const fVx = -aspect * 0.08 * Math.sin(fLead + 1.1);
        const fVy = 0.14 * 1.25 * Math.cos(fLead * 1.25);
        const fLen = Math.hypot(fVx, fVy) || 1;
        gl.uniform4f(u.uSchool, fSx, fSy, fVx / fLen, fVy / fLen);
      }
      gl.uniform1f(u.uTime, frame.time);
      gl.uniform3f(u.uPointer, pointer.nx, 1 - pointer.ny, pointer.presence);
      gl.uniform2f(u.uPointerVel, pointer.vx, -pointer.vy);
      gl.uniform2f(u.uScroll, scroll.y, scroll.velocity);
      let anyClick = false;
      for (let i = 0; i < MAX_SHADER_CLICKS; i++) {
        const slot = frame.clicks[i];
        const live = Boolean(slot && slot.active > 0 && slot.age < 3.4 && !frame.still);
        if (live) {
          anyClick = true;
        }
        const base = i * 4;
        state.clickData[base] = slot?.x ?? 0.5;
        state.clickData[base + 1] = 1 - (slot?.y ?? 0.5);
        state.clickData[base + 2] = slot?.age ?? 999;
        state.clickData[base + 3] = live ? 1 : 0;
      }
      if (anyClick || state.clicksActive) {
        state.clicksActive = anyClick;
        gl.uniform4fv(u['uClicks[0]'], state.clickData);
      }
    },
    onDispose(gl, state) {
      gl.deleteTexture(state.texture);
    },
  })(canvas, hooks);
};

/* -------------------------------------------------------------------------- */
/* Canvas 2D Fallback Renderer (same cove, caustics, manta & palm shadows)    */
/* -------------------------------------------------------------------------- */

interface ShorelinePaints {
  readonly look: ShorelineLook;
  readonly w: number;
  readonly h: number;
  readonly waterGrad: CanvasGradient;
  readonly sandGrad: CanvasGradient;
  readonly mantaShadow: string;
  readonly mantaBody: string;
}

function coveX(ny: number, tide: number, lunarSpring: number, scrollY: number): number {
  const curve =
    0.245 + 0.072 * Math.sin((1 - ny) * 3.15 + 0.55) + 0.048 * Math.cos((1 - ny) * 1.85 - 0.7);
  return curve + (1 - tide) * 0.13 - lunarSpring * 0.022 + (scrollY - 0.5) * 0.018;
}

function drawManta(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  heading: number,
  scale: number,
  fill: string,
): void {
  c.save();
  c.translate(x, y);
  c.rotate(heading);
  c.fillStyle = fill;
  c.beginPath();
  c.moveTo(scale * 0.55, 0);
  c.quadraticCurveTo(scale * 0.18, scale * 0.9, -scale * 0.12, scale);
  c.quadraticCurveTo(-scale * 0.22, scale * 0.35, -scale * 0.45, 0.08 * scale);
  c.lineTo(-scale * 1.15, 0);
  c.lineTo(-scale * 0.45, -0.08 * scale);
  c.quadraticCurveTo(-scale * 0.22, -scale * 0.35, -scale * 0.12, -scale);
  c.quadraticCurveTo(scale * 0.18, -scale * 0.9, scale * 0.55, 0);
  c.closePath();
  c.fill();
  c.restore();
}

const createShorelineCanvas: SceneFactory = (canvas) => {
  const c = canvas.getContext('2d');
  if (!c) {
    return null;
  }
  const doc = canvas.ownerDocument;
  const resolveLook = createLookResolver();
  const resolveLunarSpring = createLunarSpringResolver();
  let spriteKey = '';
  let palmLayer: Layer | null = null;
  let detailLayer: Layer | null = null;
  let paints: ShorelinePaints | null = null;

  const paintSprites = (look: ShorelineLook): void => {
    palmLayer ??= createLayer(doc, CANVAS_ATLAS_PIXELS, CANVAS_ATLAS_PIXELS);
    detailLayer ??= createLayer(doc, CANVAS_ATLAS_PIXELS, CANVAS_ATLAS_PIXELS);
    if (palmLayer) {
      paintPalmShadowLayer(palmLayer.g, CANVAS_ATLAS_PIXELS, look.palmShadow);
    }
    if (detailLayer) {
      paintShoreDetailsLayer(detailLayer.g, CANVAS_ATLAS_PIXELS, {
        shell: mixRgb(look.foam, look.sandDry, 0.32),
        coral: look.coral,
        reef: mixRgb(look.waterDeep, look.coral, 0.42),
      });
    }
  };

  const buildPaints = (look: ShorelineLook, w: number, h: number): ShorelinePaints => {
    const waterGrad = c.createLinearGradient(w * 0.18, 0, w, h * 0.12);
    waterGrad.addColorStop(0, rgbCss(look.waterShallow));
    waterGrad.addColorStop(0.45, rgbCss(look.waterMid));
    waterGrad.addColorStop(1, rgbCss(look.waterDeep));
    const sandGrad = c.createLinearGradient(0, 0, w * 0.36, 0);
    sandGrad.addColorStop(0, rgbCss(look.sandDry));
    sandGrad.addColorStop(0.72, rgbCss(look.sandDry));
    sandGrad.addColorStop(1, rgbCss(look.sandWet));
    return {
      look,
      w,
      h,
      waterGrad,
      sandGrad,
      mantaShadow: rgbCss(look.waterDeep, 0.35),
      mantaBody: rgbCss(mixRgb(look.waterDeep, look.palmShadow, 0.4), 0.44),
    };
  };

  const traceCoveEdge = (
    w: number,
    h: number,
    tide: number,
    lunarSpring: number,
    scrollY: number,
    offset: number,
    wavePhase: number,
    waveAmp: number,
    continuePath = false,
  ): void => {
    const steps = 28;
    for (let i = 0; i <= steps; i++) {
      const ny = i / steps;
      const sway = Math.sin(wavePhase + (1 - ny) * 2.2) * waveAmp;
      const x = (coveX(ny, tide, lunarSpring, scrollY) + offset - sway) * w;
      const y = ny * h;
      if (i === 0 && !continuePath) {
        c.moveTo(x, y);
      } else {
        c.lineTo(x, y);
      }
    }
  };

  const scene: Scene = {
    kind: 'canvas2d',
    renderScale: 0.75,
    maxPixels: 900_000,
    render({ ctx, palette, view, time, pointer, clicks, scroll, still }) {
      const params = shorelineParams(ctx.effects.backdropParams);
      const look = resolveLook(palette, params.time);
      const lunarSpring = resolveLunarSpring();
      if (look.key !== spriteKey) {
        spriteKey = look.key;
        paintSprites(look);
      }

      const w = view.cssWidth;
      const h = view.cssHeight;
      const pr = view.pixelRatio;
      if (!paints || paints.look !== look || paints.w !== w || paints.h !== h) {
        paints = buildPaints(look, w, h);
      }

      const panX = (pointer.nx - 0.5) * pointer.presence;
      const panY = (pointer.ny - 0.5) * pointer.presence;
      const surge = clamp(Math.abs(scroll.velocity), 0, 1) * 0.032;
      const reach =
        (0.064 + surge + lunarSpring * 0.015) * clamp(0.35 + params.surf * 0.65, 0.15, 1.5);
      const swash = (0.5 + 0.5 * Math.sin(time * 0.58)) ** 1.35;

      c.setTransform(pr, 0, 0, pr, 0, 0);
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = 1;

      c.fillStyle = paints.waterGrad;
      c.fillRect(0, 0, w, h);

      if (params.caustics > 0.05) {
        c.save();
        c.globalCompositeOperation = look.lightMode ? 'source-over' : 'lighter';
        const alpha = clamp(0.18 * params.caustics * look.mood.causticGain, 0, 0.42);
        c.strokeStyle = rgbCss(look.caustic, alpha);
        c.lineCap = 'round';
        for (let i = 0; i < 9; i++) {
          const baseX = w * (0.28 + (i / 9) * 0.72);
          c.lineWidth = Math.max(2, h * (0.005 + (i % 3) * 0.003));
          c.beginPath();
          for (let s = 0; s <= 14; s++) {
            const ny = s / 14;
            const waveX =
              baseX +
              Math.sin(ny * 7.5 + time * (0.55 + (i % 3) * 0.14) + i * 1.9) * w * 0.022 +
              Math.cos(ny * 13 - time * 0.42 + i) * w * 0.008;
            const py = ny * h;
            if (s === 0) {
              c.moveTo(waveX, py);
            } else {
              c.lineTo(waveX, py);
            }
          }
          c.stroke();
        }
        c.restore();
      }

      if (params.marineLife) {
        const orbit = time * 0.065;
        const mx = w * (0.83 + 0.068 * Math.sin(orbit));
        const my = h * (0.66 - 0.18 * Math.cos(orbit * 0.72 + 0.3));
        const vx = w * 0.068 * Math.cos(orbit);
        const vy = h * 0.18 * 0.72 * Math.sin(orbit * 0.72 + 0.3);
        const heading = Math.atan2(vy, vx);
        const scale = Math.min(w, h) * 0.064;
        drawManta(
          c,
          mx + look.mood.sunDirX * h * 0.75,
          my - look.mood.sunDirY * h * 0.75,
          heading,
          scale,
          paints.mantaShadow,
        );
        drawManta(c, mx, my, heading, scale, paints.mantaBody);
      }

      c.beginPath();
      c.moveTo(0, 0);
      traceCoveEdge(
        w,
        h,
        params.tide,
        lunarSpring,
        scroll.y,
        -reach * swash,
        time * 0.58,
        0.012,
        true,
      );
      c.lineTo(0, h);
      c.closePath();
      c.fillStyle = paints.sandGrad;
      c.fill();

      if (detailLayer) {
        c.globalAlpha = 0.85;
        c.drawImage(detailLayer.canvas, 0, 0, w, h);
        c.globalAlpha = 1;
      }

      if (params.surf > 0.05) {
        c.save();
        c.lineCap = 'round';
        c.strokeStyle = rgbCss(look.foam, clamp(0.72 * params.surf, 0, 0.9));
        c.lineWidth = Math.max(2.5, w * 0.0045);
        c.beginPath();
        traceCoveEdge(w, h, params.tide, lunarSpring, scroll.y, -reach * swash, time * 0.58, 0.012);
        c.stroke();
        c.strokeStyle = rgbCss(look.foam, clamp(0.36 * params.surf, 0, 0.55));
        c.lineWidth = Math.max(1.8, w * 0.003);
        c.beginPath();
        traceCoveEdge(
          w,
          h,
          params.tide,
          lunarSpring,
          scroll.y,
          0.036 - reach * 0.55 * swash,
          time * 0.58 - 2.3,
          0.01,
        );
        c.stroke();
        c.restore();
      }

      if (!still) {
        for (const slot of clicks) {
          if (slot.active > 0 && slot.age < 3) {
            const radius = slot.age * 0.22 * Math.min(w, h);
            const alpha = clamp(Math.exp(-slot.age * 1.2) * 0.55, 0, 1);
            c.strokeStyle = rgbCss(look.foam, alpha);
            c.lineWidth = 1.6;
            c.beginPath();
            c.arc(slot.x * w, slot.y * h, radius, 0, Math.PI * 2);
            c.stroke();
          }
        }
      }

      if (params.palms && palmLayer) {
        const swayX = Math.sin(time * 0.8) * 6 * params.breeze - panX * w * 0.014;
        const swayY = Math.cos(time * 0.68) * 4 * params.breeze - panY * h * 0.014;
        c.globalAlpha = look.lightMode
          ? 0.14 * look.mood.shadowDepth
          : 0.22 * look.mood.shadowDepth;
        c.drawImage(palmLayer.canvas, swayX, swayY, w, h);
        c.globalAlpha = 1;
      }

      c.setTransform(1, 0, 0, 1, 0, 0);
    },
    dispose() {
      releaseLayer(palmLayer);
      releaseLayer(detailLayer);
      palmLayer = null;
      detailLayer = null;
      paints = null;
    },
  };
  return scene;
};

/** Static coastal CSS wash shown only when neither WebGL nor Canvas 2D is available. */
function shorelineCss(palette: ScenePalette): string {
  const look = resolveShorelineLook(palette, shorelineMoodAt('noon', 0.5));
  return [
    `radial-gradient(ellipse 46% 52% at 68% 36%, ${rgbCss(look.caustic, look.lightMode ? 0.34 : 0.22)}, transparent 70%)`,
    `radial-gradient(ellipse 40% 44% at 84% 72%, ${rgbCss(look.caustic, look.lightMode ? 0.24 : 0.18)}, transparent 68%)`,
    `linear-gradient(104deg, ${rgbCss(look.sandDry)} 0%, ${rgbCss(look.sandWet)} 23%, ${rgbCss(look.foam, 0.72)} 26%, ${rgbCss(look.waterShallow)} 32%, ${rgbCss(look.waterMid)} 66%, ${rgbCss(look.waterDeep)} 100%)`,
  ].join(', ');
}

export const SHORELINE_SCENE: SceneSpec = {
  factories: [createShorelineShader, createShorelineCanvas],
  cssFallback: shorelineCss,
  fps: 24,
  startTime: 14,
  trackScroll: true,
  acceptsBursts: true,
  watchdog: BUILTIN_SHADER_WATCHDOG,
};
