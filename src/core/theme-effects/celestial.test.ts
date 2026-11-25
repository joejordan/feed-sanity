import { describe, expect, it } from 'vitest';
import { dayPhaseAt, moonPhaseAt } from './celestial';

/** Shortest distance between two phases on the `0..1` circle. */
function phaseGap(a: number, b: number): number {
  const gap = Math.abs(a - b) % 1;
  return Math.min(gap, 1 - gap);
}

describe('local sky clock for u_dayPhase and u_moonPhase', () => {
  it('maps the local clock onto a 0..1 fraction of the day', () => {
    expect(dayPhaseAt(new Date(2026, 10, 25, 0, 0, 0))).toBe(0);
    expect(dayPhaseAt(new Date(2026, 10, 25, 6, 0, 0))).toBe(0.25);
    expect(dayPhaseAt(new Date(2026, 10, 25, 12, 0, 0))).toBe(0.5);
    expect(dayPhaseAt(new Date(2026, 10, 25, 18, 0, 0))).toBe(0.75);
    const lastSecond = dayPhaseAt(new Date(2026, 10, 25, 23, 59, 59));
    expect(lastSecond).toBeGreaterThan(0.999);
    expect(lastSecond).toBeLessThan(1);
  });

  it('lands on real new and full moons to within a day', () => {
    // Eclipses pin the phase exactly: solar ones fall on a new moon, lunar ones on a full moon.
    const lunations: ReadonlyArray<readonly [string, number]> = [
      ['2024-04-08T18:21:00Z', 0], // total solar eclipse
      ['2024-04-23T23:49:00Z', 0.5], // full moon
      ['2025-09-07T18:09:00Z', 0.5], // total lunar eclipse
      ['2026-08-12T17:37:00Z', 0], // total solar eclipse
    ];
    for (const [iso, expected] of lunations) {
      const phase = moonPhaseAt(Date.parse(iso));
      expect(phaseGap(phase, expected), `${iso} -> ${phase.toFixed(3)}`).toBeLessThan(0.035);
    }
  });

  it('advances one full cycle per synodic month and stays in 0..1 for any date', () => {
    const start = Date.parse('2026-11-25T00:00:00Z');
    const synodicMs = 29.530_588_853 * 86_400_000;
    expect(phaseGap(moonPhaseAt(start), moonPhaseAt(start + synodicMs))).toBeLessThan(1e-6);
    expect(phaseGap(moonPhaseAt(start + synodicMs / 2), moonPhaseAt(start) + 0.5)).toBeLessThan(
      1e-6,
    );
    for (const iso of ['1969-07-20T20:17:00Z', '2000-01-06T18:14:00Z', '2099-12-31T23:59:59Z']) {
      const phase = moonPhaseAt(Date.parse(iso));
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(1);
    }
  });
});
