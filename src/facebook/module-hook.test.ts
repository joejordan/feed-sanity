import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModuleRecord } from './module-hook';
import { observeModules } from './module-hook';

afterEach(() => {
  vi.useRealTimers();
});

describe('observeModules', () => {
  it('captures already-initialized modules and wraps uninitialized factories passively', () => {
    const readyExports = { value: 1 };
    const lazyEntry: Record<string, unknown> = {
      factoryFinished: false,
      exports: {},
      factory() {
        (lazyEntry.exports as Record<string, unknown>).ready = true;
        lazyEntry.factoryFinished = true;
      },
    };
    const modulesMap: Record<string, unknown> = {
      ReadyMod: { factoryFinished: true, exports: readyExports },
      LazyMod: lazyEntry,
    };
    const require = (name: string) => (name === '__debug' ? { modulesMap } : undefined);

    const seen: ModuleRecord[] = [];
    const stop = observeModules({ require }, ['ReadyMod', 'LazyMod'], (rec) => seen.push(rec));

    expect(seen.map((r) => r.name)).toEqual(['ReadyMod']);

    // Running Facebook's factory notifies the observer without forcing requireLazy.
    (lazyEntry.factory as () => void)();
    expect(seen.map((r) => r.name)).toEqual(['ReadyMod', 'LazyMod']);
    expect(seen[1]?.exports.ready).toBe(true);
    stop();
  });

  it('stops polling once all requested modules are captured or stopped', () => {
    vi.useFakeTimers();
    const modulesMap: Record<string, unknown> = {};
    const require = (name: string) => (name === '__debug' ? { modulesMap } : undefined);
    const seen: string[] = [];
    const stop = observeModules({ require }, ['LateMod'], (rec) => seen.push(rec.name));

    modulesMap.LateMod = { factoryFinished: true, exports: { ok: true } };
    vi.advanceTimersByTime(500);
    expect(seen).toEqual(['LateMod']);
    stop();
  });

  it('captures Haste factory exports passed via args[6] and finalized after factory returns', async () => {
    const hasteEntry: Record<string, unknown> = {
      factoryFinished: false,
      exports: undefined,
      factory(...args: unknown[]) {
        const exp = args[6] as Record<string, unknown>;
        exp.fromArg = 42;
      },
    };
    const modulesMap: Record<string, unknown> = { HasteMod: hasteEntry };
    const require = (name: string) => (name === '__debug' ? { modulesMap } : undefined);

    const seen: ModuleRecord[] = [];
    const stop = observeModules({ require }, ['HasteMod'], (rec) => seen.push(rec));

    // Simulate Haste invoking the factory with `exports` in args[6] and setting `entry.exports` after.
    const out: Record<string, unknown> = {};
    (hasteEntry.factory as (...args: unknown[]) => void)(null, null, null, null, null, null, out);
    hasteEntry.exports = out;
    hasteEntry.factoryFinished = true;
    await Promise.resolve();

    expect(seen).toHaveLength(1);
    expect(seen[0]?.exports.fromArg).toBe(42);
    stop();
  });
});
