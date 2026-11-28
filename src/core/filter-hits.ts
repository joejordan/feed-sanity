// Lightweight, site-scoped per-filter live match counter shared between
// filtering features (`feed-filters`, `thread-filters`, `post-filters`) and
// `SiteFiltersPanel` via `WeakMap<object, FilterHitTracker>` keyed by `SavedData`.

import type { Filter } from './filter-types';
import { Listeners } from './listeners';
import { createLogger } from './log';
import { resolveDataOwner } from './saved';

/**
 * Tracks how many active items on the current page matched each filter rule,
 * de-duplicating re-evaluations of the same item element and emitting version
 * updates for `useSyncExternalStore`.
 */
export class FilterHitTracker {
  readonly #itemKeys = new Map<object, Set<string>>();
  readonly #counts = new Map<string, number>();
  readonly #listeners = new Listeners(createLogger('filter-hits'));
  #version = 0;

  /** Snapshot token incremented whenever any filter's hit count changes. */
  version(): number {
    return this.#version;
  }

  /** Number of currently tracked items matched by `filter` (counted by its `id`). */
  countFor(filter: Pick<Filter, 'id'>): number {
    return filter.id ? (this.#counts.get(filter.id) ?? 0) : 0;
  }

  /** Replaces the set of filters matched by `item` and updates counts incrementally. */
  setItemMatches(item: object, matched: readonly Pick<Filter, 'id'>[]): void {
    const next = new Set<string>();
    for (const filter of matched) {
      // Filters without an id (never saved through `readFilters`) are not counted.
      if (filter.id) {
        next.add(filter.id);
      }
    }
    if (next.size === 0) {
      this.forgetItem(item);
      return;
    }
    const prev = this.#itemKeys.get(item);
    let changed = false;

    if (prev) {
      for (const key of prev) {
        if (!next.has(key)) {
          this.#decrement(key);
          changed = true;
        }
      }
    }
    for (const key of next) {
      if (!prev?.has(key)) {
        this.#counts.set(key, (this.#counts.get(key) ?? 0) + 1);
        changed = true;
      }
    }

    this.#itemKeys.set(item, next);

    if (changed) {
      this.#notify();
    }
  }

  /** Removes `item` from all filter hit counts when untracked or removed from DOM. */
  forgetItem(item: object): void {
    const prev = this.#itemKeys.get(item);
    if (!prev) {
      return;
    }
    this.#itemKeys.delete(item);
    for (const key of prev) {
      this.#decrement(key);
    }
    this.#notify();
  }

  /** Clears all recorded item matches (e.g. when filtering stops). */
  clear(): void {
    if (this.#itemKeys.size === 0 && this.#counts.size === 0) {
      return;
    }
    this.#itemKeys.clear();
    this.#counts.clear();
    this.#notify();
  }

  /** Subscribes to hit count updates (compatible with `useSyncExternalStore`). */
  onChange(listener: () => void): () => void {
    return this.#listeners.add(listener);
  }

  #decrement(key: string): void {
    const remaining = (this.#counts.get(key) ?? 0) - 1;
    if (remaining > 0) {
      this.#counts.set(key, remaining);
    } else {
      this.#counts.delete(key);
    }
  }

  #notify(): void {
    this.#version++;
    this.#listeners.emit();
  }
}

const trackersByData = new WeakMap<object, FilterHitTracker>();

/**
 * Returns the `FilterHitTracker` scoped to a site's `SavedData` / `FeatureData`
 * instance, ensuring isolated per-site and per-test session hit counts.
 */
export function getFilterHitTracker(data: object): FilterHitTracker {
  const owner = resolveDataOwner(data);
  let tracker = trackersByData.get(owner);
  if (!tracker) {
    tracker = new FilterHitTracker();
    trackersByData.set(owner, tracker);
  }
  return tracker;
}
