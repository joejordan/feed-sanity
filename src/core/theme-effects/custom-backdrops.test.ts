import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ThemePalette } from '../theming/types';
import type { CustomSceneSpec, CustomShaderSpec } from './scene-schema';
import { createEffectsLayerController } from './controller';
import { DEFAULT_THEME_EFFECTS } from './model';
import { buildCustomFragmentSource } from './renderers/custom-shader';

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
    drawArrays,
    shaderSource,
    loseContext,
    setLost: (v: boolean) => {
      contextLost = v;
    },
  };
}

describe('Tier 2 custom-scene & Tier 3 custom-shader runtime renderers', () => {
  afterEach(() => {
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

    const rafQueue: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const flushNext = (now: number): void => {
      const cb = rafQueue.shift();
      cb?.(now);
    };

    const live = makeFakeWebGLContext({ compileOk: true });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((kind: string) =>
      kind === 'webgl' ? live.gl : null) as HTMLCanvasElement['getContext']);
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 1200,
      height: 800,
      top: 0,
      left: 0,
      right: 1200,
      bottom: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

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
});
