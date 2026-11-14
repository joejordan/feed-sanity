import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { extensionStore } from '../platform/extension-store';
import { SavedData } from './saved';

const readList = (stored: unknown): string[] => (Array.isArray(stored) ? stored : []);

describe('SavedData', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('reads the stored value, and nothing saved as what `read` makes of it', async () => {
    await browser.storage.local.set({ 'u/words': ['a', 'b'] });
    const data = new SavedData(extensionStore, 'u');

    const words = data.value('words', readList);
    const others = data.value('others', readList);
    expect(words.get()).toEqual([]);
    await Promise.all([words.ready, others.ready]);

    expect(words.get()).toEqual(['a', 'b']);
    expect(others.get()).toEqual([]);
  });

  it('gives every caller the same value for a name', () => {
    const data = new SavedData(extensionStore, 'u');

    expect(data.value('words', readList)).toBe(data.value('words', readList));
  });

  it('saves under the prefix and tells listeners', async () => {
    const words = new SavedData(extensionStore, 'u').value('words', readList);
    await words.ready;
    const listener = vi.fn<(value: string[]) => void>();
    words.onChange(listener);

    await words.set(['c']);

    expect(words.get()).toEqual(['c']);
    expect(listener).toHaveBeenLastCalledWith(['c']);
    expect(await browser.storage.local.get('u/words')).toEqual({ 'u/words': ['c'] });
  });

  it('follows a save made in another tab', async () => {
    const words = new SavedData(extensionStore, 'u').value('words', readList);
    await words.ready;
    const listener = vi.fn<(value: string[]) => void>();
    words.onChange(listener);

    await browser.storage.local.set({ 'u/words': ['elsewhere'] });

    expect(words.get()).toEqual(['elsewhere']);
    expect(listener).toHaveBeenLastCalledWith(['elsewhere']);
  });

  it('is ready even when the store cannot be read', async () => {
    const broken = {
      ...extensionStore,
      get: () => Promise.reject(new Error('storage is gone')),
    };
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const words = new SavedData(broken, 'u').value('words', readList);
    await words.ready;

    expect(words.get()).toEqual([]);
    expect(error).toHaveBeenCalled();
    // What is stored was never seen, so it must not be replaced.
    await expect(words.set(['new'])).rejects.toThrow('could not be read');
    error.mockRestore();
  });
});
