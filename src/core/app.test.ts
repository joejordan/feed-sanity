import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { extensionStore } from '../platform/extension-store';
import { startFeatures } from './app';
import { defineFeature } from './feature';
import { Options } from './options';
import { SavedData } from './saved';

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
    expect(
      await startFeatures(
        [feature],
        new Options(extensionStore, 'u/options'),
        undefined,
        new SavedData(extensionStore, 'u'),
      ),
    ).toEqual([]);
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
      undefined,
      new SavedData(extensionStore, 'u'),
    );
    expect(failed).toEqual(['broken', 'rejecting']);
    expect(started).toEqual(['working']);
  });

  it('hands each feature the page it was given', async () => {
    const page = { name: 'a page' };
    const seen: unknown[] = [];
    const feature = defineFeature({
      id: 'curious',
      setup: (ctx: { page: typeof page }) => {
        seen.push(ctx.page);
      },
    });

    await startFeatures(
      [feature],
      new Options(extensionStore, 'u/options'),
      page,
      new SavedData(extensionStore, 'u'),
    );

    expect(seen).toEqual([page]);
  });
});
