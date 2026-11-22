import { cleanup, render, screen } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { readLocatorOverrides } from '../core/locator';
import { Options } from '../core/options';
import { SavedData } from '../core/saved';
import { LOCATOR_OVERRIDES } from '../facebook/feature';
import { savedFilters } from '../features/post-filters/types';
import { extensionStore } from '../platform/extension-store';
import { DataPanel } from './data-panel';

afterEach(cleanup);

describe('DataPanel', () => {
  let options: Options;
  let data: SavedData;

  const makeStores = () => ({
    options,
    filters: savedFilters(data),
    locators: data.value(LOCATOR_OVERRIDES, readLocatorOverrides),
  });

  beforeEach(async () => {
    fakeBrowser.reset();
    options = new Options(extensionStore, 'u/options');
    options.register({
      hidden_keywords: { section: 'Hide Posts', title: 'Keywords', description: '', default: '' },
    });
    await options.load();
    data = new SavedData(extensionStore, 'u');
    const stores = makeStores();
    await Promise.all([stores.filters.ready, stores.locators.ready]);
  });

  it('copies exported settings JSON to the clipboard', async () => {
    const stores = makeStores();
    await stores.options.set('hidden_keywords', 'crypto');
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

    render(<DataPanel stores={stores} />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy JSON' }));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(JSON.parse(writeText.mock.calls[0]?.[0] ?? '{}')).toEqual({
      options: { hidden_keywords: 'crypto' },
      filters: [],
    });
    expect(screen.getByRole('status').textContent).toContain('copied');
    vi.unstubAllGlobals();
  });

  it('imports pasted JSON, shows errors on bad JSON, and confirms before resetting', async () => {
    const stores = makeStores();
    render(<DataPanel stores={stores} />);

    const box = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Settings JSON to import',
    });
    const importBtn = screen.getByRole<HTMLButtonElement>('button', { name: 'Import JSON' });
    expect(importBtn.disabled).toBe(true);

    await userEvent.type(box, 'not-json');
    await userEvent.click(importBtn);
    expect(screen.getByRole('status').textContent).toContain('not valid JSON');

    await userEvent.clear(box);
    await userEvent.click(box);
    await userEvent.paste('{"options":{"hidden_keywords":"giveaway"}}');
    await userEvent.click(importBtn);

    await vi.waitFor(() => expect(stores.options.get('hidden_keywords')).toBe('giveaway'));
    expect(screen.getByRole('status').textContent).toContain('Imported 1 option.');

    // Two-step reset confirmation.
    await userEvent.click(screen.getByRole('button', { name: 'Reset all settings' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm reset' }));
    await vi.waitFor(() => expect(stores.options.get('hidden_keywords')).toBe(''));
    expect(screen.getByRole('status').textContent).toContain('reset to defaults');
  });
});
