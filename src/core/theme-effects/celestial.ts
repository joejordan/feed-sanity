// Local sky clock for the Tier 3 shader uniforms `u_dayPhase` and `u_moonPhase`.
// Everything derives from the viewer's own clock: no location, network, or
// extra permission is involved.

const DAY_SECONDS = 86_400;
/** Mean length of one lunar cycle, new moon to new moon, in days. */
const SYNODIC_MONTH_DAYS = 29.530_588_853;
/** A reference new moon: 2000-01-06 18:14 UTC. */
const REFERENCE_NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14);

/** Fraction of the local day that has passed (`0` = midnight, `0.5` = noon). */
export function dayPhaseAt(date: Date): number {
  return (date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds()) / DAY_SECONDS;
}

/**
 * Lunar phase at `timeMs` as a fraction of the cycle: `0` = new moon,
 * `0.25` = first quarter, `0.5` = full moon, `0.75` = last quarter. It uses the
 * mean cycle length, so it stays within about half a day of the true phase.
 */
export function moonPhaseAt(timeMs: number): number {
  const cycles = (timeMs - REFERENCE_NEW_MOON_MS) / (SYNODIC_MONTH_DAYS * DAY_SECONDS * 1000);
  return cycles - Math.floor(cycles);
}
