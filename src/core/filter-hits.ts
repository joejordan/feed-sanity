// Lightweight, site-scoped per-filter live match counter shared between
// filtering features (`feed-filters`, `thread-filters`, `post-filters`) and
// `SiteFiltersPanel` via `WeakMap<object, FilterHitTracker>` keyed by `SavedData`.

import type { Filter } from './filter-types';
import { Listeners } from './listeners';
import { createLogger } from './log';
import { resolveDataOwner } from './saved';

const signatureCache = new WeakMap<Filter, string>();

/** Stable structural key for a `Filter` (cached per object identity). */
function filterSignature(filter: Filter): string {
  let key = signatureCache.get(filter);
  if (key === undefined) {
    key = JSON.stringify(filter);
    signatureCache.set(filter, key);
  }
  return key;
}

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

  /** Number of currently tracked items matched by `filter`. */
  countFor(filter: Filter): number {
    return this.#counts.get(filterSignature(filter)) ?? 0;
  }

  /** Replaces the set of filters matched by `item` and updates counts incrementally. */
  setItemMatches(item: object, matched: readonly Filter[]): void {
    if (matched.length === 0) {
      this.forgetItem(item);
      return;
    }
    const next = new Set<string>();
    for (const filter of matched) {
      next.add(filterSignature(filter));
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

    if (next.size > 0) {
      this.#itemKeys.set(item, next);
    } else if (prev) {
      this.#itemKeys.delete(item);
    }

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
