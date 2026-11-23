import { cleanup, render, screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFilters } from '../../core/filter-types';
import { Options } from '../../core/options';
import { SITES_STORAGE_KEY } from '../../core/site-settings';
import { inMemoryStore } from '../../core/testing';
import { readThemeConfig, THEME_DATA_KEY } from '../../core/theming';
import { facebookSite } from '../../sites/facebook';
import { gmailSite } from '../../sites/gmail';
import { instagramSite } from '../../sites/instagram';
import { redditSite } from '../../sites/reddit';
import { xSite } from '../../sites/x';
import { X_VIDEO_SPEED_KEY } from '../../sites/x/features/video-speed-model';
import { QuickPopup } from './quick-popup';
import { detectActiveMode, SITE_QUICK_CONFIGS } from './starter-modes';

afterEach(cleanup);

describe('QuickPopup', () => {
  it('applies Starter Modes with Undo, site toggles, X video speed stepper, Quick Theme, Quick Mute, and deep-links', async () => {
    const store = inMemoryStore({
      'x/123/options': { x_hide_sponsored: true, x_hide_suggested: true },
    });
    const onOpenSettings = vi.fn();
    const onOpenSiteUrl = vi.fn();

    render(
      <QuickPopup
        store={store}
        activeTab={{
          siteId: 'x',
          displayName: 'X (Twitter)',
          storagePrefix: 'x/123',
          enabled: true,
          hiddenCount: 7,
        }}
        onOpenSettings={onOpenSettings}
        onOpenSiteUrl={onOpenSiteUrl}
      />,
    );

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
      const savedTheme = readThemeConfig(await store.get(`x/123/${THEME_DATA_KEY}`));
      expect(savedTheme.preset).toBe('crimson-velvet');
    });

    // Quick Mute creates a runnable Simple filter rule.
    await userEvent.type(screen.getByRole('textbox', { name: 'Quick mute keyword' }), 'spoilers');
    await userEvent.click(screen.getByRole('button', { name: 'Hide' }));
    await vi.waitFor(async () => {
      const filters = readFilters(await store.get('x/123/filters'));
      expect(filters).toHaveLength(1);
      expect(filters[0]?.rules?.[0]?.condition?.text).toBe('spoilers');
    });

    // Footer buttons deep-link to Appearance and Filtering.
    await userEvent.click(screen.getByRole('button', { name: /Audit theme/i }));
    expect(onOpenSettings).toHaveBeenCalledWith('Appearance');
    await userEvent.click(screen.getByRole('button', { name: /All X \(Twitter\) settings/i }));
    expect(onOpenSettings).toHaveBeenCalledWith('Filtering');
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
});
