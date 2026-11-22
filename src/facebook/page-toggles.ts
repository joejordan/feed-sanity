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
 * How often to poll Facebook's module loader while waiting for `require` /
 * `requireLazy` or for the three refresh modules to be initialized by Facebook.
 * Once all three modules are captured (or the toggle is turned off), polling
 * stops completely.
 */
const BOOT_POLL_MS = 50;
const LAZY_POLL_MS = 500;
const MAX_LOADER_WAIT_MS = 15_000;

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
  let usingModulesMap = false;
  let subscribedLazy = false;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let pollIntervalMs = 0;
  let loaderDeadline = 0;
  const wrappedFactories = new WeakSet<Loose>();

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

  /** Reads Facebook's internal module registry from `require('__debug').modulesMap`, if available. */
  const modulesMap = (): Loose | undefined => {
    if (typeof loader.require !== 'function') {
      return undefined;
    }
    try {
      const debug = (loader.require as RequireModule)('__debug');
      const map = isObject(debug) ? debug.modulesMap : undefined;
      return isObject(map) ? map : undefined;
    } catch {
      return undefined;
    }
  };

  /** Reads one module entry from `require('__debug').modulesMap`, if available. */
  const moduleEntry = (name: string): Loose | undefined => {
    const map = modulesMap();
    const entry = map ? map[name] : undefined;
    return isObject(entry) ? entry : undefined;
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
      pollIntervalMs = 0;
    }
  };

  const allCaptured = (): boolean =>
    Boolean(
      stalenessMod && returnToFeedMod && (groupsRefreshMod !== undefined || groupsRefreshEntry),
    );

  const captureStaleness = (loaded: unknown): void => {
    if (!stalenessMod && isObject(loaded)) {
      stalenessMod = loaded;
      if (enabled) {
        applyStaleness();
      }
    }
  };

  const captureReturnToFeed = (loaded: unknown): void => {
    if (!returnToFeedMod && isObject(loaded)) {
      returnToFeedMod = loaded;
      if (enabled) {
        applyReturnToFeed();
      }
    }
  };

  const captureGroups = (loaded: unknown, entry?: Loose): void => {
    if (entry && !groupsRefreshEntry) {
      groupsRefreshEntry = entry;
      if (isObject(entry.exports)) {
        groupsRefreshMod = entry.exports;
      }
    } else if (isObject(loaded)) {
      groupsRefreshMod = loaded;
    } else if (typeof loaded === 'function') {
      const found = moduleEntry(GROUPS_REFRESH_MODULE);
      if (found) {
        groupsRefreshEntry = found;
        if (isObject(found.exports)) {
          groupsRefreshMod = found.exports;
        }
      }
    }
    if (enabled && (groupsRefreshMod || groupsRefreshEntry)) {
      applyGroupsRefresh();
    }
  };

  const captureEntryExports = (name: string, entry: Loose, exportsObj?: unknown): void => {
    const resolved = exportsObj ?? entry.exports;
    if (name === STALENESS_MODULE) {
      captureStaleness(resolved);
    } else if (name === RETURN_TO_FEED_MODULE) {
      captureReturnToFeed(resolved);
    } else if (name === GROUPS_REFRESH_MODULE) {
      captureGroups(resolved, entry);
    }
  };

  const isCaptured = (name: string): boolean => {
    if (name === STALENESS_MODULE) {
      return Boolean(stalenessMod);
    }
    if (name === RETURN_TO_FEED_MODULE) {
      return Boolean(returnToFeedMod);
    }
    return Boolean(groupsRefreshMod || groupsRefreshEntry);
  };

  /**
   * Passively inspects Facebook's `__debug.modulesMap` without ever calling
   * `requireLazy`, which would force-execute a module's factory before
   * Facebook's inline `ServerJS` bootstrap has populated `qex` (crashing
   * `CometFeedStalenessConstantsEntryPointVariables` with invariant #11799).
   *
   * Already-finished modules are patched immediately; defined-but-uninitialized
   * modules have their `factory` wrapped so they are patched the instant
   * Facebook itself requires them.
   */
  const scanModulesMap = (): boolean => {
    const map = modulesMap();
    if (!map) {
      return false;
    }
    usingModulesMap = true;
    for (const name of [STALENESS_MODULE, RETURN_TO_FEED_MODULE, GROUPS_REFRESH_MODULE]) {
      if (isCaptured(name)) {
        continue;
      }
      const entry = map[name];
      if (!isObject(entry) || entry.hasError === true) {
        continue;
      }
      const ready =
        entry.factoryFinished === true ||
        (entry.factoryFinished === undefined &&
          (isObject(entry.exports) || typeof entry.defaultExport === 'function'));
      if (ready) {
        captureEntryExports(name, entry);
        continue;
      }
      if (
        entry.factoryFinished === false &&
        typeof entry.factory === 'function' &&
        !wrappedFactories.has(entry)
      ) {
        const origFactory = entry.factory as AnyFunction;
        const wrappedFactory: AnyFunction = function (this: unknown, ...args: unknown[]) {
          const result = origFactory.apply(this, args);
          // Facebook's factory signature passes `exports` as the 7th argument.
          // Patch named exports synchronously and re-sync on a microtask once
          // the loader finishes populating `entry.defaultExport`.
          const exportsArg = args[6];
          if (isObject(exportsArg)) {
            captureEntryExports(name, entry, exportsArg);
          }
          queueMicrotask(() => {
            scanModulesMap();
          });
          return result;
        };
        if (writeProp(entry, 'factory', wrappedFactory)) {
          wrappedFactories.add(entry);
        }
      }
    }
    if (allCaptured()) {
      stopPolling();
    }
    return true;
  };

  /**
   * Fallback for loaders that expose only `requireLazy` without
   * `require('__debug').modulesMap`. Never runs while the document is still
   * loading or when `require` is present, so a real Facebook page's early
   * `requireLazy` stub never force-evaluates modules before `ServerJS`
   * populates `qex`.
   */
  const subscribeRequireLazy = (): boolean => {
    if (
      subscribedLazy ||
      usingModulesMap ||
      typeof loader.require === 'function' ||
      typeof loader.requireLazy !== 'function' ||
      (typeof document !== 'undefined' && document.readyState !== 'complete')
    ) {
      return subscribedLazy;
    }
    subscribedLazy = true;
    stopPolling();
    const requireLazy = loader.requireLazy as RequireLazy;
    const watchModule = (name: string, onLoad: (mod: unknown) => void): void => {
      try {
        requireLazy([name], (loaded) => {
          onLoad(loaded);
        });
      } catch {
        // Ignore bootloader rejections; diagnostics and tests see what was patched.
      }
    };
    watchModule(STALENESS_MODULE, captureStaleness);
    watchModule(RETURN_TO_FEED_MODULE, captureReturnToFeed);
    watchModule(GROUPS_REFRESH_MODULE, (loaded) => captureGroups(loaded));
    return true;
  };

  const setPoll = (intervalMs: number): void => {
    if (pollTimer !== undefined && pollIntervalMs === intervalMs) {
      return;
    }
    stopPolling();
    pollIntervalMs = intervalMs;
    pollTimer = setInterval(() => {
      if (!enabled || allCaptured()) {
        stopPolling();
        return;
      }
      if (scanModulesMap()) {
        // After the initial boot window, slow down to a lightweight check for
        // route-lazy modules such as Groups that may load on later navigation.
        if (Date.now() >= loaderDeadline) {
          setPoll(LAZY_POLL_MS);
        }
        return;
      }
      if (subscribeRequireLazy()) {
        return;
      }
      if (Date.now() >= loaderDeadline) {
        stopPolling();
      }
    }, intervalMs);
  };

  const startWatching = (): void => {
    if (allCaptured() || subscribedLazy) {
      return;
    }
    loaderDeadline = Date.now() + MAX_LOADER_WAIT_MS;
    if (scanModulesMap()) {
      if (!allCaptured()) {
        setPoll(BOOT_POLL_MS);
      }
      return;
    }
    if (subscribeRequireLazy()) {
      return;
    }
    setPoll(BOOT_POLL_MS);
  };

  return (next: boolean): StopFeedRefreshAnswer => {
    enabled = next;
    if (enabled) {
      startWatching();
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
