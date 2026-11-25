// Flagship Tier 3 GLSL ES 1.00 fragment shader: "Event Horizon".
//
// Real-time gravitational-lensing black hole with relativistic Doppler-beamed
// accretion disk, Einstein photon ring, optional curved spacetime grid,
// selectable visual modes (Black Hole, Quasar Jet, Solar Eclipse), two-layer
// chromatic starfield, scroll/pointer orbital parallax, and 4-slot overlapping
// click gravitational shockwaves. Uses built-in GLSL preamble helpers (`rot2`,
// `gauss`, `fbm`, `snoise`, `hash12`, `premultiply`).

import type { CustomShaderSpec } from './scene-schema';

export const EVENT_HORIZON_FRAGMENT = `
vec3 starLayer(vec2 uv, float scale, float density, float t) {
  vec2 p = uv * scale;
  vec2 id = floor(p);
  float rnd = hash12(id);
  if (rnd < density) {
    return vec3(0.0);
  }
  vec2 gv = fract(p) - 0.5;
  vec2 jitter = vec2(hash12(id + 17.3) - 0.5, hash12(id + 41.7) - 0.5) * 0.68;
  float d = length(gv - jitter);
  float twinkle = 0.65 + 0.35 * sin(t * (1.4 + rnd * 3.2) + rnd * 62.83);
  float core = (1.0 - smoothstep(0.008, 0.09, d)) * twinkle;
  float halo = exp(-d * 18.0) * 0.28 * twinkle;
  float temp = hash12(id + 93.1);
  vec3 tint = mix(vec3(0.76, 0.87, 1.0), vec3(1.0, 0.9, 0.74), temp);
  return tint * (core + halo);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 res = max(u_resolution, vec2(1.0));
  float minDim = min(res.x, res.y);
  float aspect = res.x / res.y;
  vec2 uv = (fragCoord - 0.5 * res) / minDim;

  float t = u_time;
  float ptrActive = u_pointer.z * u_pointer.w;
  vec2 ptrNorm = (u_pointer.xy - 0.5) * ptrActive;

  // Mode enum: 0 = Black Hole, 1 = Quasar Jet, 2 = Solar Eclipse.
  float isQuasar = 1.0 - step(0.5, abs(u_mode - 1.0));
  float isEclipse = step(1.5, u_mode);

  // Frame the singularity gracefully in the left third on wide displays so the
  // glowing accretion disk arcs across both gutters and behind the center feed.
  float sideBias = smoothstep(1.05, 1.75, aspect) * 0.34;
  vec2 corePos = vec2(-sideBias, 0.05) + ptrNorm * vec2(-0.085, -0.06);

  // Overlapping multi-click gravitational shockwaves (4-slot ring buffer).
  float clickWave = 0.0;
  float clickCrest = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 clk = u_clicks[i];
    if (clk.w > 0.5 && clk.z < 2.2) {
      vec2 clickPos = (clk.xy * res - 0.5 * res) / minDim;
      vec2 toClick = uv - clickPos;
      float dClick = length(toClick);
      float waveR = clk.z * 0.72;
      float decay = exp(-clk.z * 1.45);
      float ring = gauss((dClick - waveR) * 14.0) * decay;
      clickWave += ring;
      clickCrest += gauss((dClick - waveR) * 26.0) * decay;
      uv += (toClick / (dClick + 0.001)) * ring * 0.036 * u_lensing;
    }
  }

  vec2 q = uv - corePos;
  float r = length(q);
  float rs = mix(0.145, 0.168, isEclipse);

  // Einstein gravitational deflection bends background rays around the horizon.
  float lensScale = mix(1.65, 0.85, isEclipse);
  float lensStrength = (rs * rs * lensScale * u_lensing) / (r * r + 0.011);
  vec2 lensedQ = q * (1.0 - min(lensStrength, 0.88));

  // Deep-space canvas with normalized scroll-driven nebula clouds and velocity flare.
  float scrollDrift = u_scroll.x * 0.45;
  float scrollPulse = clamp(abs(u_scroll.y) * 0.42, 0.0, 0.45);
  vec2 nebulaUv = lensedQ * 1.55 + vec2(t * 0.014, -scrollDrift * 0.6);
  float nebA = fbm(nebulaUv);
  float nebB = fbm(nebulaUv * 1.75 + vec2(3.1, -2.4) + nebA * 0.6);

  vec3 darkSpace = u_bg * 0.72;
  vec3 nebula = mix(u_accent2 * 0.24, u_accent * 0.2, smoothstep(-0.35, 0.55, nebB));
  nebula *= smoothstep(-0.25, 0.7, nebA + 0.25);
  vec3 col = darkSpace + nebula * 0.65;

  // Chromatic parallax starfield warped into an Einstein ring near the horizon.
  vec2 starUvA = lensedQ + vec2(0.0, scrollDrift);
  vec2 starUvB = lensedQ * 1.45 + vec2(1.7, scrollDrift * 1.65);
  vec3 stars = starLayer(starUvA, 12.0, 0.915, t) * 0.95;
  stars += starLayer(starUvB, 22.0, 0.935, t * 1.25) * 0.55;
  float einsteinBoost = 1.0 + gauss((r - rs * 1.26) * 18.0) * 1.4 * u_lensing;
  col += stars * einsteinBoost;

  // Optional gossamer spacetime curvature grid dipping into the gravity well.
  if (u_showGrid > 0.5) {
    vec2 gridP = (lensedQ + vec2(0.0, scrollDrift * 0.85)) * 7.5;
    vec2 gridCell = abs(fract(gridP - 0.5) - 0.5);
    float line = 1.0 - smoothstep(0.0, 0.032, min(gridCell.x, gridCell.y));
    float wellMask = (1.0 - smoothstep(0.22, 1.35, r)) * smoothstep(rs * 0.95, rs * 1.35, r);
    vec3 gridCol = mix(u_accent2, u_coronaColor, exp(-r * 2.4));
    col += gridCol * line * wellMask * (0.14 + min(clickWave, 1.5) * 0.24);
  }

  // Tilted and slightly rolled disk coordinates (orbits subtly with pointer).
  float roll = -0.22 + ptrNorm.x * 0.16;
  vec2 rq = rot2(roll) * q;
  float tilt = clamp(u_diskTilt + ptrNorm.y * 0.09, 0.14, 0.82);
  vec2 dq = vec2(rq.x, rq.y / tilt);
  float rd = length(dq);

  // Relativistic Doppler beaming: approaching limb blazes hot, receding cools.
  float doppler = clamp(-dq.x / (rd + 0.14), -1.0, 1.0);
  float beam = 0.64 + 0.56 * doppler + scrollPulse * 0.18;
  vec3 hotCore = mix(u_coronaColor, vec3(1.0, 0.96, 0.88), clamp(beam * 0.52, 0.0, 0.85));

  // Radial disk profile: skip expensive spiral FBM outside the visible disk envelope.
  float innerEdge = smoothstep(rs * 1.02, rs * 1.38, rd);
  float outerFade = exp(-max(rd - rs * 1.25, 0.0) * (2.65 - scrollPulse * 0.35));
  float diskEnvelope = innerEdge * outerFade * (1.0 - isEclipse * 0.82);
  float diskMask = 0.0;
  vec3 diskColor = hotCore;
  if (diskEnvelope > 0.0005) {
    float kepler = 1.45 / (rd + 0.17) - t * (0.42 + 0.62 / (rd + 0.34));
    float diskAngle = atan(dq.y, dq.x) + kepler;
    vec2 swirlUv = vec2(cos(diskAngle), sin(diskAngle)) * (rd * 3.1) + vec2(rd * 2.4 - t * 0.16, 0.0);
    float filaments = fbm(swirlUv * (0.85 + u_turbulence * 0.55));
    float wisps = snoise(swirlUv * 2.3 + filaments * 1.15);
    float plasma = smoothstep(-0.32, 0.68, filaments * 0.72 + wisps * 0.38 + 0.28);
    diskMask = diskEnvelope * (0.35 + 0.85 * plasma);
    vec3 coolTail = mix(u_accent, u_accent2, smoothstep(0.18, 0.95, rd));
    diskColor = mix(coolTail, hotCore, clamp(outerFade * beam * 0.95, 0.0, 1.0));
  }

  // Gravitationally lensed upper and lower halo arcs (far side of disk bent over the shadow).
  float haloBand = gauss((r - rs * (1.14 + 0.18 * u_lensing)) * (9.5 - u_lensing * 2.2));
  vec3 warpedArcs = vec3(0.0);
  if (haloBand > 0.0005 && r > rs * 0.92) {
    float polarWeight = pow(abs(rq.y) / (r + 0.001), 1.35);
    float haloSwirl = 0.55 + 0.45 * fbm(vec2(atan(rq.y, rq.x) * 2.2 - t * 0.5, r * 7.5));
    float lensedHalo = haloBand * polarWeight * haloSwirl * (0.75 + 0.45 * u_lensing);
    vec3 haloColor = mix(u_accent2, hotCore, 0.55 + 0.35 * doppler);
    warpedArcs = haloColor * lensedHalo * (1.1 - isEclipse * 0.55);
  }

  // Separate front equatorial ribbon (passes IN FRONT of the black hole) from back half.
  float frontMask = smoothstep(-0.025, 0.03, -rq.y);
  float horizonShadow = smoothstep(rs * 0.92, rs * 1.045, r);

  // Compose far side + lensed halo behind the shadow, then eclipse with the event horizon.
  vec3 backDisk = diskColor * diskMask * (1.0 - frontMask) * beam * 1.15;
  col = (col + backDisk + warpedArcs) * horizonShadow;

  // Quasar mode: twin collimated relativistic polar plasma jets shooting along the spin axis.
  if (isQuasar > 0.5) {
    float jetSpread = 0.026 + abs(rq.y) * 0.085;
    float jetCore = gauss(rq.x / jetSpread) * smoothstep(rs * 0.85, rs * 1.35, abs(rq.y));
    if (jetCore > 0.0005) {
      float jetFade = exp(-abs(rq.y) * 1.65);
      float jetFlow = 0.62 + 0.38 * snoise(vec2(rq.x * 16.0, abs(rq.y) * 5.5 - t * 2.6));
      vec3 jetColor = mix(u_accent2, vec3(0.84, 0.94, 1.0), jetCore * 0.65);
      col += jetColor * jetCore * jetFade * jetFlow * 1.35;
    }
  }

  // Solar Eclipse mode: radial streaming solar corona + diamond-ring flare on the limb.
  if (isEclipse > 0.5 && r > rs * 0.9) {
    float coronaFalloff = exp(-(r - rs) * 4.8) * smoothstep(rs * 0.95, rs * 1.05, r);
    if (coronaFalloff > 0.0005) {
      float cAng = atan(rq.y, rq.x);
      float streamers = 0.55 + 0.45 * fbm(vec2(cAng * 4.5, r * 3.8 - t * 0.25));
      col += mix(u_coronaColor, vec3(1.0, 0.97, 0.9), 0.45) * coronaFalloff * streamers * 1.55;
    }
    vec2 diamondPos = vec2(rs * 1.02, rs * 0.14);
    float dFlare = length(rq - diamondPos);
    float diamond = exp(-dFlare * 28.0) * 1.6 + gauss(rq.y * 26.0) * exp(-dFlare * 6.0) * 0.55;
    col += vec3(1.0, 0.96, 0.86) * diamond;
  }

  // Razor-sharp incandescent Einstein photon ring hugging the event horizon.
  float photonRing = gauss((r - rs * 1.035) * 44.0);
  float outerChroma = gauss((r - rs * 1.1) * 20.0);
  col += mix(u_coronaColor, vec3(1.0, 0.97, 0.9), 0.65) * photonRing * (1.25 + scrollPulse * 0.4);
  col += mix(u_accent2, u_accent, 0.5) * outerChroma * 0.42;

  // Front equatorial accretion ribbon crosses cleanly in front of the black hole shadow.
  float frontGlow = diskMask * frontMask * beam;
  col += diskColor * frontGlow * 1.32;

  // Soft volumetric atmospheric glow + subtle click gravitational wave crests.
  float aura = exp(-r * 2.25) * 0.22;
  col += mix(u_accent2, u_coronaColor, 0.55) * aura;
  col += mix(u_coronaColor, u_accent2, 0.45) * min(clickCrest, 1.6) * 0.46;

  // Cinema filmic highlight roll-off (no harsh digital clipping).
  col = col / (1.0 + col * 0.52);

  // Graceful adaptation when the user flips the theme to Light polarity.
  if (u_isDark < 0.5) {
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    vec3 celestialTint = mix(u_bg, mix(u_accent, u_accent2, 0.45), clamp(lum * 0.9, 0.0, 0.72));
    col = mix(u_bg, celestialTint, 0.85);
  }

  fragColor = premultiply(col, 1.0);
}
`.trim();

export const EVENT_HORIZON_SHADER: CustomShaderSpec = {
  fragment: EVENT_HORIZON_FRAGMENT,
  renderScale: 0.6,
  fps: 24,
  fallbackColors: ['#05050a', '#2b1340'],
  params: [
    {
      key: 'mode',
      kind: 'enum',
      label: 'Cosmic mode',
      options: ['black-hole', 'quasar', 'eclipse'],
      optionLabels: {
        'black-hole': 'Black Hole',
        quasar: 'Quasar Jet',
        eclipse: 'Solar Eclipse',
      },
      defaultValue: 'black-hole',
    },
    {
      key: 'lensing',
      kind: 'number',
      label: 'Gravitational lensing',
      min: 0.2,
      max: 1.6,
      step: 0.05,
      defaultValue: 1,
    },
    {
      key: 'diskTilt',
      kind: 'number',
      label: 'Disk inclination',
      min: 0.16,
      max: 0.75,
      step: 0.02,
      defaultValue: 0.32,
    },
    {
      key: 'turbulence',
      kind: 'number',
      label: 'Plasma turbulence',
      min: 0.2,
      max: 1.5,
      step: 0.05,
      defaultValue: 0.95,
    },
    {
      key: 'coronaColor',
      kind: 'color',
      label: 'Accretion corona',
      defaultValue: '#ff9e3d',
    },
    {
      key: 'showGrid',
      kind: 'boolean',
      label: 'Spacetime grid',
      defaultValue: true,
    },
  ],
};
