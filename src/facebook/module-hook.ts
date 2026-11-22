// Passive observer for Facebook's internal `__debug.modulesMap` module loader.
// Runs in the page's own world, so it imports nothing.
//
// Calling `requireLazy` at `document_start` can execute a module factory before
// Facebook's inline ServerJS populates `qex` / `justknobx` / `gkx` keys,
// crashing Comet boot (see invariant #11799). Wrapping uninitialized factories
// inside `require('__debug').modulesMap` instead observes modules passively
// the instant Facebook itself initializes them.

export interface PageLoader {
  readonly require?: unknown;
  readonly requireLazy?: unknown;
}

export interface ModuleRecord {
  readonly name: string;
  readonly exports: Record<string, unknown>;
  readonly entry?: Record<string, unknown> | undefined;
}

export type Loose = Record<string, unknown>;
export type AnyFunction = (...args: unknown[]) => unknown;
export type RequireLazy = (
  deps: readonly string[],
  callback: (...modules: unknown[]) => void,
) => unknown;

type RequireModule = (name: string) => unknown;

const BOOT_POLL_MS = 50;
const LAZY_POLL_MS = 500;
const MAX_LOADER_WAIT_MS = 15_000;

export const isObject = (value: unknown): value is Loose =>
  typeof value === 'object' && value !== null;

/** Reads Facebook's internal module registry from `require('__debug').modulesMap`, if available. */
export function readModulesMap(loader: PageLoader): Loose | undefined {
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
}

/**
 * Passively observes one or more Facebook modules by name and invokes
 * `onCapture(record)` once each module's factory finishes initializing.
 * Never forces early module initialization via `requireLazy` while Facebook is
 * still booting. Returns a stop function that halts polling.
 */
export function observeModules(
  loader: PageLoader,
  names: readonly string[],
  onCapture: (record: ModuleRecord) => void,
): () => void {
  const targets = [...new Set(names)];
  const captured = new Set<string>();
  const wrappedFactories = new WeakSet<Loose>();
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let pollIntervalMs = 0;
  const deadline = Date.now() + MAX_LOADER_WAIT_MS;
  let stopped = false;

  const stopPolling = (): void => {
    if (pollTimer !== undefined) {
      clearInterval(pollTimer);
      pollTimer = undefined;
      pollIntervalMs = 0;
    }
  };

  const deliver = (name: string, exportsObj: unknown, entry?: Loose): void => {
    if (stopped || captured.has(name) || !isObject(exportsObj)) {
      return;
    }
    captured.add(name);
    onCapture({ name, exports: exportsObj, entry });
    if (captured.size >= targets.length) {
      stopPolling();
    }
  };

  const scanMap = (): { hasMap: boolean; allWrapped: boolean } => {
    const map = readModulesMap(loader);
    if (!map) {
      return { hasMap: false, allWrapped: false };
    }
    let allWrapped = true;
    for (const name of targets) {
      if (captured.has(name)) {
        continue;
      }
      const entry = map[name];
      if (!isObject(entry) || entry.hasError === true) {
        allWrapped = false;
        continue;
      }
      if (
        (entry.factoryFinished === true || entry.factoryFinished === undefined) &&
        isObject(entry.exports)
      ) {
        deliver(name, entry.exports, entry);
        continue;
      }
      if (typeof entry.factory === 'function') {
        if (!wrappedFactories.has(entry)) {
          const desc = Object.getOwnPropertyDescriptor(entry, 'factory');
          if (desc?.writable === true) {
            wrappedFactories.add(entry);
            const origFactory = entry.factory as AnyFunction;
            entry.factory = function wrappedFactory(this: unknown, ...args: unknown[]): unknown {
              const result = origFactory.apply(this, args);
              let exp: Loose | undefined;
              if (isObject(entry.exports)) {
                exp = entry.exports;
              } else if (isObject(args[6])) {
                exp = args[6];
              }
              if (exp && Object.keys(exp).length > 0) {
                deliver(name, exp, entry);
              }
              // Facebook's Haste loader may finalize `entry.exports` / `module.exports`
              // after `factory` returns; re-scan in a microtask so captures never miss
              // even after interval polling stops.
              queueMicrotask(() => {
                if (!stopped && !captured.has(name)) {
                  scanMap();
                }
              });
              return result;
            };
          } else {
            allWrapped = false;
          }
        }
      } else {
        allWrapped = false;
      }
    }
    return { hasMap: true, allWrapped };
  };

  const tryRequireLazy = (): boolean => {
    if (
      typeof loader.require === 'function' ||
      typeof loader.requireLazy !== 'function' ||
      typeof document === 'undefined' ||
      document.readyState !== 'complete'
    ) {
      return false;
    }
    const requireLazy = loader.requireLazy as RequireLazy;
    for (const name of targets) {
      if (captured.has(name)) {
        continue;
      }
      try {
        requireLazy([name], (loaded) => {
          deliver(name, loaded);
        });
      } catch {
        // Ignore missing modules in synthetic or partial environments.
      }
    }
    return true;
  };

  const ensurePoll = (intervalMs: number): void => {
    if (stopped || captured.size >= targets.length || pollIntervalMs === intervalMs) {
      return;
    }
    stopPolling();
    pollIntervalMs = intervalMs;
    pollTimer = setInterval(tick, intervalMs);
  };

  const tick = (): void => {
    if (stopped || captured.size >= targets.length) {
      stopPolling();
      return;
    }
    const { hasMap, allWrapped } = scanMap();
    if (hasMap) {
      // Once every remaining target already has a wrapped factory (or our wait
      // deadline elapsed), no further interval polling is needed.
      if (allWrapped || Date.now() >= deadline) {
        stopPolling();
      } else {
        ensurePoll(LAZY_POLL_MS);
      }
      return;
    }
    if (tryRequireLazy() || Date.now() >= deadline) {
      stopPolling();
      return;
    }
    ensurePoll(BOOT_POLL_MS);
  };

  tick();

  return () => {
    stopped = true;
    stopPolling();
  };
}
