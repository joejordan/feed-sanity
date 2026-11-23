// Adapted from `@ignitesoftware/digital-rain` (Joe Jordan / Ignite Software).
// Two-layer canvas engine and lifecycle mounter with automatic visibility,
// reduced-motion, ResizeObserver, and passive pointer tracking.

import type { GlyphAtlas } from './glyph-atlas';
import type { LayerDynamics, WarpField } from './rain-layer';
import type { DigitalRainOptions, RainSettings } from './settings';
import { splitGlyphs } from './charsets';
import { buildGlyphAtlas, fontShorthand } from './glyph-atlas';
import { clamp, createRandom, degreesToRadians, easeFactor, lerp, randomSeed } from './math';
import { paintLayer, RainLayer } from './rain-layer';
import { isLightBackground, rainSettingsEqual, resolveRainSettings } from './settings';

interface Viewport {
  width: number;
  height: number;
  pixelRatio: number;
}

interface Layers {
  front: RainLayer;
  back: RainLayer;
}

const BASE_FALL_RATE = 13;
const ROW_PITCH = 1;
const COLUMN_PITCH = 0.75;
const BACK_SCALE = 0.55;
const BACK_PACE = 0.85;
const BACK_OPACITY = 1.3;
const BACK_BLOOM = 0.6;
const INK_BLOOM = 0.5;
const MAX_FRAME_SECONDS = 0.05;
const MAX_CANVAS_PIXELS = 3840 * 2160;
const FONT_STEPS_PER_PIXEL = 2;
const WARP_FADE_RATE = 5;
const WARP_FOLLOW_RATE = 16;

class RainEngine {
  readonly #canvas: HTMLCanvasElement;
  readonly #context: CanvasRenderingContext2D;
  readonly #doc: Document;
  #settings: RainSettings;
  #viewport: Viewport = { width: 0, height: 0, pixelRatio: 1 };

  #layers: Layers;
  #glyphCount = 1;
  #frontAtlas: GlyphAtlas | null = null;
  #backAtlas: GlyphAtlas | null = null;
  #atlasKey = '';
  #layoutKey = '';

  #scale = 1;
  #rotation = 0;
  #gridWidth = 0;
  #gridHeight = 0;
  #ink = false;

  readonly #pointer = { x: 0, y: 0, targetX: 0, targetY: 0, presence: 0, inside: false };
  #running = false;
  #frame = 0;
  #lastTime: number | null = null;
  #destroyed = false;

  readonly #onFrame = (time: number): void => {
    this.#frame = 0;
    if (this.#running) {
      const elapsed = this.#lastTime === null ? 0 : (time - this.#lastTime) / 1000;
      this.#lastTime = time;
      this.#step(clamp(elapsed, 0, MAX_FRAME_SECONDS));
    }
    this.#draw();
    if (this.#running) {
      this.#invalidate();
    }
  };

  constructor(
    canvas: HTMLCanvasElement,
    context: CanvasRenderingContext2D,
    settings: RainSettings,
    doc: Document,
  ) {
    this.#canvas = canvas;
    this.#context = context;
    this.#doc = doc;
    this.#settings = settings;
    this.#layers = this.#createLayers();
  }

  #createLayers(): Layers {
    const random = createRandom(this.#settings.seed ?? randomSeed());
    const startEmpty = this.#settings.intro === 'rain-in';
    const create = (pace: number): RainLayer => {
      const layer = new RainLayer(random, startEmpty);
      layer.setGlyphCount(this.#glyphCount);
      layer.setDynamics(this.#dynamics(pace));
      return layer;
    };
    this.#layoutKey = '';
    return { front: create(1), back: create(BACK_PACE) };
  }

  #dynamics(pace: number): LayerDynamics {
    const { density, trailLength, speed, speedVariance, mutationRate } = this.#settings;
    return {
      density,
      trailLength,
      fallRate: BASE_FALL_RATE * speed * pace,
      speedVariance,
      mutationRate,
    };
  }

  #sync(): void {
    const { width, height, pixelRatio } = this.#viewport;
    if (width <= 0 || height <= 0) {
      return;
    }
    const settings = this.#settings;

    let scale = pixelRatio * settings.resolution;
    const pixels = width * height * scale * scale;
    if (pixels > MAX_CANVAS_PIXELS) {
      scale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);
    }
    this.#scale = scale;
    const canvasWidth = Math.max(1, Math.round(width * scale));
    const canvasHeight = Math.max(1, Math.round(height * scale));
    let cleared = false;
    if (this.#canvas.width !== canvasWidth) {
      this.#canvas.width = canvasWidth;
      cleared = true;
    }
    if (this.#canvas.height !== canvasHeight) {
      this.#canvas.height = canvasHeight;
      cleared = true;
    }

    this.#ink =
      settings.appearance === 'ink' ||
      (settings.appearance === 'auto' && isLightBackground(settings.backgroundColor));

    const fontPixels = Math.max(
      1,
      Math.round(settings.fontSize * scale * FONT_STEPS_PER_PIXEL) / FONT_STEPS_PER_PIXEL,
    );
    const look = {
      charset: settings.charset,
      fontFamily: settings.fontFamily,
      fontWeight: settings.fontWeight,
      fontPixels,
      trailColor: settings.trailColor,
      headColor: settings.headColor,
      mirrored: settings.mirrored,
      halo: settings.bloom > 0,
    };
    const atlasKey = JSON.stringify(look);
    if (atlasKey !== this.#atlasKey) {
      this.#atlasKey = atlasKey;
      const { charset, ...spec } = look;
      const glyphs = splitGlyphs(charset);
      this.#frontAtlas = buildGlyphAtlas({ ...spec, glyphs }, this.#doc);
      this.#backAtlas = buildGlyphAtlas(
        { ...spec, glyphs, fontPixels: fontPixels * BACK_SCALE },
        this.#doc,
      );
      this.#glyphCount = glyphs.length;
      this.#layers.front.setGlyphCount(glyphs.length);
      this.#layers.back.setGlyphCount(glyphs.length);
    }

    const layoutKey = [
      canvasWidth,
      canvasHeight,
      fontPixels,
      settings.columnSpacing,
      settings.angle,
    ].join(':');
    if (layoutKey !== this.#layoutKey) {
      this.#layoutKey = layoutKey;
      this.#layout(canvasWidth, canvasHeight, fontPixels);
    }

    if (cleared) {
      this.#draw();
    }
  }

  #layout(canvasWidth: number, canvasHeight: number, fontPixels: number): void {
    this.#rotation = -degreesToRadians(this.#settings.angle);
    const cos = Math.abs(Math.cos(this.#rotation));
    const sin = Math.abs(Math.sin(this.#rotation));
    this.#gridWidth = canvasWidth * cos + canvasHeight * sin;
    this.#gridHeight = canvasWidth * sin + canvasHeight * cos;
    this.#place(this.#layers.front, fontPixels);
    this.#place(this.#layers.back, fontPixels * BACK_SCALE);
  }

  #place(layer: RainLayer, fontPixels: number): void {
    const columnWidth = fontPixels * COLUMN_PITCH * this.#settings.columnSpacing;
    const cellWidth = Math.max(2, Math.round(columnWidth));
    const cellHeight = Math.max(2, Math.round(fontPixels * ROW_PITCH));
    layer.resize(
      Math.ceil(this.#gridWidth / cellWidth) + 1,
      Math.ceil(this.#gridHeight / cellHeight) + 1,
      cellWidth,
      cellHeight,
    );
  }

  #toGrid(x: number, y: number): [number, number] {
    const dx = x - this.#canvas.width / 2;
    const dy = y - this.#canvas.height / 2;
    const cos = Math.cos(this.#rotation);
    const sin = Math.sin(this.#rotation);
    return [dx * cos + dy * sin + this.#gridWidth / 2, dy * cos - dx * sin + this.#gridHeight / 2];
  }

  #invalidate(): void {
    if (this.#frame === 0 && !this.#destroyed) {
      this.#frame = requestAnimationFrame(this.#onFrame);
    }
  }

  #step(deltaSeconds: number): void {
    const settings = this.#settings;
    const pointer = this.#pointer;
    const wanted = pointer.inside && settings.interactive && settings.timeWarp ? 1 : 0;
    pointer.presence = lerp(pointer.presence, wanted, easeFactor(WARP_FADE_RATE, deltaSeconds));
    const follow = easeFactor(WARP_FOLLOW_RATE, deltaSeconds);
    pointer.x = lerp(pointer.x, pointer.targetX, follow);
    pointer.y = lerp(pointer.y, pointer.targetY, follow);

    let warp: WarpField | null = null;
    if (pointer.presence > 0.005 && settings.warpStrength > 0 && settings.warpRadius > 0) {
      const [x, y] = this.#toGrid(pointer.x, pointer.y);
      warp = {
        x,
        y,
        radius: settings.warpRadius * this.#scale,
        strength: settings.warpStrength * pointer.presence,
      };
    }

    this.#layers.front.step(deltaSeconds, warp);
    if (settings.depth > 0) {
      this.#layers.back.step(deltaSeconds, warp);
    }
  }

  #draw(): void {
    const context = this.#context;
    const settings = this.#settings;
    const { width, height } = this.#canvas;

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.clearRect(0, 0, width, height);
    if (!this.#frontAtlas) {
      return;
    }

    context.translate(width / 2, height / 2);
    context.rotate(this.#rotation);
    context.translate(-this.#gridWidth / 2, -this.#gridHeight / 2);
    context.globalCompositeOperation = this.#ink ? 'source-over' : 'lighter';

    const bloom = this.#ink ? settings.bloom * INK_BLOOM : settings.bloom;
    if (settings.depth > 0 && this.#backAtlas) {
      paintLayer(context, this.#layers.back, {
        atlas: this.#backAtlas,
        opacity: settings.depth * BACK_OPACITY * settings.exposure,
        bloom: bloom * BACK_BLOOM,
      });
    }
    paintLayer(context, this.#layers.front, {
      atlas: this.#frontAtlas,
      opacity: settings.exposure,
      bloom,
    });
  }

  configure(settings: RainSettings): void {
    const restart =
      settings.seed !== this.#settings.seed || settings.intro !== this.#settings.intro;
    this.#settings = settings;
    if (restart) {
      this.#layers = this.#createLayers();
    } else {
      this.#layers.front.setDynamics(this.#dynamics(1));
      this.#layers.back.setDynamics(this.#dynamics(BACK_PACE));
    }
    this.#sync();
    this.#invalidate();
  }

  setViewport(viewport: Viewport): void {
    this.#viewport = viewport;
    this.#sync();
    this.#invalidate();
  }

  invalidateGlyphs(): void {
    this.#atlasKey = '';
    this.#sync();
    this.#invalidate();
  }

  setRunning(running: boolean): void {
    if (running === this.#running) {
      return;
    }
    this.#running = running;
    this.#lastTime = null;
    this.#invalidate();
  }

  pointerMove(x: number, y: number): void {
    const pointer = this.#pointer;
    pointer.targetX = x * this.#canvas.width;
    pointer.targetY = y * this.#canvas.height;
    if (!pointer.inside) {
      pointer.x = pointer.targetX;
      pointer.y = pointer.targetY;
      pointer.inside = true;
    }
  }

  pointerLeave(): void {
    this.#pointer.inside = false;
  }

  pointerPress(x: number, y: number): void {
    this.pointerMove(x, y);
    if (this.#settings.interactive && this.#settings.clickCascade) {
      this.cascade(x, y);
    }
  }

  cascade(x: number, y: number): void {
    if (!this.#running || !Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }
    const { front } = this.#layers;
    const [gridX, gridY] = this.#toGrid(x * this.#canvas.width, y * this.#canvas.height);
    front.cascade(gridX / front.cellWidth, gridY / front.cellHeight, this.#settings.cascadeSpread);
  }

  destroy(): void {
    this.#destroyed = true;
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }
}

export interface MountDigitalRainOptions extends DigitalRainOptions {
  pointerTarget?: EventTarget | null | undefined;
}

export interface DigitalRainInstance {
  update: (options: DigitalRainOptions) => void;
  cascade: (x: number, y: number) => void;
  destroy: () => void;
}

const INERT: DigitalRainInstance = {
  update: () => undefined,
  cascade: () => undefined,
  destroy: () => undefined,
};

export function mountDigitalRain(
  canvas: HTMLCanvasElement,
  { pointerTarget, ...options }: MountDigitalRainOptions = {},
): DigitalRainInstance {
  const context = canvas.getContext('2d');
  if (!context) {
    return INERT;
  }
  const doc = canvas.ownerDocument ?? document;
  const win = doc.defaultView ?? globalThis;

  let settings: RainSettings = resolveRainSettings(options);
  const listeners = new AbortController();
  const { signal } = listeners;
  const reducedMotion = win.matchMedia?.('(prefers-reduced-motion: reduce)');
  let visible = !doc.hidden;

  const engineSettings = (): RainSettings =>
    reducedMotion?.matches ? { ...settings, intro: 'filled' } : settings;
  const engine = new RainEngine(canvas, context, engineSettings(), doc);

  const refresh = (): void => {
    engine.setRunning(visible && !doc.hidden && !settings.paused && !reducedMotion?.matches);
  };
  const apply = (): void => {
    engine.configure(engineSettings());
    refresh();
  };
  reducedMotion?.addEventListener('change', apply, { signal });
  doc.addEventListener('visibilitychange', refresh, { signal });

  const applyBackground = (): void => {
    canvas.style.backgroundColor = settings.backgroundColor;
  };
  applyBackground();

  const fonts = doc.fonts;
  let requestedFont = '';
  const requestFont = (): void => {
    const font = fontShorthand(settings.fontWeight, settings.fontSize, settings.fontFamily);
    const request = `${font}|${settings.charset}`;
    if (fonts && request !== requestedFont) {
      requestedFont = request;
      fonts.load(font, settings.charset).catch(() => undefined);
    }
  };
  fonts?.addEventListener('loadingdone', () => engine.invalidateGlyphs(), { signal });
  requestFont();

  const measure = (width: number, height: number, measuredRatio?: number): void => {
    const pixelRatio = measuredRatio ?? (win.devicePixelRatio || 1);
    engine.setViewport({ width, height, pixelRatio });
  };

  const syncViewportSize = (): void => {
    const rect = canvas.getBoundingClientRect();
    const width = rect.width || win.innerWidth || 0;
    const height = rect.height || win.innerHeight || 0;
    measure(width, height);
  };

  let resizeObserver: ResizeObserver | undefined;
  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver((entries) => {
      const entry = entries.at(-1);
      if (entry) {
        const { width, height } = entry.contentRect;
        const deviceSize = entry.devicePixelContentBoxSize?.[0]?.inlineSize;
        const cssSize = entry.contentBoxSize?.[0]?.inlineSize;
        measure(
          width,
          height,
          deviceSize !== undefined && cssSize ? deviceSize / cssSize : undefined,
        );
      }
    });
    try {
      resizeObserver.observe(canvas, { box: 'device-pixel-content-box' });
    } catch {
      resizeObserver.observe(canvas);
    }
  }
  syncViewportSize();

  let intersectionObserver: IntersectionObserver | undefined;
  if (typeof IntersectionObserver === 'function') {
    intersectionObserver = new IntersectionObserver((entries) => {
      visible = entries.at(-1)?.isIntersecting ?? true;
      refresh();
    });
    intersectionObserver.observe(canvas);
  }

  const report = (event: PointerEvent, tell: (x: number, y: number) => void): void => {
    const { left, top, width, height } = canvas.getBoundingClientRect();
    if (width > 0 && height > 0) {
      tell((event.clientX - left) / width, (event.clientY - top) / height);
    }
  };
  const onMove = (event: Event): void => {
    report(event as PointerEvent, (x, y) => engine.pointerMove(x, y));
  };
  const onDown = (event: Event): void => {
    const pe = event as PointerEvent;
    report(pe, (x, y) => (pe.button === 0 ? engine.pointerPress(x, y) : engine.pointerMove(x, y)));
  };
  const onLeave = (): void => engine.pointerLeave();
  const onUp = (event: Event): void => {
    if ((event as PointerEvent).pointerType !== 'mouse') {
      engine.pointerLeave();
    }
  };
  const target = pointerTarget ?? canvas;
  const passive = { signal, passive: true };
  target.addEventListener('pointermove', onMove, passive);
  target.addEventListener('pointerdown', onDown, passive);
  target.addEventListener('pointerup', onUp, passive);
  target.addEventListener('pointerleave', onLeave, passive);
  target.addEventListener('pointercancel', onLeave, passive);

  refresh();

  return {
    update(next) {
      const resolved = resolveRainSettings(next);
      if (rainSettingsEqual(resolved, settings)) {
        return;
      }
      settings = resolved;
      applyBackground();
      requestFont();
      apply();
    },
    cascade(x, y) {
      engine.cascade(x, y);
    },
    destroy() {
      listeners.abort();
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      engine.destroy();
    },
  };
}
