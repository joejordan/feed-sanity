import { describe, expect, it, vi } from 'vitest';
import type { Store } from '../storage';
import { inMemoryStore } from '../testing';
import {
  applyThemePreset,
  createThemeLibrary,
  DEFAULT_THEME_DOCUMENT,
  MAX_LIBRARY_THEMES,
  readGlobalThemeRevision,
  readThemeLibraryState,
  THEME_FILE_FORMAT,
  THEME_LIBRARY_KEY,
  updateThemeCustomCss,
} from '../theming';

describe('core/theming/library', () => {
  it('validates stored library payloads, deduplicates entry IDs, skips malformed items, and enforces cap', () => {
    const midnight = applyThemePreset(DEFAULT_THEME_DOCUMENT, 'midnight');
    const warm = applyThemePreset(DEFAULT_THEME_DOCUMENT, 'warm-paper');

    expect(readGlobalThemeRevision(undefined)).toBe(0);
    expect(readGlobalThemeRevision(-5)).toBe(0);
    expect(readGlobalThemeRevision(1.5)).toBe(0);
    expect(readGlobalThemeRevision(42)).toBe(42);

    const parsed = readThemeLibraryState({
      schemaVersion: 1,
      themes: [
        { id: 'midnight', document: midnight, savedAt: 100, updatedAt: 200 },
        // Duplicate ID is dropped.
        { id: 'midnight', document: warm, savedAt: 300, updatedAt: 400 },
        // Invalid document is skipped cleanly.
        { id: 'broken', document: { format: 'wrong' }, savedAt: 500, updatedAt: 500 },
        { id: 'warm-paper', document: warm, savedAt: 600, updatedAt: 500 },
      ],
      globalTheme: { revision: 99, document: warm },
    });

    expect(parsed.themes).toHaveLength(2);
    expect(parsed.themes[0]?.id).toBe('midnight');
    expect(parsed.themes[1]?.id).toBe('warm-paper');
    // updatedAt is never earlier than savedAt.
    expect(parsed.themes[1]?.updatedAt).toBe(600);
    expect(parsed.globalTheme?.revision).toBe(99);
    expect(parsed.globalTheme?.document.id).toBe('warm-paper');

    // Oversized theme arrays are clamped cleanly to MAX_LIBRARY_THEMES.
    const oversized = readThemeLibraryState({
      schemaVersion: 1,
      themes: Array.from({ length: MAX_LIBRARY_THEMES + 10 }, (_, idx) => ({
        id: `theme-${idx}`,
        document: { ...midnight, id: `theme-${idx}`, meta: { name: `Theme ${idx}` } },
        savedAt: idx,
        updatedAt: idx,
      })),
    });
    expect(oversized.themes).toHaveLength(MAX_LIBRARY_THEMES);
  });

  it('supports save, unique IDs, overwrite, rename, delete + restore, custom CSS stripping, and cross-tab sync', async () => {
    const store = inMemoryStore();
    const libA = createThemeLibrary(store);
    const libB = createThemeLibrary(store);
    try {
      await Promise.all([libA.ready, libB.ready]);
      expect(libA.list()).toEqual([]);

      const customCssDoc = updateThemeCustomCss(
        applyThemePreset(DEFAULT_THEME_DOCUMENT, 'catppuccin-mocha'),
        '@import url("https://evil.test/x.css"); .card { border-radius: 12px; }',
      );

      // Save with custom CSS stripped when includeCustomCss is false.
      const first = await libA.saveTheme(customCssDoc, {
        name: 'Mocha Clean',
        includeCustomCss: false,
      });
      expect(first.id).toBe('mocha-clean');
      expect(first.document.meta.name).toBe('Mocha Clean');
      expect(first.document.customCss).toBeUndefined();

      // Cross-tab watcher receives updates automatically.
      expect(libB.list()).toHaveLength(1);
      expect(libB.list()[0]?.id).toBe('mocha-clean');

      // Saving another theme with the same base name allocates a unique suffix ID.
      const second = await libA.saveTheme(customCssDoc, { name: 'Mocha Clean' });
      expect(second.id).toBe('mocha-clean-2');
      expect(second.document.customCss).toBe('.card { border-radius: 12px; }');

      // In-place overwrite preserves entry ID and moves it to the top.
      const overwritten = await libA.saveTheme(applyThemePreset(DEFAULT_THEME_DOCUMENT, 'nord'), {
        entryId: first.id,
        name: 'Nord Updated',
      });
      expect(overwritten.id).toBe(first.id);
      expect(overwritten.document.meta.name).toBe('Nord Updated');
      expect(libA.list()[0]?.id).toBe(first.id);

      // Rename updates display name & slugified document ID in place.
      const renamed = await libA.renameTheme(second.id, 'Mocha Night');
      expect(renamed?.document.meta.name).toBe('Mocha Night');
      expect(renamed?.document.id).toBe('mocha-night');
      expect(libB.list().find((entry) => entry.id === second.id)?.document.meta.name).toBe(
        'Mocha Night',
      );

      // Delete returns removed entry so Undo can restore it cleanly.
      const removed = await libA.removeTheme(second.id);
      expect(removed?.id).toBe(second.id);
      expect(libA.list()).toHaveLength(1);
      await libA.restoreTheme(removed!);
      expect(libA.list()).toHaveLength(2);
    } finally {
      libA.dispose();
      libB.dispose();
    }
  });

  it('broadcasts applyToAllSites with strictly increasing revisions and refuses to overwrite on unread storage failure', async () => {
    const store = inMemoryStore();
    const lib = createThemeLibrary(store);
    try {
      await lib.ready;
      const first = await lib.applyToAllSites(applyThemePreset(DEFAULT_THEME_DOCUMENT, 'midnight'));
      const second = await lib.applyToAllSites(
        applyThemePreset(DEFAULT_THEME_DOCUMENT, 'warm-paper'),
      );
      expect(first.revision).toBeGreaterThan(0);
      expect(second.revision).toBeGreaterThan(first.revision);
      expect(lib.getGlobalTheme()?.document.id).toBe('warm-paper');
    } finally {
      lib.dispose();
    }

    // Storage read failure sets unread guard so subsequent saves refuse to clobber unseen data.
    const failingStore: Store = {
      get: vi.fn().mockRejectedValue(new Error('storage offline')),
      set: vi.fn().mockResolvedValue(undefined),
      onChange: () => () => undefined,
    };
    const brokenLib = createThemeLibrary(failingStore);
    try {
      await brokenLib.ready;
      await expect(
        brokenLib.saveTheme({
          format: THEME_FILE_FORMAT,
          schemaVersion: 1,
          id: 'test',
          meta: { name: 'Test' },
          palette: null,
        }),
      ).rejects.toThrow(`'${THEME_LIBRARY_KEY}' could not be read`);
      expect(failingStore.set).not.toHaveBeenCalled();
    } finally {
      brokenLib.dispose();
    }
  });

  it('enforces MAX_LIBRARY_THEMES on add while allowing overwrite, no-ops duplicate/full restores, and avoids double-hyphen IDs', async () => {
    const midnight = applyThemePreset(DEFAULT_THEME_DOCUMENT, 'midnight');
    const fullEntries = Array.from({ length: MAX_LIBRARY_THEMES }, (_, idx) => ({
      id: `theme-${idx}`,
      document: { ...midnight, id: `theme-${idx}`, meta: { name: `Theme ${idx}` } },
      savedAt: idx + 1,
      updatedAt: idx + 1,
    }));
    const fullStore = inMemoryStore({
      [THEME_LIBRARY_KEY]: { schemaVersion: 1, themes: fullEntries },
    });
    const fullLib = createThemeLibrary(fullStore);
    try {
      await fullLib.ready;
      await expect(fullLib.saveTheme(midnight, { name: 'One Too Many' })).rejects.toThrow(
        `My Themes library is full (${MAX_LIBRARY_THEMES} themes)`,
      );

      // Overwriting an existing entry succeeds even when at capacity.
      const replaced = await fullLib.saveTheme(midnight, {
        entryId: 'theme-0',
        name: 'Replaced Entry',
      });
      expect(replaced.id).toBe('theme-0');
      expect(fullLib.list()).toHaveLength(MAX_LIBRARY_THEMES);

      // restoreTheme is a safe no-op when full or when the entry ID already exists.
      await fullLib.restoreTheme({
        id: 'extra-entry',
        document: midnight,
        savedAt: 1,
        updatedAt: 1,
      });
      expect(fullLib.list()).toHaveLength(MAX_LIBRARY_THEMES);
    } finally {
      fullLib.dispose();
    }

    // Duplicate long slug whose 42-char slice ends in '-' must not emit '--2'.
    const slugStore = inMemoryStore();
    const slugLib = createThemeLibrary(slugStore);
    try {
      await slugLib.ready;
      const longName = 'midnight emerald aurora cyber glass theme pro';
      const first = await slugLib.saveTheme(midnight, { name: longName });
      const second = await slugLib.saveTheme(midnight, { name: longName });
      expect(second.id).not.toContain('--');
      const reloaded = readThemeLibraryState(await slugStore.get(THEME_LIBRARY_KEY));
      expect(reloaded.themes.map((entry) => entry.id)).toEqual([second.id, first.id]);
    } finally {
      slugLib.dispose();
    }
  });
});
