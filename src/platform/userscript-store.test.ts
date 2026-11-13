import { afterEach, describe, expect, it, vi } from 'vitest';
import { userscriptStore } from './userscript-store';

type ChangeListener = (name: string, oldValue: unknown, newValue: unknown, remote: boolean) => void;

function stubGM(): Map<string, unknown> {
  const values = new Map<string, unknown>();
  vi.stubGlobal('GM', {
    getValue: (name: string) => Promise.resolve(values.get(name)),
    setValue: (name: string, value: unknown) => {
      values.set(name, value);
      return Promise.resolve();
    },
  });
  return values;
}

describe('userscriptStore', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads and writes through GM.getValue and GM.setValue', async () => {
    const values = stubGM();
    expect(await userscriptStore.get('7/options')).toBeUndefined();
    await userscriptStore.set('7/options', { enabled: true });
    expect(values.get('7/options')).toEqual({ enabled: true });
    expect(await userscriptStore.get('7/options')).toEqual({ enabled: true });
  });

  it('reports changes where the manager has a change listener', () => {
    const registered: [string, ChangeListener][] = [];
    vi.stubGlobal('GM_addValueChangeListener', (name: string, listener: ChangeListener) => {
      registered.push([name, listener]);
    });
    const listener = vi.fn();
    userscriptStore.onChange('7/options', listener);

    expect(registered.map(([name]) => name)).toEqual(['7/options']);
    registered[0]?.[1]('7/options', { a: 1 }, { a: 2 }, true);
    expect(listener).toHaveBeenCalledWith({ a: 1 }, { a: 2 });
  });

  it('does nothing about changes in Greasemonkey, which has no change listener', () => {
    vi.stubGlobal('GM_addValueChangeListener', undefined);
    expect(() => userscriptStore.onChange('7/options', vi.fn())).not.toThrow();
  });
});
