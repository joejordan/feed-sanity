// Adapted from `@ignitesoftware/digital-rain` (Joe Jordan / Ignite Software).
// Pure math and seeded PRNG utilities for the Matrix Digital Rain backdrop engine.

export type RandomSource = () => number;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

/** Frame-rate independent easing factor so motion matches across 60Hz and 144Hz displays. */
export function easeFactor(ratePerSecond: number, deltaSeconds: number): number {
  return 1 - Math.exp(-ratePerSecond * deltaSeconds);
}

export function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Mulberry32 seeded generator for deterministic rain frames. */
export function createRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 4_294_967_296);
}
