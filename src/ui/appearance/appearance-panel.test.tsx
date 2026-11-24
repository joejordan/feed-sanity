import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ThemeConfig, ThemeController } from '../../core/theming';
import { createDomEnvironment } from '../../core/dom-env';
import { Options } from '../../core/options';
import { SavedData } from '../../core/saved';
import { inMemoryStore } from '../../core/testing';
import {
  DEFAULT_THEME_CONFIG,
  MAX_THEME_FILE_BYTES,
  readEarlyThemeCss,
  resolveTheme,
  THEME_FILE_FORMAT,
  THEME_FONT_STACKS,
  writeEarlyThemeCss,
} from '../../core/theming';
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
        section: 'Filtering',
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
    await userEvent.click(screen.getByRole('button', { name: 'Filtering' }));
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

    // The redundant "Live preview · Reversible" badge is removed from Studio Vibes.
    expect(screen.queryByText(/Live preview/i)).toBeNull();

    // One-click Enter the Matrix vibe applies Hacker Terminal + Matrix Digital Rain + Glass + Glyphs.
    await userEvent.click(screen.getByRole('button', { name: /Enter the Matrix/i }));
    await vi.waitFor(() => {
      expect(saved.get().preset).toBe('terminal-phosphor');
      expect(saved.get().font).toBe('mono');
      expect(saved.get().effects?.backdrop).toBe('digital-rain');
      expect(saved.get().effects?.rainIntro).toBe('rain-in');
      expect(saved.get().effects?.surface).toBe('glass');
      expect(saved.get().effects?.click).toBe('matrix-burst');
    });

    // Matrix Rain tuner controls (including Rain intro) appear automatically and save live.
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Glyph charset' }), 'hex');
    await vi.waitFor(() => expect(saved.get().effects?.rainCharset).toBe('hex'));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Rain intro' }), 'filled');
    await vi.waitFor(() => expect(saved.get().effects?.rainIntro).toBe('filled'));

    // Switching to a static Color Theme clears active Studio effects AND resets vibe-owned mono font.
    await userEvent.click(screen.getByRole('button', { name: /Warm Paper/i }));
    await vi.waitFor(() => {
      expect(saved.get().preset).toBe('warm-paper');
      expect(saved.get().effects).toBeUndefined();
      expect(saved.get().font).toBe('default');
    });

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

  it('applies the Velvet Silk vibe and lets the Silk backdrop be picked on its own', async () => {
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

    const velvet = screen.getByRole('button', { name: /Velvet Silk/i });
    await userEvent.click(velvet);
    await vi.waitFor(() => {
      expect(saved.get().preset).toBe('crimson-velvet');
      expect(saved.get().effects?.backdrop).toBe('silk');
      expect(saved.get().effects?.surface).toBe('glass');
      expect(saved.get().effects?.click).toBe('ripple');
    });
    expect(velvet.getAttribute('aria-pressed')).toBe('true');

    // Silk is also a standalone background chip: switch away, then back.
    await userEvent.click(screen.getByRole('button', { name: /^Aurora/ }));
    await vi.waitFor(() => expect(saved.get().effects?.backdrop).toBe('aurora'));
    const silkChip = screen.getByRole('button', { name: /^Silk/ });
    await userEvent.click(silkChip);
    await vi.waitFor(() => expect(saved.get().effects?.backdrop).toBe('silk'));
    expect(silkChip.getAttribute('aria-pressed')).toBe('true');

    // The click-effects copy promises calm, interactive-only feedback.
    expect(screen.getByText(/Selecting text stays quiet/)).toBeTruthy();

    // Dragging a Studio slider live-previews immediately without writing mid-drag (even if paused >250ms),
    // commits once when released anywhere on the window (even outside the slider hitbox), and ignores trailing blur.
    const setSpy = vi.spyOn(saved, 'set');
    controller.previewMock.mockClear();
    const speedSlider = screen.getByRole<HTMLInputElement>('slider', { name: 'Motion speed' });
    fireEvent.pointerDown(speedSlider);
    fireEvent.input(speedSlider, { target: { value: '1.4' } });
    fireEvent.input(speedSlider, { target: { value: '1.65' } });
    expect(controller.previewMock).toHaveBeenCalledTimes(2);
    await new Promise((resolve) => setTimeout(resolve, 290));
    expect(setSpy).not.toHaveBeenCalled();

    globalThis.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    fireEvent.blur(speedSlider);
    await vi.waitFor(() => expect(saved.get().effects?.speed).toBe(1.65));
    expect(setSpy).toHaveBeenCalledTimes(1);

    // Non-pointer (keyboard) input commits automatically after the 250ms fallback debounce.
    fireEvent.input(speedSlider, { target: { value: '1.25' } });
    expect(setSpy).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(saved.get().effects?.speed).toBe(1.25));
    expect(setSpy).toHaveBeenCalledTimes(2);
    setSpy.mockRestore();
  });

  it('embeds External stylesheet inside the Custom CSS disclosure at the bottom of Appearance instead of a top-level card', async () => {
    const store = inMemoryStore();
    const options = new Options(store, 'test/options');
    options.register({
      custom_stylesheet_url: {
        section: 'Appearance',
        group: 'External Stylesheet',
        title: 'External CSS url',
        description: 'Link an external stylesheet.',
        default: '',
        hiddenInList: true,
      },
    });
    await options.load();
    const data = new SavedData(store, 'test');
    const saved = data.value(THEME_DATA_KEY, readThemeConfig);
    await saved.ready;
    const controller: ThemeController = {
      ...makeController(),
      audit: vi.fn().mockReturnValue(null),
    };
    const panel = appearancePanel(saved, controller);

    render(<OptionsDialog options={options} panels={[panel]} onClose={vi.fn()} />);

    // Not rendered as a standalone top-level card above the Appearance panel.
    expect(screen.queryByText('External Stylesheet')).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'External CSS url' })).toBeNull();

    // Custom CSS disclosure is the final disclosure at the bottom of Appearance.
    const disclosures = screen.getAllByRole('button', { name: /Customize colors|Custom CSS/i });
    expect(disclosures.at(-1)?.textContent).toContain('Custom CSS');

    // Expand Custom CSS and save an external stylesheet URL.
    await userEvent.click(screen.getByRole('button', { name: /Custom CSS/i }));
    const urlInput = screen.getByRole<HTMLInputElement>('textbox', { name: 'External CSS url' });
    await userEvent.type(urlInput, 'https://example.com/theme.css');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await vi.waitFor(() =>
      expect(options.get('custom_stylesheet_url')).toBe('https://example.com/theme.css'),
    );
    expect(screen.getByRole('button', { name: /Custom CSS/i }).textContent).toContain('Active');

    // Clearing resets the saved URL cleanly.
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await vi.waitFor(() => expect(options.get('custom_stylesheet_url')).toBe(''));
  });

  it('syncs earlyCacheSiteId with the saved theme without leaking an active preview into sessionStorage', async () => {
    const siteId = 'test-early-cache-preview';
    writeEarlyThemeCss(siteId, '');
    const env = createDomEnvironment({ doc: document });
    const store = inMemoryStore();
    const data = new SavedData(store, 'test');
    const saved = data.value(THEME_DATA_KEY, readThemeConfig);
    await saved.ready;

    const runtime = initSiteTheme(env, data, facebookThemeMapping, { earlyCacheSiteId: siteId });
    try {
      // Save Catppuccin Mocha while previewing Site Default (`null`): sessionStorage must
      // cache Catppuccin Mocha (`#1e1e2e`), NOT the null preview (`""`).
      runtime.controller.preview(null);
      await saved.set({ ...DEFAULT_THEME_CONFIG, preset: 'catppuccin-mocha' });
      await vi.waitFor(() => expect(readEarlyThemeCss(siteId)).toContain('#1e1e2e'));

      // Save Midnight Slate while previewing Warm Paper: sessionStorage must cache Midnight (`#0b0f17`).
      const warmPaper = resolveTheme({ ...DEFAULT_THEME_CONFIG, preset: 'warm-paper' });
      runtime.controller.preview(warmPaper);
      await saved.set({ ...DEFAULT_THEME_CONFIG, preset: 'midnight' });
      await vi.waitFor(() => expect(readEarlyThemeCss(siteId)).toContain('#0b0f17'));
      expect(readEarlyThemeCss(siteId)).not.toContain('#f4efe6');
    } finally {
      runtime.dispose();
      env.dispose();
      writeEarlyThemeCss(siteId, '');
    }
  });

  it('previews, validates, fixes contrast, gates custom CSS opt-in, and applies imported .fstheme.json files', async () => {
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
    await userEvent.click(screen.getByRole('button', { name: /Import \/ Export theme/i }));

    const sampleTheme = JSON.stringify({
      format: THEME_FILE_FORMAT,
      schemaVersion: 1,
      id: 'ocean-pulse',
      meta: { name: 'Ocean Pulse', author: 'Joe', description: 'Deep sea palette with glass' },
      palette: {
        colorScheme: 'light',
        background: '#ffffff',
        surface: '#f8fafc',
        text: '#d4d4d4',
        accent: '#0284c7',
      },
      effects: {
        backdrop: { id: 'aurora', intensity: 0.6 },
        surface: { finish: 'glass', glassStrength: 0.4 },
      },
      customCss: '.custom-rule { letter-spacing: 0.01em; }',
    });

    const pasteArea = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Paste theme JSON',
    });
    await userEvent.click(pasteArea);
    await userEvent.paste(sampleTheme);
    await userEvent.click(screen.getByRole('button', { name: 'Preview import' }));

    // Preview shows metadata, low-contrast warning, and unchecked custom CSS opt-in.
    expect(screen.getByText('Ocean Pulse')).toBeTruthy();
    expect(screen.getByText(/by Joe/)).toBeTruthy();
    expect(screen.getByText(/Low text contrast/)).toBeTruthy();
    const cssCheckbox = screen.getByRole<HTMLInputElement>('checkbox', {
      name: /Include custom CSS/i,
    });
    expect(cssCheckbox.checked).toBe(false);

    // One-click Fix contrast repairs the preview document before applying.
    await userEvent.click(screen.getByRole('button', { name: 'Fix contrast' }));
    expect(screen.queryByText(/Low text contrast/)).toBeNull();

    // Apply without checking custom CSS: palette + effects apply, custom CSS stays excluded.
    await userEvent.click(screen.getByRole('button', { name: 'Apply imported theme' }));
    await vi.waitFor(() => {
      expect(saved.get().document?.meta.name).toBe('Ocean Pulse');
      expect(saved.get().document?.palette?.text).toBe('#111111');
      expect(saved.get().effects?.backdrop).toBe('aurora');
      expect(saved.get().customCss).toBe('');
    });

    // Active imported theme banner appears at the top of Appearance and can reset cleanly.
    expect(screen.getByRole('region', { name: 'Active imported theme' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await vi.waitFor(() => {
      expect(saved.get().document).toBeUndefined();
      expect(saved.get().preset).toBe('default');
    });
  });

  it('supports custom CSS opt-in with preserved warnings, invalid/oversized file errors, Export, Copy JSON, and clearing imported font', async () => {
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
    await userEvent.click(screen.getByRole('button', { name: /Import \/ Export theme/i }));

    // Invalid JSON shows role="alert" and hides Apply button.
    const pasteArea = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Paste theme JSON',
    });
    await userEvent.click(pasteArea);
    await userEvent.paste('{broken');
    await userEvent.click(screen.getByRole('button', { name: 'Preview import' }));
    expect(screen.getByRole('alert').textContent).toContain('Invalid JSON syntax');
    expect(screen.queryByRole('button', { name: 'Apply imported theme' })).toBeNull();

    // Oversized file is rejected before reading.
    const fileInput = screen.getByLabelText<HTMLInputElement>('Import theme file');
    const hugeFile = new File(['x'.repeat(MAX_THEME_FILE_BYTES + 1)], 'huge.fstheme.json', {
      type: 'application/json',
    });
    await userEvent.upload(fileInput, hugeFile);
    expect(screen.getByRole('alert').textContent).toContain('64 KB limit');

    // Valid file upload with BOTH low contrast + stripped @import + customStack.
    const fileJson = JSON.stringify({
      format: THEME_FILE_FORMAT,
      schemaVersion: 1,
      id: 'imported-studio',
      meta: { name: 'Imported Studio' },
      palette: {
        colorScheme: 'light',
        background: '#ffffff',
        surface: '#f8fafc',
        text: '#d4d4d4',
        accent: '#0284c7',
      },
      typography: { customStack: '"IBM Plex Sans", sans-serif' },
      customCss: '@import url("https://evil.example/x.css"); .keep { border-radius: 8px; }',
    });
    const validFile = new File([fileJson], 'imported-studio.fstheme.json', {
      type: 'application/json',
    });
    await userEvent.upload(fileInput, validFile);

    await vi.waitFor(() => expect(screen.getByText('Imported Studio')).toBeTruthy());
    expect(screen.getByText(/Stripped 1 external\/unsafe CSS/)).toBeTruthy();

    // Fix contrast removes the contrast warning while keeping the stripped-CSS warning visible.
    await userEvent.click(screen.getByRole('button', { name: 'Fix contrast' }));
    expect(screen.queryByText(/Low text contrast/)).toBeNull();
    expect(screen.getByText(/Stripped 1 external\/unsafe CSS/)).toBeTruthy();

    // Opt-in custom CSS and apply.
    await userEvent.click(screen.getByRole('checkbox', { name: /Include custom CSS/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply imported theme' }));
    await vi.waitFor(() => {
      expect(saved.get().document?.meta.name).toBe('Imported Studio');
      expect(saved.get().customCss).toContain('.keep { border-radius: 8px; }');
      expect(saved.get().customCss).not.toContain('evil.example');
    });

    // Typography dropdown displays "Custom (imported)" and lets the user revert cleanly to Site default.
    const fontSelect = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Typography' });
    expect(fontSelect.value).toBe('__imported__');
    await userEvent.selectOptions(fontSelect, 'default');
    await vi.waitFor(() => {
      expect(saved.get().font).toBe('default');
      expect(saved.get().document?.typography?.customStack).toBeUndefined();
    });

    // Export triggers Blob download and Copy JSON writes canonical JSON to clipboard.
    const createUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    const revokeUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    try {
      await userEvent.click(screen.getByRole('button', { name: /Export \.fstheme\.json/i }));
      expect(createUrlSpy).toHaveBeenCalledTimes(1);
      await userEvent.click(screen.getByRole('button', { name: 'Copy JSON' }));
      await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
      expect(writeText.mock.calls[0]?.[0]).toContain('"format": "feed-sanity-theme"');
    } finally {
      createUrlSpy.mockRestore();
      revokeUrlSpy.mockRestore();
    }
  });
});
