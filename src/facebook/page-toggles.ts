// Page-world toggles for Facebook's own modules. They run in the page's own
// world, as part of the page-world side of the bridge (see `src/page-world.ts`),
// so this file imports nothing but types and keeps to small, reversible patches.
//
// Each Facebook module name and export below was verified live on 2026-11-21:
// - `CometFeedStalenessConstantsEntryPointVariables`: holds the timeouts that
//   `useCometHomeStaleFeedRefresh` (`FEED_STALE_TIMEOUT`, `FEED_VISIBILITY_TIMEOUT`)
//   and `useCometFeedPushViewCloseRefresh` (`FEED_STALE_PUSH_VIEW_TIMEOUT`) read
//   live when deciding whether to wipe and refresh the Home feed.
// - `CometReturnToFeedRouteUtils`: `isRouteEligible` gates
//   `useStaleSessionReturnToFeed`, which navigates back to Home from groups,
//   profiles, Marketplace, single posts, stories, search and other pages after
//   the tab has been away.
// - `useGroupsCometCrossFeedRefresh`: refreshes `/groups/feed/` on return from
//   inactivity by calling its `refreshHandler` prop.

import type { PageToggle, PageToggles } from '../core/page-world';

/** The toggle that stops Facebook's automatic feed refreshes and return-to-feed redirects. */
export const STOP_FEED_REFRESH = 'stop-feed-refresh';

/** Facebook's module names that drive automatic feed refreshes and stale-session redirects. */
export const STALENESS_MODULE = 'CometFeedStalenessConstantsEntryPointVariables';
export const RETURN_TO_FEED_MODULE = 'CometReturnToFeedRouteUtils';
export const GROUPS_REFRESH_MODULE = 'useGroupsCometCrossFeedRefresh';

/**
 * How often to check for Facebook's `requireLazy` bootloader before it has run
 * at `document_start`, and when to give up on a page that never defines one.
 */
const POLL_MS = 25;
const MAX_WAIT_MS = 15_000;

/**
 * The staleness constants overridden while Anti-Zuck is on.
 *
 * `FEED_STALE_PUSH_VIEW_TIMEOUT` is set to `null` rather than `Infinity`
 * because `useCometFeedPushViewCloseRefresh` guards its block with `!= null`
 * and passes the timeout to `setTimeout`, where `Infinity` would overflow to
 * 0 ms. The other two are only compared with `>`, where `Infinity` never trips.
 */
const STALENESS_OVERRIDES: Readonly<Record<string, number | null>> = {
  FEED_STALE_TIMEOUT: Number.POSITIVE_INFINITY,
  FEED_VISIBILITY_TIMEOUT: Number.POSITIVE_INFINITY,
  FEED_STALE_PUSH_VIEW_TIMEOUT: null,
};

type Loose = Record<string, unknown>;
type AnyFunction = (...args: unknown[]) => unknown;
type RequireLazy = (deps: readonly string[], callback: (...modules: unknown[]) => void) => unknown;
type RequireModule = (name: string) => unknown;

/** What the stop-feed-refresh toggle sends back. The content side checks it. */
export interface StopFeedRefreshAnswer {
  enabled: boolean;
  /** Which Facebook modules are currently patched. */
  patched: string[];
}

export interface PageLoader {
  readonly require?: unknown;
  readonly requireLazy?: unknown;
}

const isObject = (value: unknown): value is Loose => typeof value === 'object' && value !== null;

const canWrite = (target: Loose, key: string): boolean => {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  return descriptor !== undefined && descriptor.writable === true;
};

/** Writes `value` onto `target[key]` when writable, returning whether the write took effect. */
function writeProp(target: Loose, key: string, value: unknown): boolean {
  if (!canWrite(target, key)) {
    return false;
  }
  try {
    target[key] = value;
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds one stateful `stop-feed-refresh` toggle bound to `loader` (which
 * defaults to `globalThis`). Turning it on subscribes to Facebook's three
 * refresh modules via `requireLazy` and disables their automatic refreshes;
 * turning it off restores every original value and function immediately.
 */
export function createStopFeedRefreshToggle(
  loader: PageLoader = globalThis as PageLoader,
): PageToggle {
  let enabled = false;
  let subscribed = false;
  let pollTimer: ReturnType<typeof setInterval> | undefined;

  let stalenessMod: Loose | undefined;
  const originalStaleness = new Map<string, unknown>();

  let returnToFeedMod: Loose | undefined;
  let originalIsRouteEligible: AnyFunction | undefined;

  let groupsRefreshMod: Loose | undefined;
  let groupsRefreshEntry: Loose | undefined;
  let originalGroupsHook: AnyFunction | undefined;
  // Keeps the wrapped `refreshHandler` reference stable across re-renders so
  // React Compiler's memoization inside `useGroupsCometCrossFeedRefresh` does
  // not tear down and re-subscribe its effect on every render.
  const gatedHandlers = new WeakMap<AnyFunction, AnyFunction>();

  /** Reads Facebook's internal module entry from `require('__debug').modulesMap`, if available. */
  const moduleEntry = (name: string): Loose | undefined => {
    if (typeof loader.require !== 'function') {
      return undefined;
    }
    try {
      const debug = (loader.require as RequireModule)('__debug');
      const map = isObject(debug) ? debug.modulesMap : undefined;
      const entry = isObject(map) ? map[name] : undefined;
      return isObject(entry) ? entry : undefined;
    } catch {
      return undefined;
    }
  };

  const gateHandler = (handler: AnyFunction): AnyFunction => {
    let gated = gatedHandlers.get(handler);
    if (!gated) {
      gated = (...args: unknown[]) => (enabled ? undefined : handler(...args));
      gatedHandlers.set(handler, gated);
    }
    return gated;
  };

  const applyStaleness = (): boolean => {
    if (!stalenessMod) {
      return false;
    }
    let changed = false;
    for (const [key, override] of Object.entries(STALENESS_OVERRIDES)) {
      if (!(key in stalenessMod)) {
        continue;
      }
      if (!originalStaleness.has(key)) {
        originalStaleness.set(key, stalenessMod[key]);
      }
      if (writeProp(stalenessMod, key, enabled ? override : originalStaleness.get(key))) {
        changed = true;
      }
    }
    return changed;
  };

  const applyReturnToFeed = (): boolean => {
    if (!returnToFeedMod) {
      return false;
    }
    if (!originalIsRouteEligible && typeof returnToFeedMod.isRouteEligible === 'function') {
      originalIsRouteEligible = returnToFeedMod.isRouteEligible as AnyFunction;
    }
    if (!originalIsRouteEligible) {
      return false;
    }
    const replacement: AnyFunction = enabled ? () => false : originalIsRouteEligible;
    return writeProp(returnToFeedMod, 'isRouteEligible', replacement);
  };

  const applyGroupsRefresh = (): boolean => {
    if (!groupsRefreshMod && !groupsRefreshEntry) {
      return false;
    }
    if (!originalGroupsHook) {
      if (groupsRefreshEntry && typeof groupsRefreshEntry.defaultExport === 'function') {
        originalGroupsHook = groupsRefreshEntry.defaultExport as AnyFunction;
      } else if (groupsRefreshMod && typeof groupsRefreshMod.default === 'function') {
        originalGroupsHook = groupsRefreshMod.default as AnyFunction;
      }
    }
    if (!originalGroupsHook) {
      return false;
    }
    const baseHook = originalGroupsHook;
    const replacement: AnyFunction = enabled
      ? (props: unknown, ...rest: unknown[]) => {
          if (isObject(props) && typeof props.refreshHandler === 'function') {
            return baseHook(
              { ...props, refreshHandler: gateHandler(props.refreshHandler as AnyFunction) },
              ...rest,
            );
          }
          return baseHook(props, ...rest);
        }
      : baseHook;
    let changed = false;
    // Facebook's default-import helper reads `entry.defaultExport`, while
    // namespace imports read `entry.exports.default`, so update both when present.
    if (groupsRefreshEntry && writeProp(groupsRefreshEntry, 'defaultExport', replacement)) {
      changed = true;
    }
    if (groupsRefreshMod && writeProp(groupsRefreshMod, 'default', replacement)) {
      changed = true;
    }
    return changed;
  };

  const applyAll = (): string[] => {
    const patched: string[] = [];
    if (applyStaleness() && enabled) {
      patched.push(STALENESS_MODULE);
    }
    if (applyReturnToFeed() && enabled) {
      patched.push(RETURN_TO_FEED_MODULE);
    }
    if (applyGroupsRefresh() && enabled) {
      patched.push(GROUPS_REFRESH_MODULE);
    }
    return patched;
  };

  const stopPolling = (): void => {
    if (pollTimer !== undefined) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  };

  const subscribeOnce = (): void => {
    if (subscribed || typeof loader.requireLazy !== 'function') {
      return;
    }
    subscribed = true;
    stopPolling();
    const requireLazy = loader.requireLazy as RequireLazy;
    // Each module is requested on its own so a module that only loads on
    // another route (such as Groups) never holds back the Home or site-wide ones.
    const watchModule = (name: string, onLoad: (mod: unknown) => void): void => {
      try {
        requireLazy([name], (loaded) => {
          onLoad(loaded);
        });
      } catch {
        // Ignore bootloader rejections; diagnostics and tests see what was patched.
      }
    };
    watchModule(STALENESS_MODULE, (loaded) => {
      if (isObject(loaded)) {
        stalenessMod = loaded;
        if (enabled) {
          applyStaleness();
        }
      }
    });
    watchModule(RETURN_TO_FEED_MODULE, (loaded) => {
      if (isObject(loaded)) {
        returnToFeedMod = loaded;
        if (enabled) {
          applyReturnToFeed();
        }
      }
    });
    watchModule(GROUPS_REFRESH_MODULE, (loaded) => {
      if (isObject(loaded)) {
        groupsRefreshMod = loaded;
      } else if (typeof loaded === 'function') {
        const entry = moduleEntry(GROUPS_REFRESH_MODULE);
        if (entry) {
          groupsRefreshEntry = entry;
          if (isObject(entry.exports)) {
            groupsRefreshMod = entry.exports;
          }
        }
      }
      if (enabled) {
        applyGroupsRefresh();
      }
    });
  };

  const waitForLoader = (): void => {
    if (subscribed || pollTimer !== undefined) {
      return;
    }
    const deadline = Date.now() + MAX_WAIT_MS;
    pollTimer = setInterval(() => {
      if (!enabled || subscribed || Date.now() >= deadline) {
        stopPolling();
        return;
      }
      if (typeof loader.requireLazy === 'function') {
        subscribeOnce();
      }
    }, POLL_MS);
  };

  return (next: boolean): StopFeedRefreshAnswer => {
    enabled = next;
    if (enabled) {
      subscribeOnce();
      if (!subscribed) {
        waitForLoader();
      }
    } else {
      stopPolling();
    }
    return { enabled, patched: applyAll() };
  };
}

/** Every toggle the page-world side offers. */
export const PAGE_TOGGLES: PageToggles = {
  [STOP_FEED_REFRESH]: createStopFeedRefreshToggle(),
};
