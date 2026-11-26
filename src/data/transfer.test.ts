import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { savedFilters } from '../core/filter-types';
import { readLocatorOverrides } from '../core/locator';
import { Options } from '../core/options';
import { SavedData } from '../core/saved';
import {
  applyThemePreset,
  DEFAULT_THEME_DOCUMENT,
  updateThemePalette,
  updateThemeTypography,
} from '../core/theming';
import { LOCATOR_OVERRIDES } from '../facebook/feature';
import { extensionStore } from '../platform/extension-store';
import {
  DEFAULT_VIDEO_SPEED,
  readSavedVideoSpeed,
  X_VIDEO_SPEED_KEY,
} from '../sites/x/features/video-speed-model';
import { readThemeDocument, THEME_DATA_KEY } from '../ui/appearance';
import { applyBackup, exportBackup, parseBackup, resetAllData } from './transfer';

const SPECS = {
  home_feed: {
    section: 'Home Feed',
    title: 'Feed',
    description: '',
    default: 'home',
    choices: [
      { value: 'home', label: 'Home' },
      { value: 'friends', label: 'Friends' },
    ],
  },
  hidden_keywords: {
    section: 'Hide Posts',
    title: 'Keywords',
    description: '',
    default: '',
  },
  hide_sponsored_posts: {
    section: 'Hide Posts',
    title: 'Hide ads',
    description: '',
    default: false,
  },
};

describe('data transfer', () => {
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
    options.register(SPECS);
    await options.load();
    data = new SavedData(extensionStore, 'u');
    const stores = makeStores();
    await Promise.all([stores.filters.ready, stores.locators.ready]);
  });

  it('exports and restores options, filters and locator overrides', async () => {
    const stores = makeStores();
    await stores.options.set('home_feed', 'friends');
    await stores.options.set('hidden_keywords', 'crypto');
    await stores.filters.set([
      {
        title: 'No ads',
        enabled: true,
        rules: [{ target: 'any', operator: 'contains', condition: { text: 'sale' } }],
        actions: [{ action: 'hide', show_note: true }],
      },
    ]);
    await stores.locators.set({ post: ['[role=article]'] });

    const json = exportBackup(stores);
    await resetAllData(stores);
    expect(stores.options.get('home_feed')).toBe('home');
    expect(stores.filters.get()).toEqual([]);
    expect(stores.locators.get()).toEqual({});

    const parsed = parseBackup(json, stores.options.list());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const summary = await applyBackup(parsed, stores);

    expect(summary).toBe('Imported 3 options, 1 filter, 1 locator override.');
    expect(stores.options.get('home_feed')).toBe('friends');
    expect(stores.options.get('hidden_keywords')).toBe('crypto');
    expect(stores.filters.get()).toHaveLength(1);
    expect(stores.locators.get()).toEqual({ post: ['[role=article]'] });
  });

  it('imports exported settings, skipping unknown or incompatible options', async () => {
    const stores = makeStores();
    const fsExport = JSON.stringify({
      options: {
        hidden_keywords: 'politics\nsports',
        hide_sponsored_posts: true,
        home_feed: 'not_a_choice',
        unknown_option_a: true,
        unknown_option_b: 100,
      },
      filters: {
        '0': {
          title: 'Imported filter',
          enabled: true,
          rules: { '0': { target: 'any', operator: 'contains', condition: { text: 'meme' } } },
          actions: { '0': { action: 'hide', show_note: true } },
        },
      },
    });

    const parsed = parseBackup(fsExport, stores.options.list());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const summary = await applyBackup(parsed, stores);

    expect(summary).toBe('Imported 2 options, 1 filter (3 unrecognised options skipped).');
    expect(stores.options.get('hidden_keywords')).toBe('politics\nsports');
    expect(stores.options.get('hide_sponsored_posts')).toBe(true);
    expect(stores.options.get('home_feed')).toBe('home');
    expect(stores.filters.get()[0]?.title).toBe('Imported filter');
  });

  it('rejects invalid JSON or objects with no recognised sections', () => {
    const specs = options.list();
    expect(parseBackup('{bad', specs)).toEqual({
      ok: false,
      error: 'The pasted text is not valid JSON.',
    });
    expect(parseBackup('[]', specs)).toEqual({
      ok: false,
      error: 'Settings data must be a JSON object.',
    });
    expect(parseBackup('{"other": 1}', specs)).toEqual({
      ok: false,
      error: 'No options, filters, theme or locator overrides were found in that JSON.',
    });
  });

  it('exports, imports, and resets saved theme documents and rejects malformed theme payloads', async () => {
    const stores = makeStores();
    const theme = data.value(THEME_DATA_KEY, readThemeDocument);
    await Promise.all([stores.filters.ready, stores.locators.ready, theme.ready]);
    const customNord = updateThemeTypography(
      updateThemePalette(applyThemePreset(DEFAULT_THEME_DOCUMENT, 'nord'), { accent: '#88c0d0' }),
      'serif',
    );
    await theme.set(customNord);

    const withTheme = { ...stores, theme };
    const exported = exportBackup(withTheme);
    expect(JSON.parse(exported).theme).toMatchObject({
      id: 'nord',
      typography: { preset: 'serif' },
    });

    await resetAllData(withTheme);
    expect(theme.get().id).toBe('default');
    expect(theme.get().palette).toBeNull();

    const parsed = parseBackup(exported, options.list());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const summary = await applyBackup(parsed, withTheme);
    expect(summary).toContain('theme');
    expect(theme.get()).toMatchObject({
      id: 'nord',
      palette: { accent: '#88c0d0' },
      typography: { preset: 'serif' },
    });

    // Non-ThemeDocumentV1 theme payloads are rejected with a clear validation error.
    const invalidThemeBackup = JSON.stringify({
      theme: { preset: 'warm-paper', font: 'mono' },
    });
    const parsedInvalid = parseBackup(invalidThemeBackup, options.list());
    expect(parsedInvalid.ok).toBe(false);
    if (!parsedInvalid.ok) {
      expect(parsedInvalid.error).toMatch(/format/i);
    }
  });

  it('tags backups with siteId, warns on cross-site import, and round-trips X custom video speed', async () => {
    const stores = makeStores();
    const videoSpeed = data.value(X_VIDEO_SPEED_KEY, readSavedVideoSpeed);
    await Promise.all([stores.filters.ready, stores.locators.ready, videoSpeed.ready]);
    await videoSpeed.set({ rate: 1.37, custom: true });

    const xStores = { ...stores, siteId: 'x', videoSpeed };
    const exported = exportBackup(xStores);
    const snapshot = JSON.parse(exported);
    expect(snapshot.site).toBe('x');
    expect(snapshot.videoSpeed).toEqual({ rate: 1.37, custom: true });

    await resetAllData(xStores);
    expect(videoSpeed.get()).toEqual(DEFAULT_VIDEO_SPEED);

    const parsed = parseBackup(exported, options.list());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const summary = await applyBackup(parsed, xStores);
    expect(summary).toContain('video speed');
    expect(summary).not.toContain('exported from');
    expect(videoSpeed.get()).toEqual({ rate: 1.37, custom: true });

    // Importing an X backup on Facebook still works cleanly and notes the site mismatch.
    const fbSummary = await applyBackup(parsed, { ...stores, siteId: 'facebook' });
    expect(fbSummary).toContain('Note: this backup was exported from x.');

    // Out-of-range video speed payloads are rejected cleanly.
    const badSpeed = parseBackup(JSON.stringify({ videoSpeed: { rate: 99, custom: true } }), []);
    expect(badSpeed.ok).toBe(false);
  });
});
