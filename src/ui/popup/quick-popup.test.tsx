import { cleanup, render, screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFilters } from '../../core/filter-types';
import { Options } from '../../core/options';
import { SITES_STORAGE_KEY } from '../../core/site-settings';
import { inMemoryStore } from '../../core/testing';
import { STUDIO_VIBES } from '../../core/theme-effects';
import {
  applyStudioVibe,
  applyThemeDocument,
  DEFAULT_THEME_DOCUMENT,
  isCustomImportedDocument,
  parseThemeDocument,
  readThemeDocument,
  THEME_DATA_KEY,
  THEME_FILE_FORMAT,
} from '../../core/theming';
import { facebookSite } from '../../sites/facebook';
import { gmailSite } from '../../sites/gmail';
import { instagramSite } from '../../sites/instagram';
import { redditSite } from '../../sites/reddit';
import { xSite } from '../../sites/x';
import { X_VIDEO_SPEED_KEY } from '../../sites/x/features/video-speed-model';
import { QuickPopup } from './quick-popup';
import { detectActiveMode, SITE_QUICK_CONFIGS } from './starter-modes';

afterEach(cleanup);

function renderXPopup(
  store: ReturnType<typeof inMemoryStore>,
  {
    hiddenCount = 0,
    onOpenSettings = vi.fn(),
    onOpenSiteUrl = vi.fn(),
  }: {
    readonly hiddenCount?: number;
    readonly onOpenSettings?: (section?: string) => void;
    readonly onOpenSiteUrl?: (url: string) => void;
  } = {},
) {
  return render(
    <QuickPopup
      store={store}
      activeTab={{
        siteId: 'x',
        displayName: 'X (Twitter)',
        storagePrefix: 'x/123',
        enabled: true,
        hiddenCount,
      }}
      onOpenSettings={onOpenSettings}
      onOpenSiteUrl={onOpenSiteUrl}
    />,
  );
}

async function readSavedXTheme(store: ReturnType<typeof inMemoryStore>) {
  return readThemeDocument(await store.get(`x/123/${THEME_DATA_KEY}`));
}

describe('QuickPopup', () => {
  it('applies Starter Modes with Undo, site toggles, X video speed stepper, Quick Theme, Quick Mute, and deep-links', async () => {
    const store = inMemoryStore({
      'x/123/options': { x_hide_sponsored: true, x_hide_suggested: true },
    });
    const onOpenSettings = vi.fn();
    renderXPopup(store, { hiddenCount: 7, onOpenSettings });

    expect(screen.getByText('X (Twitter)')).toBeTruthy();
    expect(screen.getByText(/7 hidden here/)).toBeTruthy();

    // Starter Mode: Focus applies preset patch immediately and supports Undo.
    await userEvent.click(screen.getByRole('button', { name: 'Focus' }));
    await vi.waitFor(async () => {
      const saved = (await store.get('x/123/options')) as Record<string, unknown>;
      expect(saved.x_default_following).toBe(true);
      expect(saved.x_hide_grok).toBe(true);
    });
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await vi.waitFor(async () => {
      const saved = (await store.get('x/123/options')) as Record<string, unknown>;
      expect(saved.x_hide_grok).toBeUndefined();
    });

    // Inline X video speed stepper updates saved video speed.
    await userEvent.click(screen.getByRole('button', { name: 'Increase video speed' }));
    await vi.waitFor(async () => {
      expect(await store.get(`x/123/${X_VIDEO_SPEED_KEY}`)).toEqual({ rate: 1.05, custom: true });
    });

    // Quick Theme swatch updates site theme immediately.
    await userEvent.click(screen.getByRole('button', { name: 'Crimson Velvet theme' }));
    await vi.waitFor(async () => {
      expect((await readSavedXTheme(store)).id).toBe('crimson-velvet');
    });

    // Quick Mute creates a runnable Simple filter rule.
    await userEvent.type(screen.getByRole('textbox', { name: 'Quick mute keyword' }), 'spoilers');
    await userEvent.click(screen.getByRole('button', { name: 'Hide' }));
    await vi.waitFor(async () => {
      const filters = readFilters(await store.get('x/123/filters'));
      expect(filters).toHaveLength(1);
      expect(filters[0]?.rules?.[0]?.condition?.text).toBe('spoilers');
    });

    // Footer buttons deep-link to Appearance (Theme Studio) and Filtering.
    await userEvent.click(screen.getByRole('button', { name: /Theme Studio/i }));
    expect(onOpenSettings).toHaveBeenCalledWith('Appearance');
    await userEvent.click(screen.getByRole('button', { name: /All X \(Twitter\) settings/i }));
    expect(onOpenSettings).toHaveBeenCalledWith('Filtering');
  });

  it('shows active Studio Vibe strip with Pause/FX off, clears Studio FX + vibe font on Quick Theme pick with full Undo', async () => {
    const matrixVibe = STUDIO_VIBES.find((v) => v.id === 'enter-the-matrix')!;
    const matrixDoc = applyStudioVibe(DEFAULT_THEME_DOCUMENT, matrixVibe);
    const store = inMemoryStore({
      'x/123/options': { x_hide_sponsored: true, x_hide_suggested: true },
      [`x/123/${THEME_DATA_KEY}`]: matrixDoc,
    });

    renderXPopup(store);

    await vi.waitFor(() => expect(screen.getByText('Enter the Matrix')).toBeTruthy());

    // Pausing background motion flips effects.backdrop.paused without losing the vibe.
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await vi.waitFor(async () => {
      expect((await readSavedXTheme(store)).effects?.backdrop?.paused).toBe(true);
    });

    // Picking a light Quick Theme clears Studio effects AND resets Enter the Matrix's mono font.
    await userEvent.click(screen.getByRole('button', { name: 'Warm Paper theme' }));
    await vi.waitFor(async () => {
      const saved = await readSavedXTheme(store);
      expect(saved.id).toBe('warm-paper');
      expect(saved.effects).toBeUndefined();
      expect(saved.typography).toBeUndefined();
    });

    // Clicking Undo restores the full previous Studio Vibe (including effects and font).
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await vi.waitFor(async () => {
      const saved = await readSavedXTheme(store);
      expect(saved.id).toBe('enter-the-matrix');
      expect(saved.effects?.backdrop?.id).toBe('digital-rain');
      expect(saved.typography?.preset).toBe('mono');
    });

    // Clicking "FX off" keeps the color palette while clearing effects and vibe-owned font.
    await userEvent.click(screen.getByRole('button', { name: 'FX off' }));
    await vi.waitFor(async () => {
      const saved = await readSavedXTheme(store);
      expect(saved.id).toBe('terminal-phosphor');
      expect(saved.effects).toBeUndefined();
      expect(saved.typography).toBeUndefined();
    });
  });

  it('collapses Starter Modes for customized setups and requires inline confirmation before overwriting custom settings', async () => {
    const store = inMemoryStore({
      // Customized X setup: hides Grok & sidebar, does not match Clean/Focus/Minimal.
      'x/123/options': {
        x_hide_sponsored: true,
        x_hide_suggested: false,
        x_hide_grok: true,
        x_hide_sidebar: true,
      },
    });

    renderXPopup(store);

    // Starter Modes start collapsed behind "Custom · Presets ▾" so custom users aren't exposed to accidental clobbering.
    const presetsToggle = await screen.findByRole('button', { name: /Custom · Presets/i });
    expect(screen.queryByRole('button', { name: 'Focus' })).toBeNull();

    // Expanding Presets reveals modes without modifying anything.
    await userEvent.click(presetsToggle);
    await userEvent.click(screen.getByRole('button', { name: 'Focus' }));

    // First click only arms confirmation (zero writes yet) and reports changed + hidden setting counts.
    expect(screen.getByText(/Focus: changes \d+ settings/i)).toBeTruthy();
    const stillCustom = (await store.get('x/123/options')) as Record<string, unknown>;
    expect(stillCustom.x_hide_sidebar).toBe(true);

    // Confirming via Apply writes Focus and supports Undo back to custom settings.
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await vi.waitFor(async () => {
      const saved = (await store.get('x/123/options')) as Record<string, unknown>;
      expect(saved.x_default_following).toBe(true);
      expect(saved.x_hide_sidebar).toBe(false);
    });
  });

  it('renders the Supported Sites launcher on unsupported tabs and persists site toggles', async () => {
    const store = inMemoryStore();
    const onOpenSiteUrl = vi.fn();

    render(
      <QuickPopup
        store={store}
        activeTab={null}
        onOpenSettings={vi.fn()}
        onOpenSiteUrl={onOpenSiteUrl}
      />,
    );

    expect(screen.getByText('Not active on this page')).toBeTruthy();
    const fbSwitch = screen.getByRole<HTMLInputElement>('checkbox', {
      name: /Enable Feed Sanity on Facebook/i,
    });
    expect(fbSwitch.checked).toBe(true);
    await userEvent.click(fbSwitch);

    await vi.waitFor(async () => {
      const savedSites = (await store.get(SITES_STORAGE_KEY)) as Record<string, boolean>;
      expect(savedSites.facebook).toBe(false);
    });

    const openButtons = screen.getAllByRole('button', { name: /Open/i });
    await userEvent.click(openButtons[0] as HTMLElement);
    expect(onOpenSiteUrl).toHaveBeenCalledWith('https://www.facebook.com/');
  });

  it('matches every site adapter OptionSpec contract and round-trips Clean -> Focus -> Minimal -> Focus -> Clean', () => {
    const adapters = [facebookSite, xSite, instagramSite, redditSite, gmailSite];
    for (const adapter of adapters) {
      const cfg = SITE_QUICK_CONFIGS[adapter.id];
      expect(cfg, `Missing quick config for ${adapter.id}`).toBeDefined();
      if (!cfg) {
        continue;
      }

      const options = new Options(inMemoryStore(), `${adapter.id}/options`);
      for (const feature of adapter.features) {
        if (feature.options) {
          options.register(feature.options);
        }
      }
      const specs = new Map(options.list());

      for (const toggle of cfg.toggles) {
        const spec = specs.get(toggle.key);
        expect(spec, `${adapter.id} toggle ${toggle.key}`).toBeDefined();
        expect(toggle.defaultValue).toBe(spec?.default);
      }

      for (const [key, def] of Object.entries(cfg.modeDefaults)) {
        const spec = specs.get(key);
        expect(spec, `${adapter.id} modeDefault ${key}`).toBeDefined();
        expect(def).toBe(spec?.default);
      }

      // Every mode patch key must be registered and valid (including `choices`),
      // and applying `{ ...modeDefaults, ...mode.patch }` must round-trip cleanly!
      let state: Record<string, boolean | string | number> = {};
      const sequence = ['clean', 'focus', 'minimal', 'focus', 'clean'] as const;
      for (const modeId of sequence) {
        const mode = cfg.modes.find((m) => m.id === modeId);
        expect(mode).toBeDefined();
        if (!mode) {
          continue;
        }
        for (const [key, val] of Object.entries(mode.patch)) {
          const spec = specs.get(key);
          expect(spec, `${adapter.id} ${modeId} patch key ${key}`).toBeDefined();
          if (spec?.choices) {
            expect(
              spec.choices.some((choice) => choice.value === val),
              `${adapter.id} ${modeId} choice ${key}=${String(val)}`,
            ).toBe(true);
          }
        }
        state = { ...state, ...cfg.modeDefaults, ...mode.patch };
        expect(detectActiveMode(cfg.modes, state, cfg.modeDefaults)).toBe(modeId);
      }
    }
  });

  it('shows imported .fstheme.json name in the Theme badge, unpresses built-in swatches, and supports Undo', async () => {
    const parsed = parseThemeDocument({
      format: THEME_FILE_FORMAT,
      schemaVersion: 1,
      id: 'aurora-mist',
      meta: { name: 'Aurora Mist' },
      palette: {
        colorScheme: 'dark',
        background: '#09101d',
        surface: '#111c30',
        text: '#e2e8f0',
        accent: '#38bdf8',
      },
    });
    expect(parsed.ok).toBe(true);
    const importedDoc = applyThemeDocument(parsed.document!);

    const store = inMemoryStore({
      [`x/123/${THEME_DATA_KEY}`]: importedDoc,
    });
    renderXPopup(store);

    await vi.waitFor(() => expect(screen.getByText('Aurora Mist')).toBeTruthy());
    expect(
      screen.getByRole('button', { name: 'Site Default theme' }).getAttribute('aria-pressed'),
    ).toBe('false');
    expect(
      screen.getByRole('button', { name: 'Warm Paper theme' }).getAttribute('aria-pressed'),
    ).toBe('false');

    // Picking a Quick Theme replaces the imported document, and Undo restores it cleanly.
    await userEvent.click(screen.getByRole('button', { name: 'Warm Paper theme' }));
    await vi.waitFor(async () => {
      const saved = readThemeDocument(await store.get(`x/123/${THEME_DATA_KEY}`));
      expect(saved.id).toBe('warm-paper');
      expect(isCustomImportedDocument(saved)).toBe(false);
    });

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await vi.waitFor(async () => {
      const saved = readThemeDocument(await store.get(`x/123/${THEME_DATA_KEY}`));
      expect(saved.meta.name).toBe('Aurora Mist');
      expect(isCustomImportedDocument(saved)).toBe(true);
    });
  });
});
