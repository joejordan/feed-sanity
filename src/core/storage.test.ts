import { describe, expect, it, vi } from 'vitest';
import type { Store } from './storage';
import { createPreloadedStore, readStoreMany } from './storage';

describe('core/storage helpers', () => {
  it('reads multiple keys via native getMany when available and falls back to get() otherwise', async () => {
    const nativeGetMany = vi.fn(async (keys: readonly string[]) =>
      Object.fromEntries(keys.map((k) => [k, `val:${k}`])),
    );
    const fastStore: Store = {
      get: vi.fn(),
      getMany: nativeGetMany,
      set: vi.fn(),
      onChange: vi.fn(),
    };
    expect(await readStoreMany(fastStore, ['a', 'b'])).toEqual({ a: 'val:a', b: 'val:b' });
    expect(nativeGetMany).toHaveBeenCalledTimes(1);
    expect(fastStore.get).not.toHaveBeenCalled();

    const basicStore: Store = {
      get: vi.fn(async (k: string) => `single:${k}`),
      set: vi.fn(),
      onChange: vi.fn(),
    };
    expect(await readStoreMany(basicStore, ['x', 'y'])).toEqual({
      x: 'single:x',
      y: 'single:y',
    });
    expect(basicStore.get).toHaveBeenCalledTimes(2);
  });

  it('serves each preloaded key once from memory before delegating to the backing store', async () => {
    const backing: Store = {
      get: vi.fn(async (key: string) => `live:${key}`),
      set: vi.fn(async () => undefined),
      onChange: vi.fn(),
    };
    const store = createPreloadedStore(backing, { 'v2/sites': { x: true }, 'v2/x/options': {} });

    // First read hits one-shot preloaded cache with zero backing IPC.
    expect(await store.get('v2/sites')).toEqual({ x: true });
    expect(backing.get).not.toHaveBeenCalled();

    // Second read of the same key falls through to backing store.
    expect(await store.get('v2/sites')).toBe('live:v2/sites');
    expect(backing.get).toHaveBeenCalledTimes(1);

    // Writing invalidates a preloaded key immediately.
    await store.set('v2/x/options', { a: 1 });
    expect(await store.get('v2/x/options')).toBe('live:v2/x/options');
  });
});
