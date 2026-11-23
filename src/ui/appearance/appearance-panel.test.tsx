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

  it('applies presets instantly with live preview, clears preview on close, validates hex, and saves', async () => {
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

    // Selecting a preset previews and saves it immediately.
    await userEvent.click(screen.getByRole('button', { name: /Catppuccin Mocha/i }));
    expect(controller.previewMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        palette: expect.objectContaining({ background: '#1e1e2e', accent: '#cba6f7' }),
      }),
    );
    await vi.waitFor(() => expect(saved.get().preset).toBe('catppuccin-mocha'));

    // Switching to another tab inside the open dialog keeps the saved theme intact.
    await userEvent.click(screen.getByRole('button', { name: 'Feed' }));
    await userEvent.click(screen.getByRole('button', { name: 'Appearance' }));
    await userEvent.click(screen.getByRole('button', { name: /^Site Default/i }));
    expect(controller.previewMock).toHaveBeenLastCalledWith(null);
    await vi.waitFor(() => expect(saved.get().preset).toBe('default'));

    // Closing the dialog invokes `panel.onClose` to clear preview cleanly.
    controller.clearPreviewMock.mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
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

  it('warns inline on low WCAG AA contrast and fixes text color in one click', async () => {
    const store = inMemoryStore({
      'test/theme': {
        ...DEFAULT_THEME_CONFIG,
        preset: 'warm-paper',
        background: '#ffffff',
        surface: '#f8fafc',
        text: '#dddddd',
      },
    });
    const options = new Options(store, 'test/options');
    await options.load();
    const data = new SavedData(store, 'test');
    const saved = data.value(THEME_DATA_KEY, readThemeConfig);
    await saved.ready;
    const controller = makeController();
    const panel = appearancePanel(saved, controller);

    render(<OptionsDialog options={options} panels={[panel]} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Appearance' }));

    expect(screen.getByText(/Low text contrast/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Fix contrast' }));
    expect(screen.queryByText(/Low text contrast/)).toBeNull();
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Primary text' }).value).toBe(
      '#111111',
    );
  });

  it('runs theme audit and auto-heal from the Appearance panel and clears stale results on edit', async () => {
    const store = inMemoryStore({
      'test/theme': { ...DEFAULT_THEME_CONFIG, preset: 'midnight' },
    });
    const options = new Options(store, 'test/options');
    await options.load();
    const data = new SavedData(store, 'test');
    const saved = data.value(THEME_DATA_KEY, readThemeConfig);
    await saved.ready;

    const auditMock = vi
      .fn()
      .mockReturnValueOnce({
        score: 80,
        totalChecked: 10,
        summary: { contrast: 1, polarityLeak: 1, layoutShift: 0, headerOcclusion: 0 },
        violations: [
          {
            kind: 'polarity-leak' as const,
            selector: 'div.popup',
            detail: 'Light background on dark theme',
          },
          {
            kind: 'contrast' as const,
            selector: 'div.popup',
            detail: 'Contrast 1.9:1 < 4.5:1',
          },
        ],
      })
      .mockReturnValueOnce({
        score: 100,
        totalChecked: 10,
        summary: { contrast: 0, polarityLeak: 0, layoutShift: 0, headerOcclusion: 0 },
        violations: [],
      });
    const healNowMock = vi.fn().mockReturnValue(2);
    const controller: ThemeController = {
      ...makeController(),
      audit: auditMock,
      healNow: healNowMock,
    };
    const panel = appearancePanel(saved, controller);

    render(<OptionsDialog options={options} panels={[panel]} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Appearance' }));
    await userEvent.click(screen.getByRole('button', { name: /Theme health & layout check/i }));

    await userEvent.click(screen.getByRole('button', { name: 'Audit page' }));
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/80% coverage/)).toBeTruthy();
    expect(screen.getAllByText(/div\.popup/).length).toBeGreaterThan(0);
    const healButton = screen.getByRole<HTMLButtonElement>('button', { name: 'Auto-heal now' });
    expect(healButton.disabled).toBe(false);

    await userEvent.click(healButton);
    expect(healNowMock).toHaveBeenCalledTimes(1);
    expect(auditMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/100% coverage/)).toBeTruthy();
    expect(screen.getByText(/Fixed 2 elements on this page \(80% → 100%\)/)).toBeTruthy();
    // Once 0 contrast/surface issues remain, Auto-heal now disables until another issue is found.
    expect(healButton.disabled).toBe(true);

    // Editing the theme clears stale audit output immediately and re-enables Auto-heal now.
    await userEvent.click(screen.getByRole('button', { name: /Nord/i }));
    expect(screen.queryByText(/100% coverage/)).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Auto-heal now' }).disabled).toBe(
      false,
    );
  });

  it('reports remaining issues accurately when Auto-heal now returns 0 with unresolved contrast violations', async () => {
    const store = inMemoryStore({
      'test/theme': { ...DEFAULT_THEME_CONFIG, preset: 'midnight' },
    });
    const options = new Options(store, 'test/options');
    await options.load();
    const data = new SavedData(store, 'test');
    const saved = data.value(THEME_DATA_KEY, readThemeConfig);
    await saved.ready;

    const controller: ThemeController = {
      ...makeController(),
      audit: vi.fn().mockReturnValue({
        score: 90,
        totalChecked: 10,
        summary: { contrast: 1, polarityLeak: 0, layoutShift: 0, headerOcclusion: 0 },
        violations: [
          { kind: 'contrast', selector: 'span.custom', detail: 'Contrast 2.1:1 < 4.5:1' },
        ],
      }),
      healNow: vi.fn().mockReturnValue(0),
    };
    const panel = appearancePanel(saved, controller);

    render(<OptionsDialog options={options} panels={[panel]} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Appearance' }));
    await userEvent.click(screen.getByRole('button', { name: /Theme health & layout check/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Auto-heal now' }));

    expect(screen.getByText(/1 remaining contrast\/surface issue needs/)).toBeTruthy();
    expect(screen.queryByText(/no unhealed contrast or surface issues found/)).toBeNull();
  });

  it('applies Studio Vibes (Enter the Matrix, Vice City VI), exposes Matrix Rain tuners, and resets effects cleanly', async () => {
    const store = inMemoryStore();
    const options = new Options(store, 'test/options');
    await options.load();
    const data = new SavedData(store, 'test');
    const saved = data.value(THEME_DATA_KEY, readThemeConfig);
    await saved.ready;
    const controller = makeController();
    const panel = appearancePanel(saved, controller);

    render(<OptionsDialog options={options} panels={[panel]} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Appearance' }));

    // One-click Enter the Matrix vibe applies Hacker Terminal + Matrix Digital Rain + Glass + Glyphs.
    await userEvent.click(screen.getByRole('button', { name: /Enter the Matrix/i }));
    await vi.waitFor(() => {
      expect(saved.get().preset).toBe('terminal-phosphor');
      expect(saved.get().effects?.backdrop).toBe('digital-rain');
      expect(saved.get().effects?.surface).toBe('glass');
      expect(saved.get().effects?.click).toBe('matrix-burst');
    });

    // Matrix Rain tuner controls appear automatically and save live.
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Glyph charset' }), 'hex');
    await vi.waitFor(() => expect(saved.get().effects?.rainCharset).toBe('hex'));

    // Switching to Vice City VI vibe activates GTA VI Vice Horizon + Gradient + Sparks.
    await userEvent.click(screen.getByRole('button', { name: /Vice City VI/i }));
    await vi.waitFor(() => {
      expect(saved.get().preset).toBe('sunset-vapor');
      expect(saved.get().effects?.backdrop).toBe('vice-horizon');
      expect(saved.get().effects?.surface).toBe('gradient');
      expect(saved.get().effects?.click).toBe('spark');
    });

    // Reset effects clears all studio effects while keeping the color palette intact.
    await userEvent.click(screen.getByRole('button', { name: 'Reset effects' }));
    await vi.waitFor(() => {
      expect(saved.get().preset).toBe('sunset-vapor');
      expect(saved.get().effects).toBeUndefined();
    });
  });
});
