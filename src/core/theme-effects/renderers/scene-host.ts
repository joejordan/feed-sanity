// Shared lifecycle host for every canvas backdrop renderer.
//
// - Sizes the backing store with a capped device pixel ratio and a pixel budget.
// - Caps the frame rate (ambient scenes default to 30fps) and sleeps entirely
//   for on-demand scenes once the pointer settles.
// - Pauses on `document.hidden`, the Studio "Pause motion" switch, and
//   `prefers-reduced-motion: reduce`, painting one still frame instead.
// - Tracks a damped pointer for parallax and spotlights (mouse and pen only).
// - Walks a WebGL → Canvas 2D → CSS fallback chain, including on context loss.
// - Tears down every listener, observer, frame, and GPU resource on destroy.

import type { ScenePalette } from './palette';
import type { BackdropContext, BackdropInstance } from './types';
import { easeFactor } from '../digital-rain/math';
import { resolveScenePalette } from './palette';

export interface SceneViewport {
  readonly cssWidth: number;
  readonly cssHeight: number;
  /** Backing-store pixels per CSS pixel. */
  readonly pixelRatio: number;
  readonly width: number;
  readonly height: number;
}

export interface ScenePointer {
  /** Smoothed pointer position in CSS pixels. */
  readonly x: number;
  readonly y: number;
  /** Smoothed pointer position normalized to `0..1` (top-left origin). */
  readonly nx: number;
  readonly ny: number;
  /** Damped presence `0..1`: fades in on movement and out when the pointer leaves. */
  readonly presence: number;
}

export interface SceneFrame {
  readonly ctx: BackdropContext;
  /** Resolved theme colors; the same object every frame until the theme changes. */
  readonly palette: ScenePalette;
  readonly view: SceneViewport;
  readonly pointer: ScenePointer;
  /** Scene clock in seconds, already scaled by the motion speed. */
  readonly time: number;
  /** Speed-scaled seconds since the previous frame (`0` for still frames). */
  readonly dt: number;
  /** True while painting a single still frame (paused, reduced motion, or idle). */
  readonly still: boolean;
}

export interface BackingSizeOptions {
  /** Multiplies the device pixel ratio (soft shaders render below native resolution). */
  readonly renderScale?: number;
  readonly maxPixelRatio?: number;
  readonly maxPixels?: number;
}

export interface Scene extends BackingSizeOptions {
  readonly kind: 'webgl' | 'canvas2d';
  resize?: (view: SceneViewport) => void;
  render: (frame: SceneFrame) => void;
  dispose?: () => void;
}

export interface SceneHooks {
  /** Replaces this scene with the next fallback (for example after WebGL context loss). */
  readonly fallback: () => void;
}

export type SceneFactory = (canvas: HTMLCanvasElement, hooks: SceneHooks) => Scene | null;

export interface SceneSpec {
  /** Tried in order until one returns a scene. */
  readonly factories: readonly SceneFactory[];
  /** Static CSS `background` shown when no canvas context is available at all. */
  readonly cssFallback: (palette: ScenePalette) => string;
  /** Frame cap while animating (default 30). */
  readonly fps?: number;
  /** Render only while the pointer is moving or settling instead of continuously. */
  readonly onDemand?: boolean;
  /** Initial scene clock so the very first and reduced-motion frames look composed. */
  readonly startTime?: number;
  /** Pointer follow rate per second (default 5). */
  readonly pointerRate?: number;
}

const DEFAULT_MAX_PIXEL_RATIO = 1.5;
const DEFAULT_MAX_PIXELS = 2_400_000;
const PRESENCE_RATE = 3.2;
const SETTLE_EPSILON_PX = 0.35;
/** Shader clocks wrap so float precision never degrades over long sessions. */
const CLOCK_WRAP_SECONDS = 3600;

/**
 * Resolves a crisp but bounded backing-store size: the device pixel ratio is
 * capped (default 1.5), multiplied by the scene's render scale, then reduced
 * further when the result would exceed the pixel budget.
 */
export function resolveBackingSize(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  options: BackingSizeOptions = {},
): { readonly width: number; readonly height: number; readonly pixelRatio: number } {
  const w = Number.isFinite(cssWidth) ? Math.max(1, cssWidth) : 1;
  const h = Number.isFinite(cssHeight) ? Math.max(1, cssHeight) : 1;
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const maxRatio = options.maxPixelRatio ?? DEFAULT_MAX_PIXEL_RATIO;
  let ratio = Math.min(maxRatio, Math.max(0.5, dpr)) * (options.renderScale ?? 1);
  const budget = options.maxPixels ?? DEFAULT_MAX_PIXELS;
  if (w * h * ratio * ratio > budget) {
    ratio = Math.sqrt(budget / (w * h));
  }
  return {
    width: Math.max(1, Math.floor(w * ratio)),
    height: Math.max(1, Math.floor(h * ratio)),
    pixelRatio: ratio,
  };
}

/** A full-viewport, non-interactive canvas for backdrop layers. */
export function createSceneCanvas(doc: Document): HTMLCanvasElement {
  const canvas = doc.createElement('canvas');
  canvas.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;';
  return canvas;
}

export function mountScene(initial: BackdropContext, spec: SceneSpec): BackdropInstance {
  let ctx = initial;
  let palette = resolveScenePalette(initial);
  const { doc, container } = initial;
  const win = doc.defaultView ?? globalThis;
  const abort = new AbortController();
  const { signal } = abort;
  const fps = spec.fps ?? 30;
  const frameInterval = 1000 / fps;
  const pointerRate = spec.pointerRate ?? 5;
  const reducedMotion = win.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;

  let canvas: HTMLCanvasElement | null = null;
  let scene: Scene | null = null;
  let cssLayer: HTMLDivElement | null = null;
  let generation = 0;
  let nextFactory = 0;
  let view: SceneViewport = { cssWidth: 0, cssHeight: 0, pixelRatio: 1, width: 0, height: 0 };
  let raf = 0;
  let lastFrame = 0;
  let clock = spec.startTime ?? 0;
  let destroyed = false;
  let sceneHooks: SceneHooks | null = null;

  const target = { x: 0, y: 0, presence: 0, seeded: false };
  const pointer = { x: 0, y: 0, nx: 0.5, ny: 0.5, presence: 0 };

  const animating = (): boolean =>
    !ctx.effects.paused && !doc.hidden && !(reducedMotion?.matches ?? false);

  const pointerSettled = (): boolean =>
    Math.abs(target.x - pointer.x) < SETTLE_EPSILON_PX &&
    Math.abs(target.y - pointer.y) < SETTLE_EPSILON_PX &&
    Math.abs(target.presence - pointer.presence) < 0.004;

  const advancePointer = (dt: number): void => {
    const follow = easeFactor(pointerRate, dt);
    pointer.x += (target.x - pointer.x) * follow;
    pointer.y += (target.y - pointer.y) * follow;
    pointer.presence += (target.presence - pointer.presence) * easeFactor(PRESENCE_RATE, dt);
    if (pointerSettled()) {
      pointer.x = target.x;
      pointer.y = target.y;
      pointer.presence = target.presence;
    }
    pointer.nx = view.cssWidth > 0 ? pointer.x / view.cssWidth : 0.5;
    pointer.ny = view.cssHeight > 0 ? pointer.y / view.cssHeight : 0.5;
  };

  const paint = (dt: number, still: boolean): void => {
    if (!scene || view.width <= 0 || view.height <= 0) {
      return;
    }
    try {
      scene.render({
        ctx,
        palette,
        view,
        pointer,
        time: clock % CLOCK_WRAP_SECONDS,
        dt,
        still,
      });
    } catch {
      // A renderer that throws (driver quirk, exotic browser) steps down the
      // fallback chain instead of breaking the host page every frame.
      stop();
      sceneHooks?.fallback();
    }
  };

  const tick = (now: number): void => {
    raf = 0;
    if (destroyed || !scene || !animating()) {
      return;
    }
    if (lastFrame !== 0 && now - lastFrame < frameInterval - 2) {
      raf = requestAnimationFrame(tick);
      return;
    }
    const elapsed = lastFrame === 0 ? 1 / fps : Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    const dt = elapsed * ctx.effects.speed;
    clock += dt;
    advancePointer(elapsed);
    paint(dt, false);
    if (spec.onDemand && pointerSettled()) {
      return;
    }
    raf = requestAnimationFrame(tick);
  };

  const stop = (): void => {
    if (raf !== 0) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  const start = (): void => {
    if (raf === 0 && !destroyed && scene) {
      lastFrame = 0;
      raf = requestAnimationFrame(tick);
    }
  };

  const sync = (): void => {
    if (destroyed) {
      return;
    }
    if (cssLayer) {
      cssLayer.style.background = spec.cssFallback(palette);
    }
    if (!scene || doc.hidden) {
      stop();
      return;
    }
    if (animating()) {
      paint(0, false);
      if (!spec.onDemand || !pointerSettled()) {
        start();
      }
      return;
    }
    stop();
    paint(0, true);
  };

  const measure = (): void => {
    if (!canvas || !scene) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const cssWidth = rect.width || win.innerWidth || 0;
    const cssHeight = rect.height || win.innerHeight || 0;
    if (cssWidth <= 0 || cssHeight <= 0) {
      return;
    }
    const size = resolveBackingSize(cssWidth, cssHeight, win.devicePixelRatio || 1, scene);
    if (
      size.width === view.width &&
      size.height === view.height &&
      cssWidth === view.cssWidth &&
      cssHeight === view.cssHeight
    ) {
      return;
    }
    canvas.width = size.width;
    canvas.height = size.height;
    view = { cssWidth, cssHeight, ...size };
    if (!target.seeded) {
      target.x = cssWidth / 2;
      target.y = cssHeight / 2;
      pointer.x = target.x;
      pointer.y = target.y;
    }
    scene.resize?.(view);
    // Repaint immediately: resizing clears the canvas, and waiting for the next
    // capped frame would flash an empty backdrop.
    paint(0, !animating());
  };

  const disposeScene = (): void => {
    stop();
    scene?.dispose?.();
    scene = null;
    canvas?.remove();
    canvas = null;
    view = { cssWidth: 0, cssHeight: 0, pixelRatio: 1, width: 0, height: 0 };
  };

  const mountCssFallback = (): void => {
    if (cssLayer) {
      return;
    }
    cssLayer = doc.createElement('div');
    cssLayer.dataset.fsRenderer = 'css';
    cssLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    container.append(cssLayer);
  };

  const mountNext = (): void => {
    disposeScene();
    generation += 1;
    const current = generation;
    const hooks: SceneHooks = {
      fallback: () => {
        // Defer so a scene never disposes itself in the middle of a render.
        queueMicrotask(() => {
          if (!destroyed && current === generation) {
            mountNext();
            sync();
          }
        });
      },
    };
    sceneHooks = hooks;
    while (nextFactory < spec.factories.length) {
      const factory = spec.factories[nextFactory];
      nextFactory += 1;
      const candidate = createSceneCanvas(doc);
      container.append(candidate);
      let created: Scene | null = null;
      try {
        created = factory?.(candidate, hooks) ?? null;
      } catch {
        created = null;
      }
      if (created) {
        candidate.dataset.fsRenderer = created.kind;
        canvas = candidate;
        scene = created;
        measure();
        return;
      }
      candidate.remove();
    }
    mountCssFallback();
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType === 'touch' || !ctx.effects.interactive) {
      return;
    }
    target.x = event.clientX;
    target.y = event.clientY;
    target.presence = 1;
    if (!target.seeded) {
      target.seeded = true;
      pointer.x = target.x;
      pointer.y = target.y;
    }
    if (spec.onDemand && animating()) {
      start();
    }
  };

  const onPointerOut = (event: PointerEvent): void => {
    if (event.relatedTarget) {
      return;
    }
    target.presence = 0;
    if (spec.onDemand && animating()) {
      start();
    }
  };

  mountNext();

  // Observe the stable container (not the canvas) so fallbacks keep resizing.
  let resizeObserver: ResizeObserver | undefined;
  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver(() => measure());
    resizeObserver.observe(container);
  } else {
    win.addEventListener('resize', measure, { signal, passive: true });
  }
  doc.addEventListener('visibilitychange', sync, { signal });
  reducedMotion?.addEventListener?.('change', sync, { signal });
  doc.addEventListener('pointermove', onPointerMove, { signal, passive: true, capture: true });
  doc.addEventListener('pointerout', onPointerOut, { signal, passive: true, capture: true });
  sync();

  return {
    update(next) {
      ctx = next;
      const nextPalette = resolveScenePalette(next);
      // Keep the same object while colors are unchanged so derived caches stay warm.
      if (nextPalette.key !== palette.key) {
        palette = nextPalette;
      }
      if (!ctx.effects.interactive) {
        target.presence = 0;
      }
      sync();
    },
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      abort.abort();
      resizeObserver?.disconnect();
      disposeScene();
      cssLayer?.remove();
      cssLayer = null;
    },
  };
}
