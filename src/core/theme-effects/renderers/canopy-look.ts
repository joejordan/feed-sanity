// Colour and light for the Jungle Canopy backdrop: a time-of-day "mood" (where
// the light comes from, how warm it is, pollen or fireflies) resolved against the
// active theme palette into the handful of colours both renderers paint with.

import type { CanopyTime } from '../param-specs';
import type { Rgb, ScenePalette } from './palette';
import { SUNLIGHT } from '../../theming/color';
import { clamp, lerp } from '../digital-rain/math';
import { BLACK, hexRgb, mixRgb, rgbKey, WHITE } from './palette';

type FixedCanopyTime = Exclude<CanopyTime, 'clock'>;

export interface CanopyMood {
  /** Amber shift of the light and haze (`0..1`). */
  readonly warm: number;
  /** Moonlit blue shift (`0..1`). */
  readonly cool: number;
  /** Strength of the light shafts and the glow of the clearing. */
  readonly light: number;
  /** Light source across the viewport (`0` = left edge, `1` = right edge). */
  readonly sunX: number;
  /** Light source height in viewport heights (`1` = top edge). */
  readonly sunY: number;
  /** `0` = steady pollen glinting in the light, `1` = blinking fireflies. */
  readonly fireflies: number;
  /** Mote density multiplier. */
  readonly motes: number;
  /** Mist density multiplier. */
  readonly mist: number;
}

const MOODS: Readonly<Record<FixedCanopyTime, CanopyMood>> = {
  dawn: {
    warm: 0.28,
    cool: 0.3,
    light: 0.72,
    sunX: 0.36,
    sunY: 1.14,
    fireflies: 0,
    motes: 0.45,
    mist: 1.6,
  },
  morning: {
    warm: 0.12,
    cool: 0,
    light: 1,
    sunX: 0.3,
    sunY: 1.28,
    fireflies: 0,
    motes: 0.75,
    mist: 1,
  },
  golden: {
    warm: 1,
    cool: 0,
    light: 1.1,
    sunX: 0.14,
    sunY: 1.06,
    fireflies: 0.12,
    motes: 0.9,
    mist: 0.85,
  },
  dusk: {
    warm: 0.3,
    cool: 0.62,
    light: 0.42,
    sunX: 0.2,
    sunY: 1.1,
    fireflies: 1,
    motes: 1.3,
    mist: 1.1,
  },
  night: {
    warm: 0,
    cool: 1,
    light: 0.55,
    sunX: 0.68,
    sunY: 1.3,
    fireflies: 1,
    motes: 1,
    mist: 0.9,
  },
};

/** The jungle's day, as fractions of the local day (`0` = midnight, `0.5` = noon). */
const CLOCK_STOPS: ReadonlyArray<readonly [phase: number, time: FixedCanopyTime]> = [
  [0, 'night'],
  [0.2, 'night'],
  [0.26, 'dawn'],
  [0.34, 'morning'],
  [0.62, 'morning'],
  [0.73, 'golden'],
  [0.8, 'dusk'],
  [0.9, 'night'],
  [1, 'night'],
];

function mixMood(a: CanopyMood, b: CanopyMood, t: number): CanopyMood {
  return {
    warm: lerp(a.warm, b.warm, t),
    cool: lerp(a.cool, b.cool, t),
    light: lerp(a.light, b.light, t),
    sunX: lerp(a.sunX, b.sunX, t),
    sunY: lerp(a.sunY, b.sunY, t),
    fireflies: lerp(a.fireflies, b.fireflies, t),
    motes: lerp(a.motes, b.motes, t),
    mist: lerp(a.mist, b.mist, t),
  };
}

/**
 * The mood for a "Time of day" setting. `clock` follows `dayPhase` (the fraction
 * of the viewer's local day that has passed) through dawn mist, morning sun,
 * golden hour, firefly dusk, and moonlit night.
 */
export function canopyMoodAt(time: CanopyTime, dayPhase: number): CanopyMood {
  if (time !== 'clock') {
    return MOODS[time];
  }
  const phase = Number.isFinite(dayPhase) ? dayPhase - Math.floor(dayPhase) : 0;
  for (let i = 1; i < CLOCK_STOPS.length; i++) {
    const [end, endTime] = CLOCK_STOPS[i] ?? [1, 'night'];
    if (phase <= end) {
      const [start, startTime] = CLOCK_STOPS[i - 1] ?? [0, 'night'];
      const span = end - start;
      return mixMood(MOODS[startTime], MOODS[endTime], span > 0 ? (phase - start) / span : 0);
    }
  }
  return MOODS.night;
}

export interface CanopyLook {
  /** Forest-floor shadow, the darkest tone in a dark scene (the page tone in a light one). */
  readonly deep: Rgb;
  /** Mist and the far clearing. */
  readonly haze: Rgb;
  /** Closest leaves in shade. */
  readonly leafNear: Rgb;
  /** Closest leaves with light coming through them. */
  readonly leafLit: Rgb;
  /** Hazy leaves one layer back. */
  readonly leafMid: Rgb;
  /** Light shafts and rim light. */
  readonly light: Rgb;
  /** Pollen or fireflies. */
  readonly mote: Rgb;
  readonly mood: CanopyMood;
  /** True when painting onto a light page. */
  readonly inked: boolean;
  /** Changes only when a colour changes, so cached sprites know when to repaint. */
  readonly key: string;
}

interface CanopyBase {
  readonly background: Rgb;
  readonly accent: Rgb;
  readonly alt: Rgb;
}

/** Signature rainforest colours used while the site keeps its own palette. */
const SIGNATURE: Readonly<Record<'dark' | 'light', CanopyBase>> = {
  dark: {
    background: hexRgb('#06120c'),
    accent: hexRgb('#4be38a'),
    alt: hexRgb(SUNLIGHT.dark),
  },
  light: {
    background: hexRgb('#eaf1e8'),
    accent: hexRgb('#15803d'),
    alt: hexRgb(SUNLIGHT.light),
  },
};

function canopyBase(palette: ScenePalette): CanopyBase {
  const signature = SIGNATURE[palette.scheme];
  if (palette.native) {
    return signature;
  }
  // Without a secondary accent `alt` is the palette's danger red, which makes poor sunlight.
  const alt = palette.hasSecondary ? palette.alt : signature.alt;
  return { background: palette.background, accent: palette.accent, alt };
}

const AMBER = hexRgb('#ff9a3c');
const MOONLIGHT = hexRgb('#a9c4ff');
const NIGHT_SHADE = hexRgb('#050d1a');
const NIGHT_HAZE = hexRgb('#1d3550');

/** Resolves the colours of the scene for `palette` under `mood`. */
export function resolveCanopyLook(palette: ScenePalette, mood: CanopyMood): CanopyLook {
  const inked = palette.scheme === 'light';
  const base = canopyBase(palette);
  const warm = clamp(mood.warm, 0, 1);
  const cool = clamp(mood.cool, 0, 1);
  const leaf = mixRgb(base.accent, base.alt, 0.22 + warm * 0.3);
  const sunlight = mixRgb(mixRgb(base.alt, WHITE, 0.42), AMBER, warm * 0.5);

  let deep: Rgb;
  let haze: Rgb;
  let leafNear: Rgb;
  let leafLit: Rgb;
  let leafMid: Rgb;
  let light: Rgb;
  let mote: Rgb;
  if (inked) {
    // A pale watercolour wash: every tone stays close to the page so dark text
    // sitting directly on the backdrop keeps its contrast.
    deep = base.background;
    haze = mixRgb(mixRgb(base.background, WHITE, 0.6), AMBER, warm * 0.08);
    leafNear = mixRgb(base.background, base.accent, 0.3);
    leafLit = mixRgb(base.background, leaf, 0.16);
    leafMid = mixRgb(base.background, base.accent, 0.15);
    light = mixRgb(mixRgb(sunlight, WHITE, 0.55), MOONLIGHT, cool * 0.5);
    mote = mixRgb(mixRgb(base.alt, base.accent, mood.fireflies * 0.5), base.background, 0.1);
  } else {
    deep = mixRgb(mixRgb(base.background, BLACK, 0.2), NIGHT_SHADE, cool * 0.5);
    haze = mixRgb(
      mixRgb(mixRgb(base.background, base.accent, 0.24), AMBER, warm * 0.2),
      NIGHT_HAZE,
      cool * 0.55,
    );
    leafNear = mixRgb(deep, base.accent, 0.11);
    leafLit = mixRgb(mixRgb(leaf, base.background, 0.42), NIGHT_HAZE, cool * 0.4);
    leafMid = mixRgb(mixRgb(deep, base.accent, 0.2), haze, 0.3);
    light = mixRgb(sunlight, MOONLIGHT, cool * 0.78);
    const pollen = mixRgb(sunlight, WHITE, 0.4);
    const firefly = mixRgb(mixRgb(base.accent, base.alt, 0.55), WHITE, 0.22);
    mote = mixRgb(pollen, firefly, clamp(mood.fireflies, 0, 1));
  }

  return {
    deep,
    haze,
    leafNear,
    leafLit,
    leafMid,
    light,
    mote,
    mood,
    inked,
    key: rgbKey([deep, haze, leafNear, leafLit, leafMid, light, mote]),
  };
}
