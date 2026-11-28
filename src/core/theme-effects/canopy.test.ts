import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ThemePalette } from '../theming';
import type { CanopyLeaf } from './renderers/canopy-foliage';
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
import { CANOPY_TIMES } from './param-specs';
import { CANOPY_SCENE } from './renderers/canopy';
import {
  buildCanopyFoliage,
  CANOPY_QUADRANT_LIMIT,
  CANOPY_TONE_BAND,
  canopyFoliage,
  paintCanopyAtlas,
  paintCanopyLayer,
} from './renderers/canopy-foliage';
import { canopyMoodAt, resolveCanopyLook } from './renderers/canopy-look';
import { resolveScenePalette } from './renderers/palette';

const canopyVibe = STUDIO_VIBES.find((vibe) => vibe.id === 'rainforest-canopy')!;
const canopyPreset = findThemePreset('rainforest-canopy')!;
const midnight = BUILTIN_THEMES.find((theme) => theme.id === 'midnight')!.palette;
const matcha = BUILTIN_THEMES.find((theme) => theme.id === 'matcha-porcelain')!.palette;

function scenePalette(palette: ThemePalette | null, hostScheme: 'dark' | 'light' = 'dark') {
  return resolveScenePalette({
    doc: document,
    container: document.body,
    palette,
    hostScheme,
    effects: DEFAULT_THEME_EFFECTS,
  });
}

function signedArea(ring: Float32Array): number {
  let area = 0;
  for (let i = 0; i < ring.length; i += 2) {
    const j = (i + 2) % ring.length;
    area += ring[i]! * ring[j + 1]! - ring[j]! * ring[i + 1]!;
  }
  return area / 2;
}

/** `[minX, maxX, minY, maxY]` of every outline point of `leaf`. */
function bounds(leaf: CanopyLeaf): readonly [number, number, number, number] {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const ring of leaf.rings) {
    for (let i = 0; i < ring.length; i += 2) {
      minX = Math.min(minX, ring[i]!);
      maxX = Math.max(maxX, ring[i]!);
      minY = Math.min(minY, ring[i + 1]!);
      maxY = Math.max(maxY, ring[i + 1]!);
    }
  }
  return [minX, maxX, minY, maxY];
}

/** A 2D context that records its calls and the composite mode and style each fill and stroke used. */
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

describe('Jungle Canopy foliage', () => {
  it('grows the same jungle from the same seed, with both layers in all four corners', () => {
    const first = buildCanopyFoliage(7);
    const again = buildCanopyFoliage(7);
    const other = buildCanopyFoliage(8);
    expect(again.length).toBe(first.length);
    expect(again[0]!.rings[0]).toEqual(first[0]!.rings[0]);
    expect(again.map((leaf) => leaf.tone)).toEqual(first.map((leaf) => leaf.tone));
    expect(other.map((leaf) => leaf.tone)).not.toEqual(first.map((leaf) => leaf.tone));
    // The built-in jungle is grown once and shared by both renderers.
    expect(canopyFoliage()).toBe(canopyFoliage());

    const quadrants = new Set<string>();
    for (const leaf of canopyFoliage()) {
      const [minX, , minY] = bounds(leaf);
      quadrants.add(
        `${leaf.layer}:${minX < 0.5 ? 'left' : 'right'}:${minY < 0.5 ? 'top' : 'bottom'}`,
      );
      expect(leaf.rings.length).toBeGreaterThan(0);
      expect(leaf.tone).toBeGreaterThanOrEqual(0.15);
      expect(leaf.tone).toBeLessThanOrEqual(1);
      for (const ring of leaf.rings) {
        expect(ring.length).toBeGreaterThanOrEqual(6);
        expect(ring.every(Number.isFinite)).toBe(true);
      }
    }
    expect(quadrants.size).toBe(8);
  });

  it('keeps every leaf inside its own quadrant so corners never bleed into each other', () => {
    const half = CANOPY_QUADRANT_LIMIT / 2;
    for (const leaf of canopyFoliage()) {
      const [minX, maxX, minY, maxY] = bounds(leaf);
      // Each leaf sits wholly on one side of the frame's empty centre cross, on both axes.
      expect(maxX <= half + 1e-6 || minX >= 1 - half - 1e-6).toBe(true);
      expect(maxY <= half + 1e-6 || minY >= 1 - half - 1e-6).toBe(true);
    }
  });

  it('winds blades one way and monstera holes the other so one nonzero fill cuts them', () => {
    let holes = 0;
    for (const leaf of canopyFoliage()) {
      expect(signedArea(leaf.rings[0]!)).toBeGreaterThan(0);
      for (const ring of leaf.rings) {
        if (signedArea(ring) < 0) {
          holes += 1;
          expect(leaf.layer).toBe('near');
        }
      }
    }
    expect(holes).toBeGreaterThan(8);
  });

  it('paints the shader data texture one channel at a time and never erases with clearRect', () => {
    const leaves = canopyFoliage();
    const { ctx, calls, paints } = recordingContext();
    paintCanopyAtlas(ctx, 256);
    expect(calls).toContain('fillRect');
    expect(calls).not.toContain('clearRect');

    const nearCount = leaves.filter((leaf) => leaf.layer === 'near').length;
    const midCount = leaves.length - nearCount;
    const fills = paints.filter((paint) => paint.op === 'fill');
    // Every leaf clears its own channels under itself, then adds its values.
    expect(fills.filter((p) => p.mode === 'multiply' && p.style === '#ff00ff')).toHaveLength(
      midCount,
    );
    expect(fills.filter((p) => p.mode === 'multiply' && p.style === '#00ff00')).toHaveLength(
      nearCount,
    );
    const nearFills = fills.filter((p) => p.mode === 'lighter' && p.style.startsWith('rgb(255,0,'));
    expect(nearFills).toHaveLength(nearCount);
    for (const fill of nearFills) {
      const blue = Number(/rgb\(255,0,(\d+)\)/.exec(fill.style)?.[1]) / 255;
      expect(blue).toBeGreaterThanOrEqual(CANOPY_TONE_BAND.min - 0.01);
      expect(blue).toBeLessThanOrEqual(CANOPY_TONE_BAND.max + 0.01);
    }
    // Veins are written above the tone band: side veins first, then the midrib.
    const veinLevels = new Set(
      paints.filter((p) => p.op === 'stroke' && p.mode === 'lighter').map((p) => p.style),
    );
    expect(veinLevels).toEqual(new Set(['rgb(0,0,173)', 'rgb(0,0,255)']));
    expect(ctx.globalCompositeOperation).toBe('source-over');
  });

  it('paints tinted sprite layers for the Canvas 2D fallback, veining only the near layer', () => {
    const near = recordingContext();
    paintCanopyLayer(near.ctx, 256, 'near', {
      shade: [10, 36, 22],
      lit: [28, 90, 52],
      vein: [87, 176, 106],
    });
    expect(near.calls).toContain('clearRect');
    expect(near.paints.some((paint) => paint.op === 'stroke')).toBe(true);
    expect(near.paints.every((paint) => paint.mode === 'source-over')).toBe(true);

    const mid = recordingContext();
    paintCanopyLayer(mid.ctx, 256, 'mid', { shade: [29, 74, 53], lit: [47, 107, 74] });
    expect(mid.paints.some((paint) => paint.op === 'stroke')).toBe(false);
    expect(mid.paints.length).toBe(canopyFoliage().filter((leaf) => leaf.layer === 'mid').length);
  });
});

describe('Jungle Canopy light', () => {
  it('gives every time of day its own mood and blends through them on the clock', () => {
    const morning = canopyMoodAt('morning', 0);
    const night = canopyMoodAt('night', 0);
    const golden = canopyMoodAt('golden', 0);
    // Fixed settings ignore the clock.
    expect(canopyMoodAt('morning', 0.9)).toBe(morning);
    expect(morning.fireflies).toBe(0);
    expect(night.fireflies).toBe(1);
    expect(night.cool).toBe(1);
    expect(golden.warm).toBe(1);
    expect(canopyMoodAt('dawn', 0).mist).toBeGreaterThan(morning.mist);
    for (const time of CANOPY_TIMES) {
      const mood = canopyMoodAt(time, 0.5);
      // The light always sits above the canopy line the shafts are traced back to.
      expect(mood.sunY).toBeGreaterThan(1);
      expect(mood.sunX).toBeGreaterThanOrEqual(0);
      expect(mood.sunX).toBeLessThanOrEqual(1);
    }

    expect(canopyMoodAt('clock', 0)).toEqual(night);
    expect(canopyMoodAt('clock', 0.5)).toEqual(morning);
    expect(canopyMoodAt('clock', 0.73)).toEqual(golden);
    expect(canopyMoodAt('clock', 0.95)).toEqual(night);
    // Out-of-range and non-finite phases wrap or fall back instead of throwing.
    expect(canopyMoodAt('clock', 1.5)).toEqual(morning);
    expect(canopyMoodAt('clock', Number.NaN)).toEqual(night);
    // Between stops the mood is a blend, so the light never jumps.
    const afternoon = canopyMoodAt('clock', 0.675);
    expect(afternoon.warm).toBeGreaterThan(morning.warm);
    expect(afternoon.warm).toBeLessThan(golden.warm);
    let previous = canopyMoodAt('clock', 0);
    for (let phase = 0.005; phase <= 1; phase += 0.005) {
      const mood = canopyMoodAt('clock', phase);
      expect(Math.abs(mood.light - previous.light)).toBeLessThan(0.06);
      expect(Math.abs(mood.fireflies - previous.fireflies)).toBeLessThan(0.1);
      previous = mood;
    }
  });

  it('resolves scene colours from the active palette, with signature greens on Site Default', () => {
    const morning = canopyMoodAt('morning', 0);
    const themed = resolveCanopyLook(scenePalette(canopyPreset.palette), morning);
    const native = resolveCanopyLook(scenePalette(null), morning);
    // The preset is the signature jungle, so both resolve to the same scene.
    expect(native.key).toBe(themed.key);
    expect(themed.inked).toBe(false);

    const luminance = (c: readonly number[]): number =>
      0.299 * c[0]! + 0.587 * c[1]! + 0.114 * c[2]!;
    // Dark scenes stay dark overall: shade, then leaves, then haze, with light on top.
    expect(luminance(themed.leafNear)).toBeLessThan(luminance(themed.haze));
    expect(luminance(themed.deep)).toBeLessThan(luminance(themed.haze));
    expect(luminance(themed.light)).toBeGreaterThan(luminance(themed.leafLit));
    expect(luminance(themed.haze)).toBeLessThan(80);

    // Night cools the light; golden hour warms it.
    const night = resolveCanopyLook(scenePalette(canopyPreset.palette), canopyMoodAt('night', 0));
    const golden = resolveCanopyLook(scenePalette(canopyPreset.palette), canopyMoodAt('golden', 0));
    expect(night.light[2]).toBeGreaterThan(night.light[0]);
    expect(golden.light[0]).toBeGreaterThan(golden.light[2]);
    expect(night.key).not.toBe(themed.key);

    // A light palette paints a pale wash: every tone stays close to the page.
    const inked = resolveCanopyLook(scenePalette(matcha), morning);
    expect(inked.inked).toBe(true);
    expect(luminance(inked.leafNear)).toBeGreaterThan(150);
    expect(luminance(inked.leafNear)).toBeLessThan(luminance(inked.deep));

    // Another theme's colours carry through: Midnight Slate grows blue leaves.
    const slate = resolveCanopyLook(scenePalette(midnight), morning);
    expect(slate.leafLit[2]).toBeGreaterThan(slate.leafLit[1]);
    // It has no secondary accent, so its light is sunbeam gold, never its danger red.
    expect(slate.light[0]).toBeGreaterThan(slate.light[2]);
    expect(slate.light[1]).toBeGreaterThan(slate.light[2]);
    expect(slate.light[1]).toBeGreaterThan(190);
  });

  it('falls back to a static CSS wash built from the same look', () => {
    const css = CANOPY_SCENE.cssFallback(scenePalette(canopyPreset.palette));
    expect(css).toContain('conic-gradient(');
    expect(css).toContain('linear-gradient(180deg');
    expect(css.match(/radial-gradient\(/g)).toHaveLength(5);
    expect(css).not.toContain('url(');
    expect(CANOPY_SCENE.factories).toHaveLength(2);
    expect(CANOPY_SCENE.acceptsBursts).toBe(true);
    expect(CANOPY_SCENE.trackScroll).toBe(true);
  });
});

describe('Rainforest Canopy theme primitives', () => {
  afterEach(() => {
    document.querySelector(`[data-feed-sanity="${CLICK_FX_OWN_VALUE}"]`)?.remove();
  });

  it('registers the backdrop, finish, and click effect everywhere the Studio reads them', () => {
    expect(BACKDROP_EFFECT_IDS).toContain('canopy');
    expect(BACKDROP_OPTIONS.find((option) => option.id === 'canopy')?.name).toBe('Jungle Canopy');
    expect(BACKDROP_REGISTRY.canopy).toMatchObject({ id: 'canopy', reactsToClicks: true });
    // Only scenes that answer clicks themselves take every click.
    expect(BACKDROP_REGISTRY['custom-scene'].reactsToClicks).toBe(true);
    expect(BACKDROP_REGISTRY['custom-shader'].reactsToClicks).toBe(true);
    expect(BACKDROP_REGISTRY.aurora.reactsToClicks).toBeUndefined();
    expect(BACKDROP_REGISTRY['digital-rain'].reactsToClicks).toBeUndefined();
    expect(SURFACE_FINISH_OPTIONS.find((option) => option.value === 'dappled')?.label).toBe(
      'Dappled',
    );
    expect(CLICK_EFFECT_OPTIONS.find((option) => option.value === 'petals')?.label).toBe('Petals');
    expect(getSurfaceParamSpecs('dappled').map((spec) => spec.key)).toEqual(['light', 'glow']);
    expect(getClickParamSpecs('petals').map((spec) => spec.key)).toEqual(['style', 'scale']);
    expect(BACKDROP_PARAM_SPECS.canopy.map((spec) => spec.key)).toEqual([
      'time',
      'rays',
      'foliage',
      'mist',
      'motes',
      'breeze',
    ]);
  });

  it('validates and clamps canopy, dappled, and petals parameters', () => {
    expect(resolveEffectParams(BACKDROP_PARAM_SPECS.canopy, undefined)).toEqual({
      time: 'morning',
      rays: 1,
      foliage: 1,
      mist: 1,
      motes: 1,
      breeze: 1,
    });
    const parsed = readThemeEffectsConfig({
      backdrop: 'canopy',
      backdropParams: {
        time: 'noon',
        rays: 9,
        foliage: 0.1,
        mist: -2,
        motes: 'many',
        breeze: 0.333,
        vines: 4,
      },
      surface: 'dappled',
      surfaceParams: { light: 5, glow: 0 },
      click: 'petals',
      clickParams: { style: 'confetti', scale: 3 },
    });
    expect(parsed.backdrop).toBe('canopy');
    // Unknown enum values, wrong types, and unknown keys are dropped; numbers are clamped.
    expect(parsed.backdropParams).toEqual({ rays: 1.6, foliage: 0.5, mist: 0, breeze: 0.33 });
    expect(parsed.surfaceParams).toEqual({ light: 1.8, glow: 0.3 });
    expect(parsed.clickParams).toEqual({ scale: 1.6 });
    for (const time of CANOPY_TIMES) {
      expect(
        readThemeEffectsConfig({ backdrop: 'canopy', backdropParams: { time } }).backdropParams,
      ).toEqual({ time });
    }

    // Switching engines drops the canopy tuners; staying on it merges them.
    expect(mergeEffectsPatch(parsed, { backdrop: 'aurora' }).backdropParams).toBeUndefined();
    expect(mergeEffectsPatch(parsed, { backdropParams: { time: 'dusk' } }).backdropParams).toEqual({
      rays: 1.6,
      foliage: 0.5,
      mist: 0,
      breeze: 0.33,
      time: 'dusk',
    });
  });

  it('ships a WCAG AA palette with a vine ribbon and a three-spot ambient glow', () => {
    const p = canopyPreset.palette;
    expect(BUILTIN_THEMES.some((theme) => theme.id === 'rainforest-canopy')).toBe(true);
    expect(p.colorScheme).toBe('dark');
    expect(contrastRatio(p.text, p.background)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(p.text, p.surface)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(p.text, p.surfaceAlt)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(p.textMuted, p.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.textMuted, p.surfaceAlt)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.accent, p.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.accentText, p.accent)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(p.danger, p.surface)).toBeGreaterThanOrEqual(4.5);
    // The Dappled call-to-action runs from the accent toward sunbeam gold; text holds up at both ends.
    expect(contrastRatio(p.accentText, p.accentSecondary!)).toBeGreaterThanOrEqual(7);
    expect(p.accentSecondary).toBe(SUNLIGHT.dark);
    expect(canopyPreset.chrome?.ribbon?.stops.at(0)).toBe('transparent');
    expect(canopyPreset.chrome?.ribbon?.stops.at(-1)).toBe('transparent');
    expect(canopyPreset.chrome?.ambientGlow?.spots).toHaveLength(3);
    expect(canopyPreset.swatches).toHaveLength(6);
  });

  it('round-trips the Live Theme through a .fstheme.json document and back to its palette', () => {
    expect(canopyVibe.effects).toMatchObject({
      backdrop: 'canopy',
      surface: 'dappled',
      click: 'petals',
    });
    expect(canopyVibe.effects.customShader).toBeUndefined();

    const doc = vibeToThemeDocument(canopyVibe);
    const parsed = parseThemeDocument(JSON.parse(serializeThemeDocument(doc)));
    expect(parsed.ok).toBe(true);
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.document).toEqual(doc);
    // Pure data: no custom CSS and no GPU code, so it imports without a trust prompt.
    expect(parsed.capabilities).toMatchObject({
      trust: 'data-only',
      backdropEngine: 'canopy',
      surfaceFinish: 'dappled',
      clickEffect: 'petals',
      hasChrome: true,
      hasCustomShader: false,
    });
    expect(analyzeThemeDocument(doc).minContrastRatio).toBeGreaterThanOrEqual(7);

    expect(documentEffectsToConfig(doc.effects)).toMatchObject({
      backdrop: 'canopy',
      intensity: 0.92,
      glassStrength: 0.28,
      surface: 'dappled',
      click: 'petals',
    });
    expect(describeThemeDocument(doc)).toEqual({ overriding: true, label: 'Rainforest Canopy' });
    expect(findActiveStudioVibe(doc)?.id).toBe('rainforest-canopy');

    // Tuning a parameter keeps the Live Theme identity; unknown keys only warn on import.
    const tuned = updateThemeEffects(doc, { backdropParams: { time: 'clock', motes: 1.4 } });
    expect(tuned.effects?.backdrop?.params).toEqual({ time: 'clock', motes: 1.4 });
    expect(findActiveStudioVibe(tuned)?.id).toBe('rainforest-canopy');
    const future = parseThemeDocument({
      ...tuned,
      effects: {
        ...tuned.effects,
        backdrop: { ...tuned.effects?.backdrop, params: { time: 'clock', orchids: 3 } },
      },
    });
    expect(future.ok).toBe(true);
    expect(future.document?.effects?.backdrop?.params).toEqual({ time: 'clock' });
    expect(future.warnings.join(' ')).toContain('orchids');

    // Resetting effects falls back to the static colour theme, palette and chrome intact.
    const cleared = clearThemeEffects(doc);
    expect(cleared.id).toBe('rainforest-canopy');
    expect(cleared.effects).toBeUndefined();
    expect(cleared.palette).toEqual(canopyPreset.palette);
    expect(cleared.chrome).toEqual(canopyPreset.chrome);
    expect(describeThemeDocument(cleared).label).toBe('Rainforest Canopy');
  });

  it('compiles the Dappled finish as static layered light, with sunbeam gold when a palette has no secondary', () => {
    const surfaces = {
      leafCards: ['.card'],
      softSurfaces: ['.post'],
      feedCards: ['.post'],
      primaryCtas: ['button.primary'],
      columns: ['main'],
      searchContainers: ['.search'],
    };
    const dappled = { ...DEFAULT_THEME_EFFECTS, surface: 'dappled' } as const;
    const css = compileSurfaceFinishCss(canopyPreset.palette, 'dark', dappled, surfaces);
    // Two pools and a fleck of sun across the top, canopy green bounced up from the far corner.
    expect(css).toContain(
      `radial-gradient(ellipse 38% 72% at 9% 0%, ${hexWithAlpha(SUNLIGHT.dark, 0.13)} 0%, transparent 70%)`,
    );
    expect(css).toContain(
      `radial-gradient(ellipse 48% 62% at 100% 100%, ${hexWithAlpha(canopyPreset.palette.accent, 0.09)} 0%, transparent 72%)`,
    );
    expect(css.match(/radial-gradient\(/g)).toHaveLength(4);
    // Free while scrolling: no blur, no animation, no transition, and hover stays inset-only.
    expect(css).not.toContain('backdrop-filter');
    expect(css).not.toMatch(/animation|transition|@keyframes/);
    const hover = /\.post:hover \{\n([^}]+)\}/.exec(css)?.[1] ?? '';
    expect(hover).toContain('inset 3px 0 0 0');
    expect(hover.match(/inset/g)).toHaveLength(3);
    expect(hover.split(',').every((layer) => layer.includes('inset'))).toBe(true);
    expect(css).toContain(
      'button.primary {\n  background-image: linear-gradient(135deg, #4be38a 0%',
    );
    expect(css).toContain('.search:focus-within');
    expect(css).not.toContain(':where(');

    // Tuners scale the light and the glow independently.
    const bright = compileSurfaceFinishCss(
      canopyPreset.palette,
      'dark',
      { ...dappled, surfaceParams: { light: 1.8, glow: 0.3 } },
      surfaces,
    );
    expect(bright).toContain(hexWithAlpha(SUNLIGHT.dark, 0.13 * 1.8));
    expect(bright).toContain(hexWithAlpha(canopyPreset.palette.accent, 0.09 * 0.3));

    // Midnight Slate has no secondary accent: its sun is gold, not its danger red.
    const slate = compileSurfaceFinishCss(midnight, 'dark', dappled, surfaces);
    expect(slate).toContain(hexWithAlpha(SUNLIGHT.dark, 0.13));
    expect(slate).not.toContain(hexWithAlpha(midnight.danger, 0.13));
    const paper = compileSurfaceFinishCss(matcha, 'light', dappled, surfaces);
    expect(paper).toContain(hexWithAlpha(SUNLIGHT.light, 0.17));
    // With no palette at all it still compiles against the host scheme.
    expect(compileSurfaceFinishCss(null, 'light', dappled, surfaces)).toContain(
      hexWithAlpha(SUNLIGHT.light, 0.17),
    );

    // The whole Live Theme compiles into the layered host sheet, finish in its own layer.
    const hostCss = compileHostThemeCss(
      resolveTheme(applyStudioVibe(DEFAULT_THEME_DOCUMENT, canopyVibe))!,
      xThemeMapping,
      'dark',
    );
    expect(hostCss.startsWith(THEME_LAYER_ORDER)).toBe(true);
    expect(hostCss).toContain('@layer fs-finish {');
    expect(hostCss).toContain('radial-gradient(ellipse 38% 72% at 9% 0%');
    expect(hostCss).not.toContain('backdrop-filter');
    expect(hostCss).not.toContain('background-attachment');

    // Feed Sanity's own dialog picks up a matching wash.
    const uiCss = compileUiSurfaceCss(canopyPreset.palette, dappled);
    expect(uiCss).toContain('.pane, .qp-body');
    expect(uiCss).toContain(hexWithAlpha(SUNLIGHT.dark, 0.08));
    expect(compileUiSurfaceCss(matcha, dappled)).toContain(hexWithAlpha(SUNLIGHT.light, 0.08));
  });

  it('scatters a dewdrop and petals on click, by style and size, inside its shadow root', () => {
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

    fx.setEffect('petals', canopyPreset.palette);
    fx.triggerAt(120, 80);
    // One ring, one bead, six petals; nothing lands in the page's own DOM.
    expect(particles()).toHaveLength(8);
    expect(
      document.querySelector(`[data-feed-sanity="${CLICK_FX_OWN_VALUE}"]`)?.shadowRoot,
    ).not.toBeNull();
    const [ring, bead, ...petals] = particles();
    expect(ring!.style.width).toBe('44px');
    expect(ring!.style.height).toBe('44px');
    expect(bead!.style.width).toBe('9px');
    expect(petals.map((petal) => petal.style.width)).toEqual([
      '10px',
      '8px',
      '8px',
      '10px',
      '8px',
      '8px',
    ]);
    for (const el of particles()) {
      expect(el.style.pointerEvents).toBe('none');
      expect(el.style.position).toBe('absolute');
    }
    // Two opposite corners rounded fully make each particle a petal, not a dot.
    for (const petal of petals) {
      expect(petal.style.borderRadius).toContain('100%');
      expect(petal.style.borderRadius).not.toBe('50%');
    }

    reset();
    fx.setEffect('petals', canopyPreset.palette, { params: { style: 'dew' } });
    fx.triggerAt(120, 80);
    expect(particles()).toHaveLength(2);

    reset();
    fx.setEffect('petals', canopyPreset.palette, { params: { style: 'petals', scale: 1.5 } });
    fx.triggerAt(120, 80);
    expect(particles()).toHaveLength(6);
    expect(particles()[0]!.style.width).toBe('15px');

    // Midnight Slate has no secondary accent: sunbeam gold keeps the petals in three colours
    // instead of doubling up on its danger red.
    reset();
    fx.setEffect('petals', midnight, { params: { style: 'petals' } });
    const cssWrites = vi.spyOn(CSSStyleDeclaration.prototype, 'cssText', 'set');
    fx.triggerAt(120, 80);
    const petalColors = cssWrites.mock.calls.map(
      ([css]) => /linear-gradient\(135deg, (#[0-9a-f]{6})/i.exec(css)?.[1],
    );
    cssWrites.mockRestore();
    expect(petalColors).toHaveLength(6);
    expect(new Set(petalColors)).toEqual(
      new Set([SUNLIGHT.dark, midnight.danger, midnight.accent]),
    );

    reset();
    fx.setEffect('petals', null, { params: { scale: 1.5 } });
    fx.triggerAt(120, 80);
    expect(particles()[0]!.style.width).toBe('66px');

    fx.setEffect('none', null);
    expect(document.querySelector(`[data-feed-sanity="${CLICK_FX_OWN_VALUE}"]`)).toBeNull();
    fx.destroy();
  });
});
