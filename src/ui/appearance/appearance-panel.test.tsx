import { cleanup, render, screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ThemeConfig, ThemeController } from '../../core/theming';
import { createDomEnvironment } from '../../core/dom-env';
import { Options } from '../../core/options';
import { SavedData } from '../../core/saved';
import { inMemoryStore } from '../../core/testing';
import { DEFAULT_THEME_CONFIG, resolveTheme, THEME_FONT_STACKS } from '../../core/theming';
import { facebookThemeMapping } from '../../sites/facebook/theme-mapping';
import { setUserThemeCss } from '../mount';
import { OptionsDialog } from '../options-dialog/options-dialog';
import { appearancePanel, readThemeConfig, THEME_DATA_KEY } from './appearance-panel';
import { initSiteTheme } from './index';

afterEach(() => {
  cleanup();
  setUserThemeCss('');
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

function makeController(): ThemeController & {
  readonly applyMock: ReturnType<typeof vi.fn>;
  readonly previewMock: ReturnType<typeof vi.fn>;
  readonly clearPreviewMock: ReturnType<typeof vi.fn>;
} {
  const applyMock = vi.fn();
  const previewMock = vi.fn();
  const clearPreviewMock = vi.fn();
  return {
    apply: applyMock,
    preview: previewMock,
    clearPreview: clearPreviewMock,
    current: () => null,
    dispose: vi.fn(),
    applyMock,
    previewMock,
    clearPreviewMock,
  };
}

describe('appearancePanel & initSiteTheme', () => {
  it('reads corrupt or partial saved ThemeConfig values safely', () => {
    expect(readThemeConfig(null)).toEqual(DEFAULT_THEME_CONFIG);
    expect(readThemeConfig('invalid')).toEqual(DEFAULT_THEME_CONFIG);
    expect(readThemeConfig({ preset: 42, accent: '#123456', font: null })).toEqual({
      ...DEFAULT_THEME_CONFIG,
      accent: '#123456',
    });
  });

  it('previews edits live across OptionsDialog tab switches, clears on Cancel, validates hex, and saves', async () => {
    const store = inMemoryStore();
    const options = new Options(store, 'test/options');
    options.register({
      sample_opt: {
        section: 'Feed',
        title: 'Sample option',
        description: 'Sample',
        default: false,
      },
    });
    await options.load();

    const data = new SavedData(store, 'test');
    const saved = data.value(THEME_DATA_KEY, readThemeConfig);
    await saved.ready;
    const controller = makeController();
    const panel = appearancePanel(saved, controller);
    const onClose = vi.fn();

    const { unmount } = render(
      <OptionsDialog options={options} panels={[panel]} onClose={onClose} />,
    );

    // Switching to Appearance without editing must NOT trigger preview (so cross-tab sync stays live).
    await userEvent.click(screen.getByRole('button', { name: 'Appearance' }));
    expect(controller.previewMock).not.toHaveBeenCalled();

    // Selecting a preset previews it live.
    await userEvent.click(screen.getByRole('button', { name: /Catppuccin Mocha/i }));
    expect(controller.previewMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        palette: expect.objectContaining({ background: '#1e1e2e', accent: '#cba6f7' }),
      }),
    );

    // Switching to another tab inside the open dialog preserves the staged live preview.
    await userEvent.click(screen.getByRole('button', { name: 'Feed' }));
    expect(controller.clearPreviewMock).not.toHaveBeenCalled();

    // Returning to Appearance and selecting Site Default previews `null`.
    await userEvent.click(screen.getByRole('button', { name: 'Appearance' }));
    await userEvent.click(screen.getByRole('button', { name: /^Site Default/i }));
    expect(controller.previewMock).toHaveBeenLastCalledWith(null);

    // Clicking Cancel closes the dialog and invokes `panel.onClose` to clear preview cleanly.
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(controller.clearPreviewMock).toHaveBeenCalledTimes(1);
    unmount();
    expect(controller.clearPreviewMock).toHaveBeenCalledTimes(1);

    // Validation catches malformed hex strings and accepts valid ones.
    expect(panel.problem?.({ ...DEFAULT_THEME_CONFIG, accent: 'purple' })).toMatch(/hex color/i);
    expect(panel.problem?.({ ...DEFAULT_THEME_CONFIG, accent: '#cba6f7' })).toBeNull();

    // Save persists config, applies the resolved theme + font, and clears preview state.
    controller.clearPreviewMock.mockClear();
    const nextConfig: ThemeConfig = { ...DEFAULT_THEME_CONFIG, preset: 'nord', font: 'serif' };
    await panel.save(nextConfig);
    expect(saved.get()).toEqual(nextConfig);
    expect(controller.applyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        palette: expect.objectContaining({ background: '#2e3440' }),
        fontFamily: THEME_FONT_STACKS.serif,
      }),
    );
    expect(controller.clearPreviewMock).toHaveBeenCalledTimes(1);
  });

  it('hydrates stored theme in initSiteTheme, reacts to cross-tab storage updates, and unsubscribes on dispose', async () => {
    const store = inMemoryStore({
      'acct/theme': { ...DEFAULT_THEME_CONFIG, preset: 'midnight' },
    });
    const data = new SavedData(store, 'acct');
    const env = createDomEnvironment();
    const runtime = initSiteTheme(env, data, facebookThemeMapping);

    try {
      await vi.waitFor(() =>
        expect(document.querySelector('#feed_sanity_user_theme')?.textContent).toContain('#0b0f17'),
      );

      // External storage update (e.g., another tab) switches the theme live.
      await store.set('acct/theme', { ...DEFAULT_THEME_CONFIG, preset: 'warm-paper' });
      await vi.waitFor(() =>
        expect(document.querySelector('#feed_sanity_user_theme')?.textContent).toContain('#f4efe6'),
      );

      // Disposing clears injected styles and stops reacting to later storage updates.
      runtime.dispose();
      expect(document.querySelector('#feed_sanity_user_theme')).toBeNull();

      await store.set('acct/theme', { ...DEFAULT_THEME_CONFIG, preset: 'catppuccin-mocha' });
      expect(document.querySelector('#feed_sanity_user_theme')).toBeNull();
    } finally {
      runtime.dispose();
      env.dispose();
    }
  });

  it('respects active: false on load and save, and clears both applied and previewed styles on setActive(false)', async () => {
    const store = inMemoryStore({
      'acct/theme': { ...DEFAULT_THEME_CONFIG, preset: 'midnight' },
    });
    const data = new SavedData(store, 'acct');
    const env = createDomEnvironment();
    const runtime = initSiteTheme(env, data, facebookThemeMapping, { active: false });

    try {
      await runtime.panel.ready;
      // Starting inactive injects no theme CSS.
      expect(document.querySelector('#feed_sanity_user_theme')).toBeNull();

      // Saving a new theme while inactive persists it without injecting CSS onto the disabled site.
      await runtime.panel.save({ ...DEFAULT_THEME_CONFIG, preset: 'warm-paper' });
      expect(document.querySelector('#feed_sanity_user_theme')).toBeNull();

      // Activating applies the saved theme immediately.
      runtime.setActive(true);
      expect(document.querySelector('#feed_sanity_user_theme')?.textContent).toContain('#f4efe6');

      // Deactivating clears both live preview and applied theme without losing saved config.
      runtime.controller.preview(resolveTheme({ ...DEFAULT_THEME_CONFIG, preset: 'nord' }));
      expect(document.querySelector('#feed_sanity_user_theme')?.textContent).toContain('#2e3440');
      runtime.setActive(false);
      expect(document.querySelector('#feed_sanity_user_theme')).toBeNull();

      // Re-activating restores the saved Warm Paper theme cleanly (not the cleared Nord preview).
      runtime.setActive(true);
      expect(document.querySelector('#feed_sanity_user_theme')?.textContent).toContain('#f4efe6');
    } finally {
      runtime.dispose();
      env.dispose();
    }
  });
});
