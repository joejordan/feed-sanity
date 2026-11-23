import { describe, expect, it, vi } from 'vitest';
import type { AttachedShadowInfo, ShadowHookHost } from '.';
import { installAttachShadowHook, watchOpenShadowAttachments } from '.';

describe('engines/shadow', () => {
  it('notifies on attachShadow, isolates throwing callbacks, and restores the original method', () => {
    const fakeRoot = {} as ShadowRoot;
    const original = vi.fn(function (this: Element, _init: ShadowRootInit) {
      return fakeRoot;
    }) as unknown as Element['attachShadow'];
    const proto = { attachShadow: original };
    const host: ShadowHookHost = { Element: { prototype: proto } };

    const seen: AttachedShadowInfo[] = [];
    const uninstall = installAttachShadowHook((info) => {
      seen.push(info);
      if (seen.length === 1) {
        throw new Error('observer boom');
      }
    }, host);

    const el = document.createElement('div');
    expect(proto.attachShadow.call(el, { mode: 'open' })).toBe(fakeRoot);
    expect(proto.attachShadow.call(el, { mode: 'closed' })).toBe(fakeRoot);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual({ host: el, root: fakeRoot, mode: 'open' });
    expect(seen[1]).toEqual({ host: el, root: fakeRoot, mode: 'closed' });

    uninstall();
    expect(proto.attachShadow).toBe(original);
    // Idempotent second uninstall.
    uninstall();
  });

  it('does not clobber another wrapper installed after ours', () => {
    const fakeRoot = {} as ShadowRoot;
    const original = vi.fn(() => fakeRoot) as unknown as Element['attachShadow'];
    const proto = { attachShadow: original };
    const host: ShadowHookHost = { Element: { prototype: proto } };

    const seen: AttachedShadowInfo[] = [];
    const uninstall = installAttachShadowHook((info) => seen.push(info), host);
    const ours = proto.attachShadow;
    const outer = vi.fn(function (this: Element, init: ShadowRootInit) {
      return ours.call(this, init);
    }) as unknown as Element['attachShadow'];
    proto.attachShadow = outer;

    uninstall();
    expect(proto.attachShadow).toBe(outer);
    const el = document.createElement('div');
    expect(proto.attachShadow.call(el, { mode: 'open' })).toBe(fakeRoot);
    // After uninstall our callback no longer fires even when invoked through `outer`.
    expect(seen).toHaveLength(0);
  });

  it('watchOpenShadowAttachments coalesces open attachments into one microtask batch, ignores closed roots, and cancels on teardown', async () => {
    const fakeRoot = {} as ShadowRoot;
    const original = vi.fn(() => fakeRoot) as unknown as Element['attachShadow'];
    const proto = { attachShadow: original };
    const host: ShadowHookHost = { Element: { prototype: proto } };

    const batches: number[] = [];
    const stop = watchOpenShadowAttachments((count) => batches.push(count), host);

    const el = document.createElement('div');
    proto.attachShadow.call(el, { mode: 'open' });
    proto.attachShadow.call(el, { mode: 'closed' });
    proto.attachShadow.call(el, { mode: 'open' });
    expect(batches).toEqual([]);

    await Promise.resolve();
    expect(batches).toEqual([2]);

    // Queue another open attachment and dispose before microtask flushes -> cancelled.
    proto.attachShadow.call(el, { mode: 'open' });
    stop();
    await Promise.resolve();
    expect(batches).toEqual([2]);
    expect(proto.attachShadow).toBe(original);
  });
});
