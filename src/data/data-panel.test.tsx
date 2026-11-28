import { cleanup, render, screen } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { savedFilters } from '../core/filter-types';
import { readLocatorOverrides } from '../core/locator';
import { Options } from '../core/options';
import { SavedData } from '../core/saved';
import { LOCATOR_OVERRIDES } from '../facebook/feature';
import { extensionStore } from '../platform/extension-store';
import { OptionsDialog } from '../ui/options-dialog/options-dialog';
import { DataPanel, dataPanel } from './data-panel';

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

  it('emits a single status live region inside OptionsDialog when notify is provided', async () => {
    const stores = makeStores();
    render(
      <OptionsDialog
        options={stores.options}
        panels={[dataPanel(stores)]}
        initialSection="Backup & Reset"
        onClose={() => undefined}
      />,
    );

    const box = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Settings JSON to import',
    });
    await userEvent.click(box);
    await userEvent.paste('{"options":{"hidden_keywords":"promo"}}');
    await userEvent.click(screen.getByRole('button', { name: 'Import JSON' }));

    await vi.waitFor(() => expect(stores.options.get('hidden_keywords')).toBe('promo'));
    const statuses = screen.getAllByRole('status');
    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.textContent).toContain('Imported 1 option.');
  });

  it('requires confirmation before importing a backup exported from a different site and scopes the copy to the site', async () => {
    const stores = { ...makeStores(), siteId: 'x' };
    render(<DataPanel stores={stores} siteName="X (Twitter)" />);

    // Non-Facebook sites label Reset with the site name.
    expect(screen.getByRole('button', { name: 'Reset X (Twitter) settings' })).toBeTruthy();

    const box = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Settings JSON to import',
    });
    await userEvent.click(box);
    await userEvent.paste('{"site":"facebook","options":{"hidden_keywords":"cross-site"}}');
    await userEvent.click(screen.getByRole('button', { name: 'Import JSON' }));

    // Does not overwrite before confirmation.
    expect(stores.options.get('hidden_keywords')).toBe('');
    expect(screen.getByRole('alert').textContent).toContain('exported from facebook');

    await userEvent.click(screen.getByRole('button', { name: 'Import anyway' }));
    await vi.waitFor(() => expect(stores.options.get('hidden_keywords')).toBe('cross-site'));
  });

  it('shows live backup snapshot summary metrics and restores a dropped JSON file', async () => {
    const stores = makeStores();
    render(<DataPanel stores={stores} siteName="Facebook" />);

    const summary = screen.getByRole('group', { name: 'Current configuration summary' });
    expect(summary.textContent).toContain('0');
    expect(summary.textContent).toContain('Customized options');

    const dropzone = screen
      .getByRole('button', { name: 'Load from file...' })
      .closest('.data-dropzone') as HTMLElement;
    const file = new File(
      [JSON.stringify({ options: { hidden_keywords: 'dropped-term' }, filters: [] })],
      'backup.json',
      { type: 'application/json' },
    );
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(dropEvent, 'dataTransfer', { value: { files: [file] } });
    dropzone.dispatchEvent(dropEvent);

    await vi.waitFor(() => expect(stores.options.get('hidden_keywords')).toBe('dropped-term'));
    expect(screen.getByRole('status').textContent).toContain('Imported 1 option');
    await vi.waitFor(() => expect(summary.textContent).toContain('1'));
  });
});
