import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { extensionStore } from '../platform/extension-store';
import { startFeatures } from './app';
import { defineFeature } from './feature';
import { Options } from './options';

describe('startFeatures', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('gives each feature its saved option values', async () => {
    await browser.storage.local.set({ 'u/options': { size: 12 } });
    const seen: number[] = [];
    const feature = defineFeature({
      id: 'sized',
      options: { size: { section: 'General', title: 'Size', description: '', default: 10 } },
      setup: ({ options }) => {
        seen.push(options.get('size'));
      },
    });
    expect(await startFeatures([feature], new Options(extensionStore, 'u/options'))).toEqual([]);
    expect(seen).toEqual([12]);
  });

  it('keeps starting the other features when one throws', async () => {
    const started: string[] = [];
    const broken = defineFeature({
      id: 'broken',
      setup: () => {
        throw new Error('selector not found');
      },
    });
    const rejecting = defineFeature({
      id: 'rejecting',
      setup: () => Promise.reject(new Error('timed out')),
    });
    const working = defineFeature({
      id: 'working',
      setup: () => {
        started.push('working');
      },
    });
    const failed = await startFeatures(
      [broken, rejecting, working],
      new Options(extensionStore, 'u/options'),
    );
    expect(failed).toEqual(['broken', 'rejecting']);
    expect(started).toEqual(['working']);
  });
});
