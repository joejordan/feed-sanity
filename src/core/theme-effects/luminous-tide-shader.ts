// Flagship Tier 3 GLSL ES 1.00 fragment shader: "Luminous Tide".
//
// A moonlit shoreline where the surf glows with bioluminescent plankton. The
// moon shows tonight's real lunar phase (`u_moonPhase`), the sky can follow the
// viewer's clock (`u_dayPhase`), the water lights up wherever it is disturbed:
// under the pointer and along its wake (`u_pointerVel`), in rings around each
// click (`u_clicks[4]`), and across the whole surf while scrolling (`u_scroll`).
// Clicking the sky sends a shooting star. Uses the built-in preamble helpers
// (`rot2`, `gauss`, `snoise`, `hash12`, `premultiply`).

import type { CustomShaderSpec } from './scene-schema';

export const LUMINOUS_TIDE_FRAGMENT = `
float sat(float x) {
  return clamp(x, 0.0, 1.0);
}

float fbm2(vec2 p) {
  return 0.65 * snoise(p) + 0.325 * snoise(mat2(1.62, 1.18, -1.18, 1.62) * p);
}

vec3 starLayer(vec2 p, float cut, float t) {
  vec2 id = floor(p);
  float rnd = hash12(id);
  if (rnd < cut) {
    return vec3(0.0);
  }
  vec2 f = fract(p) - 0.5 - (vec2(hash12(id + 17.3), hash12(id + 41.7)) - 0.5) * 0.7;
  float d = length(f);
  float twinkle = 0.7 + 0.3 * sin(t * (1.2 + rnd * 3.0) + rnd * 62.8);
  float core = (1.0 - smoothstep(0.012, 0.09, d)) + exp(-d * 16.0) * 0.3;
  vec3 tint = mix(vec3(0.74, 0.86, 1.0), vec3(1.0, 0.9, 0.76), fract(rnd * 7.31));
  return tint * core * twinkle * (0.3 + 0.7 * fract(rnd * 13.7));
}

// Plankton flashes: one soft point per cell that blinks on its own clock.
float sparkle(vec2 p, float t) {
  vec2 id = floor(p);
  float rnd = hash12(id);
  vec2 f = fract(p) - 0.5 - (vec2(rnd, fract(rnd * 57.3)) - 0.5) * 0.6;
  float dSq = dot(f, f);
  if (dSq >= 0.04) {
    return 0.0;
  }
  float flash = max(sin(t * (1.4 + rnd * 4.0) + rnd * 40.0), 0.0);
  flash *= flash;
  flash *= flash;
  return (1.0 - smoothstep(0.0, 0.2, sqrt(dSq))) * flash * flash;
}

float meteor(vec2 p, vec2 head, vec2 dir, float len) {
  vec2 d = p - head;
  float along = clamp(dot(d, -dir), 0.0, len);
  vec2 m = d + dir * along;
  float dSq = dot(m, m);
  if (dSq > 0.001) {
    return 0.0;
  }
  return exp(-dSq * 9000.0) * (1.0 - along / len);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 res = max(u_resolution, vec2(1.0));
  float aspect = res.x / res.y;
  vec2 uv = fragCoord / res;
  float ax = (uv.x - 0.5) * aspect;
  vec2 p = vec2(ax, uv.y);
  float t = u_time;
  float grain = hash12(fragCoord);

  float live = u_pointer.z * u_pointer.w;
  vec2 ptr = u_pointer.xy;
  vec2 pan = (ptr - 0.5) * live;
  vec2 pq = p - vec2((ptr.x - 0.5) * aspect, ptr.y);
  float surge = sat(abs(u_scroll.y));
  float sw = 0.55 + 0.45 * u_swell;

  // Time of day. Enum: 0 = moonlit night, 1 = follow the clock, 2 = dusk, 3 = dawn.
  float dp = 0.0;
  if (u_sky > 2.5) {
    dp = 0.232;
  } else if (u_sky > 1.5) {
    dp = 0.772;
  } else if (u_sky > 0.5) {
    dp = u_dayPhase;
  }
  float sunH = -cos(dp * 6.2832);
  float day = smoothstep(-0.05, 0.4, sunH);
  float night = 1.0 - smoothstep(-0.4, 0.0, sunH);
  float dusk = sat(1.0 - day - night);
  float warm = smoothstep(0.4, 0.6, dp);
  float dark = night + dusk * 0.6;

  // Moon. Enum: 0 = tonight's real phase, 1 = full, 2 = crescent, 3 = new.
  float phase = u_moonPhase;
  if (u_moon > 2.5) {
    phase = 0.0;
  } else if (u_moon > 1.5) {
    phase = 0.14;
  } else if (u_moon > 0.5) {
    phase = 0.5;
  }
  float phaseCos = cos(phase * 6.2832);
  float illum = 0.5 - 0.5 * phaseCos;
  float moonVis = night + dusk * 0.55 + day * 0.16;

  // Light polarity paints the same night scene from a fixed dark base, then
  // inks it onto the page at the end, so a flipped palette never floods the sky.
  float inked = 1.0 - step(0.5, u_isDark);
  vec3 bgc = mix(u_bg, vec3(0.02, 0.05, 0.09), inked);
  vec3 sfc = mix(u_surface, vec3(0.04, 0.09, 0.15), inked);
  vec3 brd = mix(u_border, vec3(0.11, 0.21, 0.31), inked);
  vec3 txt = mix(u_text, vec3(0.91, 0.96, 0.98), inked);

  vec3 deep = bgc * 0.8;
  vec3 haze = mix(bgc, brd, 0.8);
  vec3 after = mix(mix(u_danger, u_accent2, 0.3), mix(u_danger, vec3(1.0, 0.6, 0.28), 0.55), warm);
  vec3 dayTop = mix(bgc, vec3(0.1, 0.34, 0.58), 0.8);
  vec3 dayLow = mix(sfc, vec3(0.52, 0.74, 0.86), 0.78);
  vec3 skyTop = deep * night + mix(deep, brd, 0.65) * dusk + dayTop * day;
  vec3 skyLow = haze * night + mix(haze, after, 0.75) * dusk + dayLow * day;
  vec3 moonCol = mix(txt, vec3(1.0), 0.3);
  vec3 glow = u_bloomColor;
  // A dark moon brings out the plankton, the way it does on a real beach.
  float bloomAmt = u_bloom * (night + dusk * 0.55 + day * 0.08) * (1.25 - 0.5 * illum);

  float hy = 0.57 + (u_scroll.x - 0.5) * 0.03 - pan.y * 0.012;
  float sunX = mix(0.36, -0.36, smoothstep(0.22, 0.78, dp)) * aspect;
  vec2 sunP = vec2(sunX, hy + sunH * 0.3);
  vec2 moonP = vec2(
    mix(0.16, 0.38, smoothstep(1.05, 1.75, aspect)) * aspect - pan.x * 0.012,
    0.84 - pan.y * 0.008
  );
  float mr = 0.05;

  vec3 col;
  float sy = (uv.y - hy) / (1.0 - hy);
  if (sy >= 0.0) {
    float hz = 1.0 - sy;
    hz *= hz * hz;
    col = mix(skyTop, skyLow, 0.3 * (1.0 - sy) + 0.7 * hz);

    if (dusk > 0.001 || day > 0.001) {
      float sd = length(p - sunP);
      col += after * exp(-sd * 2.4) * dusk * 0.85;
      col += vec3(1.0, 0.95, 0.85) * (gauss(sd * 16.0) + exp(-sd * 4.5) * 0.35) * day;
    }

    vec2 mq = p - moonP;
    float md = length(mq);
    float disc = 1.0 - smoothstep(mr * 0.94, mr, md);

    float starAmt = (night + dusk * 0.3) * u_stars * (1.0 - illum * 0.4);
    if (starAmt > 0.01) {
      vec2 sp = p + vec2(pan.x * 0.02 + t * 0.0012, 0.0);
      float band = gauss(((sp.y - 0.8) * 0.9 + sp.x * 0.4) * 3.4);
      float ext = smoothstep(0.0, 0.22, sy) * (1.0 - disc) * starAmt;
      vec3 stars = starLayer(sp * 26.0, 0.93 - band * 0.06, t);
      stars += starLayer(sp * 47.0 + 7.3, 0.95 - band * 0.07, t * 1.3) * 0.6;
      if (dot(stars, vec3(1.0)) > 0.0) {
        float nearPtr = live > 0.001 ? 1.0 + 1.6 * live * exp(-dot(pq, pq) * 40.0) : 1.0;
        col += stars * ext * nearPtr;
      }
      if (band > 0.03 && ext > 0.005) {
        float mw = band * (0.4 + 0.6 * fbm2(sp * 2.4 + vec2(4.0, 1.5)));
        col += mix(txt, u_accent2, 0.4) * sat(mw) * 0.16 * ext;
      }
    }

    if (u_aurora > 0.5 && night > 0.02) {
      float wob = snoise(vec2(ax * 0.9 + t * 0.02, t * 0.015));
      float curtain = gauss((sy - 0.34 - wob * 0.12) * 4.2);
      if (curtain > 0.01) {
        float rays = 0.55 + 0.45 * snoise(vec2(ax * 7.0 + wob * 2.0, sy * 1.2 - t * 0.05));
        float fold = 0.5 + 0.5 * sin(ax * 3.0 + wob * 4.0 + t * 0.07);
        float side = 0.55 + 0.45 * (1.0 - smoothstep(-0.6, 0.4, ax));
        vec3 ac = mix(u_accent2, u_accent, sat(sy * 1.6 - 0.2));
        col += ac * curtain * rays * (0.35 + 0.65 * fold) * side * 0.2 * night;
      }
    }

    // Sky clicks send shooting stars when enabled; periodic meteors share the same tint.
    if (u_meteors > 0.5) {
      float streak = 0.0;
      if (u_click.w > 0.5 && u_click.z < 1.1) {
        for (int i = 0; i < 4; i++) {
          vec4 clk = u_clicks[i];
          if (clk.w > 0.5 && clk.z < 1.1 && clk.y >= hy) {
            vec2 cq = p - vec2((clk.x - 0.5) * aspect, clk.y);
            vec2 dir = vec2(clk.x < 0.5 ? 0.8645 : -0.8645, -0.5026);
            streak += meteor(cq, dir * clk.z * 0.42, dir, 0.16) * (1.1 - clk.z);
            float cqSq = dot(cq, cq);
            if (cqSq < 0.01) {
              streak += exp(-cqSq * 900.0 - clk.z * 6.0);
            }
          }
        }
      }
      if (night > 0.02) {
        float cyc = t / 11.0;
        float seed = floor(cyc);
        float age = fract(cyc) * 11.0;
        if (age < 1.0) {
          float rx = hash12(vec2(seed, 3.1));
          vec2 dir = vec2(rx < 0.5 ? 0.8986 : -0.8986, -0.4388);
          vec2 head = vec2((rx - 0.5) * aspect * 0.9, 0.8 + 0.17 * hash12(vec2(seed, 8.7)));
          streak += meteor(p, head + dir * age * 0.5, dir, 0.15) * sin(age * 3.1416) * night;
        }
      }
      if (streak > 0.001) {
        col += vec3(0.85, 0.94, 1.0) * streak;
      }
    }

    if (illum > 0.001) {
      col += moonCol * (exp(-md * 10.0) * 0.2 + exp(-md * 3.2) * 0.05) * illum * moonVis;
    }
    if (disc > 0.0) {
      vec2 n = rot2(-0.45) * mq / mr;
      float limb = sqrt(max(1.0 - n.y * n.y, 0.0));
      float lit = smoothstep(-0.08, 0.08, (phase < 0.5 ? n.x : -n.x) - phaseCos * limb * 1.1);
      float tex = 0.84 + 0.16 * snoise(n * 2.3 + 3.7);
      float shade = 0.7 + 0.3 * sqrt(max(1.0 - dot(n, n), 0.0));
      col += moonCol * disc * tex * shade * (lit * 1.5 + 0.05 * night) * moonVis;
    }

    // Distant headland on the left horizon.
    if (uv.y - hy < 0.08) {
      float lx = ax + aspect * 0.36;
      float ridge = gauss(lx * 2.4) * (0.05 + 0.006 * sin(ax * 47.0) + 0.004 * sin(ax * 113.0));
      ridge += 0.02 * gauss((lx - 0.26) * 5.0);
      float land = 1.0 - smoothstep(ridge - 0.0025, ridge, uv.y - hy);
      col = mix(col, mix(bgc * 0.45, skyLow, 0.22 + 0.2 * day), land);
    }
  } else {
    // Shoreline: compute first so dry sand skips the ocean swell & reflection pass.
    float foam = 0.0;
    float beach = 0.0;
    float wet = 0.0;
    if (uv.y < 0.42) {
      float wt = t * 0.42 * sw;
      float wash = 0.115 + 0.05 * sin(ax * 1.15 + 0.6) + 0.018 * sin(ax * 3.7 + 2.0);
      wash += (0.026 + 0.02 * surge) * u_swell * (0.6 * sin(wt + ax * 0.9) + 0.4 * sin(wt * 0.53 + ax * 2.3 + 1.0));
      wash += 0.01 * snoise(vec2(ax * 5.0, t * 0.12));
      float e = uv.y - wash;
      foam = exp(-abs(e) * 150.0) + exp(-abs(e) * (e > 0.0 ? 34.0 : 70.0)) * 0.3;
      foam += exp(-abs(e + 0.022 + 0.012 * sin(wt * 0.5 + ax * 1.7)) * 240.0) * 0.22;
      beach = 1.0 - smoothstep(-0.004, 0.0, e);
      wet = exp(min(e, 0.0) * 24.0);
    }

    // Water disturbance from clicks and pointer wake (skipped on dry sand).
    float agit = 0.0;
    if (beach < 0.999 || wet > 0.002) {
      if (u_click.w > 0.5 && u_click.z < 3.0) {
        for (int i = 0; i < 4; i++) {
          vec4 clk = u_clicks[i];
          if (clk.w > 0.5 && clk.z < 3.0 && clk.y < hy) {
            vec2 cq = (p - vec2((clk.x - 0.5) * aspect, clk.y)) * vec2(1.0, 2.6);
            float cs = 0.45 + 2.4 * (hy - clk.y);
            float cw = 0.012 * cs;
            float cr = clk.z * 0.2 * cs;
            float rMax = max(cr + cw * 3.2, cw * 6.8);
            float cdSq = dot(cq, cq);
            if (cdSq < rMax * rMax) {
              float cd = sqrt(cdSq);
              agit += (gauss((cd - cr) / cw) + 0.5 * gauss((cd - cr * 0.55) / cw)) * exp(-clk.z * 1.25);
              if (clk.z < 1.8) {
                float cdN = cd / cw;
                agit += exp(-cdN * cdN / 6.0 - clk.z * 5.0);
              }
            }
          }
        }
      }
      if (live > 0.001 && ptr.y < hy + 0.02) {
        vec2 squash = vec2(1.0, 2.4);
        vec2 pqS = pq * squash;
        vec2 tail = u_pointerVel * vec2(aspect, 1.0) * 0.09 * squash;
        float tl = dot(tail, tail);
        float along = tl > 0.0001 ? sat(dot(pqS, -tail) / tl) : 0.0;
        vec2 wv = pqS + tail * along;
        float wdSq = dot(wv, wv);
        float rad = 0.03 + 0.15 * max(hy - ptr.y, 0.0);
        float radSq = rad * rad;
        if (wdSq < radSq * 9.0) {
          float onSea = 1.0 - smoothstep(hy - 0.02, hy + 0.02, ptr.y);
          agit += exp(-wdSq / radSq) * (0.2 + min(sqrt(tl) * 8.0, 1.0) * (1.0 - 0.55 * along)) * live * onSea;
        }
      }
    }

    vec3 lume = mix(glow, vec3(1.0), 0.15);
    vec3 ripple = mix(vec3(0.4, 0.45, 0.5), lume, sat(bloomAmt));
    float plankton = 0.0;
    col = vec3(0.0);

    if (beach < 0.999 || foam > 0.002) {
      float d = hy - uv.y;
      float lz = log(0.2 / (d + 0.012));
      plankton = smoothstep(-0.4, 0.5, snoise(vec2(ax * 0.9 + 3.0, lz * 0.9 - t * 0.02)));

      if (beach < 0.999) {
        float detail = smoothstep(0.012, 0.09, d);
        float fres = exp(-d * (9.0 - 5.0 * dusk));

        col = mix(mix(deep * 0.72, dayTop * 0.5, day), skyLow, fres * 0.75);
        if (dusk > 0.001) {
          col += after * exp(-abs(ax - sunX) * 1.6) * fres * dusk * 0.4;
        }

        // Swell fronts. Log-depth spacing packs them toward the horizon the way
        // perspective does, and every front carries its own lit and dark stretches.
        float warp = snoise(vec2(ax * 1.3, lz * 1.4 + t * 0.03));
        float k = (lz * 15.0 + ax * 0.9 + warp * 1.5 + t * 0.5 * sw) / 6.2832;
        float idx = floor(k);
        float s = fract(k);
        float front = exp(-s * (10.5 - 3.5 * u_swell)) * smoothstep(0.0, 0.04, s);
        float rip = 0.5 + 0.5 * sin(lz * 58.0 + ax * 7.0 + warp * 5.0 + t * 1.6);
        rip *= 0.5 + 0.5 * sin(lz * 31.0 - ax * 11.0 + warp * 3.0 - t * 1.1);
        float glint = mix(0.3, smoothstep(0.15, 0.85, rip), detail);

        float mwd = 0.02 + d * 0.5;
        if (illum > 0.001) {
          col += moonCol * gauss((ax - moonP.x) / mwd) * (0.15 + 0.85 * glint) * illum * moonVis * 0.6;
        }
        float sunRefl = (day * 0.6 + dusk * 0.45) * sat(1.0 + sunH * 3.0);
        if (sunRefl > 0.001) {
          vec3 sunCol = mix(after, vec3(1.0, 0.95, 0.85), day);
          col += sunCol * gauss((ax - sunX) / mwd) * (0.15 + 0.85 * glint) * sunRefl;
        }
        col += skyLow * glint * detail * 0.1;

        if (bloomAmt > 0.001) {
          float lit = front > 0.004
            ? smoothstep(-0.25, 0.55, snoise(vec2(ax * 1.7 + idx * 7.3, idx * 3.1 + t * 0.06)))
            : 0.0;
          float bio = front * lit * (0.35 + 0.65 * plankton) * (1.0 + surge * 0.9) * (0.35 + 0.65 * detail);
          float spk = detail > 0.001
            ? sparkle(vec2(ax, d * 2.2) * 46.0 * exp2(floor(lz * 1.4427 + 0.5)), t) * detail
            : 0.0;
          col += mix(glow, vec3(1.0), front * front * 0.3) * bio * bloomAmt * 1.1;
          col += glow * plankton * 0.035 * bloomAmt;
          col += lume * spk * (bio * 1.6 + agit * 2.0 + 0.05 + plankton * 0.05) * bloomAmt;
        }
        if (agit > 0.001) {
          col += ripple * agit * (0.35 + 0.65 * plankton) * (0.3 + 0.7 * dark);
        }
      }
    }

    if (beach > 0.0) {
      vec3 sand = mix(bgc * 0.6, sfc, 0.3) * (0.9 + 0.2 * grain) + dayLow * day * 0.16;
      sand = mix(sand, sand * 0.6 + skyLow * 0.2, wet);
      if (wet > 0.002) {
        if (bloomAmt > 0.001) {
          sand += lume * sparkle(p * 80.0, t * 0.6) * wet * bloomAmt * 0.9;
        }
        if (agit > 0.001) {
          sand += ripple * agit * 0.4 * wet;
        }
      }
      col = mix(col, sand, beach);
    }
    if (foam > 0.002) {
      vec3 foamCol = mix(vec3(0.75, 0.85, 0.9) * (0.25 + 0.5 * day), lume, sat(bloomAmt));
      col += foamCol * foam * (0.5 + 0.5 * plankton);
    }
  }

  // Roll off highlights on the brightest channel so the glow keeps its hue.
  col /= 1.0 + max(col.r, max(col.g, col.b)) * 0.45;

  if (inked > 0.5) {
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(u_bg, mix(u_accent, u_accent2, 0.4), sat(lum * 1.5) * 0.7);
  }

  // Half-step dither keeps the dark sky gradient from banding.
  col += (grain - 0.5) / 255.0;
  fragColor = premultiply(col, 1.0);
}
`.trim();

export const LUMINOUS_TIDE_SHADER: CustomShaderSpec = {
  fragment: LUMINOUS_TIDE_FRAGMENT,
  renderScale: 0.5,
  fps: 30,
  fallbackColors: ['#050d18', '#0d2b40'],
  params: [
    {
      key: 'sky',
      kind: 'enum',
      label: 'Time of day',
      options: ['night', 'clock', 'dusk', 'dawn'],
      optionLabels: {
        night: 'Moonlit night',
        clock: 'Follow my clock',
        dusk: 'Afterglow dusk',
        dawn: 'First light',
      },
      defaultValue: 'night',
    },
    {
      key: 'moon',
      kind: 'enum',
      label: 'Moon',
      options: ['real', 'full', 'crescent', 'new'],
      optionLabels: {
        real: "Tonight's real phase",
        full: 'Full moon',
        crescent: 'Crescent',
        new: 'New moon (darkest)',
      },
      defaultValue: 'real',
    },
    {
      key: 'swell',
      kind: 'number',
      label: 'Tide swell',
      min: 0.3,
      max: 1.6,
      step: 0.05,
      defaultValue: 1,
    },
    {
      key: 'bloom',
      kind: 'number',
      label: 'Bioluminescence',
      min: 0,
      max: 1.6,
      step: 0.05,
      defaultValue: 1,
    },
    {
      key: 'stars',
      kind: 'number',
      label: 'Starlight',
      min: 0,
      max: 1.6,
      step: 0.05,
      defaultValue: 1,
    },
    {
      key: 'bloomColor',
      kind: 'color',
      label: 'Plankton glow',
      defaultValue: '#45d8ff',
    },
    {
      key: 'aurora',
      kind: 'boolean',
      label: 'Aurora veil',
      defaultValue: true,
    },
    {
      key: 'meteors',
      kind: 'boolean',
      label: 'Shooting stars',
      defaultValue: false,
    },
  ],
};
