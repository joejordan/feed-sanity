import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { BackdropEffectId, EffectParamSpec } from './index';
import { facebookThemeMapping } from '../../sites/facebook/theme-mapping';
import { gmailThemeMapping } from '../../sites/gmail/theme-mapping';
import { instagramThemeMapping } from '../../sites/instagram/theme-mapping';
import { redditThemeMapping } from '../../sites/reddit/theme-mapping';
import { xThemeMapping } from '../../sites/x/theme-mapping';
import { createDomEnvironment } from '../dom-env';
import {
  applyStudioVibe,
  BUILTIN_THEMES,
  compileHostThemeCss,
  compileUiThemeCss,
  createThemeController,
  DEFAULT_THEME_DOCUMENT,
  readThemeDocument,
  resolveTheme,
  updateThemeEffects,
} from '../theming';
import { createRandom } from './digital-rain/math';
import { mountDigitalRain } from './digital-rain/mount';
import { RainLayer } from './digital-rain/rain-layer';
import {
  BACKDROP_EFFECT_IDS,
  BACKDROP_OPTIONS,
  BACKDROP_OWN_VALUE,
  BACKDROP_PARAM_SPECS,
  BACKDROP_REGISTRY,
  CLICK_EFFECT_IDS,
  CLICK_FX_OWN_VALUE,
  compileBackdropRevealCss,
  compileSurfaceFinishCss,
  createEffectsLayerController,
  DEFAULT_THEME_EFFECTS,
  deriveEffectParams,
  getClickEffectLabel,
  getSurfaceFinishLabel,
  hasActiveEffects,
  mergeEffectsPatch,
  mountClickEffects,
  readThemeEffectsConfig,
  resolveEffectParams,
  resolveGlassMetrics,
  STUDIO_VIBES,
  SURFACE_FINISH_IDS,
  sameEffectParams,
  validateEffectParams,
} from './index';
import { resolveBackingSize } from './renderers/scene-host';

/* -------------------------------------------------------------------------- */
/* Canvas, WebGL, and animation-frame test doubles                            */
/* -------------------------------------------------------------------------- */

type GlMode = 'none' | 'ok' | 'fail-compile';

interface CanvasStubs {
  readonly calls2d: string[];
  readonly fillTexts: string[];
  readonly glCalls: string[];
  readonly glUniform1f: Record<string, number>;
  readonly loseContext: Mock<() => void>;
}

/** A permissive 2D context: every method is a recorded no-op. */
function fake2dContext(
  calls: string[],
  fillTexts: string[],
  canvas: HTMLCanvasElement,
): CanvasRenderingContext2D {
  const store: Record<string | symbol, unknown> = { canvas };
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
        if (prop === 'fillText' && typeof args[0] === 'string') {
          fillTexts.push(args[0]);
        }
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
  uniform1f: Record<string, number>,
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
          case 'getUniformLocation':
            return { name: String(args[1] ?? '') };
          case 'uniform1f': {
            const loc = args[0] as { name?: string } | null;
            if (loc?.name && typeof args[1] === 'number') {
              uniform1f[loc.name] = args[1];
            }
            return;
          }
          case 'createShader':
          case 'createProgram':
          case 'createBuffer':
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
    fillTexts: [],
    glCalls: [],
    glUniform1f: {},
    loseContext: vi.fn<() => void>(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function getContext(
    this: HTMLCanvasElement,
    type: string,
  ) {
    if (type === 'webgl') {
      return options.webgl === 'none'
        ? null
        : fakeWebGlContext(
            stubs.glCalls,
            stubs.glUniform1f,
            stubs.loseContext,
            options.webgl === 'ok',
          );
    }
    if (type === '2d' && options.twoD) {
      return fake2dContext(stubs.calls2d, stubs.fillTexts, this);
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

const clickParticles = (): number => {
  const host = document.querySelector(`[data-feed-sanity="${CLICK_FX_OWN_VALUE}"]`);
  return (host?.shadowRoot ?? host)?.childElementCount ?? 0;
};

/** Dispatches a primary-button pointer or mouse event that crosses shadow roots. */
function fire(el: Element, type: 'pointerdown' | 'click', clientX = 50, clientY = 40): void {
  const init = { button: 0, detail: 1, clientX, clientY, bubbles: true, composed: true };
  el.dispatchEvent(type === 'click' ? new MouseEvent(type, init) : new PointerEvent(type, init));
}

const rendererKind = (): string | null =>
  backdropHost()?.querySelector('[data-fs-renderer]')?.getAttribute('data-fs-renderer') ?? null;

const SCENE_BACKDROPS = (
  Object.keys(BACKDROP_REGISTRY) as Array<Exclude<BackdropEffectId, 'none'>>
).filter((id) => id !== 'digital-rain' && id !== 'custom-scene' && id !== 'custom-shader');

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

  it('validates, clamps, and safely defaults ThemeEffectsConfig and plugin backdropParams', () => {
    expect(readThemeEffectsConfig(null)).toEqual(DEFAULT_THEME_EFFECTS);
    expect(hasActiveEffects(DEFAULT_THEME_EFFECTS)).toBe(false);

    const parsed = readThemeEffectsConfig({
      backdrop: 'digital-rain',
      intensity: 99,
      speed: 0.01,
      glassStrength: 5,
      backdropParams: {
        look: 'phosphor',
        charset: 'binary',
        density: -3,
        intro: 'rain-in',
        customGlyphs: '❄\u0007❅❆*·',
      },
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
      backdropParams: {
        look: 'phosphor',
        charset: 'binary',
        density: 0.15,
        intro: 'rain-in',
        customGlyphs: '❄❅❆*·',
      },
      surface: 'neon',
      click: 'spark',
    });
    expect(hasActiveEffects(parsed)).toBe(true);

    // Invalid enum values fall back cleanly without crashing, and non-param backdrops strip stale params.
    const invalid = readThemeEffectsConfig({
      backdrop: 'invalid',
      surface: 'bogus',
      click: 'nope',
      backdropParams: { look: 'unknown', charset: 'emoji-bomb' },
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
    for (const id of SURFACE_FINISH_IDS) {
      expect(getSurfaceFinishLabel(id)?.length).toBeGreaterThan(0);
    }
    for (const id of CLICK_EFFECT_IDS) {
      expect(getClickEffectLabel(id)?.length).toBeGreaterThan(0);
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
    const resolved = resolveTheme(applyStudioVibe(DEFAULT_THEME_DOCUMENT, velvet!));
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

    const matrixDoc = applyStudioVibe(DEFAULT_THEME_DOCUMENT, matrixVibe);
    expect(readThemeDocument(matrixDoc).effects?.backdrop?.id).toBe('digital-rain');
    expect(readThemeDocument(matrixDoc).effects?.click?.id).toBe('matrix-burst');

    const resolvedMatrix = resolveTheme(matrixDoc)!;
    const hostCss = compileHostThemeCss(resolvedMatrix, xThemeMapping, 'dark');
    expect(hostCss).toContain('[data-feed-sanity="theme-backdrop"]');
    expect(hostCss).toContain('#react-root');
    expect(hostCss).toContain('[data-fs-shell]');
    expect(hostCss).toContain('backdrop-filter: blur(');

    const viceDoc = applyStudioVibe(DEFAULT_THEME_DOCUMENT, viceVibe);
    const resolvedVice = resolveTheme(viceDoc)!;
    const viceCss = compileHostThemeCss(resolvedVice, xThemeMapping, 'dark');
    expect(viceCss).toContain('linear-gradient(145deg');
    expect(compileUiThemeCss(resolvedVice)).toContain('linear-gradient(160deg');

    // Effects alone on Site Default still resolve cleanly without forcing a custom color palette.
    const effectsOnly = resolveTheme(
      updateThemeEffects(DEFAULT_THEME_DOCUMENT, { backdrop: 'aurora' }),
    );
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
    const capped = resolveBackingSize(1280, 720, 3, { maxPixelRatio: 1.5, maxPixels: 2_400_000 });
    expect(capped.pixelRatio).toBe(1.5);
    expect(capped.width).toBe(1920);
    expect(capped.height).toBe(1080);

    const budget = resolveBackingSize(3840, 2160, 2, { maxPixelRatio: 2, maxPixels: 2_400_000 });
    expect(budget.width * budget.height).toBeLessThanOrEqual(2_400_000);
    expect(budget.pixelRatio).toBeLessThan(1);

    const soft = resolveBackingSize(1600, 900, 2, { renderScale: 0.5 });
    expect(soft.pixelRatio).toBe(0.625);

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
    const overlayHost = (): Element | null =>
      document.querySelector(`[data-feed-sanity="${CLICK_FX_OWN_VALUE}"]`);
    const overlay = (): ParentNode | null => {
      const host = overlayHost();
      return host ? (host.shadowRoot ?? host) : null;
    };

    fx.setEffect('spark', null);
    fx.triggerAt(120, 80);
    expect(overlayHost()).not.toBeNull();
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
    expect(overlayHost()).toBeNull();
  });

  it('gates click particles to interactive targets, attaches listeners lazily, and guards disposed triggerAt', () => {
    document.body.innerHTML = `
      <div id="react-root">
        <p id="post-text">Selectable post text</p>
        <a id="link" href="#"><span id="link-label">Open</span></a>
        <div id="tab" role="tab">Following</div>
        <div id="composer" contenteditable="true"><span id="composer-child">Hi</span></div>
        <div id="readonly-box" contenteditable="false"><span id="readonly-child">Nope</span></div>
        <div id="shadow-host"></div>
      </div>`;
    const shadow = document.querySelector('#shadow-host')!.attachShadow({ mode: 'open' });
    const shadowButton = document.createElement('button');
    shadow.append(shadowButton);

    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const bursts: Array<[number, number]> = [];
    const fx = mountClickEffects(document, (x, y) => bursts.push([x, y]));
    cleanups.push(() => fx.destroy());
    // Zero document listeners attached while effect is 'none'.
    expect(addSpy).not.toHaveBeenCalled();

    const postText = document.querySelector('#post-text')!;
    const tab = document.querySelector('#tab')!;

    fx.setEffect('ripple', null);
    // Non-cascading effect attaches pointerdown only, never click.
    expect(addSpy).toHaveBeenCalledWith('pointerdown', expect.any(Function), expect.any(Object));
    expect(addSpy).not.toHaveBeenCalledWith('click', expect.any(Function), expect.any(Object));

    fire(postText, 'pointerdown');
    fire(document.body, 'pointerdown');
    fire(document.querySelector('#readonly-child')!, 'pointerdown');
    expect(clickParticles()).toBe(0);

    fire(document.querySelector('#link-label')!, 'pointerdown');
    expect(clickParticles()).toBe(1);
    fire(tab, 'pointerdown');
    fire(shadowButton, 'pointerdown');
    fire(document.querySelector('#composer-child')!, 'pointerdown');
    expect(clickParticles()).toBe(4);

    // Turning off detaches pointerdown cleanly; toggling back on re-attaches without duplicates.
    fx.setEffect('none', null);
    expect(removeSpy).toHaveBeenCalledWith('pointerdown', expect.any(Function), { capture: true });

    // Glyphs alongside Matrix Rain: margins cascade the rain without spraying particles.
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

    // Destroyed controller never invokes onBurst via triggerAt.
    fx.setEffect('matrix-burst', null, { cascade: true });
    fx.destroy();
    fx.triggerAt(100, 100);
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
    const resolved = resolveTheme(applyStudioVibe(DEFAULT_THEME_DOCUMENT, viceVibe));
    controller.apply(resolved);

    expect(backdropHost()).not.toBeNull();

    controller.apply(null);
    expect(backdropHost()).toBeNull();
  });

  it('layers backdrop at z-index -1 without body stacking traps and keeps popups opaque without ancestor backdrop-filter', () => {
    const matrixVibe = STUDIO_VIBES.find((v) => v.id === 'enter-the-matrix')!;
    const resolved = resolveTheme(applyStudioVibe(DEFAULT_THEME_DOCUMENT, matrixVibe))!;

    const xCss = compileHostThemeCss(resolved, xThemeMapping, 'dark');
    expect(xCss).toContain('z-index: -1;');
    expect(xCss).not.toContain('body > :not(');
    expect(xCss).toContain('#layers');
    expect(xCss).toContain('form[role="search"]');
    expect(xCss).toContain('[role="listbox"]');
    expect(xCss).toContain('[id^="typeaheadDropdown"]');
    // Primary column must NOT carry backdrop-filter (which traps sticky/fixed headers & dropdowns).
    expect(xCss).not.toMatch(/\[data-testid="primaryColumn"\][^}]*backdrop-filter/s);

    const glassCss = compileSurfaceFinishCss(resolved.palette, 'dark', {
      ...DEFAULT_THEME_EFFECTS,
      surface: 'glass',
    });
    // Popups stay high-opacity without backdrop-filter creating a stacking trap.
    expect(glassCss).not.toMatch(/\[role="dialog"\][^}]*backdrop-filter/s);
    expect(glassCss).toContain('[role="listbox"]');

    const fbCss = compileHostThemeCss(resolved, facebookThemeMapping, 'dark');
    expect(fbCss).not.toContain('body > :not(');
    expect(fbCss).toContain('--popover-background:');
    expect(fbCss).toContain('--card-background-wash: transparent !important;');
    expect(fbCss).toContain('--progress-ring-neutral-foreground:');
    expect(fbCss).toContain('--glimmer-spinner-icon:');
    expect(fbCss).toContain('[role="progressbar"]');
    expect(fbCss).toContain('--base-blue:');
    expect(fbCss).toContain('svg[aria-label*="Loading" i]');
    // Class-styled Comet progress rings omit an HTML `stroke` attribute on `<circle>`.
    expect(fbCss).toContain('circle:last-of-type,');
    expect(fbCss).not.toContain('circle:last-of-type, path)[stroke]');
    expect(fbCss).toContain('stop-color:');
    expect(fbCss).toContain('[data-fs-shell]');
    expect(fbCss).not.toContain('div:has([role="main"])');
    expect(fbCss).not.toMatch(/\[role="banner"\][^}]*backdrop-filter/s);

    // Intermediate root wrappers on X (Dim/Lights Out/Light), What's happening trend rows,
    // and dialog toggle switches stay clean via universal `[data-fs-shell]` in
    // `@layer fs-reveal-shell` + `--fs-reveal-canvas` (zero brittle `> div > div` chains,
    // zero unbounded `:has()`, and zero 5x attr hacks).
    expect(xCss).toContain('@layer fs-reveal-shell');
    expect(xCss).toContain('[data-fs-shell]');
    expect(xCss).toContain('--fs-reveal-canvas: transparent !important;');
    expect(xCss).not.toContain('#react-root > div > div');
    expect(xCss).not.toContain('#react-root div:has(');
    expect(xCss).not.toContain('[data-testid="sidebarColumn"] > div > div');
    expect(xCss).not.toContain('[data-fs-heal-bg]');
    expect(xCss).not.toContain(':where(button, [role="button"]):hover');
    expect(xCss).toContain('[data-testid="sidebarColumn"] section [data-testid="trend"]');
    expect(xCss).toContain('[role="dialog"] input:not([type="checkbox"]');
    expect(xCss).not.toContain('[role="dialog"] input,');

    // `backdrop-filter: blur()` is reserved strictly for `surface: 'glass'` and capped <= 10px.
    const defaultSurfaceReveal = compileBackdropRevealCss(
      resolved.palette,
      'dark',
      { ...DEFAULT_THEME_EFFECTS, ...resolved.effects, surface: 'default' },
      xThemeMapping,
    );
    expect(defaultSurfaceReveal).not.toContain('backdrop-filter');
    expect(resolveGlassMetrics(1).blurPx).toBeLessThanOrEqual(10);

    // Site-agnostic surface finish slots handle comma-separated `feedCards` (each selector
    // receives `:hover`), `primaryCtas`, `searchContainers`, and `glass` without `leafCards`.
    const neonWithSurfaces = compileSurfaceFinishCss(
      resolved.palette,
      'dark',
      { ...DEFAULT_THEME_EFFECTS, surface: 'neon' },
      {
        feedCards: ['article, [role="article"]'],
        primaryCtas: ['button.compose'],
        searchContainers: ['form[role="search"] > div'],
        columns: ['main > .col'],
      },
    );
    expect(neonWithSurfaces).toContain('article:hover,\n[role="article"]:hover');
    expect(neonWithSurfaces).toContain('button.compose');
    expect(neonWithSurfaces).toContain('form[role="search"] > div');
    expect(neonWithSurfaces).toContain('main > .col');

    const glassNoLeaves = compileSurfaceFinishCss(
      resolved.palette,
      'dark',
      { ...DEFAULT_THEME_EFFECTS, surface: 'glass' },
      { popups: ['[role="dialog"]'] },
    );
    expect(glassNoLeaves).not.toContain('backdrop-filter');
    expect(glassNoLeaves).toContain('[role="dialog"]');

    const layer = createEffectsLayerController(document);
    cleanups.push(() => layer.dispose());
    layer.sync(resolved.effects, resolved.palette, 'dark');
    expect((backdropHost() as HTMLElement | null)?.style.zIndex).toBe('-1');
  });

  it('enforces stacking and popup opacity invariants across every site mapping and every Studio Vibe', () => {
    const allSites = [
      ['facebook', facebookThemeMapping],
      ['x', xThemeMapping],
      ['instagram', instagramThemeMapping],
      ['reddit', redditThemeMapping],
      ['gmail', gmailThemeMapping],
    ] as const;

    const forbiddenBackdropTargets = [
      '[data-testid="primaryColumn"]',
      '[role="banner"]',
      '[role="dialog"]',
      '[role="menu"]',
      '[role="listbox"]',
      '[data-testid="Dropdown"]',
      '[data-testid="HoverCard"]',
    ];

    // Parse top-level CSS rule blocks (`selector { body }`) to inspect every declaration cleanly.
    const parseRules = (css: string): Array<{ selector: string; body: string }> => {
      const rules: Array<{ selector: string; body: string }> = [];
      for (const match of css.matchAll(/([^{}]+)\{([^{}]+)\}/g)) {
        const selector = (match[1] ?? '').trim();
        const body = (match[2] ?? '').trim();
        if (selector && body) {
          rules.push({ selector, body });
        }
      }
      return rules;
    };

    for (const [siteName, mapping] of allSites) {
      expect(mapping.surfaces, `${siteName} should declare centralized surfaces`).toBeDefined();
      for (const vibe of STUDIO_VIBES) {
        const resolved = resolveTheme(applyStudioVibe(DEFAULT_THEME_DOCUMENT, vibe))!;
        const css = compileHostThemeCss(resolved, mapping, 'dark');

        // Invariant 1: Never inject a body-child stacking/position trap.
        expect(css, `${siteName}/${vibe.id}`).not.toContain('body > :not(');

        const rules = parseRules(css);

        // Invariant 2: Never apply `backdrop-filter` to landmarks, columns, banners, or popups.
        for (const rule of rules) {
          if (!/backdrop-filter\s*:/i.test(rule.body)) {
            continue;
          }
          for (const forbidden of forbiddenBackdropTargets) {
            expect(
              rule.selector.includes(forbidden),
              `${siteName}/${vibe.id}: forbidden backdrop-filter on ${forbidden} in "${rule.selector}"`,
            ).toBe(false);
          }
        }

        // Invariant 3: Every declared popup selector receives a high-opacity (>= 0.95) background fill.
        const popupRules = rules.filter((r) =>
          (mapping.surfaces?.popups ?? []).some((p) => r.selector.includes(p)),
        );
        expect(
          popupRules.length,
          `${siteName}/${vibe.id}: missing opaque popup background rule`,
        ).toBeGreaterThan(0);
        for (const rule of popupRules) {
          const alphaMatch = /background-color:\s*rgb\([^/]+\/\s*([0-9.]+)\)/i.exec(rule.body);
          if (alphaMatch?.[1]) {
            expect(
              Number.parseFloat(alphaMatch[1]),
              `${siteName}/${vibe.id}: popup alpha too low in "${rule.selector}"`,
            ).toBeGreaterThanOrEqual(0.95);
          }
        }
      }
    }
  });

  it('supports matrix-component rain-in intro, disc-burst cascades, spot capping, and drag-following cascades', () => {
    const layer = new RainLayer(createRandom(42), true);
    layer.setGlyphCount(16);
    layer.setDynamics({
      density: 0.7,
      trailLength: 10,
      fallRate: 12,
      speedVariance: 0.3,
      mutationRate: 0.2,
    });
    layer.resize(40, 30, 12, 16);

    // Rain-in starts empty until streams fall in from the top.
    let initialLit = 0;
    layer.visit(() => {
      initialLit++;
    });
    expect(initialLit).toBe(0);

    // Disc-burst cascade releases multiple sparks within a ring and caps overlap per spot.
    const started = layer.cascade(20, 15, 1);
    expect(started).toBeGreaterThan(1);
    let capped = 0;
    for (let i = 0; i < 8; i++) {
      capped = layer.cascade(20, 15, 0);
    }
    expect(capped).toBe(0);

    // Stepping advances streams and compacts finished cascades cleanly.
    for (let i = 0; i < 60; i++) {
      layer.step(0.1);
    }
    let afterRainIn = 0;
    layer.visit(() => {
      afterRainIn++;
    });
    expect(afterRainIn).toBeGreaterThan(0);

    // Drag-following cascades fire while primary button is held and stop on release/blur.
    const stubs = installCanvasStubs({ webgl: 'none', twoD: true });
    const frames = installFrameDriver();
    const cascadeSpy = vi.spyOn(RainLayer.prototype, 'cascade');
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      toJSON: () => ({}),
    });
    const rain = mountDigitalRain(canvas, {
      intro: 'rain-in',
      density: 0,
      clickCascade: true,
      interactive: true,
      seed: 7,
    });
    cleanups.push(() => rain.destroy());

    canvas.dispatchEvent(
      new PointerEvent('pointerdown', {
        button: 0,
        buttons: 1,
        clientX: 100,
        clientY: 200,
        isPrimary: true,
        bubbles: true,
      }),
    );
    const afterPress = cascadeSpy.mock.calls.length;
    expect(afterPress).toBe(1);

    canvas.dispatchEvent(
      new PointerEvent('pointermove', {
        buttons: 1,
        clientX: 500,
        clientY: 200,
        isPrimary: true,
        bubbles: true,
      }),
    );
    frames.flush(0);
    frames.flush(60);
    frames.flush(120);
    const afterDrag = cascadeSpy.mock.calls.length;
    expect(afterDrag).toBeGreaterThan(afterPress);
    expect(stubs.calls2d).toContain('drawImage');

    // Releasing the primary button stops drag-following cascades.
    canvas.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerType: 'mouse',
        button: 0,
        buttons: 0,
        clientX: 500,
        clientY: 200,
        isPrimary: true,
        bubbles: true,
      }),
    );
    canvas.dispatchEvent(
      new PointerEvent('pointermove', {
        buttons: 0,
        clientX: 150,
        clientY: 250,
        isPrimary: true,
        bubbles: true,
      }),
    );
    frames.flush(180);
    frames.flush(240);
    expect(cascadeSpy.mock.calls.length).toBe(afterDrag);

    // Losing window focus mid-drag also cancels drag cascades cleanly.
    canvas.dispatchEvent(
      new PointerEvent('pointerdown', {
        button: 0,
        buttons: 1,
        clientX: 150,
        clientY: 250,
        isPrimary: true,
        bubbles: true,
      }),
    );
    const afterSecondPress = cascadeSpy.mock.calls.length;
    globalThis.dispatchEvent(new Event('blur'));
    frames.flush(700);
    frames.flush(1200);
    expect(cascadeSpy.mock.calls.length).toBe(afterSecondPress);

    // Mounting with `intro: 'rain-in'` while already `paused: true` opens filled (never blank).
    stubs.calls2d.length = 0;
    const pausedCanvas = document.createElement('canvas');
    document.body.append(pausedCanvas);
    vi.spyOn(pausedCanvas, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      toJSON: () => ({}),
    });
    const pausedRain = mountDigitalRain(pausedCanvas, {
      intro: 'rain-in',
      paused: true,
      density: 0.7,
      seed: 9,
    });
    cleanups.push(() => pausedRain.destroy());
    frames.flush(1300);
    expect(stubs.calls2d).toContain('drawImage');
  });

  it('routes digital-rain backdropParams.customGlyphs to Canvas 2D fillText and updates live', () => {
    const stubs = installCanvasStubs({ webgl: 'none', twoD: true });
    const frames = installFrameDriver();
    const layer = createEffectsLayerController(document);
    cleanups.push(() => layer.dispose());

    layer.sync(
      {
        ...DEFAULT_THEME_EFFECTS,
        backdrop: 'digital-rain',
        backdropParams: { look: 'glacier', customGlyphs: '❄❅' },
      },
      null,
      'dark',
    );
    frames.flush(16);
    expect(stubs.fillTexts).toContain('❄');
    expect(stubs.fillTexts).toContain('❅');

    stubs.fillTexts.length = 0;
    layer.sync(
      {
        ...DEFAULT_THEME_EFFECTS,
        backdrop: 'digital-rain',
        backdropParams: { look: 'glacier', customGlyphs: '⚡★' },
      },
      null,
      'dark',
    );
    frames.flush(48);
    expect(stubs.fillTexts).toContain('⚡');
    expect(stubs.fillTexts).toContain('★');
  });

  it('validates, resolves, compares, and merges declarative EffectParamSpec values safely', () => {
    const specs: readonly EffectParamSpec[] = [
      { key: 'enabled', label: 'Enabled', kind: 'boolean', defaultValue: false },
      { key: 'tint', label: 'Tint', kind: 'color', defaultValue: '#38bdf8' },
      { key: 'glyphs', label: 'Glyphs', kind: 'string', maxLength: 3, defaultValue: '' },
    ];

    // Surrogate-safe truncation keeps whole astral glyphs instead of splitting UTF-16 code units.
    const validated = validateEffectParams(
      { enabled: true, tint: '#abc', glyphs: 'A🌸⚡❄', extra: 1 },
      specs,
    );
    expect(validated).toEqual({
      enabled: true,
      tint: '#aabbcc',
      glyphs: 'A🌸⚡',
    });

    // Resolved params fill defaults for missing/invalid entries.
    expect(resolveEffectParams(specs, { tint: 'not-a-color' })).toEqual({
      enabled: false,
      tint: '#38bdf8',
      glyphs: '',
    });

    // Empty-spec backdrops still emit forward-compat warnings for unknown parameter keys.
    const warnings: string[] = [];
    expect(validateEffectParams({ futureKey: 42 }, [], warnings)).toBeUndefined();
    expect(warnings).toEqual(['Ignored unrecognized effect parameter(s): futureKey.']);

    // Equality & merge helpers preserve params on same backdrop and reset on backdrop switch.
    expect(sameEffectParams({ a: 1, b: 'x' }, { b: 'x', a: 1 })).toBe(true);
    expect(sameEffectParams({ a: 1 }, { a: 2 })).toBe(false);

    const base = {
      ...DEFAULT_THEME_EFFECTS,
      backdrop: 'digital-rain' as const,
      backdropParams: { look: 'classic', density: 1 },
    };
    const mergedSame = mergeEffectsPatch(base, { backdropParams: { density: 1.5 } });
    expect(mergedSame.backdropParams).toEqual({ look: 'classic', density: 1.5 });
    const switched = mergeEffectsPatch(mergedSame, { backdrop: 'aurora' });
    expect(switched.backdrop).toBe('aurora');
    expect(switched.backdropParams).toBeUndefined();
  });

  it('exposes declarative param specs for every backdrop, memoizes deriveEffectParams, and applies live params in WebGL & Canvas 2D', async () => {
    for (const id of BACKDROP_EFFECT_IDS) {
      if (id === 'none' || id === 'custom-scene' || id === 'custom-shader') {
        continue;
      }
      expect(BACKDROP_PARAM_SPECS[id].length).toBeGreaterThan(0);
    }

    // deriveEffectParams memoizes identical params and invalidates on value changes.
    let projectCalls = 0;
    const readSilk = deriveEffectParams(BACKDROP_PARAM_SPECS.silk, (p) => {
      projectCalls++;
      return { scale: p.scale as number };
    });
    const first = readSilk(undefined);
    expect(readSilk(undefined)).toBe(first);
    expect(readSilk({ scale: 1 })).not.toBe(first);
    expect(readSilk({ scale: 1 })).toEqual({ scale: 1 });
    expect(projectCalls).toBe(2);

    const customByBackdrop = {
      'vice-horizon': { sunScale: 1.25, palms: false, sunSlices: false, clouds: false },
      aurora: { height: 1.25, shimmer: 1.3 },
      silk: { scale: 1.4, sheen: 1.3, angle: 25 },
      starfield: { density: 1.5, constellations: false, shootingStars: false },
      'cyber-grid': { gridDensity: 1.4, mountains: false, scanPulse: false },
      'prism-beams': { spread: 0.55, dust: false },
      'dot-spotlight': { spacing: 30, spotRadius: 320 },
    } as const;

    // WebGL shader scenes upload initial and live-updated param uniforms without falling back.
    const glStubs = installCanvasStubs({ webgl: 'ok', twoD: true });
    const frames = installFrameDriver();
    const layer = createEffectsLayerController(document);
    cleanups.push(() => layer.dispose());
    for (const [id, params] of Object.entries(customByBackdrop)) {
      glStubs.calls2d.length = 0;
      glStubs.glCalls.length = 0;
      for (const k of Object.keys(glStubs.glUniform1f)) {
        delete glStubs.glUniform1f[k];
      }
      layer.sync(
        {
          ...DEFAULT_THEME_EFFECTS,
          backdrop: id as keyof typeof customByBackdrop,
          backdropParams: params,
        },
        null,
        'dark',
      );
      frames.flush(16);
      await Promise.resolve();
      if (id === 'aurora') {
        expect(rendererKind()).toBe('webgl');
        expect(glStubs.glUniform1f.uReach).toBe(1.25);
        expect(glStubs.glUniform1f.uShimmer).toBe(1.3);
        layer.sync(
          { ...DEFAULT_THEME_EFFECTS, backdrop: 'aurora', backdropParams: { height: 0.7 } },
          null,
          'dark',
        );
        frames.flush(64);
        expect(glStubs.glUniform1f.uReach).toBe(0.7);
      } else if (id === 'silk') {
        expect(rendererKind()).toBe('webgl');
        expect(glStubs.glUniform1f.uScale).toBe(1.4);
        expect(glStubs.glUniform1f.uSheenGain).toBe(1.3);
      } else if (id === 'prism-beams') {
        expect(rendererKind()).toBe('webgl');
        expect(glStubs.glUniform1f.uSpread).toBe(0.55);
        expect(glStubs.glUniform1f.uDust).toBe(0);
      } else {
        expect(rendererKind()).toBe('canvas2d');
        expect(glStubs.calls2d.length).toBeGreaterThan(0);
      }
    }

    // Dual-backend shader scenes also apply non-default params cleanly on their Canvas 2D fallback.
    const twoDStubs = installCanvasStubs({ webgl: 'none', twoD: true });
    const twoDLayer = createEffectsLayerController(document);
    cleanups.push(() => twoDLayer.dispose());
    for (const id of ['aurora', 'silk', 'prism-beams'] as const) {
      twoDStubs.calls2d.length = 0;
      twoDLayer.sync(
        { ...DEFAULT_THEME_EFFECTS, backdrop: id, backdropParams: customByBackdrop[id] },
        null,
        'dark',
      );
      frames.flush(112);
      await Promise.resolve();
      expect(rendererKind()).toBe('canvas2d');
      expect(twoDStubs.calls2d.length).toBeGreaterThan(0);
    }
  });
});
