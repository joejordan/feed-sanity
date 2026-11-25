import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ThemePalette } from '../theming/types';
import type { CustomSceneSpec, CustomShaderSpec } from './scene-schema';
import { xThemeMapping } from '../../sites/x/theme-mapping';
import { compileHostThemeCss } from '../theming/compile';
import { compileUiSurfaceCss } from '../theming/compile-ui';
import { applyStudioVibe, DEFAULT_THEME_DOCUMENT, resolveTheme } from '../theming/config';
import { BUILTIN_THEMES, findThemePreset } from '../theming/presets';
import { THEME_LAYER_ORDER } from '../theming/types';
import { createEffectsLayerController } from './controller';
import { EVENT_HORIZON_SHADER } from './event-horizon-shader';
import { LUMINOUS_TIDE_SHADER } from './luminous-tide-shader';
import { DEFAULT_THEME_EFFECTS, STUDIO_VIBES } from './model';
import { buildCustomFragmentSource } from './renderers/custom-shader';
import {
  MAX_CUSTOM_SHADER_BYTES,
  MAX_CUSTOM_SHADER_PARAMS,
  parseCustomShader,
  validateCustomShaderSource,
} from './scene-schema';
import { compileSurfaceFinishCss } from './surfaces';

const DARK_PALETTE: ThemePalette = {
  colorScheme: 'dark',
  background: '#0b0f17',
  surface: '#131926',
  surfaceAlt: '#1c2436',
  text: '#e6edf7',
  textMuted: '#8d9cb5',
  border: '#253147',
  accent: '#3b82f6',
  accentSecondary: '#ec4899',
  accentText: '#ffffff',
  danger: '#f87171',
};

/** Words GLSL ES 1.00 reserves for future use: legal-looking names that fail to compile. */
const GLSL_RESERVED_WORDS = [
  'asm',
  'class',
  'union',
  'enum',
  'typedef',
  'template',
  'this',
  'packed',
  'goto',
  'switch',
  'default',
  'inline',
  'noinline',
  'volatile',
  'public',
  'static',
  'extern',
  'external',
  'interface',
  'flat',
  'long',
  'short',
  'double',
  'half',
  'fixed',
  'unsigned',
  'superp',
  'input',
  'output',
  'sizeof',
  'cast',
  'namespace',
  'using',
];

/**
 * Static checks for the GLSL ES 1.00 rules our shaders must follow, which
 * drivers do not agree on and a mocked WebGL context cannot catch: literal
 * `smoothstep` edges must ascend, and reserved words cannot be identifiers.
 */
function lintFlagshipGlsl(fragment: string): string[] {
  const problems: string[] = [];
  const code = fragment.replaceAll(/\/\/.*$/gm, '');
  const edges = /smoothstep\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,/g;
  for (const match of code.matchAll(edges)) {
    if (Number(match[1]) >= Number(match[2])) {
      problems.push(`smoothstep edges must ascend: ${match[0]}`);
    }
  }
  for (const word of GLSL_RESERVED_WORDS) {
    if (new RegExp(`\\b${word}\\b`).test(code)) {
      problems.push(`reserved GLSL ES 1.00 word used as an identifier: ${word}`);
    }
  }
  return problems;
}

function makeFake2dContext(): CanvasRenderingContext2D {
  const grad = { addColorStop: vi.fn() } as unknown as CanvasGradient;
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    ellipse: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    createLinearGradient: vi.fn(() => grad),
    createRadialGradient: vi.fn(() => grad),
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
  } as unknown as CanvasRenderingContext2D;
}

function makeFakeWebGLContext(options: { compileOk?: boolean } = {}) {
  const compileOk = options.compileOk ?? true;
  const uniforms = new Map<string, { readonly name: string }>();
  const uniform1f = vi.fn();
  const uniform2f = vi.fn();
  const uniform3f = vi.fn();
  const uniform4f = vi.fn();
  const uniform4fv = vi.fn();
  const drawArrays = vi.fn();
  const shaderSource = vi.fn();
  const loseContext = vi.fn();
  let contextLost = false;

  const gl = {
    VERTEX_SHADER: 0x8b_31,
    FRAGMENT_SHADER: 0x8b_30,
    COMPILE_STATUS: 0x8b_81,
    LINK_STATUS: 0x8b_82,
    ARRAY_BUFFER: 0x88_92,
    STATIC_DRAW: 0x88_e4,
    FLOAT: 0x14_06,
    DEPTH_TEST: 0x0b_71,
    BLEND: 0x0b_e2,
    TRIANGLES: 0x00_04,
    createShader: vi.fn(() => ({})),
    shaderSource,
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => compileOk),
    getShaderInfoLog: vi.fn(() => (compileOk ? '' : 'syntax error at line 3')),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({})),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    detachShader: vi.fn(),
    getProgramParameter: vi.fn(() => compileOk),
    getProgramInfoLog: vi.fn(() => ''),
    deleteProgram: vi.fn(),
    createBuffer: vi.fn(() => ({})),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    deleteBuffer: vi.fn(),
    useProgram: vi.fn(),
    getAttribLocation: vi.fn(() => 0),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    disable: vi.fn(),
    viewport: vi.fn(),
    getUniformLocation: vi.fn((_prog: unknown, name: string) => {
      const loc = { name };
      uniforms.set(name, loc);
      return loc;
    }),
    uniform1f,
    uniform2f,
    uniform3f,
    uniform4f,
    uniform4fv,
    drawArrays,
    isContextLost: vi.fn(() => contextLost),
    getExtension: vi.fn(() => ({ loseContext })),
  } as unknown as WebGLRenderingContext;

  return {
    gl,
    uniforms,
    uniform1f,
    uniform2f,
    uniform3f,
    uniform4f,
    uniform4fv,
    drawArrays,
    shaderSource,
    loseContext,
    setLost: (v: boolean) => {
      contextLost = v;
    },
  };
}

/** Gives every canvas a fixed CSS size so the scene host can size its backing store. */
function mockCanvasSize(width: number, height: number): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
}

/** Swaps `requestAnimationFrame` for a manual queue so a test can run frames at chosen times. */
function stubAnimationFrames(): FrameRequestCallback[] {
  const queue: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    queue.push(cb);
    return queue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  return queue;
}

describe('Tier 2 custom-scene & Tier 3 custom-shader runtime renderers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('mounts and draws all 6 Tier 2 custom-scene layer kinds on Canvas 2D and tears down cleanly', () => {
    const ctx2d = makeFake2dContext();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((kind: string) =>
      kind === '2d' ? ctx2d : null) as HTMLCanvasElement['getContext']);

    const scene: CustomSceneSpec = {
      fps: 24,
      layers: [
        { kind: 'gradient', style: 'radial', colors: ['background', 'accent'], x: 0.5, y: 0.4 },
        {
          kind: 'rays',
          count: 4,
          originX: 0.5,
          originY: 0,
          spread: 0.3,
          rotationSpeed: 0.2,
          color: 'accent',
        },
        {
          kind: 'silhouette',
          style: 'skyline',
          x: 0.5,
          y: 0.85,
          scale: 1,
          color: 'surface',
          secondaryColor: 'accent',
        },
        {
          kind: 'waves',
          count: 2,
          amplitude: 0.08,
          frequency: 2,
          thickness: 6,
          y: 0.6,
          color: 'alt',
        },
        { kind: 'grid', horizon: 0.6, spacing: 40, glow: 0.5, color: 'accent' },
        {
          kind: 'particles',
          shape: 'glyph',
          glyphs: '❄✦',
          count: 16,
          sizeMin: 4,
          sizeMax: 8,
          speed: 0.8,
          angle: 90,
          spread: 20,
          twinkle: true,
          clickBurst: true,
          color: 'text',
          parallax: 0.3,
        },
      ],
    };

    const controller = createEffectsLayerController(document);
    controller.sync(
      {
        ...DEFAULT_THEME_EFFECTS,
        backdrop: 'custom-scene',
        customScene: scene,
        paused: true,
      },
      DARK_PALETTE,
      'dark',
    );

    const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-fs-renderer="canvas2d"]');
    expect(canvas).not.toBeNull();
    expect(ctx2d.fillRect).toHaveBeenCalled();
    expect(ctx2d.stroke).toHaveBeenCalled();
    expect(ctx2d.fillText).toHaveBeenCalled();

    controller.dispose();
    expect(document.querySelector('canvas')).toBeNull();
  });

  it('wraps custom GLSL shaders with standard & custom uniforms and binds them on WebGL 1', () => {
    const shader: CustomShaderSpec = {
      fragment: `
        void mainImage(out vec4 fragColor, in vec2 fragCoord) {
          vec2 uv = fragCoord / u_resolution;
          fragColor = vec4(mix(u_bg, u_tint, uv.x * u_gain), 1.0);
        }
      `,
      renderScale: 0.5,
      fallbackColors: ['#0b0f17', '#3b82f6'],
      params: [
        { key: 'gain', kind: 'number', label: 'Gain', min: 0, max: 2, step: 0.1, defaultValue: 1 },
        { key: 'tint', kind: 'color', label: 'Tint', defaultValue: '#22d3ee' },
        { key: 'flip', kind: 'boolean', label: 'Flip', defaultValue: true },
      ],
    };

    const wrapped = buildCustomFragmentSource(shader);
    expect(wrapped).not.toBeNull();
    expect(wrapped).toContain('uniform float u_gain;');
    expect(wrapped).toContain('uniform vec3 u_tint;');
    expect(wrapped).toContain('uniform float u_flip;');
    expect(wrapped).toContain('mainImage(fragColor, gl_FragCoord.xy);');

    const fake = makeFakeWebGLContext({ compileOk: true });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((kind: string) =>
      kind === 'webgl' ? fake.gl : null) as HTMLCanvasElement['getContext']);

    const controller = createEffectsLayerController(document);
    controller.sync(
      {
        ...DEFAULT_THEME_EFFECTS,
        backdrop: 'custom-shader',
        customShader: shader,
        backdropParams: { gain: 1.5, tint: '#ff0088', flip: false },
        paused: true,
      },
      DARK_PALETTE,
      'dark',
    );

    expect(document.querySelector('canvas[data-fs-renderer="webgl"]')).not.toBeNull();
    expect(fake.drawArrays).toHaveBeenCalled();
    expect(fake.uniform1f).toHaveBeenCalledWith(fake.uniforms.get('u_gain'), 1.5);
    expect(fake.uniform1f).toHaveBeenCalledWith(fake.uniforms.get('u_flip'), 0);
    expect(fake.uniform3f).toHaveBeenCalledWith(
      fake.uniforms.get('u_tint'),
      1,
      0,
      expect.closeTo(0x88 / 255, 2),
    );

    controller.dispose();
    expect(fake.loseContext).toHaveBeenCalled();
  });

  it('falls back cleanly to static CSS when WebGL compilation fails or context is lost', async () => {
    const shader: CustomShaderSpec = {
      fragment: 'void main() { gl_FragColor = vec4(u_accent, 1.0); }',
      fallbackColors: ['#111111', '#ff0066'],
    };

    const failing = makeFakeWebGLContext({ compileOk: false });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((kind: string) =>
      kind === 'webgl' ? failing.gl : null) as HTMLCanvasElement['getContext']);

    const controller = createEffectsLayerController(document);
    controller.sync(
      {
        ...DEFAULT_THEME_EFFECTS,
        backdrop: 'custom-shader',
        customShader: shader,
        paused: true,
      },
      DARK_PALETTE,
      'dark',
    );

    const cssFallback = document.querySelector<HTMLDivElement>('div[data-fs-renderer="css"]');
    expect(cssFallback).not.toBeNull();
    expect(cssFallback?.style.background).toContain('#111111');
    controller.dispose();

    // Now test webglcontextlost fallback.
    const live = makeFakeWebGLContext({ compileOk: true });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((kind: string) =>
      kind === 'webgl' ? live.gl : null) as HTMLCanvasElement['getContext']);

    const controller2 = createEffectsLayerController(document);
    controller2.sync(
      {
        ...DEFAULT_THEME_EFFECTS,
        backdrop: 'custom-shader',
        customShader: shader,
        paused: true,
      },
      DARK_PALETTE,
      'dark',
    );
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-fs-renderer="webgl"]');
    expect(canvas).not.toBeNull();
    live.setLost(true);
    canvas?.dispatchEvent(new Event('webglcontextlost'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.querySelector('div[data-fs-renderer="css"]')).not.toBeNull();
    controller2.dispose();
  });

  it('degrades resolution then falls back to CSS when the Tier 3 watchdog detects sustained slow frames', async () => {
    const shader: CustomShaderSpec = {
      fragment: 'void main() { gl_FragColor = vec4(u_accent, 1.0); }',
      renderScale: 0.8,
      fps: 24,
      fallbackColors: ['#0a0f18', '#38bdf8'],
    };

    const rafQueue = stubAnimationFrames();
    const flushNext = (now: number): void => {
      const cb = rafQueue.shift();
      cb?.(now);
    };

    const live = makeFakeWebGLContext({ compileOk: true });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((kind: string) =>
      kind === 'webgl' ? live.gl : null) as HTMLCanvasElement['getContext']);
    mockCanvasSize(1200, 800);

    const controller = createEffectsLayerController(document);
    controller.sync(
      {
        ...DEFAULT_THEME_EFFECTS,
        backdrop: 'custom-shader',
        customShader: shader,
        paused: false,
      },
      DARK_PALETTE,
      'dark',
    );

    const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-fs-renderer="webgl"]');
    expect(canvas).not.toBeNull();
    const initialWidth = canvas!.width;
    expect(initialWidth).toBeGreaterThan(0);

    // Drive 13 slow GPU-bound frames (each 120ms apart -> frameOverrunMs ~78ms > 42ms).
    let t = 100;
    for (let i = 0; i < 13; i++) {
      flushNext(t);
      t += 120;
    }
    // Stage 1: watchdog halves resolution instead of immediately killing WebGL.
    expect(canvas!.width).toBeLessThan(initialWidth);
    expect(document.querySelector('canvas[data-fs-renderer="webgl"]')).not.toBeNull();

    // Drive 12 more sustained slow frames -> Stage 2: steps down to static CSS fallback.
    for (let i = 0; i < 12; i++) {
      flushNext(t);
      t += 120;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('div[data-fs-renderer="css"]')).not.toBeNull();

    controller.dispose();
    vi.unstubAllGlobals();
  });

  it('recovers WebGL after background context loss, ignores throttled tab gaps in the watchdog, and revives stalled Canvas 2D scenes', async () => {
    const shader: CustomShaderSpec = {
      fragment: 'void main() { gl_FragColor = vec4(u_accent, 1.0); }',
      renderScale: 0.5,
      fps: 30,
      fallbackColors: ['#0a0f18', '#38bdf8'],
    };

    const rafQueue = stubAnimationFrames();
    const live = makeFakeWebGLContext({ compileOk: true });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((kind: string) =>
      kind === 'webgl' ? live.gl : null) as HTMLCanvasElement['getContext']);
    mockCanvasSize(1000, 600);

    const controller = createEffectsLayerController(document);
    try {
      controller.sync(
        {
          ...DEFAULT_THEME_EFFECTS,
          backdrop: 'custom-shader',
          customShader: shader,
          paused: false,
        },
        DARK_PALETTE,
        'dark',
      );
      const initialCanvas = document.querySelector<HTMLCanvasElement>(
        'canvas[data-fs-renderer="webgl"]',
      );
      expect(initialCanvas).not.toBeNull();
      const initialWidth = initialCanvas!.width;

      // 1. Long browser-throttled rAF gaps (>250ms) must NOT trip the watchdog.
      let t = 100;
      for (let i = 0; i < 30; i++) {
        rafQueue.shift()?.(t);
        t += 500;
      }
      expect(document.querySelector('canvas[data-fs-renderer="webgl"]')).not.toBeNull();
      expect(initialCanvas!.width).toBe(initialWidth);

      // 2. Background tab loses WebGL context -> recovers to live WebGL when returning to foreground.
      const hiddenSpy = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
      document.dispatchEvent(new Event('visibilitychange'));
      live.setLost(true);
      initialCanvas!.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));

      live.setLost(false);
      hiddenSpy.mockReturnValue(false);
      document.dispatchEvent(new Event('visibilitychange'));
      expect(document.querySelector('canvas[data-fs-renderer="webgl"]')).not.toBeNull();
      expect(document.querySelector('div[data-fs-renderer="css"]')).toBeNull();
      hiddenSpy.mockRestore();

      // 3. A dropped/stale rAF handle self-heals on pointermove or focus.
      const futureMs = performance.now() + 10_000;
      const perfSpy = vi.spyOn(performance, 'now').mockReturnValue(futureMs);
      rafQueue.length = 0;
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 300, clientY: 200 }));
      expect(rafQueue.length).toBeGreaterThan(0);
      perfSpy.mockRestore();

      // 4. Canvas 2D scenes pause on contextlost and remount on contextrestored / wake.
      let ctx2dLost = false;
      const fake2d = Object.assign(makeFake2dContext(), {
        isContextLost: () => ctx2dLost,
      });
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((kind: string) =>
        kind === '2d' ? fake2d : null) as HTMLCanvasElement['getContext']);
      controller.sync(
        {
          ...DEFAULT_THEME_EFFECTS,
          backdrop: 'custom-scene',
          customScene: {
            layers: [
              {
                kind: 'gradient',
                style: 'radial',
                colors: ['background', 'accent'],
                x: 0.5,
                y: 0.4,
              },
            ],
          },
          paused: false,
        },
        DARK_PALETTE,
        'dark',
      );
      const canvas2d = document.querySelector<HTMLCanvasElement>(
        'canvas[data-fs-renderer="canvas2d"]',
      );
      expect(canvas2d).not.toBeNull();
      ctx2dLost = true;
      const lostEvent = new Event('contextlost', { cancelable: true });
      canvas2d!.dispatchEvent(lostEvent);
      expect(lostEvent.defaultPrevented).toBe(true);
      rafQueue.length = 0;
      // Moving the pointer while the 2D context is still lost must not restart rAF.
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 320, clientY: 220 }));
      expect(rafQueue.length).toBe(0);

      // Once restored, the 2D scene remounts a fresh canvas and resumes animation.
      ctx2dLost = false;
      canvas2d!.dispatchEvent(new Event('contextrestored'));
      const restoredCanvas = document.querySelector<HTMLCanvasElement>(
        'canvas[data-fs-renderer="canvas2d"]',
      );
      expect(restoredCanvas).not.toBeNull();
      expect(restoredCanvas).not.toBe(canvas2d);
      expect(rafQueue.length).toBeGreaterThan(0);
    } finally {
      controller.dispose();
    }
  });

  it('forwards click bursts to custom-shader u_click even when click effect is none, and hot-swaps shaders vs live param updates', () => {
    const shaderA: CustomShaderSpec = {
      fragment: 'void main() { gl_FragColor = vec4(u_accent * u_gain, 1.0); }',
      params: [
        { key: 'gain', kind: 'number', label: 'Gain', min: 0, max: 2, step: 0.1, defaultValue: 1 },
      ],
    };
    const shaderB: CustomShaderSpec = {
      fragment: 'void main() { gl_FragColor = vec4(u_bg, 1.0); }',
    };

    const fake = makeFakeWebGLContext({ compileOk: true });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((kind: string) =>
      kind === 'webgl' ? fake.gl : null) as HTMLCanvasElement['getContext']);

    const controller = createEffectsLayerController(document);
    controller.sync(
      {
        ...DEFAULT_THEME_EFFECTS,
        backdrop: 'custom-shader',
        customShader: shaderA,
        backdropParams: { gain: 0.5 },
        click: 'none',
        interactive: true,
        paused: true,
      },
      DARK_PALETTE,
      'dark',
    );
    expect(fake.shaderSource).toHaveBeenCalledTimes(2); // 1 VS + 1 FS

    // Updating only backdropParams updates uniform without recompiling WebGL program.
    controller.sync(
      {
        ...DEFAULT_THEME_EFFECTS,
        backdrop: 'custom-shader',
        customShader: shaderA,
        backdropParams: { gain: 1.8 },
        click: 'none',
        interactive: true,
        paused: true,
      },
      DARK_PALETTE,
      'dark',
    );
    expect(fake.shaderSource).toHaveBeenCalledTimes(2);
    expect(fake.uniform1f).toHaveBeenCalledWith(fake.uniforms.get('u_gain'), 1.8);

    // Primary non-selection click feeds u_click even though effects.click === 'none'.
    document.body.dispatchEvent(
      new MouseEvent('click', { button: 0, detail: 1, clientX: 200, clientY: 150, bubbles: true }),
    );
    controller.sync(
      {
        ...DEFAULT_THEME_EFFECTS,
        backdrop: 'custom-shader',
        customShader: shaderA,
        backdropParams: { gain: 1.9 },
        click: 'none',
        interactive: true,
        paused: true,
      },
      DARK_PALETTE,
      'dark',
    );
    expect(fake.uniform4f).toHaveBeenCalledWith(
      fake.uniforms.get('u_click'),
      expect.any(Number),
      expect.any(Number),
      0,
      1,
    );
    // Hot-swapping to shaderB tears down shaderA and compiles shaderB.
    controller.sync(
      {
        ...DEFAULT_THEME_EFFECTS,
        backdrop: 'custom-shader',
        customShader: shaderB,
        click: 'none',
        interactive: true,
        paused: true,
      },
      DARK_PALETTE,
      'dark',
    );
    expect(fake.shaderSource).toHaveBeenCalledTimes(4);
    expect(fake.loseContext).toHaveBeenCalledTimes(1);

    controller.dispose();
  });

  it('validates the flagship Event Horizon Tier 3 shader, drives Prism pointer angle, and spawns Supernova click FX', async () => {
    const validated = validateCustomShaderSource(EVENT_HORIZON_SHADER.fragment);
    expect(validated.ok).toBe(true);
    expect(validated.entrypoint).toBe('mainImage');
    expect(parseCustomShader(EVENT_HORIZON_SHADER).errors).toEqual([]);

    const built = buildCustomFragmentSource(EVENT_HORIZON_SHADER);
    expect(built).toContain('uniform float u_mode;');
    expect(built).toContain('uniform float u_lensing;');
    expect(built).toContain('uniform float u_diskTilt;');
    expect(built).toContain('uniform float u_turbulence;');
    expect(built).toContain('uniform vec3 u_coronaColor;');
    expect(built).toContain('uniform float u_showGrid;');
    expect(built).toContain('uniform vec4 u_clicks[4];');
    expect(built).toContain('uniform float u_dayPhase;');
    expect(built).toContain('uniform vec3 u_border;');
    expect(built).toContain('uniform vec3 u_danger;');
    expect(built).toContain('mat2 rot2(float a)');
    expect(built).toContain('float gauss(float x)');
    expect(built).toContain('float fbm(vec2 p)');
    expect(built).toContain('vec3 hsv2rgb(vec3 c)');

    const vibe = STUDIO_VIBES.find((entry) => entry.id === 'event-horizon')!;
    expect(vibe.effects.backdrop).toBe('custom-shader');
    expect(vibe.effects.surface).toBe('prism');
    expect(vibe.effects.click).toBe('supernova');

    // Prism surface finish compiles pointer-tracked specular sheen without backdrop-filter,
    // and respects surfaceParams (baseAngle, strength, glow).
    const prismCss = compileSurfaceFinishCss(
      DARK_PALETTE,
      'dark',
      {
        ...DEFAULT_THEME_EFFECTS,
        surface: 'prism',
        surfaceParams: { baseAngle: 210, strength: 1.5, glow: 1.2 },
      },
      { leafCards: ['article'], primaryCtas: ['button.primary'] },
    );
    expect(prismCss).toContain('var(--fs-ptr-angle, 210deg)');
    expect(prismCss).not.toContain('backdrop-filter');
    expect(prismCss).not.toContain('background-attachment');

    // Prism light driver updates --fs-ptr-angle on pointermove and cleans up on dispose.
    const fake = makeFakeWebGLContext({ compileOk: true });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((type: string) =>
      type === 'webgl' ? fake.gl : null) as HTMLCanvasElement['getContext']);
    const controller = createEffectsLayerController(document);
    controller.sync(
      {
        ...DEFAULT_THEME_EFFECTS,
        ...vibe.effects,
        backdropParams: { mode: 'quasar' },
        paused: false,
        interactive: true,
      },
      DARK_PALETTE,
      'dark',
    );

    // Enum shader param uploads its option index (quasar -> 1), plus extended uniforms & clicks ring buffer.
    expect(fake.uniform1f).toHaveBeenCalledWith(fake.uniforms.get('u_mode'), 1);
    expect(fake.uniform1f).toHaveBeenCalledWith(
      fake.uniforms.get('u_dayPhase'),
      expect.any(Number),
    );
    expect(fake.uniform3f).toHaveBeenCalledWith(
      fake.uniforms.get('u_border'),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    );
    expect(fake.uniform3f).toHaveBeenCalledWith(
      fake.uniforms.get('u_danger'),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    );
    expect(fake.uniform4fv).toHaveBeenCalledWith(
      fake.uniforms.get('u_clicks[0]'),
      expect.any(Float32Array),
    );

    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 640, clientY: 200 }));
    await vi.waitFor(() => {
      const val = document.documentElement.style.getPropertyValue('--fs-ptr-angle');
      expect(val).toMatch(/^\d+deg$/);
      expect(Number.parseInt(val, 10) % 4).toBe(0);
    });
    const firstPrismAngle = document.documentElement.style.getPropertyValue('--fs-ptr-angle');
    // Moving quickly inside the 66ms throttle window converges via trailing-edge flush (never dropped).
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 20, clientY: 40 }));
    await vi.waitFor(() => {
      const nextVal = document.documentElement.style.getPropertyValue('--fs-ptr-angle');
      expect(nextVal).toMatch(/^\d+deg$/);
      expect(nextVal).not.toBe(firstPrismAngle);
    });

    // Supernova click FX spawns dual rings + 6 orbital embers by default, and respects clickParams.style.
    const btn = document.createElement('button');
    document.body.append(btn);
    btn.dispatchEvent(
      new PointerEvent('pointerdown', { button: 0, clientX: 120, clientY: 90, bubbles: true }),
    );
    const fxHost = document.querySelector('[data-feed-sanity="theme-click-fx"]');
    expect(fxHost?.shadowRoot?.childElementCount).toBe(8);

    // Switching supernova style to 'rings' spawns only the 2 concentric shockwave rings,
    // and 'embers' with scale > 1 scales ember particle diameter cleanly.
    controller.sync(
      {
        ...DEFAULT_THEME_EFFECTS,
        ...vibe.effects,
        clickParams: { style: 'rings', scale: 1.4 },
        surfaceParams: { sweep: 0, baseAngle: 145 },
        paused: false,
        interactive: true,
      },
      DARK_PALETTE,
      'dark',
    );
    expect(document.documentElement.style.getPropertyValue('--fs-ptr-angle')).toBe('');
    fxHost?.shadowRoot?.replaceChildren();
    btn.dispatchEvent(
      new PointerEvent('pointerdown', { button: 0, clientX: 140, clientY: 110, bubbles: true }),
    );
    expect(fxHost?.shadowRoot?.childElementCount).toBe(2);

    controller.sync(
      {
        ...DEFAULT_THEME_EFFECTS,
        ...vibe.effects,
        clickParams: { style: 'embers', scale: 1.5 },
        paused: false,
        interactive: true,
      },
      DARK_PALETTE,
      'dark',
    );
    fxHost?.shadowRoot?.replaceChildren();
    btn.dispatchEvent(
      new PointerEvent('pointerdown', { button: 0, clientX: 140, clientY: 110, bubbles: true }),
    );
    expect(fxHost?.shadowRoot?.childElementCount).toBe(6);
    expect((fxHost?.shadowRoot?.firstElementChild as HTMLElement | null)?.style.width).toBe('6px');

    // 4-slot `u_clicks[4]` ring buffer wraps around cleanly on 5+ bursts, preserving slots 1..3.
    const rafQueue: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    const prevWidth = globalThis.innerWidth;
    const prevHeight = globalThis.innerHeight;
    Object.defineProperty(globalThis, 'innerWidth', { value: 1000, configurable: true });
    Object.defineProperty(globalThis, 'innerHeight', { value: 1000, configurable: true });
    try {
      const clickCoords = [
        [100, 100],
        [200, 200],
        [300, 300],
        [400, 400],
        [500, 600],
      ] as const;
      let t = 100;
      for (const [cx, cy] of clickCoords) {
        document.body.dispatchEvent(
          new MouseEvent('click', {
            button: 0,
            detail: 1,
            clientX: cx,
            clientY: cy,
            bubbles: true,
          }),
        );
        t += 50;
        const cb = rafQueue.pop();
        cb?.(t);
      }
      // Force one final render to snapshot all 4 slots into `u_clicks[0]`.
      controller.sync(
        {
          ...DEFAULT_THEME_EFFECTS,
          ...vibe.effects,
          backdropParams: { mode: 'black-hole' },
          paused: true,
          interactive: true,
        },
        DARK_PALETTE,
        'dark',
      );
      const lastUpload = fake.uniform4fv.mock.calls.at(-1)?.[1] as Float32Array;
      expect(lastUpload).toBeInstanceOf(Float32Array);
      // 3 earlier button pointerdowns + 5 loop clicks -> ring buffer holds the 4 newest clicks
      // (0.2, 0.8), (0.3, 0.7), (0.4, 0.6), (0.5, 0.4), wrapping around cleanly with active=1.
      const slots = Array.from({ length: 4 }, (_, i) => ({
        x: Number((lastUpload[i * 4] ?? 0).toFixed(2)),
        y: Number((lastUpload[i * 4 + 1] ?? 0).toFixed(2)),
        active: lastUpload[i * 4 + 3],
      }));
      expect(slots).toEqual([
        { x: 0.2, y: 0.8, active: 1 },
        { x: 0.3, y: 0.7, active: 1 },
        { x: 0.4, y: 0.6, active: 1 },
        { x: 0.5, y: 0.4, active: 1 },
      ]);
    } finally {
      Object.defineProperty(globalThis, 'innerWidth', { value: prevWidth, configurable: true });
      Object.defineProperty(globalThis, 'innerHeight', { value: prevHeight, configurable: true });
    }

    controller.dispose();
    expect(document.documentElement.style.getPropertyValue('--fs-ptr-angle')).toBe('');
  });

  it('keeps both flagship shaders inside the GLSL ES 1.00 safety rules and the source budget', () => {
    for (const [name, shader] of [
      ['event-horizon', EVENT_HORIZON_SHADER],
      ['luminous-tide', LUMINOUS_TIDE_SHADER],
    ] as const) {
      expect(lintFlagshipGlsl(shader.fragment), name).toEqual([]);
      expect(new TextEncoder().encode(shader.fragment).byteLength, name).toBeLessThanOrEqual(
        MAX_CUSTOM_SHADER_BYTES,
      );
      expect(validateCustomShaderSource(shader.fragment).ok, name).toBe(true);
    }
    // Luminous Tide squares and multiplies instead of calling pow(), so a zero or
    // negative base can never reach it.
    expect(LUMINOUS_TIDE_SHADER.fragment).not.toMatch(/\bpow\s*\(/);
    expect(lintFlagshipGlsl('float flat = smoothstep(0.6, 0.2, x);')).toHaveLength(2);
  });

  it('validates the flagship Luminous Tide shader, its preset, and the Moonlit surface finish', () => {
    const validated = validateCustomShaderSource(LUMINOUS_TIDE_SHADER.fragment);
    expect(validated.ok).toBe(true);
    expect(validated.entrypoint).toBe('mainImage');

    // All 8 declarative params survive a cold parse (none collide with a reserved
    // uniform name), and together they use every param kind the sandbox offers.
    const warnings: string[] = [];
    const parsed = parseCustomShader(JSON.parse(JSON.stringify(LUMINOUS_TIDE_SHADER)), warnings);
    expect(parsed.errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(parsed.shader?.params).toEqual(LUMINOUS_TIDE_SHADER.params);
    expect(parsed.shader?.params).toHaveLength(MAX_CUSTOM_SHADER_PARAMS);
    expect(new Set(LUMINOUS_TIDE_SHADER.params?.map((param) => param.kind))).toEqual(
      new Set(['enum', 'number', 'color', 'boolean']),
    );

    const built = buildCustomFragmentSource(LUMINOUS_TIDE_SHADER);
    for (const declaration of [
      'uniform float u_sky;',
      'uniform float u_moon;',
      'uniform float u_swell;',
      'uniform float u_bloom;',
      'uniform float u_stars;',
      'uniform vec3 u_bloomColor;',
      'uniform float u_aurora;',
      'uniform float u_meteors;',
      'uniform vec2 u_pointerVel;',
      'uniform float u_moonPhase;',
      'uniform float u_dayPhase;',
      'uniform vec4 u_clicks[4];',
    ]) {
      expect(built).toContain(declaration);
    }
    // The scene really reads every interactive input and every palette color.
    for (const uniform of [
      'u_time',
      'u_pointer',
      'u_pointerVel',
      'u_scroll',
      'u_clicks',
      'u_dayPhase',
      'u_moonPhase',
      'u_bg',
      'u_surface',
      'u_text',
      'u_border',
      'u_accent',
      'u_accent2',
      'u_danger',
      'u_isDark',
    ]) {
      expect(LUMINOUS_TIDE_SHADER.fragment, uniform).toMatch(new RegExp(`\\b${uniform}\\b`));
    }

    // Leads the Live Themes list, and its palette is appended after the existing presets.
    const vibe = STUDIO_VIBES[0]!;
    expect(vibe.id).toBe('luminous-tide');
    expect(vibe.effects).toMatchObject({
      backdrop: 'custom-shader',
      surface: 'moonlit',
      click: 'tide',
    });
    expect(BUILTIN_THEMES[0]?.id).toBe('midnight');
    expect(BUILTIN_THEMES.at(-1)?.id).toBe('luminous-tide');
    const preset = findThemePreset('luminous-tide')!;
    expect(preset.palette.accentSecondary).toBe('#5ef2c2');
    expect(preset.chrome?.ribbon?.position).toBe('bottom');
    expect(preset.chrome?.ambientGlow?.spots).toHaveLength(3);

    // Moonlit finish: top-lit sheen, accent waterline and underglow, no blur or animation.
    const surfaces = {
      leafCards: ['article'],
      primaryCtas: ['button.primary'],
      feedCards: ['article.post'],
      columns: ['main'],
      searchContainers: ['form[role="search"]'],
    };
    const moonlit = { ...DEFAULT_THEME_EFFECTS, surface: 'moonlit' as const };
    const defaultCss = compileSurfaceFinishCss(DARK_PALETTE, 'dark', moonlit, surfaces);
    expect(defaultCss).toContain('linear-gradient(180deg, rgb(230 237 247 / 7%) 0%');
    expect(defaultCss).toContain('inset 0 -1px 0 0 rgb(59 130 246 / 26%)');
    expect(defaultCss).toContain('0 14px 26px -16px rgb(59 130 246 / 30%)');
    expect(defaultCss).toContain('article.post:hover');
    expect(defaultCss).toContain('button.primary {');
    expect(defaultCss).toContain('form[role="search"] {');
    expect(defaultCss).not.toMatch(/backdrop-filter|background-attachment|animation|transition/);

    const tunedCss = compileSurfaceFinishCss(
      DARK_PALETTE,
      'dark',
      { ...moonlit, surfaceParams: { sheen: 1.5, glow: 0.5 } },
      surfaces,
    );
    expect(tunedCss).toContain('0 14px 26px -16px rgb(59 130 246 / 15%)');
    expect(tunedCss).toContain('inset 0 1px 0 0 rgb(230 237 247 / 17%)');

    // Feed Sanity's own dialog picks up a matching edge light and underglow.
    const uiCss = compileUiSurfaceCss(DARK_PALETTE, moonlit);
    expect(uiCss).toContain('.dialog, .qp-root');
    expect(uiCss).toContain('inset 0 1px 0 0 rgb(230 237 247 / 10%)');

    // The whole theme compiles into layered host CSS with the waterline ribbon on the bottom edge.
    const hostCss = compileHostThemeCss(
      resolveTheme(applyStudioVibe(DEFAULT_THEME_DOCUMENT, vibe))!,
      xThemeMapping,
      'dark',
    );
    expect(hostCss.startsWith(THEME_LAYER_ORDER)).toBe(true);
    expect(hostCss).toContain('@layer fs-finish');
    expect(hostCss).toContain('inset: auto 0 0 0; height: 2px;');
    expect(hostCss).not.toContain('background-attachment');
    expect(hostCss).not.toContain('backdrop-filter');
  });

  it('feeds Luminous Tide its enum params, lunar phase, and pointer velocity, and spawns Tide click FX', () => {
    const vibe = STUDIO_VIBES.find((entry) => entry.id === 'luminous-tide')!;
    const fake = makeFakeWebGLContext({ compileOk: true });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((kind: string) =>
      kind === 'webgl' ? fake.gl : null) as HTMLCanvasElement['getContext']);
    mockCanvasSize(1000, 500);
    const rafQueue = stubAnimationFrames();
    // happy-dom never reports a resize, so the test plays the browser's part.
    const resizeCallbacks: Array<(entries: readonly ResizeObserverEntry[]) => void> = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        readonly observe = vi.fn();
        readonly disconnect = vi.fn();
        constructor(callback: (entries: readonly ResizeObserverEntry[]) => void) {
          resizeCallbacks.push(callback);
        }
      },
    );
    let now = 100;
    const runFrames = (count: number): void => {
      for (let i = 0; i < count; i++) {
        now += 40;
        rafQueue.shift()?.(now);
      }
    };
    const lastUpload = (mock: typeof fake.uniform1f, name: string): readonly unknown[] => {
      const call = mock.mock.calls.findLast(([loc]) => loc === fake.uniforms.get(name));
      expect(call, name).toBeDefined();
      return call!.slice(1);
    };
    const pointerVel = (): [number, number] =>
      lastUpload(fake.uniform2f, 'u_pointerVel') as [number, number];
    const expectRestingVel = (): void => {
      const [vx, vy] = pointerVel();
      expect(Math.abs(vx)).toBe(0);
      expect(Math.abs(vy)).toBe(0);
    };
    const effects = {
      ...DEFAULT_THEME_EFFECTS,
      ...vibe.effects,
      paused: false,
      interactive: true,
    };

    const controller = createEffectsLayerController(document);
    try {
      controller.sync(
        { ...effects, backdropParams: { sky: 'dusk', moon: 'crescent', aurora: false } },
        DARK_PALETTE,
        'dark',
      );
      expect(document.querySelector('canvas[data-fs-renderer="webgl"]')).not.toBeNull();

      // Enum params upload their option index; untouched params upload their defaults.
      expect(lastUpload(fake.uniform1f, 'u_sky')).toEqual([2]);
      expect(lastUpload(fake.uniform1f, 'u_moon')).toEqual([2]);
      expect(lastUpload(fake.uniform1f, 'u_aurora')).toEqual([0]);
      expect(lastUpload(fake.uniform1f, 'u_meteors')).toEqual([0]);
      expect(lastUpload(fake.uniform1f, 'u_swell')).toEqual([1]);
      expect(lastUpload(fake.uniform1f, 'u_bloom')).toEqual([1]);
      expect(lastUpload(fake.uniform3f, 'u_bloomColor')).toEqual([
        expect.closeTo(0x45 / 255, 3),
        expect.closeTo(0xd8 / 255, 3),
        1,
      ]);

      // Turning Shooting stars on uploads 1.
      controller.sync(
        {
          ...effects,
          backdropParams: { sky: 'dusk', moon: 'crescent', aurora: false, meteors: true },
        },
        DARK_PALETTE,
        'dark',
      );
      expect(lastUpload(fake.uniform1f, 'u_meteors')).toEqual([1]);

      // Sky clock: tonight's lunar phase and the local time of day, both in 0..1.
      for (const name of ['u_moonPhase', 'u_dayPhase']) {
        const [phase] = lastUpload(fake.uniform1f, name) as [number];
        expect(phase, name).toBeGreaterThanOrEqual(0);
        expect(phase, name).toBeLessThan(1);
      }

      // Pointer velocity stays at zero through the jump to the first pointer position.
      runFrames(1);
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 200, clientY: 250 }));
      runFrames(1);
      expectRestingVel();

      // A sweep to the right reads as positive X speed and no vertical speed.
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 800, clientY: 250 }));
      runFrames(2);
      const [sweepVx, sweepVy] = pointerVel();
      expect(sweepVx).toBeGreaterThan(0.5);
      expect(sweepVx).toBeLessThanOrEqual(4);
      expect(Math.abs(sweepVy)).toBeLessThan(0.001);

      // Moving down the page uploads negative Y, matching the shader's bottom-left origin.
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 800, clientY: 450 }));
      runFrames(2);
      expect(pointerVel()[1]).toBeLessThan(-0.2);

      // Once the pointer rests, the wake dies away to exactly zero.
      runFrames(70);
      expectRestingVel();

      // Resizing the viewport under a resting pointer changes its normalized
      // position, which must not read as speed.
      mockCanvasSize(500, 500);
      expect(resizeCallbacks).toHaveLength(1);
      for (const report of resizeCallbacks) {
        report([]);
      }
      runFrames(2);
      expectRestingVel();

      // Pausing mid-sweep leaves no wake frozen into the still frame.
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 100, clientY: 450 }));
      runFrames(2);
      expect(Math.abs(pointerVel()[0])).toBeGreaterThan(0.2);
      controller.sync({ ...effects, paused: true }, DARK_PALETTE, 'dark');
      expectRestingVel();
      controller.sync(effects, DARK_PALETTE, 'dark');

      // Tide click FX: two oval ripple rings plus seven sea-sparkle motes.
      const btn = document.createElement('button');
      document.body.append(btn);
      const press = (): void => {
        btn.dispatchEvent(
          new PointerEvent('pointerdown', { button: 0, clientX: 120, clientY: 90, bubbles: true }),
        );
      };
      press();
      const fxRoot = document.querySelector('[data-feed-sanity="theme-click-fx"]')?.shadowRoot;
      expect(fxRoot?.childElementCount).toBe(9);
      const ring = fxRoot?.firstElementChild as HTMLElement;
      expect(ring.style.width).toBe('46px');
      expect(ring.style.height).toBe('29px');

      controller.sync(
        { ...effects, clickParams: { style: 'ripples', scale: 1.5 } },
        DARK_PALETTE,
        'dark',
      );
      fxRoot?.replaceChildren();
      press();
      expect(fxRoot?.childElementCount).toBe(2);
      expect((fxRoot?.firstElementChild as HTMLElement).style.width).toBe('69px');

      controller.sync(
        { ...effects, clickParams: { style: 'sparkle', scale: 1.5 } },
        DARK_PALETTE,
        'dark',
      );
      fxRoot?.replaceChildren();
      press();
      expect(fxRoot?.childElementCount).toBe(7);
      expect((fxRoot?.firstElementChild as HTMLElement).style.width).toBe('6px');
    } finally {
      controller.dispose();
      vi.unstubAllGlobals();
    }
    expect(document.querySelector('canvas')).toBeNull();
    expect(document.querySelector('[data-feed-sanity="theme-click-fx"]')).toBeNull();
  });
});
