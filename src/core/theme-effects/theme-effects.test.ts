import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { BackdropEffectId } from './index';
import { xThemeMapping } from '../../sites/x/theme-mapping';
import { createDomEnvironment } from '../dom-env';
import {
  applyStudioVibe,
  BUILTIN_THEMES,
  compileHostThemeCss,
  compileUiThemeCss,
  createThemeController,
  DEFAULT_THEME_CONFIG,
  readThemeConfig,
  resolveTheme,
} from '../theming';
import {
  BACKDROP_EFFECT_IDS,
  BACKDROP_OPTIONS,
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
import { resolveBackingSize } from './renderers/scene-host';

/* -------------------------------------------------------------------------- */
/* Canvas, WebGL, and animation-frame test doubles                            */
/* -------------------------------------------------------------------------- */

type GlMode = 'none' | 'ok' | 'fail-compile';

interface CanvasStubs {
  readonly calls2d: string[];
  readonly glCalls: string[];
  readonly loseContext: Mock<() => void>;
}

/** A permissive 2D context: every method is a recorded no-op. */
function fake2dContext(calls: string[]): CanvasRenderingContext2D {
  const store: Record<string | symbol, unknown> = {};
  const gradient = { addColorStop: () => undefined };
  const handler: ProxyHandler<Record<string | symbol, unknown>> = {
    get(target, prop) {
      if (prop in target) {
        return target[prop];
      }
      if (typeof prop !== 'string') {
        return;
      }
      return (...args: unknown[]) => {
        calls.push(prop);
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
          return gradient;
        }
        if (prop === 'createPattern') {
          return {};
        }
        if (prop === 'createImageData') {
          const [w, h] = args as [number, number];
          return { data: new Uint8ClampedArray(w * h * 4) };
        }
        if (prop === 'measureText') {
          return { width: 0 };
        }
      };
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  };
  return new Proxy(store, handler) as unknown as CanvasRenderingContext2D;
}

function fakeWebGlContext(
  calls: string[],
  loseContext: () => void,
  compileOk: boolean,
): WebGLRenderingContext {
  let lost = false;
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (typeof prop !== 'string') {
        return;
      }
      if (/^[A-Z_0-9]+$/.test(prop)) {
        return 1;
      }
      return (...args: unknown[]) => {
        calls.push(prop);
        switch (prop) {
          case 'getExtension':
            return args[0] === 'WEBGL_lose_context'
              ? {
                  loseContext: () => {
                    lost = true;
                    loseContext();
                  },
                }
              : null;
          case 'getShaderParameter':
            return compileOk;
          case 'getProgramParameter':
            return true;
          case 'isContextLost':
            return lost;
          case 'getAttribLocation':
            return 0;
          case 'createShader':
          case 'createProgram':
          case 'createBuffer':
          case 'getUniformLocation':
            return {};
          default:
            return;
        }
      };
    },
  };
  return new Proxy({}, handler) as unknown as WebGLRenderingContext;
}

function installCanvasStubs(options: { webgl: GlMode; twoD: boolean }): CanvasStubs {
  const stubs: CanvasStubs = {
    calls2d: [],
    glCalls: [],
    loseContext: vi.fn<() => void>(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function getContext(
    this: HTMLCanvasElement,
    type: string,
  ) {
    if (type === 'webgl') {
      return options.webgl === 'none'
        ? null
        : fakeWebGlContext(stubs.glCalls, stubs.loseContext, options.webgl === 'ok');
    }
    if (type === '2d' && options.twoD) {
      return fake2dContext(stubs.calls2d);
    }
    return null;
  } as typeof HTMLCanvasElement.prototype.getContext);
  return stubs;
}

interface FrameDriver {
  readonly pending: Map<number, FrameRequestCallback>;
  /** Runs every queued frame callback once at `time` ms. */
  flush: (time: number) => void;
}

function installFrameDriver(): FrameDriver {
  const pending = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((cb: FrameRequestCallback) => {
      const id = nextId++;
      pending.set(id, cb);
      return id;
    }),
  );
  vi.stubGlobal('cancelAnimationFrame', (id: number) => pending.delete(id));
  return {
    pending,
    flush(time) {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const cb of callbacks) {
        cb(time);
      }
    },
  };
}

function stubReducedMotion(): void {
  vi.spyOn(globalThis, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
}

const backdropHost = (): Element | null =>
  document.querySelector(`[data-feed-sanity="${BACKDROP_OWN_VALUE}"]`);

const clickParticles = (): number =>
  document.querySelector(`[data-feed-sanity="${CLICK_FX_OWN_VALUE}"]`)?.childElementCount ?? 0;

/** Dispatches a primary-button pointer or mouse event that crosses shadow roots. */
function fire(el: Element, type: 'pointerdown' | 'click', clientX = 50, clientY = 40): void {
  const init = { button: 0, detail: 1, clientX, clientY, bubbles: true, composed: true };
  el.dispatchEvent(type === 'click' ? new MouseEvent(type, init) : new PointerEvent(type, init));
}

const rendererKind = (): string | null =>
  backdropHost()?.querySelector('[data-fs-renderer]')?.getAttribute('data-fs-renderer') ?? null;

const SCENE_BACKDROPS = (
  Object.keys(BACKDROP_REGISTRY) as Array<Exclude<BackdropEffectId, 'none'>>
).filter((id) => id !== 'digital-rain');

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
    vi.unstubAllGlobals();
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

  it('registers the Silk backdrop everywhere and ships a Velvet Silk vibe', () => {
    expect(BACKDROP_EFFECT_IDS).toContain('silk');
    expect(BACKDROP_OPTIONS.some((opt) => opt.id === 'silk')).toBe(true);
    expect(BACKDROP_REGISTRY.silk.id).toBe('silk');
    expect(readThemeEffectsConfig({ backdrop: 'silk' }).backdrop).toBe('silk');

    // Every option has a registered renderer, and every vibe points at real ids.
    for (const opt of BACKDROP_OPTIONS) {
      if (opt.id !== 'none') {
        expect(BACKDROP_REGISTRY[opt.id]).toBeDefined();
      }
    }
    for (const vibe of STUDIO_VIBES) {
      expect(BUILTIN_THEMES.some((theme) => theme.id === vibe.preset)).toBe(true);
      expect(BACKDROP_EFFECT_IDS).toContain(vibe.effects.backdrop ?? 'none');
      // Calibrated so reading columns always stay comfortably opaque.
      const metrics = resolveGlassMetrics(vibe.effects.glassStrength ?? 0);
      expect(metrics.columnAlpha).toBeGreaterThanOrEqual(0.8);
    }

    const velvet = STUDIO_VIBES.find((v) => v.id === 'velvet-silk');
    expect(velvet).toMatchObject({
      preset: 'crimson-velvet',
      effects: { backdrop: 'silk', surface: 'glass', click: 'ripple' },
    });
    const resolved = resolveTheme(applyStudioVibe(DEFAULT_THEME_CONFIG, velvet!));
    expect(resolved?.effects?.backdrop).toBe('silk');
    expect(compileHostThemeCss(resolved!, xThemeMapping, 'dark')).toContain(
      `[data-feed-sanity="${BACKDROP_OWN_VALUE}"]`,
    );
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

  it('caps backing-store resolution by device pixel ratio and pixel budget', () => {
    const capped = resolveBackingSize(1280, 720, 3, { maxPixelRatio: 1.5 });
    expect(capped.pixelRatio).toBe(1.5);
    expect(capped.width).toBe(1920);
    expect(capped.height).toBe(1080);

    const budget = resolveBackingSize(3840, 2160, 2, { maxPixelRatio: 2, maxPixels: 2_400_000 });
    expect(budget.width * budget.height).toBeLessThanOrEqual(2_400_000);
    expect(budget.pixelRatio).toBeLessThan(1);

    const soft = resolveBackingSize(1600, 900, 2, { renderScale: 0.5 });
    expect(soft.pixelRatio).toBe(0.75);

    const degenerate = resolveBackingSize(0, Number.NaN, Number.NaN);
    expect(degenerate.width).toBeGreaterThanOrEqual(1);
    expect(degenerate.height).toBeGreaterThanOrEqual(1);
  });

  it('mounts, switches, and tears down every registered backdrop plugin cleanly with zero DOM residue', () => {
    const layer = createEffectsLayerController(document);
    cleanups.push(() => layer.dispose());

    for (const id of Object.keys(BACKDROP_REGISTRY) as Array<keyof typeof BACKDROP_REGISTRY>) {
      layer.sync({ ...DEFAULT_THEME_EFFECTS, backdrop: id, intensity: 0.75 }, null, 'dark');
      const host = backdropHost();
      expect(host).not.toBeNull();
      expect(host?.getAttribute('data-fs-backdrop')).toBe(id);
      expect(host?.childElementCount).toBeGreaterThan(0);
    }

    // Turning backdrop off removes the backdrop host cleanly.
    layer.sync(DEFAULT_THEME_EFFECTS, null, 'dark');
    expect(backdropHost()).toBeNull();
  });

  it('falls back to a static CSS wash when no canvas context exists (Happy-DOM, locked-down GPUs)', () => {
    const layer = createEffectsLayerController(document);
    cleanups.push(() => layer.dispose());
    for (const id of SCENE_BACKDROPS) {
      layer.sync({ ...DEFAULT_THEME_EFFECTS, backdrop: id }, null, 'dark');
      expect(rendererKind()).toBe('css');
      expect(backdropHost()?.querySelector('canvas')).toBeNull();
    }
  });

  it('renders every scene on Canvas 2D without throwing when WebGL is unavailable', async () => {
    const stubs = installCanvasStubs({ webgl: 'none', twoD: true });
    const frames = installFrameDriver();
    const layer = createEffectsLayerController(document);
    cleanups.push(() => layer.dispose());
    const palette = BUILTIN_THEMES.find((t) => t.id === 'crimson-velvet')!.palette;
    const light = BUILTIN_THEMES.find((t) => t.id === 'royal-cobalt')!.palette;

    for (const id of SCENE_BACKDROPS) {
      for (const [p, scheme] of [
        [null, 'dark'],
        [palette, 'dark'],
        [light, 'light'],
      ] as const) {
        stubs.calls2d.length = 0;
        layer.sync({ ...DEFAULT_THEME_EFFECTS, backdrop: id }, p, scheme);
        document.dispatchEvent(new PointerEvent('pointermove', { clientX: 300, clientY: 200 }));
        frames.flush(16);
        frames.flush(60);
        frames.flush(120);
        // Let any deferred fallback run: a throwing renderer steps down to CSS.
        await Promise.resolve();
        await Promise.resolve();
        expect(rendererKind()).toBe('canvas2d');
        expect(stubs.calls2d.length).toBeGreaterThan(0);
      }
    }
  });

  it('prefers WebGL for shader scenes and releases every GPU resource on destroy', async () => {
    const stubs = installCanvasStubs({ webgl: 'ok', twoD: true });
    const frames = installFrameDriver();
    const layer = createEffectsLayerController(document);
    cleanups.push(() => layer.dispose());

    for (const id of ['aurora', 'silk', 'prism-beams'] as const) {
      stubs.glCalls.length = 0;
      stubs.loseContext.mockClear();
      layer.sync({ ...DEFAULT_THEME_EFFECTS, backdrop: id }, null, 'dark');
      expect(rendererKind()).toBe('webgl');
      frames.flush(16);
      frames.flush(60);
      await Promise.resolve();
      expect(rendererKind()).toBe('webgl');
      expect(stubs.glCalls).toContain('drawArrays');
      // Shaders are released right after linking.
      expect(stubs.glCalls).toContain('deleteShader');

      layer.sync({ ...DEFAULT_THEME_EFFECTS, backdrop: 'none' }, null, 'dark');
      expect(stubs.glCalls).toContain('deleteProgram');
      expect(stubs.glCalls).toContain('deleteBuffer');
      expect(stubs.loseContext).toHaveBeenCalledTimes(1);
      expect(backdropHost()).toBeNull();
      expect(frames.pending.size).toBe(0);
    }
  });

  it('steps down from WebGL to Canvas 2D on compile failure and on context loss', async () => {
    const failing = installCanvasStubs({ webgl: 'fail-compile', twoD: true });
    installFrameDriver();
    const layer = createEffectsLayerController(document);
    cleanups.push(() => layer.dispose());

    layer.sync({ ...DEFAULT_THEME_EFFECTS, backdrop: 'aurora' }, null, 'dark');
    expect(rendererKind()).toBe('canvas2d');
    expect(failing.loseContext).toHaveBeenCalled();
    layer.sync(DEFAULT_THEME_EFFECTS, null, 'dark');
    vi.restoreAllMocks();

    const stubs = installCanvasStubs({ webgl: 'ok', twoD: true });
    layer.sync({ ...DEFAULT_THEME_EFFECTS, backdrop: 'silk' }, null, 'dark');
    expect(rendererKind()).toBe('webgl');
    const glCanvas = backdropHost()?.querySelector('canvas');
    glCanvas?.dispatchEvent(new Event('webglcontextlost'));
    await Promise.resolve();
    expect(rendererKind()).toBe('canvas2d');
    expect(glCanvas?.isConnected).toBe(false);
    expect(stubs.loseContext).toHaveBeenCalled();
    expect(backdropHost()?.querySelectorAll('canvas').length).toBe(1);
  });

  it('paints a single still frame for reduced motion and pause, and never animates hidden tabs', () => {
    stubReducedMotion();
    const stubs = installCanvasStubs({ webgl: 'none', twoD: true });
    const frames = installFrameDriver();
    const layer = createEffectsLayerController(document);
    cleanups.push(() => layer.dispose());

    layer.sync({ ...DEFAULT_THEME_EFFECTS, backdrop: 'vice-horizon' }, null, 'dark');
    expect(stubs.calls2d.length).toBeGreaterThan(0);
    expect(frames.pending.size).toBe(0);
    vi.mocked(globalThis.matchMedia).mockRestore();

    layer.sync({ ...DEFAULT_THEME_EFFECTS, backdrop: 'starfield', paused: true }, null, 'dark');
    expect(frames.pending.size).toBe(0);

    layer.sync({ ...DEFAULT_THEME_EFFECTS, backdrop: 'starfield', paused: false }, null, 'dark');
    expect(frames.pending.size).toBe(1);

    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(frames.pending.size).toBe(0);
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(frames.pending.size).toBe(1);
  });

  it('renders Dot Spotlight on demand only, sleeping once the pointer settles', () => {
    installCanvasStubs({ webgl: 'none', twoD: true });
    const frames = installFrameDriver();
    const layer = createEffectsLayerController(document);
    cleanups.push(() => layer.dispose());

    layer.sync({ ...DEFAULT_THEME_EFFECTS, backdrop: 'dot-spotlight' }, null, 'dark');
    expect(frames.pending.size).toBe(0);

    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 200, clientY: 150 }));
    expect(frames.pending.size).toBe(1);
    let time = 0;
    for (let i = 0; i < 400 && frames.pending.size > 0; i++) {
      time += 17;
      frames.flush(time);
    }
    expect(frames.pending.size).toBe(0);
  });

  it('leaves zero frames, listeners, or canvases behind after dispose', () => {
    installCanvasStubs({ webgl: 'ok', twoD: true });
    const frames = installFrameDriver();
    const layer = createEffectsLayerController(document);
    for (const id of SCENE_BACKDROPS) {
      layer.sync({ ...DEFAULT_THEME_EFFECTS, backdrop: id }, null, 'dark');
    }
    layer.dispose();
    expect(backdropHost()).toBeNull();
    expect(document.querySelectorAll('canvas').length).toBe(0);
    expect(frames.pending.size).toBe(0);

    // Pointer and visibility events after dispose must not wake any renderer.
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 10, clientY: 10 }));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(frames.pending.size).toBe(0);
  });

  it('spawns subtle click effects inside a pointer-events-none overlay and removes them on disable', () => {
    const bursts: Array<[number, number]> = [];
    const fx = mountClickEffects(document, (x, y) => bursts.push([x, y]));
    cleanups.push(() => fx.destroy());
    const overlay = (): Element | null =>
      document.querySelector(`[data-feed-sanity="${CLICK_FX_OWN_VALUE}"]`);

    fx.setEffect('spark', null);
    fx.triggerAt(120, 80);
    expect(overlay()).not.toBeNull();
    expect(overlay()?.childElementCount).toBe(8);
    const spark = overlay()?.firstElementChild as HTMLElement;
    expect(spark.style.width).toBe('5px');
    expect(spark.style.height).toBe('1.5px');
    expect(spark.style.pointerEvents).toBe('none');

    fx.setEffect('none', null);
    fx.setEffect('ripple', null);
    fx.triggerAt(10, 10);
    const ring = overlay()?.firstElementChild as HTMLElement;
    expect(overlay()?.childElementCount).toBe(1);
    expect(ring.style.width).toBe('64px');
    expect(ring.style.border).toContain('1.25px');

    fx.setEffect('none', null);
    fx.setEffect('glow-pulse', null);
    fx.triggerAt(10, 10);
    expect((overlay()?.firstElementChild as HTMLElement).style.width).toBe('48px');

    fx.setEffect('none', null);
    fx.setEffect('matrix-burst', null);
    fx.triggerAt(200, 100);
    expect(overlay()?.childElementCount).toBe(5);
    // No cascade unless the backdrop accepts bursts.
    expect(bursts.length).toBe(0);
    fx.setEffect('matrix-burst', null, { cascade: true });
    fx.triggerAt(200, 100);
    expect(bursts.length).toBe(1);

    fx.setEffect('none', null);
    expect(overlay()).toBeNull();
  });

  it('gates click particles to interactive targets, but lets Glyphs cascade Matrix Rain anywhere', () => {
    document.body.innerHTML = `
      <div id="react-root">
        <p id="post-text">Selectable post text</p>
        <a id="link" href="#"><span id="link-label">Open</span></a>
        <div id="tab" role="tab">Following</div>
        <div id="shadow-host"></div>
      </div>`;
    const shadow = document.querySelector('#shadow-host')!.attachShadow({ mode: 'open' });
    const shadowButton = document.createElement('button');
    shadow.append(shadowButton);

    const bursts: Array<[number, number]> = [];
    const fx = mountClickEffects(document, (x, y) => bursts.push([x, y]));
    cleanups.push(() => fx.destroy());
    const postText = document.querySelector('#post-text')!;
    const tab = document.querySelector('#tab')!;

    fx.setEffect('ripple', null);
    fire(postText, 'pointerdown');
    fire(document.body, 'pointerdown');
    expect(clickParticles()).toBe(0);

    fire(document.querySelector('#link-label')!, 'pointerdown');
    expect(clickParticles()).toBe(1);
    fire(tab, 'pointerdown');
    fire(shadowButton, 'pointerdown');
    expect(clickParticles()).toBe(3);

    // Glyphs alongside Matrix Rain: margins cascade the rain without spraying particles.
    fx.setEffect('none', null);
    fx.setEffect('matrix-burst', null, { cascade: true });
    fire(postText, 'click');
    expect(bursts.length).toBe(1);
    expect(clickParticles()).toBe(0);

    // Interactive targets get glyphs + one cascade (pointerdown), never a double cascade on click.
    fire(tab, 'pointerdown');
    fire(tab, 'click');
    expect(bursts.length).toBe(2);
    expect(clickParticles()).toBe(5);

    // Without a burst-capable backdrop, clicks never cascade.
    fx.setEffect('matrix-burst', null, { cascade: false });
    fire(postText, 'click');
    fire(tab, 'pointerdown');
    expect(bursts.length).toBe(2);
  });

  it('routes every rain cascade through the click layer: Glyphs only, pointer reactions on', () => {
    const burst = vi.fn();
    vi.spyOn(BACKDROP_REGISTRY['digital-rain'], 'mount').mockImplementation(() => ({
      update: () => undefined,
      burst,
      destroy: () => undefined,
    }));
    const layer = createEffectsLayerController(document);
    cleanups.push(() => layer.dispose());
    const marginClick = (): void => fire(document.body, 'click', 512, 384);

    layer.sync(
      { ...DEFAULT_THEME_EFFECTS, backdrop: 'digital-rain', click: 'matrix-burst' },
      null,
      'dark',
    );
    marginClick();
    expect(burst).toHaveBeenCalledTimes(1);
    expect(burst.mock.calls[0]?.[0]).toBeCloseTo(0.5, 1);
    // No particles for margin clicks; only the rain reacts.
    expect(clickParticles()).toBe(0);

    // Sparks over Matrix Rain stay gated: margins never cascade.
    layer.sync(
      { ...DEFAULT_THEME_EFFECTS, backdrop: 'digital-rain', click: 'spark' },
      null,
      'dark',
    );
    marginClick();
    expect(burst).toHaveBeenCalledTimes(1);

    // Turning pointer reactions off silences cascades too.
    layer.sync(
      {
        ...DEFAULT_THEME_EFFECTS,
        backdrop: 'digital-rain',
        click: 'matrix-burst',
        interactive: false,
      },
      null,
      'dark',
    );
    marginClick();
    expect(burst).toHaveBeenCalledTimes(1);
  });

  it('integrates EffectsLayerController lifecycle inside createThemeController', () => {
    const env = createDomEnvironment({ doc: document });
    cleanups.push(() => env.dispose());
    const controller = createThemeController(env, xThemeMapping, () => undefined);
    cleanups.push(() => controller.dispose());

    const viceVibe = STUDIO_VIBES.find((v) => v.id === 'vice-city-vi')!;
    const resolved = resolveTheme(applyStudioVibe(DEFAULT_THEME_CONFIG, viceVibe));
    controller.apply(resolved);

    expect(backdropHost()).not.toBeNull();

    controller.apply(null);
    expect(backdropHost()).toBeNull();
  });
});
