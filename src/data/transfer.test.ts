import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { Filter } from '../core/filter-types';
import { savedFilters } from '../core/filter-types';
import { readLocatorOverrides } from '../core/locator';
import { Options } from '../core/options';
import { SavedData } from '../core/saved';
import { createSiteSettings } from '../core/site-settings';
import {
  applyThemePreset,
  createThemeLibrary,
  DEFAULT_THEME_DOCUMENT,
  updateThemePalette,
  updateThemeTypography,
} from '../core/theming';
import { LOCATOR_OVERRIDES } from '../facebook/feature';
import { savedReadHistory } from '../facebook/read-history';
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
    section: 'Filtering',
    title: 'Keywords',
    description: '',
    default: '',
  },
  hide_sponsored_posts: {
    section: 'Filtering',
    title: 'Hide ads',
    description: '',
    default: false,
  },
  read_posts_keep_days: {
    section: 'Feed & Reading',
    title: 'Keep days',
    description: '',
    default: 30,
  },
};

const NO_ADS: Filter = {
  id: 'fnoads',
  name: 'No ads',
  description: 'Hides sale posts',
  enabled: true,
  join: 'all',
  stopAfter: true,
  conditions: [
    { kind: 'text', part: 'text', test: 'contains', values: ['sale'], wholeWords: true },
    { kind: 'weekday', days: [1, 2] },
  ],
  actions: [{ kind: 'hide' }, { kind: 'style', css: 'opacity: 0.5' }],
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
    await stores.options.set('read_posts_keep_days', 7);
    await stores.filters.set([NO_ADS]);
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

    expect(summary).toBe('Imported 4 options, 1 filter, 1 locator override.');
    expect(stores.options.get('home_feed')).toBe('friends');
    expect(stores.options.get('hidden_keywords')).toBe('crypto');
    expect(stores.options.get('read_posts_keep_days')).toBe(7);
    expect(stores.filters.get()).toEqual([NO_ADS]);
    expect(stores.locators.get()).toEqual({ post: ['[role=article]'] });
  });

  it('skips and counts unknown, mistyped and invalid-choice options', async () => {
    const stores = makeStores();
    const parsed = parseBackup(
      JSON.stringify({
        options: {
          not_a_real_option: true,
          hidden_keywords: 42,
          hide_sponsored_posts: 'yes',
          home_feed: 'nowhere',
          read_posts_keep_days: null,
          also_not_real: 'x',
          hide_sponsored_posts_extra: false,
          home_feed_copy: 'home',
        },
      }),
      options.list(),
    );
    expect(parsed).toMatchObject({ ok: true, options: {}, skippedOptions: 8 });

    const mixed = parseBackup(
      JSON.stringify({
        options: { not_a_real_option: 1, hide_sponsored_posts: true, home_feed: 'friends' },
      }),
      options.list(),
    );
    expect(mixed.ok).toBe(true);
    if (!mixed.ok) {
      return;
    }
    expect(mixed.options).toEqual({ hide_sponsored_posts: true, home_feed: 'friends' });
    const summary = await applyBackup(mixed, stores);
    expect(summary).toBe('Imported 2 options (1 unrecognised option skipped).');
    expect(stores.options.get('hide_sponsored_posts')).toBe(true);
  });

  it('imports no filters when "filters" is not a list, and keeps the saved ones', async () => {
    const stores = makeStores();
    await stores.filters.set([NO_ADS]);
    for (const filters of [{ 0: NO_ADS }, 'hide everything', 7, null]) {
      const parsed = parseBackup(JSON.stringify({ filters }), options.list());
      expect(parsed).toMatchObject({ ok: true, filters: undefined });
      if (parsed.ok) {
        expect(await applyBackup(parsed, stores)).toBe('Nothing matched to import.');
      }
    }
    expect(stores.filters.get()).toEqual([NO_ADS]);
  });

  it('flags a backup from another site', () => {
    const parsed = parseBackup(JSON.stringify({ site: 'X', options: {} }), options.list());
    expect(parsed).toMatchObject({ ok: true, site: 'x' });
  });

  it('resets the read history along with everything else', async () => {
    const stores = makeStores();
    const readHistory = savedReadHistory(data);
    await readHistory.ready;
    await readHistory.set({ '1234567890': Date.now() });
    expect(Object.keys(readHistory.get())).toHaveLength(1);

    const withHistory = { ...stores, readHistory };
    expect(JSON.parse(exportBackup(withHistory))).not.toHaveProperty('readHistory');
    await resetAllData(withHistory);
    expect(readHistory.get()).toEqual({});
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
      error: 'No options, filters, themes or locator overrides were found in that JSON.',
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

  it('exports and merges global My Themes library and site toggles without clobbering existing saved themes', async () => {
    const stores = makeStores();
    const themeLibrary = createThemeLibrary(extensionStore);
    const siteSettings = createSiteSettings(extensionStore);
    await Promise.all([
      stores.filters.ready,
      stores.locators.ready,
      themeLibrary.ready,
      siteSettings.ready,
    ]);

    const nord = applyThemePreset(DEFAULT_THEME_DOCUMENT, 'nord');
    const paper = applyThemePreset(DEFAULT_THEME_DOCUMENT, 'warm-paper');
    await themeLibrary.saveTheme(nord, { name: 'Nord Saved' });
    await siteSettings.setEnabled('reddit', true);

    const exported = exportBackup({ ...stores, siteId: 'facebook', themeLibrary, siteSettings });
    const snapshot = JSON.parse(exported);
    expect(snapshot.myThemes).toHaveLength(1);
    expect(snapshot.sites.reddit).toBe(true);

    // Mutate state locally (keep an extra theme, disable reddit), then re-import.
    await themeLibrary.saveTheme(paper, { name: 'Local Paper' });
    await siteSettings.setEnabled('reddit', false);

    const parsed = parseBackup(exported, options.list());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    // Nord is already present by fingerprint, so re-importing merges without duplicates.
    const summary = await applyBackup(parsed, {
      ...stores,
      siteId: 'facebook',
      themeLibrary,
      siteSettings,
    });
    expect(summary).toContain('site toggle');
    expect(themeLibrary.list().map((e) => e.document.meta.name)).toEqual([
      'Local Paper',
      'Nord Saved',
    ]);
    expect(siteSettings.isEnabled('reddit')).toBe(true);

    // Removing Nord then re-importing restores Nord while preserving Local Paper.
    const nordEntry = themeLibrary.list().find((e) => e.document.meta.name === 'Nord Saved');
    if (nordEntry) {
      await themeLibrary.removeTheme(nordEntry.id);
    }
    expect(themeLibrary.list()).toHaveLength(1);
    const mergedSummary = await applyBackup(parsed, {
      ...stores,
      siteId: 'facebook',
      themeLibrary,
      siteSettings,
    });
    expect(mergedSummary).toContain('1 saved theme');
    expect(themeLibrary.list()).toHaveLength(2);
    themeLibrary.dispose();
    siteSettings.dispose?.();
  });
});
