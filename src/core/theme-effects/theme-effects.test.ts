import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { xThemeMapping } from '../../sites/x/theme-mapping';
import { createDomEnvironment } from '../dom-env';
import {
  applyStudioVibe,
  compileHostThemeCss,
  compileUiThemeCss,
  createThemeController,
  DEFAULT_THEME_CONFIG,
  readThemeConfig,
  resolveTheme,
} from '../theming';
import {
  BACKDROP_OWN_VALUE,
  BACKDROP_REGISTRY,
  CLICK_FX_OWN_VALUE,
  compileBackdropRevealCss,
  compileSurfaceFinishCss,
  createEffectsLayerController,
  DEFAULT_THEME_EFFECTS,
  hasActiveEffects,
  mountClickEffects,
  readThemeEffectsConfig,
  resolveGlassMetrics,
  STUDIO_VIBES,
} from './index';

describe('Creative Theme & Effects Studio engine', () => {
  const cleanups: Array<() => void> = [];

  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '<div id="react-root"><main></main></div>';
  });

  afterEach(() => {
    for (const stop of cleanups.splice(0).reverse()) {
      stop();
    }
  });

  it('validates, clamps, and safely defaults ThemeEffectsConfig', () => {
    expect(readThemeEffectsConfig(null)).toEqual(DEFAULT_THEME_EFFECTS);
    expect(hasActiveEffects(DEFAULT_THEME_EFFECTS)).toBe(false);

    const parsed = readThemeEffectsConfig({
      backdrop: 'digital-rain',
      intensity: 99,
      speed: 0.01,
      glassStrength: 5,
      rainDensity: -3,
      rainLook: 'phosphor',
      rainCharset: 'binary',
      surface: 'neon',
      click: 'spark',
      paused: true,
      interactive: false,
    });
    expect(parsed).toEqual({
      backdrop: 'digital-rain',
      intensity: 1,
      speed: 0.25,
      glassStrength: 0.65,
      paused: true,
      interactive: false,
      rainLook: 'phosphor',
      rainCharset: 'binary',
      rainDensity: 0.15,
      surface: 'neon',
      click: 'spark',
    });
    expect(hasActiveEffects(parsed)).toBe(true);

    // Invalid enum values fall back cleanly without crashing.
    const invalid = readThemeEffectsConfig({
      backdrop: 'invalid',
      surface: 'bogus',
      click: 'nope',
      rainLook: 'unknown',
      rainCharset: 'emoji-bomb',
    });
    expect(invalid).toEqual(DEFAULT_THEME_EFFECTS);
  });

  it('resolves Studio Vibes (Enter the Matrix & Vice City VI) and compiles backdrop reveal + surface finishes', () => {
    const matrixVibe = STUDIO_VIBES.find((v) => v.id === 'enter-the-matrix')!;
    const viceVibe = STUDIO_VIBES.find((v) => v.id === 'vice-city-vi')!;
    expect(matrixVibe).toBeDefined();
    expect(viceVibe).toBeDefined();

    const matrixConfig = applyStudioVibe(DEFAULT_THEME_CONFIG, matrixVibe);
    expect(readThemeConfig(matrixConfig).effects?.backdrop).toBe('digital-rain');
    expect(readThemeConfig(matrixConfig).effects?.click).toBe('matrix-burst');

    const resolvedMatrix = resolveTheme(matrixConfig)!;
    const hostCss = compileHostThemeCss(resolvedMatrix, xThemeMapping, 'dark');
    expect(hostCss).toContain('[data-feed-sanity="theme-backdrop"]');
    expect(hostCss).toContain('#react-root');
    expect(hostCss).toContain('backdrop-filter: blur(');

    const viceConfig = applyStudioVibe(DEFAULT_THEME_CONFIG, viceVibe);
    const resolvedVice = resolveTheme(viceConfig)!;
    const viceCss = compileHostThemeCss(resolvedVice, xThemeMapping, 'dark');
    expect(viceCss).toContain('linear-gradient(145deg');
    expect(compileUiThemeCss(resolvedVice)).toContain('linear-gradient(160deg');

    // Effects alone on Site Default still resolve cleanly without forcing a custom color palette.
    const effectsOnly = resolveTheme({
      ...DEFAULT_THEME_CONFIG,
      effects: { ...DEFAULT_THEME_EFFECTS, backdrop: 'aurora' },
    });
    expect(effectsOnly?.palette).toBeNull();
    expect(effectsOnly?.effects?.backdrop).toBe('aurora');

    // Glass metrics stay bounded to readable contrast alphas.
    const maxGlass = resolveGlassMetrics(10);
    expect(maxGlass.columnAlpha).toBeGreaterThanOrEqual(0.65);
    expect(maxGlass.cardAlpha).toBeGreaterThanOrEqual(0.7);

    expect(compileBackdropRevealCss(null, 'dark', DEFAULT_THEME_EFFECTS)).toBe('');
    expect(
      compileSurfaceFinishCss(null, 'dark', { ...DEFAULT_THEME_EFFECTS, surface: 'neon' }),
    ).toContain('box-shadow:');
  });

  it('mounts, switches, and tears down every registered backdrop plugin cleanly with zero DOM residue', () => {
    const layer = createEffectsLayerController(document);
    cleanups.push(() => layer.dispose());

    for (const id of Object.keys(BACKDROP_REGISTRY) as Array<keyof typeof BACKDROP_REGISTRY>) {
      layer.sync({ ...DEFAULT_THEME_EFFECTS, backdrop: id, intensity: 0.75 }, null, 'dark');
      const host = document.querySelector(`[data-feed-sanity="${BACKDROP_OWN_VALUE}"]`);
      expect(host).not.toBeNull();
      expect(host?.getAttribute('data-fs-backdrop')).toBe(id);
      expect(host?.childElementCount).toBeGreaterThan(0);
    }

    // Turning backdrop off removes the backdrop host cleanly.
    layer.sync(DEFAULT_THEME_EFFECTS, null, 'dark');
    expect(document.querySelector(`[data-feed-sanity="${BACKDROP_OWN_VALUE}"]`)).toBeNull();
  });

  it('spawns click effects inside a pointer-events-none overlay and removes them cleanly on disable/dispose', () => {
    const bursts: Array<[number, number]> = [];
    const fx = mountClickEffects(document, (x, y) => bursts.push([x, y]));
    cleanups.push(() => fx.destroy());

    fx.setEffect('spark', null);
    fx.triggerAt(120, 80);
    const overlay = document.querySelector(`[data-feed-sanity="${CLICK_FX_OWN_VALUE}"]`);
    expect(overlay).not.toBeNull();
    expect(overlay?.childElementCount).toBe(10);

    fx.setEffect('matrix-burst', null);
    fx.triggerAt(200, 100);
    expect(bursts.length).toBeGreaterThanOrEqual(1);

    fx.setEffect('none', null);
    expect(document.querySelector(`[data-feed-sanity="${CLICK_FX_OWN_VALUE}"]`)).toBeNull();
  });

  it('integrates EffectsLayerController lifecycle inside createThemeController', () => {
    const env = createDomEnvironment({ doc: document });
    cleanups.push(() => env.dispose());
    const controller = createThemeController(env, xThemeMapping, () => undefined);
    cleanups.push(() => controller.dispose());

    const viceVibe = STUDIO_VIBES.find((v) => v.id === 'vice-city-vi')!;
    const resolved = resolveTheme(applyStudioVibe(DEFAULT_THEME_CONFIG, viceVibe));
    controller.apply(resolved);

    expect(document.querySelector(`[data-feed-sanity="${BACKDROP_OWN_VALUE}"]`)).not.toBeNull();

    controller.apply(null);
    expect(document.querySelector(`[data-feed-sanity="${BACKDROP_OWN_VALUE}"]`)).toBeNull();
  });
});
