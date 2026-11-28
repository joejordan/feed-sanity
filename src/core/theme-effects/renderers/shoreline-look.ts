// Colour and lighting moods for the Coral Shoreline backdrop: an aerial
// tropical island cove whose sun angle, water clarity, wet-sand gloss, and
// caustic brilliance shift across sunrise, sunlit lagoon, mango sunset, and
// moonlit cove (or follow the viewer's own clock), while harmonising with
// whichever light or dark theme palette is active.

import type { ShorelineTime } from '../param-specs';
import type { Rgb, ScenePalette } from './palette';
import { clamp, lerp } from '../digital-rain/math';
import { BLACK, hexRgb, mixRgb, rgbKey, WHITE } from './palette';

type FixedShorelineTime = Exclude<ShorelineTime, 'clock'>;

export interface ShorelineMood {
  /** Warm amber/rose shift of sunlight and wet-sand reflection (`0..1`). */
  readonly warm: number;
  /** Nocturnal indigo/moonlit shift (`0..1`). */
  readonly cool: number;
  /** Caustic brightness multiplier. */
  readonly causticGain: number;
  /** Specular glitter intensity on water crests and wet sand. */
  readonly sparkle: number;
  /** Horizontal offset of cast underwater & palm shadows (sun direction X). */
  readonly sunDirX: number;
  /** Vertical offset of cast underwater & palm shadows (sun direction Y). */
  readonly sunDirY: number;
  /** Subtle palm shadow strength (`0..1`). */
  readonly shadowDepth: number;
}

const MOODS: Readonly<Record<FixedShorelineTime, ShorelineMood>> = {
  sunrise: {
    warm: 0.62,
    cool: 0.14,
    causticGain: 0.88,
    sparkle: 0.85,
    sunDirX: 0.045,
    sunDirY: -0.025,
    shadowDepth: 0.78,
  },
  noon: {
    warm: 0.08,
    cool: 0,
    causticGain: 1.15,
    sparkle: 1,
    sunDirX: 0.026,
    sunDirY: -0.032,
    shadowDepth: 0.9,
  },
  sunset: {
    warm: 1,
    cool: 0.18,
    causticGain: 0.94,
    sparkle: 1.15,
    sunDirX: -0.042,
    sunDirY: -0.038,
    shadowDepth: 0.84,
  },
  moonlit: {
    warm: 0,
    cool: 1,
    causticGain: 0.72,
    sparkle: 0.78,
    sunDirX: 0.032,
    sunDirY: -0.028,
    shadowDepth: 0.65,
  },
};

/** Coastal day cycle as fractions of the local day (`0` = midnight, `0.5` = noon). */
const CLOCK_STOPS: ReadonlyArray<readonly [phase: number, time: FixedShorelineTime]> = [
  [0, 'moonlit'],
  [0.2, 'moonlit'],
  [0.29, 'sunrise'],
  [0.39, 'noon'],
  [0.66, 'noon'],
  [0.77, 'sunset'],
  [0.87, 'moonlit'],
  [1, 'moonlit'],
];

function mixMood(a: ShorelineMood, b: ShorelineMood, t: number): ShorelineMood {
  if (t <= 0) {
    return a;
  }
  if (t >= 1) {
    return b;
  }
  return {
    warm: lerp(a.warm, b.warm, t),
    cool: lerp(a.cool, b.cool, t),
    causticGain: lerp(a.causticGain, b.causticGain, t),
    sparkle: lerp(a.sparkle, b.sparkle, t),
    sunDirX: lerp(a.sunDirX, b.sunDirX, t),
    sunDirY: lerp(a.sunDirY, b.sunDirY, t),
    shadowDepth: lerp(a.shadowDepth, b.shadowDepth, t),
  };
}

/**
 * Resolves the lighting mood for `time`. `'clock'` interpolates smoothly across
 * `dayPhase` (`0..1`, local midnight to midnight) with no sudden jumps.
 */
export function shorelineMoodAt(time: ShorelineTime, dayPhase: number): ShorelineMood {
  if (time !== 'clock') {
    return MOODS[time];
  }
  const phase = Number.isFinite(dayPhase) ? dayPhase - Math.floor(dayPhase) : 0;
  for (let i = 1; i < CLOCK_STOPS.length; i++) {
    const [end, endTime] = CLOCK_STOPS[i] ?? [1, 'moonlit'];
    if (phase <= end) {
      const [start, startTime] = CLOCK_STOPS[i - 1] ?? [0, 'moonlit'];
      const span = end - start;
      return mixMood(MOODS[startTime], MOODS[endTime], span > 0 ? (phase - start) / span : 0);
    }
  }
  return MOODS.moonlit;
}

export interface ShorelineLook {
  /** Sun-warmed dry coral sand. */
  readonly sandDry: Rgb;
  /** Darkened, sky-reflecting wet sand behind each receding wave. */
  readonly sandWet: Rgb;
  /** Crystal-clear ankle-deep aquamarine shallows. */
  readonly waterShallow: Rgb;
  /** Luminous Caribbean turquoise mid-lagoon. */
  readonly waterMid: Rgb;
  /** Deep reef cerulean/indigo drop-off. */
  readonly waterDeep: Rgb;
  /** Refracted sunlight caustic web on the seabed. */
  readonly caustic: Rgb;
  /** Lacy seafoam crest and bubble ribbons. */
  readonly foam: Rgb;
  /** Coral reef heads, sea stars, and warm shell tint. */
  readonly coral: Rgb;
  /** Soft translucent shadow cast by overhanging coconut palms. */
  readonly palmShadow: Rgb;
  /** Sky/sun specular highlight tint on wet sand and wave ripples. */
  readonly skySpec: Rgb;
  readonly mood: ShorelineMood;
  /** True when painting onto a light page so text directly over the shore stays legible. */
  readonly lightMode: boolean;
  /** Stable key so cached Canvas 2D sprites repaint only when colours change. */
  readonly key: string;
}

interface ShorelineBase {
  readonly background: Rgb;
  readonly accent: Rgb;
  readonly sand: Rgb;
  readonly coral: Rgb;
}

const SIGNATURE_LIGHT: ShorelineBase = {
  background: hexRgb('#eaf7f5'),
  accent: hexRgb('#077685'),
  sand: hexRgb('#f2e6cf'),
  coral: hexRgb('#e26d5a'),
};

const SIGNATURE_DARK: ShorelineBase = {
  background: hexRgb('#06151c'),
  accent: hexRgb('#2dd4bf'),
  sand: hexRgb('#232b2d'),
  coral: hexRgb('#f08275'),
};

const TURQUOISE_LIGHT = hexRgb('#1fc7c8');
const SHALLOW_MINT = hexRgb('#8ef0e6');
const DEEP_CERULEAN = hexRgb('#0a7e9e');
const SUNSET_PEACH = hexRgb('#ff9b5e');
const SUNSET_ROSE = hexRgb('#f27280');
const SUNRISE_ROSE = hexRgb('#ffc8b8');
const MOON_BLUE = hexRgb('#7eb8e8');
const NIGHT_WATER = hexRgb('#072235');
const NIGHT_DEEP = hexRgb('#04101c');
const NIGHT_SAND = hexRgb('#131e26');
const WARM_SAND_LIGHT = hexRgb('#f6ecda');
const WARM_SAND_WET = hexRgb('#dfd0b6');
const DARK_SAND_FALLBACK = hexRgb('#c7a474');
const DARK_SAND_WET = hexRgb('#0c1b24');
const SUNSET_DEEP_PLUM = hexRgb('#6e487a');
const MOON_DEEP_NAVY = hexRgb('#1b456d');
const SUNLIT_CAUSTIC_GOLD = hexRgb('#fff4c4');
const MOON_CAUSTIC_ICE = hexRgb('#d6efff');
const DUSK_PALM_SLATE = hexRgb('#2a3656');
const DARK_SUNSET_SAND = hexRgb('#442f28');
const DARK_SUNSET_WET = hexRgb('#311f24');
const DARK_SUNSET_SHALLOW = hexRgb('#523230');
const DARK_SUNSET_MID = hexRgb('#3c2444');

function shorelineBase(palette: ScenePalette): ShorelineBase {
  const sig = palette.scheme === 'light' ? SIGNATURE_LIGHT : SIGNATURE_DARK;
  if (palette.native) {
    return sig;
  }
  let sand: Rgb;
  if (palette.scheme === 'light') {
    sand = mixRgb(WARM_SAND_LIGHT, palette.background, 0.36);
  } else {
    const sandTint = palette.hasSecondary ? palette.alt : DARK_SAND_FALLBACK;
    sand = mixRgb(palette.background, sandTint, 0.14);
  }
  const coral = palette.hasSecondary ? mixRgb(palette.alt, palette.danger, 0.45) : palette.danger;
  return {
    background: palette.background,
    accent: palette.accent,
    sand,
    coral,
  };
}

/** Resolves all shoreline colours from `palette` and `mood`, keeping text polarity safe. */
export function resolveShorelineLook(palette: ScenePalette, mood: ShorelineMood): ShorelineLook {
  const lightMode = palette.scheme === 'light';
  const base = shorelineBase(palette);
  const warm = clamp(mood.warm, 0, 1);
  const cool = clamp(mood.cool, 0, 1);

  let sandDry: Rgb;
  let sandWet: Rgb;
  let waterShallow: Rgb;
  let waterMid: Rgb;
  let waterDeep: Rgb;
  let caustic: Rgb;
  let foam: Rgb;
  let coral: Rgb;
  let palmShadow: Rgb;
  let skySpec: Rgb;

  if (lightMode) {
    // Daylight island paradise: airy warm coral sand and luminous Caribbean
    // turquoise shallows kept bright enough that dark host text stays sharp.
    const warmGlow = mixRgb(SUNRISE_ROSE, SUNSET_PEACH, warm);
    const coolSand = mixRgb(base.background, MOON_BLUE, 0.24);
    sandDry = mixRgb(
      mixRgb(mixRgb(WARM_SAND_LIGHT, base.sand, 0.42), warmGlow, warm * 0.42),
      coolSand,
      cool * 0.52,
    );
    sandWet = mixRgb(
      mixRgb(
        mixRgb(WARM_SAND_WET, base.background, 0.22),
        mixRgb(SUNSET_PEACH, SUNSET_ROSE, 0.35),
        warm * 0.48,
      ),
      mixRgb(base.background, DEEP_CERULEAN, 0.32),
      cool * 0.48,
    );
    const vividLagoon = mixRgb(TURQUOISE_LIGHT, base.accent, 0.24);
    waterShallow = mixRgb(
      mixRgb(mixRgb(SHALLOW_MINT, base.background, 0.2), warmGlow, warm * 0.38),
      mixRgb(base.background, MOON_BLUE, 0.36),
      cool * 0.46,
    );
    waterMid = mixRgb(
      mixRgb(
        mixRgb(vividLagoon, base.background, 0.12),
        mixRgb(SUNSET_PEACH, SUNSET_ROSE, 0.4),
        warm * 0.46,
      ),
      mixRgb(base.background, DEEP_CERULEAN, 0.48),
      cool * 0.48,
    );
    waterDeep = mixRgb(
      mixRgb(mixRgb(DEEP_CERULEAN, base.accent, 0.32), SUNSET_DEEP_PLUM, warm * 0.44),
      mixRgb(base.background, MOON_DEEP_NAVY, 0.66),
      cool * 0.48,
    );
    caustic = mixRgb(mixRgb(WHITE, SUNLIT_CAUSTIC_GOLD, 0.5 + warm * 0.45), MOON_CAUSTIC_ICE, cool);
    foam = mixRgb(WHITE, mixRgb(SUNRISE_ROSE, MOON_BLUE, cool), warm * 0.28 + cool * 0.16);
    coral = mixRgb(mixRgb(base.coral, WARM_SAND_WET, 0.38), SUNSET_PEACH, warm * 0.3);
    palmShadow = mixRgb(
      mixRgb(DEEP_CERULEAN, base.accent, 0.35),
      DUSK_PALM_SLATE,
      cool * 0.5 + warm * 0.28,
    );
    skySpec = mixRgb(
      mixRgb(WHITE, mixRgb(SUNSET_PEACH, SUNSET_ROSE, 0.3), warm * 0.85),
      MOON_BLUE,
      cool * 0.78,
    );
  } else {
    // Nocturnal / dark-theme cove: deep tranquil lagoon & damp coral sand with
    // glowing turquoise caustics and silver-pearlescent surf lace so light text pops.
    sandDry = mixRgb(
      mixRgb(base.sand, DARK_SUNSET_SAND, warm * 0.55),
      mixRgb(NIGHT_SAND, base.background, 0.45),
      cool * 0.55,
    );
    sandWet = mixRgb(mixRgb(DARK_SAND_WET, base.background, 0.5), DARK_SUNSET_WET, warm * 0.42);
    const lagoonTint = mixRgb(base.accent, TURQUOISE_LIGHT, 0.42);
    waterShallow = mixRgb(
      mixRgb(mixRgb(base.background, lagoonTint, 0.24), DARK_SUNSET_SHALLOW, warm * 0.38),
      mixRgb(NIGHT_WATER, lagoonTint, 0.18),
      cool * 0.5,
    );
    waterMid = mixRgb(
      mixRgb(mixRgb(base.background, lagoonTint, 0.36), DARK_SUNSET_MID, warm * 0.42),
      mixRgb(NIGHT_WATER, base.accent, 0.26),
      cool * 0.55,
    );
    waterDeep = mixRgb(mixRgb(base.background, BLACK, 0.28), NIGHT_DEEP, 0.45 + cool * 0.35);
    caustic = mixRgb(
      mixRgb(mixRgb(lagoonTint, WHITE, 0.34), SUNSET_PEACH, warm * 0.7),
      mixRgb(MOON_BLUE, WHITE, 0.3),
      cool * 0.65,
    );
    foam = mixRgb(
      mixRgb(mixRgb(lagoonTint, WHITE, 0.64), SUNRISE_ROSE, warm * 0.48),
      mixRgb(MOON_BLUE, WHITE, 0.54),
      cool * 0.5,
    );
    coral = mixRgb(mixRgb(base.coral, sandDry, 0.45), SUNSET_PEACH, warm * 0.3);
    palmShadow = mixRgb(base.background, BLACK, 0.64);
    skySpec = mixRgb(mixRgb(lagoonTint, SUNSET_PEACH, warm * 0.82), MOON_BLUE, cool * 0.75);
  }

  return {
    sandDry,
    sandWet,
    waterShallow,
    waterMid,
    waterDeep,
    caustic,
    foam,
    coral,
    palmShadow,
    skySpec,
    mood,
    lightMode,
    key: rgbKey([
      sandDry,
      sandWet,
      waterShallow,
      waterMid,
      waterDeep,
      caustic,
      foam,
      coral,
      palmShadow,
      skySpec,
    ]),
  };
}
