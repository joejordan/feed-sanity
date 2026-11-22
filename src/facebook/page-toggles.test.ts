import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createStopFeedRefreshToggle,
  GROUPS_REFRESH_MODULE,
  RETURN_TO_FEED_MODULE,
  STALENESS_MODULE,
} from './page-toggles';
import { checkStopFeedRefresh } from './stop-feed-refresh';

interface FakeLoader {
  requireLazy?:
    | ((deps: readonly string[], callback: (...modules: unknown[]) => void) => void)
    | undefined;
  define: (name: string, mod: unknown) => void;
  requested: string[];
}

/** A stand-in for Facebook's `requireLazy` that resolves modules present now or defined later. */
function makeLoader(initial: Record<string, unknown> = {}): FakeLoader {
  const modules = new Map<string, unknown>(Object.entries(initial));
  const waiting = new Map<string, ((mod: unknown) => void)[]>();
  const requested: string[] = [];

  const requireLazy = (deps: readonly string[], callback: (...loaded: unknown[]) => void): void => {
    const [name] = deps;
    if (!name) {
      return;
    }
    requested.push(name);
    if (modules.has(name)) {
      callback(modules.get(name));
    } else {
      const list = waiting.get(name) ?? [];
      list.push(callback);
      waiting.set(name, list);
    }
  };

  return {
    requireLazy,
    requested,
    define(name: string, mod: unknown) {
      modules.set(name, mod);
      const callbacks = waiting.get(name);
      if (callbacks) {
        waiting.delete(name);
        for (const callback of callbacks) {
          callback(mod);
        }
      }
    },
  };
}

describe('createStopFeedRefreshToggle', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('overrides staleness timeouts and restores the exact original values when turned off', () => {
    const staleness = {
      FEED_STALE_TIMEOUT: 600_000,
      FEED_VISIBILITY_TIMEOUT: 120_000,
      FEED_STALE_PUSH_VIEW_TIMEOUT: 1_800_000,
      BADGE_STALE_TIMEOUT: 600_000,
      FEED_MAX_QUERY_AGE_IN_SEC: 180,
      STALE_REFRESH_MODE: 'WARM',
    };
    const loader = makeLoader({ [STALENESS_MODULE]: staleness });
    const toggle = createStopFeedRefreshToggle(loader);

    expect(toggle(true)).toEqual({ enabled: true, patched: [STALENESS_MODULE] });
    expect(staleness.FEED_STALE_TIMEOUT).toBe(Number.POSITIVE_INFINITY);
    expect(staleness.FEED_VISIBILITY_TIMEOUT).toBe(Number.POSITIVE_INFINITY);
    expect(staleness.FEED_STALE_PUSH_VIEW_TIMEOUT).toBeNull();
    // Unrelated constants stay untouched.
    expect(staleness.BADGE_STALE_TIMEOUT).toBe(600_000);
    expect(staleness.FEED_MAX_QUERY_AGE_IN_SEC).toBe(180);
    expect(staleness.STALE_REFRESH_MODE).toBe('WARM');

    expect(toggle(false)).toEqual({ enabled: false, patched: [] });
    expect(staleness.FEED_STALE_TIMEOUT).toBe(600_000);
    expect(staleness.FEED_VISIBILITY_TIMEOUT).toBe(120_000);
    expect(staleness.FEED_STALE_PUSH_VIEW_TIMEOUT).toBe(1_800_000);

    // Turning it back on re-applies without subscribing again.
    expect(toggle(true)).toEqual({ enabled: true, patched: [STALENESS_MODULE] });
    expect(staleness.FEED_VISIBILITY_TIMEOUT).toBe(Number.POSITIVE_INFINITY);
    expect(staleness.FEED_STALE_PUSH_VIEW_TIMEOUT).toBeNull();
    expect(loader.requested).toEqual([
      STALENESS_MODULE,
      RETURN_TO_FEED_MODULE,
      GROUPS_REFRESH_MODULE,
    ]);
  });

  it('disables return-to-feed route eligibility while on and restores the original function when off', () => {
    const original = vi.fn((route: string) => route === 'comet.group' || route === 'comet.watch');
    const rtf = { isRouteEligible: original };
    const loader = makeLoader({ [RETURN_TO_FEED_MODULE]: rtf });
    const toggle = createStopFeedRefreshToggle(loader);

    expect(toggle(true)).toEqual({ enabled: true, patched: [RETURN_TO_FEED_MODULE] });
    expect(rtf.isRouteEligible('comet.group')).toBe(false);
    expect(original).not.toHaveBeenCalled();

    expect(toggle(false)).toEqual({ enabled: false, patched: [] });
    expect(rtf.isRouteEligible).toBe(original);
    expect(rtf.isRouteEligible('comet.group')).toBe(true);
    expect(rtf.isRouteEligible('comet.home')).toBe(false);
  });

  it('gates useGroupsCometCrossFeedRefresh refreshHandler with a stable reference and restores cleanly', () => {
    const seenHandlers: ((...args: unknown[]) => unknown)[] = [];
    const originalHook = vi.fn((props: { refreshHandler: () => void; extra?: string }) => {
      seenHandlers.push(props.refreshHandler);
      return props.extra;
    });
    const groupsMod = { default: originalHook };
    const loader = makeLoader({ [GROUPS_REFRESH_MODULE]: groupsMod });
    const toggle = createStopFeedRefreshToggle(loader);

    expect(toggle(true)).toEqual({ enabled: true, patched: [GROUPS_REFRESH_MODULE] });

    const refreshHandler = vi.fn();
    expect(groupsMod.default({ refreshHandler, extra: 'ok' })).toBe('ok');
    groupsMod.default({ refreshHandler });

    // React Compiler memoizes on `refreshHandler`, so repeated renders must see the same reference.
    expect(seenHandlers).toHaveLength(2);
    expect(seenHandlers[0]).toBe(seenHandlers[1]);

    // While enabled, calling the captured handler does nothing.
    seenHandlers[0]?.();
    expect(refreshHandler).not.toHaveBeenCalled();

    // Turning off restores the hook AND lets an already-captured handler call through.
    expect(toggle(false)).toEqual({ enabled: false, patched: [] });
    expect(groupsMod.default).toBe(originalHook);
    seenHandlers[0]?.();
    expect(refreshHandler).toHaveBeenCalledTimes(1);

    // Turning back on blocks that same already-captured handler again.
    toggle(true);
    seenHandlers[0]?.();
    expect(refreshHandler).toHaveBeenCalledTimes(1);
  });

  it('patches unwrapped default exports via __debug.modulesMap as Facebook requireLazy delivers them', () => {
    const seen: ((...args: unknown[]) => unknown)[] = [];
    const originalHook = (props: { refreshHandler: () => void }) => {
      seen.push(props.refreshHandler);
    };
    const entry = {
      exports: { default: originalHook },
      defaultExport: originalHook,
    };
    const modulesMap: Record<string, unknown> = {
      [GROUPS_REFRESH_MODULE]: entry,
    };
    const loader = {
      require: (name: string) => (name === '__debug' ? { modulesMap } : undefined),
      requireLazy: (deps: readonly string[], cb: (...loaded: unknown[]) => void) => {
        if (deps[0] === GROUPS_REFRESH_MODULE) {
          // Real Facebook unwraps `.default` and hands the hook function directly to requireLazy.
          cb(entry.defaultExport);
        }
      },
    };
    const toggle = createStopFeedRefreshToggle(loader);

    expect(toggle(true)).toEqual({ enabled: true, patched: [GROUPS_REFRESH_MODULE] });
    expect(entry.defaultExport).not.toBe(originalHook);
    expect(entry.exports.default).not.toBe(originalHook);

    const refreshHandler = vi.fn();
    entry.defaultExport({ refreshHandler });
    seen[0]?.();
    expect(refreshHandler).not.toHaveBeenCalled();

    expect(toggle(false)).toEqual({ enabled: false, patched: [] });
    expect(entry.defaultExport).toBe(originalHook);
    expect(entry.exports.default).toBe(originalHook);
    seen[0]?.();
    expect(refreshHandler).toHaveBeenCalledTimes(1);
  });

  it('waits for requireLazy when started at document_start, and applies to modules loaded later', () => {
    vi.useFakeTimers();
    const loader: FakeLoader = makeLoader();
    const realRequireLazy = loader.requireLazy;
    loader.requireLazy = undefined;

    const toggle = createStopFeedRefreshToggle(loader);
    expect(toggle(true)).toEqual({ enabled: true, patched: [] });

    // Facebook's bootloader defines `requireLazy` shortly after document_start.
    loader.requireLazy = realRequireLazy;
    vi.advanceTimersByTime(30);

    const staleness = {
      FEED_STALE_TIMEOUT: 600_000,
      FEED_VISIBILITY_TIMEOUT: 120_000,
      FEED_STALE_PUSH_VIEW_TIMEOUT: 1_800_000,
    };
    loader.define(STALENESS_MODULE, staleness);
    expect(staleness.FEED_STALE_TIMEOUT).toBe(Number.POSITIVE_INFINITY);
    expect(staleness.FEED_STALE_PUSH_VIEW_TIMEOUT).toBeNull();

    // A module arriving after the toggle was turned off is cached without mutating it.
    toggle(false);
    const rtf = { isRouteEligible: (route: string) => route === 'comet.group' };
    loader.define(RETURN_TO_FEED_MODULE, rtf);
    expect(rtf.isRouteEligible('comet.group')).toBe(true);

    // Turning the toggle back on patches the cached module immediately.
    expect(toggle(true)).toEqual({
      enabled: true,
      patched: [STALENESS_MODULE, RETURN_TO_FEED_MODULE],
    });
    expect(rtf.isRouteEligible('comet.group')).toBe(false);
  });

  it('does not throw when a module is frozen and still patches the rest', () => {
    const frozen = Object.freeze({
      FEED_STALE_TIMEOUT: 600_000,
      FEED_VISIBILITY_TIMEOUT: 120_000,
      FEED_STALE_PUSH_VIEW_TIMEOUT: 1_800_000,
    });
    const rtf = { isRouteEligible: () => true };
    const loader = makeLoader({
      [STALENESS_MODULE]: frozen,
      [RETURN_TO_FEED_MODULE]: rtf,
    });
    const toggle = createStopFeedRefreshToggle(loader);

    expect(toggle(true)).toEqual({ enabled: true, patched: [RETURN_TO_FEED_MODULE] });
    expect(frozen.FEED_STALE_TIMEOUT).toBe(600_000);
    expect(rtf.isRouteEligible()).toBe(false);
  });
});

describe('checkStopFeedRefresh', () => {
  it('accepts a valid toggle answer and rejects malformed data', () => {
    expect(checkStopFeedRefresh({ enabled: true, patched: [STALENESS_MODULE] })).toEqual({
      enabled: true,
      patched: [STALENESS_MODULE],
    });
    expect(checkStopFeedRefresh(null)).toBeNull();
    expect(checkStopFeedRefresh({ enabled: 'yes', patched: [] })).toBeNull();
    expect(checkStopFeedRefresh({ enabled: true, patched: [123] })).toBeNull();
  });
});
