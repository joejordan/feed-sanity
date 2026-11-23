import { describe, expect, it, vi } from 'vitest';
import type { Filter } from './filter-types';
import { FilterHitTracker, getFilterHitTracker } from './filter-hits';

const rule = (text: string): Filter => ({
  title: `Hide ${text}`,
  enabled: true,
  rules: [{ target: 'any', operator: 'contains', matcher: 'str', condition: { text } }],
  actions: [{ action: 'hide' }],
});

describe('FilterHitTracker', () => {
  it('tracks unique matched items per filter, deduplicates re-evaluations, and decrements on forget/clear', () => {
    const tracker = new FilterHitTracker();
    const listener = vi.fn();
    const stop = tracker.onChange(listener);

    const f1 = rule('crypto');
    const f2 = rule('spoilers');
    const postA = {};
    const postB = {};

    tracker.setItemMatches(postA, [f1]);
    tracker.setItemMatches(postB, [f1, f2]);
    expect(tracker.countFor(f1)).toBe(2);
    expect(tracker.countFor(f2)).toBe(1);
    expect(listener).toHaveBeenCalledTimes(2);

    // Re-evaluating postA with the same filter does not double-count or spuriously notify.
    tracker.setItemMatches(postA, [structuredClone(f1)]);
    expect(tracker.countFor(f1)).toBe(2);
    expect(listener).toHaveBeenCalledTimes(2);

    // Updating postB to only match f2 decrements f1 cleanly.
    tracker.setItemMatches(postB, [f2]);
    expect(tracker.countFor(f1)).toBe(1);
    expect(tracker.countFor(f2)).toBe(1);

    tracker.forgetItem(postA);
    expect(tracker.countFor(f1)).toBe(0);

    tracker.clear();
    expect(tracker.countFor(f2)).toBe(0);

    stop();
  });

  it('returns an isolated tracker per data host via WeakMap', () => {
    const dataA = {};
    const dataB = {};
    const tA = getFilterHitTracker(dataA);
    expect(getFilterHitTracker(dataA)).toBe(tA);
    expect(getFilterHitTracker(dataB)).not.toBe(tA);
  });
});
