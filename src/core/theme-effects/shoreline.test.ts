import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ThemePalette } from '../theming';
import { xThemeMapping } from '../../sites/x/theme-mapping';
import {
  analyzeThemeDocument,
  applyStudioVibe,
  BUILTIN_THEMES,
  clearThemeEffects,
  compileHostThemeCss,
  contrastRatio,
  DEFAULT_THEME_DOCUMENT,
  describeThemeDocument,
  documentEffectsToConfig,
  findActiveStudioVibe,
  findThemePreset,
  hexWithAlpha,
  parseThemeDocument,
  resolveTheme,
  serializeThemeDocument,
  THEME_LAYER_ORDER,
  updateThemeEffects,
  vibeToThemeDocument,
} from '../theming';
import { SUNLIGHT } from '../theming/color';
import {
  BACKDROP_EFFECT_IDS,
  BACKDROP_OPTIONS,
  BACKDROP_PARAM_SPECS,
  BACKDROP_REGISTRY,
  CLICK_EFFECT_OPTIONS,
  CLICK_FX_OWN_VALUE,
  compileSurfaceFinishCss,
  compileUiSurfaceCss,
  DEFAULT_THEME_EFFECTS,
  getClickParamSpecs,
  getSurfaceParamSpecs,
  mergeEffectsPatch,
  mountClickEffects,
  readThemeEffectsConfig,
  resolveEffectParams,
  STUDIO_VIBES,
  SURFACE_FINISH_OPTIONS,
} from './index';
import { SHORELINE_TIMES } from './param-specs';
import { resolveScenePalette } from './renderers/palette';
import { lunarSpringTideAt, SHORELINE_SCENE } from './renderers/shoreline';
import {
  buildShorelineArt,
  paintPalmShadowLayer,
  paintShoreDetailsLayer,
  paintShorelineAtlas,
  shorelineArt,
} from './renderers/shoreline-atlas';
import { resolveShorelineLook, shorelineMoodAt } from './renderers/shoreline-look';

const lagoonVibe = STUDIO_VIBES.find((vibe) => vibe.id === 'coral-lagoon')!;
const lagoonPreset = findThemePreset('coral-lagoon')!;
const midnight = BUILTIN_THEMES.find((theme) => theme.id === 'midnight')!.palette;
const warmPaper = BUILTIN_THEMES.find((theme) => theme.id === 'warm-paper')!.palette;

function scenePalette(palette: ThemePalette | null, hostScheme: 'dark' | 'light' = 'light') {
  return resolveScenePalette({
    doc: document,
    container: document.body,
    palette,
    hostScheme,
    effects: DEFAULT_THEME_EFFECTS,
  });
}

function recordingContext() {
  const paints: Array<{ op: string; mode: string; style: string }> = [];
  const state: Record<string, unknown> = { globalCompositeOperation: 'source-over' };
  const calls: string[] = [];
  const ctx = new Proxy(state, {
    get(target, prop) {
      if (typeof prop !== 'string' || prop in target) {
        return target[prop as string];
      }
      return () => {
        calls.push(prop);
        if (prop === 'fill' || prop === 'stroke') {
          paints.push({
            op: prop,
            mode: String(target.globalCompositeOperation),
            style: String(prop === 'fill' ? target.fillStyle : target.strokeStyle),
          });
        }
      };
    },
    set(target, prop, value) {
      target[prop as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls, paints };
}

describe('Coral Shoreline art atlas', () => {
  it('generates deterministic palm fronds, beach shells, and submerged coral reef heads', () => {
    const first = buildShorelineArt(42);
    const again = buildShorelineArt(42);
    const other = buildShorelineArt(99);
    expect(again).toEqual(first);
    expect(other.shells).not.toEqual(first.shells);
    expect(shorelineArt()).toBe(shorelineArt());

    expect(first.fronds.length).toBeGreaterThanOrEqual(5);
    expect(first.shells.some((s) => s.kind === 'starfish')).toBe(true);
    expect(first.shells.some((s) => s.kind === 'scallop')).toBe(true);
    expect(first.shells.some((s) => s.kind === 'spiral')).toBe(true);
    expect(first.reef.some((r) => r.kind === 'staghorn')).toBe(true);
    expect(first.reef.some((r) => r.kind === 'brain')).toBe(true);
    for (const shell of first.shells) {
      expect(shell.x).toBeGreaterThan(0);
      expect(shell.x).toBeLessThan(0.25);
    }
    for (const head of first.reef) {
      expect(head.x).toBeGreaterThan(0.7);
      expect(head.x).toBeLessThan(1);
    }
  });

  it('paints the 3-channel shader data texture independently without clearRect', () => {
    const { ctx, calls, paints } = recordingContext();
    paintShorelineAtlas(ctx, 256);
    expect(calls).toContain('fillRect');
    expect(calls).not.toContain('clearRect');
    const lighterPaints = paints.filter((p) => p.mode === 'lighter');
    expect(lighterPaints.some((p) => p.style === 'rgb(210,0,0)')).toBe(true);
    expect(lighterPaints.some((p) => /^rgb\(0,\d+,0\)$/.test(p.style))).toBe(true);
    expect(lighterPaints.some((p) => /^rgb\(0,0,\d+\)$/.test(p.style))).toBe(true);
  });

  it('paints tinted Canvas 2D palm shadow and detail sprite layers', () => {
    const palms = recordingContext();
    paintPalmShadowLayer(palms.ctx, 256, [10, 80, 96]);
    expect(palms.calls).toContain('clearRect');
    expect(palms.paints.length).toBeGreaterThan(20);

    const details = recordingContext();
    paintShoreDetailsLayer(details.ctx, 256, {
      shell: [248, 240, 224],
      coral: [226, 109, 90],
      reef: [18, 92, 114],
    });
    expect(details.calls).toContain('clearRect');
    expect(details.paints.length).toBeGreaterThan(20);
  });
});

describe('Coral Shoreline lighting, lunar tide & palette adaptation', () => {
  it('interpolates smoothly across every time of day and computes real lunar spring tide', () => {
    const noon = shorelineMoodAt('noon', 0);
    const sunset = shorelineMoodAt('sunset', 0);
    const moonlit = shorelineMoodAt('moonlit', 0);
    expect(shorelineMoodAt('noon', 0.9)).toBe(noon);
    expect(sunset.warm).toBe(1);
    expect(moonlit.cool).toBe(1);
    expect(noon.causticGain).toBeGreaterThan(moonlit.causticGain);

    expect(shorelineMoodAt('clock', 0)).toEqual(moonlit);
    expect(shorelineMoodAt('clock', 0.5)).toEqual(noon);
    expect(shorelineMoodAt('clock', 0.77)).toEqual(sunset);
    expect(shorelineMoodAt('clock', 1.5)).toEqual(noon);
    expect(shorelineMoodAt('clock', Number.NaN)).toEqual(moonlit);

    let prev = shorelineMoodAt('clock', 0);
    for (let phase = 0.005; phase <= 1; phase += 0.005) {
      const next = shorelineMoodAt('clock', phase);
      expect(Math.abs(next.warm - prev.warm)).toBeLessThan(0.08);
      expect(Math.abs(next.cool - prev.cool)).toBeLessThan(0.08);
      prev = next;
    }

    // Spring tide peaks at new moon (reference epoch) and full moon, drops near quarters.
    const refNewMoon = Date.UTC(2000, 0, 6, 18, 14);
    const quarterLater = refNewMoon + 7.3826 * 86_400_000;
    expect(lunarSpringTideAt(refNewMoon)).toBeGreaterThan(0.95);
    expect(lunarSpringTideAt(quarterLater)).toBeLessThan(0.1);
  });

  it('adapts polarity cleanly for daylight Coral Lagoon, Site Default, and dark themes', () => {
    const noon = shorelineMoodAt('noon', 0.5);
    const daylight = resolveShorelineLook(scenePalette(lagoonPreset.palette, 'light'), noon);
    const nativeLight = resolveShorelineLook(scenePalette(null, 'light'), noon);
    expect(daylight.lightMode).toBe(true);
    expect(nativeLight.lightMode).toBe(true);

    const lum = (c: readonly number[]): number => 0.299 * c[0]! + 0.587 * c[1]! + 0.114 * c[2]!;
    // Light mode keeps sand bright so dark nav text directly over the shore remains crisp.
    expect(lum(daylight.sandDry)).toBeGreaterThan(200);
    expect(lum(daylight.waterShallow)).toBeGreaterThan(lum(daylight.waterDeep));

    // Sunset warms sand & specular reflection; moonlit cools the lagoon.
    const sunset = resolveShorelineLook(
      scenePalette(lagoonPreset.palette, 'light'),
      shorelineMoodAt('sunset', 0),
    );
    const moonlit = resolveShorelineLook(
      scenePalette(midnight, 'dark'),
      shorelineMoodAt('moonlit', 0),
    );
    expect(sunset.skySpec[0]).toBeGreaterThan(sunset.skySpec[2]);
    expect(moonlit.lightMode).toBe(false);
    expect(lum(moonlit.sandDry)).toBeLessThan(50);
    expect(moonlit.caustic[2]).toBeGreaterThan(moonlit.caustic[0]);

    // Light palettes harmonize while preserving warm sand.
    const paperLook = resolveShorelineLook(scenePalette(warmPaper, 'light'), noon);
    expect(paperLook.lightMode).toBe(true);
    expect(paperLook.key).not.toBe(daylight.key);
  });

  it('provides a pure-CSS static coastal fallback with no external assets', () => {
    const css = SHORELINE_SCENE.cssFallback(scenePalette(lagoonPreset.palette, 'light'));
    expect(css).toContain('linear-gradient(104deg');
    expect(css.match(/radial-gradient\(/g)).toHaveLength(2);
    expect(css).not.toContain('url(');
    expect(SHORELINE_SCENE.factories).toHaveLength(2);
    expect(SHORELINE_SCENE.acceptsBursts).toBe(true);
    expect(SHORELINE_SCENE.trackScroll).toBe(true);
  });
});

describe('Coral Lagoon theme primitives', () => {
  afterEach(() => {
    document.querySelector(`[data-feed-sanity="${CLICK_FX_OWN_VALUE}"]`)?.remove();
  });

  it('registers shoreline, caustic (Sea Glass), and seafoam everywhere in the Studio', () => {
    expect(BACKDROP_EFFECT_IDS).toContain('shoreline');
    expect(BACKDROP_OPTIONS.find((opt) => opt.id === 'shoreline')?.name).toBe('Coral Shoreline');
    expect(BACKDROP_REGISTRY.shoreline).toMatchObject({ id: 'shoreline', reactsToClicks: true });
    expect(SURFACE_FINISH_OPTIONS.find((opt) => opt.value === 'caustic')?.label).toBe('Sea Glass');
    expect(CLICK_EFFECT_OPTIONS.find((opt) => opt.value === 'seafoam')?.label).toBe('Seafoam');
    expect(getSurfaceParamSpecs('caustic').map((spec) => spec.key)).toEqual(['caustics', 'rim']);
    expect(getClickParamSpecs('seafoam').map((spec) => spec.key)).toEqual(['style', 'scale']);
    expect(BACKDROP_PARAM_SPECS.shoreline.map((spec) => spec.key)).toEqual([
      'time',
      'caustics',
      'tide',
      'surf',
      'breeze',
      'palms',
      'marineLife',
    ]);
  });

  it('validates and clamps shoreline, caustic, and seafoam parameters safely', () => {
    expect(resolveEffectParams(BACKDROP_PARAM_SPECS.shoreline, undefined)).toEqual({
      time: 'noon',
      caustics: 1,
      tide: 1,
      surf: 1,
      breeze: 1,
      palms: true,
      marineLife: true,
    });
    const parsed = readThemeEffectsConfig({
      backdrop: 'shoreline',
      backdropParams: {
        time: 'twilight',
        caustics: 8,
        tide: 0.05,
        surf: -1,
        breeze: 0.456,
        palms: false,
        marineLife: 'yes',
        dolphins: 2,
      },
      surface: 'caustic',
      surfaceParams: { caustics: 4, rim: 0.1 },
      click: 'seafoam',
      clickParams: { style: 'tsunami', scale: 5 },
    });
    expect(parsed.backdrop).toBe('shoreline');
    expect(parsed.backdropParams).toEqual({
      caustics: 1.6,
      tide: 0.3,
      surf: 0,
      breeze: 0.46,
      palms: false,
    });
    expect(parsed.surfaceParams).toEqual({ caustics: 1.8, rim: 0.3 });
    expect(parsed.clickParams).toEqual({ scale: 1.6 });
    for (const time of SHORELINE_TIMES) {
      expect(
        readThemeEffectsConfig({ backdrop: 'shoreline', backdropParams: { time } }).backdropParams,
      ).toEqual({ time });
    }
    expect(mergeEffectsPatch(parsed, { backdrop: 'canopy' }).backdropParams).toBeUndefined();
    expect(
      mergeEffectsPatch(parsed, { backdropParams: { time: 'sunset' } }).backdropParams,
    ).toEqual({
      caustics: 1.6,
      tide: 0.3,
      surf: 0,
      breeze: 0.46,
      palms: false,
      time: 'sunset',
    });
  });

  it('ships a WCAG-verified daylight Coral Lagoon palette with coastal ribbon and ambient glow', () => {
    const p = lagoonPreset.palette;
    expect(BUILTIN_THEMES.at(-1)?.id).toBe('coral-lagoon');
    expect(p.colorScheme).toBe('light');
    expect(contrastRatio(p.text, p.background)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(p.text, p.surface)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(p.text, p.surfaceAlt)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(p.textMuted, p.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.textMuted, p.surfaceAlt)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.accent, p.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.accent, p.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.accentText, p.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.danger, p.surface)).toBeGreaterThanOrEqual(4.5);
    expect(lagoonPreset.chrome?.ribbon?.stops.at(0)).toBe('transparent');
    expect(lagoonPreset.chrome?.ribbon?.stops.at(-1)).toBe('transparent');
    expect(lagoonPreset.chrome?.ambientGlow?.spots).toHaveLength(3);
    expect(lagoonPreset.swatches).toHaveLength(6);
  });

  it('round-trips Coral Lagoon through .fstheme.json as pure data and restores cleanly', () => {
    expect(lagoonVibe.effects).toMatchObject({
      backdrop: 'shoreline',
      surface: 'caustic',
      click: 'seafoam',
    });
    expect(lagoonVibe.effects.customShader).toBeUndefined();

    const doc = vibeToThemeDocument(lagoonVibe);
    const parsed = parseThemeDocument(JSON.parse(serializeThemeDocument(doc)));
    expect(parsed.ok).toBe(true);
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.document).toEqual(doc);
    expect(parsed.capabilities).toMatchObject({
      trust: 'data-only',
      backdropEngine: 'shoreline',
      surfaceFinish: 'caustic',
      clickEffect: 'seafoam',
      hasChrome: true,
      hasCustomShader: false,
    });
    expect(analyzeThemeDocument(doc).minContrastRatio).toBeGreaterThanOrEqual(7);

    expect(documentEffectsToConfig(doc.effects)).toMatchObject({
      backdrop: 'shoreline',
      intensity: 0.92,
      glassStrength: 0.24,
      surface: 'caustic',
      click: 'seafoam',
    });
    expect(describeThemeDocument(doc)).toEqual({ overriding: true, label: 'Coral Lagoon' });
    expect(findActiveStudioVibe(doc)?.id).toBe('coral-lagoon');

    const tuned = updateThemeEffects(doc, { backdropParams: { time: 'sunset', palms: false } });
    expect(tuned.effects?.backdrop?.params).toEqual({ time: 'sunset', palms: false });
    expect(findActiveStudioVibe(tuned)?.id).toBe('coral-lagoon');

    const cleared = clearThemeEffects(doc);
    expect(cleared.id).toBe('coral-lagoon');
    expect(cleared.effects).toBeUndefined();
    expect(cleared.palette).toEqual(lagoonPreset.palette);
  });

  it('compiles the Sea Glass (caustic) finish with static caustic arcs, inset-only hover, and zero blur', () => {
    const surfaces = {
      leafCards: ['.card'],
      softSurfaces: ['.post'],
      feedCards: ['.post'],
      primaryCtas: ['button.primary'],
      columns: ['main'],
      searchContainers: ['.search'],
    };
    const caustic = { ...DEFAULT_THEME_EFFECTS, surface: 'caustic' } as const;
    const css = compileSurfaceFinishCss(lagoonPreset.palette, 'light', caustic, surfaces);
    expect(css.match(/radial-gradient\(/g)).toHaveLength(3);
    expect(css).not.toContain('backdrop-filter');
    expect(css).not.toMatch(/animation|transition|@keyframes/);
    expect(css).not.toContain(':where(');
    const hover = /\.post:hover \{\n([^}]+)\}/.exec(css)?.[1] ?? '';
    expect(hover).toContain('inset 3px 0 0 0');
    expect(hover.split(',').every((layer) => layer.includes('inset'))).toBe(true);
    expect(css).toContain(
      `button.primary {\n  background-image: linear-gradient(135deg, ${lagoonPreset.palette.accent} 0%`,
    );
    expect(css).toContain('.search:focus-within');

    // Palettes without a secondary accent fall back to sunbeam gold, never danger red.
    const slate = compileSurfaceFinishCss(midnight, 'dark', caustic, surfaces);
    expect(slate).toContain(hexWithAlpha(SUNLIGHT.dark, 0.1));
    expect(slate).not.toContain(hexWithAlpha(midnight.danger, 0.1));

    // Light Coral Lagoon on a dark host page must still use light-scheme pearlescent bevels,
    // never dark text (#092b32) as the top highlight.
    const lightOnDarkHost = compileSurfaceFinishCss(
      lagoonPreset.palette,
      'dark',
      caustic,
      surfaces,
    );
    expect(lightOnDarkHost).toContain('inset 0 1px 0 0 rgb(255 255 255 / 72%)');
    expect(lightOnDarkHost).not.toContain(hexWithAlpha(lagoonPreset.palette.text, 0.18));

    const hostCss = compileHostThemeCss(
      resolveTheme(applyStudioVibe(DEFAULT_THEME_DOCUMENT, lagoonVibe))!,
      xThemeMapping,
      'light',
    );
    expect(hostCss.startsWith(THEME_LAYER_ORDER)).toBe(true);
    expect(hostCss).toContain('@layer fs-finish {');
    expect(hostCss).not.toContain('backdrop-filter');
    expect(hostCss).not.toContain('background-attachment');

    const uiCss = compileUiSurfaceCss(lagoonPreset.palette, caustic);
    expect(uiCss).toContain('.dialog, .qp-root');
    expect(uiCss).toContain('.pane, .qp-body');
  });

  it('spawns Seafoam surf rings and glossy buoyant bubbles inside its shadow root', () => {
    const fx = mountClickEffects(document);
    const particles = (): HTMLElement[] => {
      const host = document.querySelector(`[data-feed-sanity="${CLICK_FX_OWN_VALUE}"]`);
      return [...((host?.shadowRoot ?? host)?.children ?? [])] as HTMLElement[];
    };
    const reset = (): void => {
      document
        .querySelector(`[data-feed-sanity="${CLICK_FX_OWN_VALUE}"]`)
        ?.shadowRoot?.replaceChildren();
    };

    fx.setEffect('seafoam', lagoonPreset.palette);
    const cssWrites = vi.spyOn(CSSStyleDeclaration.prototype, 'cssText', 'set');
    fx.triggerAt(140, 90);
    const writtenCss = cssWrites.mock.calls.map(([css]) => String(css));
    cssWrites.mockRestore();
    // 2 surf crest rings + 7 glossy sea-bubbles
    expect(particles()).toHaveLength(9);
    const [innerRing, outerRing, ...bubbles] = particles();
    expect(innerRing!.style.width).toBe('48px');
    expect(outerRing!.style.width).toBe('74px');
    expect(bubbles).toHaveLength(7);
    for (const bubble of bubbles) {
      expect(bubble.style.borderRadius).toBe('50%');
    }
    expect(
      writtenCss.filter((css) => css.includes('radial-gradient(circle at 32% 28%')),
    ).toHaveLength(7);

    reset();
    fx.setEffect('seafoam', lagoonPreset.palette, { params: { style: 'spray' } });
    fx.triggerAt(140, 90);
    expect(particles()).toHaveLength(2);

    reset();
    fx.setEffect('seafoam', lagoonPreset.palette, { params: { style: 'bubbles', scale: 1.4 } });
    fx.triggerAt(140, 90);
    expect(particles()).toHaveLength(7);
    expect(particles()[0]!.style.width).toBe('7px');

    fx.setEffect('none', null);
    expect(document.querySelector(`[data-feed-sanity="${CLICK_FX_OWN_VALUE}"]`)).toBeNull();
    fx.destroy();
  });
});
