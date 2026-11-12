import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { Options } from './options';

const specs = {
  greeting: { section: 'General', title: 'Greeting', description: '', default: 'hello' },
  enabled: { section: 'General', title: 'Enabled', description: '', default: false },
};

function newOptions(): Options {
  const options = new Options('42/options');
  options.register(specs);
  return options;
}

describe('Options', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('reads the default when nothing was saved', async () => {
    const options = newOptions();
    await options.load();
    expect(options.get('greeting')).toBe('hello');
    expect(options.get('enabled')).toBe(false);
  });

  it('reads saved values in place of defaults', async () => {
    await browser.storage.local.set({ '42/options': { greeting: 'hi' } });
    const options = newOptions();
    await options.load();
    expect(options.get('greeting')).toBe('hi');
    expect(options.get('enabled')).toBe(false);
  });

  it('saves a changed value under its storage key', async () => {
    const options = newOptions();
    await options.load();
    await options.set('enabled', true);
    expect(await browser.storage.local.get('42/options')).toEqual({
      '42/options': { enabled: true },
    });
  });

  it('calls a watcher with the current value and with each change until stopped', async () => {
    const options = newOptions();
    await options.load();
    const listener = vi.fn();
    const stop = options.watch('greeting', listener);
    await options.set('greeting', 'hey');
    stop();
    await options.set('greeting', 'yo');
    expect(listener.mock.calls).toEqual([['hello'], ['hey']]);
  });

  it('still saves and tells the other watchers when one watcher throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const options = newOptions();
    await options.load();
    const later = vi.fn();
    options.watch('greeting', (value) => {
      if (value !== 'hello') {
        throw new Error('selector not found');
      }
    });
    options.watch('greeting', later);
    await options.set('greeting', 'hey');
    expect(later).toHaveBeenLastCalledWith('hey');
    expect(await browser.storage.local.get('42/options')).toEqual({
      '42/options': { greeting: 'hey' },
    });
  });

  it('stops telling watchers a value that one of them has already replaced', async () => {
    const options = newOptions();
    await options.load();
    options.watch('greeting', (value) => {
      if (value === 'hey') {
        void options.set('greeting', 'HEY');
      }
    });
    const later = vi.fn();
    options.watch('greeting', later);
    await options.set('greeting', 'hey');
    expect(later.mock.calls).toEqual([['hello'], ['HEY']]);
  });

  it('follows a value saved by another tab', async () => {
    const options = newOptions();
    await options.load();
    const listener = vi.fn();
    options.watch('greeting', listener);
    await browser.storage.local.set({ '42/options': { greeting: 'hi', enabled: true } });
    expect(listener.mock.calls).toEqual([['hello'], ['hi']]);

    // A save made here keeps what the other tab saved.
    await options.set('greeting', 'hey');
    expect(await browser.storage.local.get('42/options')).toEqual({
      '42/options': { greeting: 'hey', enabled: true },
    });

    await browser.storage.local.remove('42/options');
    expect(listener).toHaveBeenLastCalledWith('hello');
    expect(options.get('enabled')).toBe(false);
  });

  it('keeps a value set here when the report of an older save arrives late', async () => {
    const options = newOptions();
    await options.load();
    await options.set('greeting', 'hey');
    await options.set('enabled', true);
    const listener = vi.fn();
    options.watch('enabled', listener);
    // The first save's report, as storage would deliver it after the second.
    await fakeBrowser.storage.onChanged.trigger(
      { '42/options': { oldValue: undefined, newValue: { greeting: 'hey' } } },
      'local',
    );
    expect(options.get('enabled')).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('reads the default when the saved value has the wrong type', async () => {
    await browser.storage.local.set({ '42/options': { greeting: 5, enabled: 'yes' } });
    const options = newOptions();
    await options.load();
    expect(options.get('greeting')).toBe('hello');
    expect(options.get('enabled')).toBe(false);
  });

  it('does nothing when the value is unchanged', async () => {
    const options = newOptions();
    await options.load();
    const listener = vi.fn();
    options.watch('greeting', listener);
    await options.set('greeting', 'hello');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(await browser.storage.local.get('42/options')).toEqual({});
  });

  it('rejects an option key that two features both define', () => {
    const options = newOptions();
    expect(() => options.register({ greeting: specs.greeting })).toThrow(/defined twice/);
  });

  it('rejects an unknown key', async () => {
    await browser.storage.local.set({ '42/options': { missing: 1 } });
    const options = newOptions();
    await options.load();
    expect(() => options.get('missing')).toThrow(/Unknown option/);
    await expect(options.set('missing', 1)).rejects.toThrow(/Unknown option/);
  });
});
