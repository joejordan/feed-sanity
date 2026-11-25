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
import { clamp, easeFactor } from '../digital-rain/math';
import { MAX_SHADER_CLICKS } from '../scene-schema';
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
  /** Smoothed pointer velocity in viewport widths/heights per second (top-left origin). */
  readonly vx: number;
  readonly vy: number;
  /** Damped presence `0..1`: fades in on movement and out when the pointer leaves. */
  readonly presence: number;
}

export interface SceneClickSlot {
  /** Normalized X (`0..1`) of this click burst. */
  readonly x: number;
  /** Normalized Y (`0..1`, top-left origin) of this click burst. */
  readonly y: number;
  /** Seconds elapsed since this click (`999` while slot is unused). */
  readonly age: number;
  /** `1` once populated, `0` before first use. */
  readonly active: number;
}

export interface SceneClickState {
  /** Normalized X (`0..1`) of the most recent burst click. */
  readonly x: number;
  /** Normalized Y (`0..1`, top-left origin) of the most recent burst click. */
  readonly y: number;
  /** Seconds elapsed since the most recent burst click (`999` before first click). */
  readonly age: number;
  /** Total burst clicks received during this scene lifecycle. */
  readonly count: number;
}

export interface SceneScrollState {
  /** Normalized viewport scroll ratio (`0..1`). */
  readonly y: number;
  /** Clamped vertical scroll velocity (`-1..1`). */
  readonly velocity: number;
}

export interface SceneFrame {
  readonly ctx: BackdropContext;
  /** Resolved theme colors; the same object every frame until the theme changes. */
  readonly palette: ScenePalette;
  readonly view: SceneViewport;
  readonly pointer: ScenePointer;
  /** Most recent click burst state for interactive scenes & shaders. */
  readonly click: SceneClickState;
  /** Ring buffer of the last `MAX_SHADER_CLICKS` click bursts for overlapping ripples. */
  readonly clicks: readonly SceneClickSlot[];
  /** Viewport scroll parallax state (populated when `trackScroll` is enabled). */
  readonly scroll: SceneScrollState;
  /** Monotonic painted frame counter. */
  readonly frameIndex: number;
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
  burst?: (normX: number, normY: number) => void;
  dispose?: () => void;
}

export interface SceneHooks {
  /** Replaces this scene with the next fallback (for example after WebGL context loss). */
  readonly fallback: () => void;
}

export type SceneFactory = (canvas: HTMLCanvasElement, hooks: SceneHooks) => Scene | null;

export interface SceneWatchdogSpec {
  /** Milliseconds per frame above which a frame counts as slow. */
  readonly slowFrameMs: number;
  /** Consecutive slow frames before degrading resolution, then falling back. */
  readonly consecutiveLimit: number;
}

export interface SceneSpec {
  /** Tried in order until one returns a scene. */
  readonly factories: readonly SceneFactory[];
  /** Static CSS `background` shown when no canvas context is available at all. */
  readonly cssFallback: (palette: ScenePalette) => string;
  /** Frame cap while animating (default 20). */
  readonly fps?: number;
  /** Render only while the pointer is moving or settling instead of continuously. */
  readonly onDemand?: boolean;
  /** Initial scene clock so the very first and reduced-motion frames look composed. */
  readonly startTime?: number;
  /** Pointer follow rate per second (default 5). */
  readonly pointerRate?: number;
  /** Attach a passive scroll listener to populate `frame.scroll`. */
  readonly trackScroll?: boolean;
  /** Expose `BackdropInstance.burst` so primary clicks feed into `frame.click` & `scene.burst`. */
  readonly acceptsBursts?: boolean;
  /** Optional slow-frame watchdog for untrusted / custom GPU shaders. */
  readonly watchdog?: SceneWatchdogSpec;
}

const DEFAULT_MAX_PIXEL_RATIO = 1.25;
const DEFAULT_MAX_PIXELS = 1_200_000;
const PRESENCE_RATE = 3.2;
const SETTLE_EPSILON_PX = 0.35;
/** Low-pass rate for pointer velocity, and its cap in viewport spans per second. */
const VELOCITY_RATE = 12;
const MAX_POINTER_SPEED = 4;
const VELOCITY_EPSILON = 0.001;
const IDLE_CLICK_AGE = 999;
/** Shader clocks wrap so float precision never degrades over long sessions. */
const CLOCK_WRAP_SECONDS = 3600;

/**
 * Resolves a crisp but bounded backing-store size: the device pixel ratio is
 * capped (default 1.25), multiplied by the scene's render scale, then reduced
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

/** A full-viewport, non-interactive canvas promoted to its own compositor layer. */
export function createSceneCanvas(doc: Document): HTMLCanvasElement {
  const canvas = doc.createElement('canvas');
  canvas.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;will-change:transform;transform:translateZ(0);';
  return canvas;
}

export function mountScene(initial: BackdropContext, spec: SceneSpec): BackdropInstance {
  let ctx = initial;
  let palette = resolveScenePalette(initial);
  const { doc, container } = initial;
  const win = doc.defaultView ?? globalThis;
  const abort = new AbortController();
  const { signal } = abort;
  const fps = spec.fps ?? 20;
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
  let frameIndex = 0;
  let slowStreak = 0;
  let scaleMultiplier = 1;
  let destroyed = false;
  let sceneHooks: SceneHooks | null = null;

  const target = { x: 0, y: 0, presence: 0, seeded: false };
  const pointer = { x: 0, y: 0, nx: 0.5, ny: 0.5, vx: 0, vy: 0, presence: 0 };
  const click = { x: 0.5, y: 0.5, age: IDLE_CLICK_AGE, count: 0 };
  const clicks = Array.from({ length: MAX_SHADER_CLICKS }, () => ({
    x: 0.5,
    y: 0.5,
    age: IDLE_CLICK_AGE,
    active: 0,
  }));
  let nextClickSlot = 0;
  const scroll = { y: 0, velocity: 0, lastPx: 0, maxPx: 1, boundsAt: 0, dirty: false };

  const animating = (): boolean =>
    !ctx.effects.paused && !doc.hidden && !(reducedMotion?.matches ?? false);

  const readScrollPx = (): number => {
    const el = doc.scrollingElement ?? doc.documentElement;
    return win.scrollY ?? el?.scrollTop ?? 0;
  };

  const syncScrollMax = (now: number): boolean => {
    const el = doc.scrollingElement ?? doc.documentElement;
    if (!el) {
      return false;
    }
    scroll.maxPx = Math.max(1, el.scrollHeight - (win.innerHeight || el.clientHeight || 1));
    scroll.boundsAt = now;
    return true;
  };

  const refreshScrollBounds = (seedOnly = false, now = performance.now()): void => {
    if (!syncScrollMax(now)) {
      return;
    }
    const currentPx = readScrollPx();
    if (seedOnly) {
      scroll.lastPx = currentPx;
      scroll.velocity = 0;
    }
    scroll.y = clamp(currentPx / scroll.maxPx, 0, 1);
  };

  const sampleScroll = (now: number): void => {
    if (!scroll.dirty) {
      return;
    }
    scroll.dirty = false;
    const currentPx = readScrollPx();
    if (currentPx > scroll.maxPx || now - scroll.boundsAt >= 1500) {
      syncScrollMax(now);
    }
    const delta = currentPx - scroll.lastPx;
    scroll.lastPx = currentPx;
    scroll.velocity = clamp(delta / 120, -1, 1);
    scroll.y = clamp(currentPx / scroll.maxPx, 0, 1);
  };

  const pointerSettled = (): boolean =>
    Math.abs(target.x - pointer.x) < SETTLE_EPSILON_PX &&
    Math.abs(target.y - pointer.y) < SETTLE_EPSILON_PX &&
    Math.abs(target.presence - pointer.presence) < 0.004;

  const normalizePointer = (): void => {
    pointer.nx = view.cssWidth > 0 ? pointer.x / view.cssWidth : 0.5;
    pointer.ny = view.cssHeight > 0 ? pointer.y / view.cssHeight : 0.5;
  };

  // Speed is only measured while frames run, so it is stale once the loop stops:
  // a paused still frame or the first frame back would otherwise show an old wake.
  const restPointer = (): void => {
    pointer.vx = 0;
    pointer.vy = 0;
  };

  const advancePointer = (dt: number, now: number): void => {
    const follow = easeFactor(pointerRate, dt);
    pointer.x += (target.x - pointer.x) * follow;
    pointer.y += (target.y - pointer.y) * follow;
    pointer.presence += (target.presence - pointer.presence) * easeFactor(PRESENCE_RATE, dt);
    if (pointerSettled()) {
      pointer.x = target.x;
      pointer.y = target.y;
      pointer.presence = target.presence;
    }
    const prevNx = pointer.nx;
    const prevNy = pointer.ny;
    normalizePointer();
    if (dt > 0) {
      const blend = easeFactor(VELOCITY_RATE, dt);
      const rawVx = clamp((pointer.nx - prevNx) / dt, -MAX_POINTER_SPEED, MAX_POINTER_SPEED);
      const rawVy = clamp((pointer.ny - prevNy) / dt, -MAX_POINTER_SPEED, MAX_POINTER_SPEED);
      pointer.vx += (rawVx - pointer.vx) * blend;
      pointer.vy += (rawVy - pointer.vy) * blend;
      if (Math.abs(pointer.vx) < VELOCITY_EPSILON && Math.abs(pointer.vy) < VELOCITY_EPSILON) {
        restPointer();
      }
    }
    if (click.count > 0 && click.age < IDLE_CLICK_AGE) {
      click.age = Math.min(IDLE_CLICK_AGE, click.age + dt);
      for (const slot of clicks) {
        if (slot.active > 0 && slot.age < IDLE_CLICK_AGE) {
          slot.age = Math.min(IDLE_CLICK_AGE, slot.age + dt);
        }
      }
    }
    if (spec.trackScroll) {
      sampleScroll(now);
      scroll.velocity *= Math.max(0, 1 - dt * 6);
      if (Math.abs(scroll.velocity) < 0.002) {
        scroll.velocity = 0;
      }
    }
  };

  const checkWatchdog = (started: number, frameOverrunMs: number): void => {
    if (!spec.watchdog) {
      return;
    }
    const worstMs = Math.max(performance.now() - started, frameOverrunMs);
    if (worstMs <= spec.watchdog.slowFrameMs) {
      slowStreak = 0;
      return;
    }
    slowStreak += 1;
    if (slowStreak < spec.watchdog.consecutiveLimit) {
      return;
    }
    slowStreak = 0;
    if (scaleMultiplier > 0.5) {
      scaleMultiplier = 0.5;
      measure(view.cssWidth, view.cssHeight);
      return;
    }
    stop();
    sceneHooks?.fallback();
  };

  const frameObj: { -readonly [K in keyof SceneFrame]: SceneFrame[K] } = {
    ctx,
    palette,
    view,
    pointer,
    click,
    clicks,
    scroll,
    frameIndex: 0,
    time: 0,
    dt: 0,
    still: false,
  };

  const paint = (dt: number, still: boolean, frameOverrunMs = 0): void => {
    if (!scene || view.width <= 0 || view.height <= 0) {
      return;
    }
    const started = spec.watchdog && !still ? performance.now() : 0;
    try {
      frameObj.ctx = ctx;
      frameObj.palette = palette;
      frameObj.view = view;
      frameObj.frameIndex = frameIndex;
      frameObj.time = clock % CLOCK_WRAP_SECONDS;
      frameObj.dt = dt;
      frameObj.still = still;
      scene.render(frameObj);
      frameIndex += 1;
    } catch {
      // A renderer that throws (driver quirk, exotic browser) steps down the
      // fallback chain instead of breaking the host page every frame.
      stop();
      sceneHooks?.fallback();
      return;
    }
    if (!still) {
      checkWatchdog(started, frameOverrunMs);
    }
  };

  const tick = (now: number): void => {
    raf = 0;
    if (destroyed || !scene || !animating()) {
      return;
    }
    // 0.88x tolerance prevents 60 Hz vsync jitter from skipping every other 30 FPS tick.
    if (lastFrame !== 0 && now - lastFrame < frameInterval * 0.88) {
      raf = requestAnimationFrame(tick);
      return;
    }
    const frameOverrunMs = lastFrame === 0 ? 0 : Math.max(0, now - lastFrame - frameInterval);
    const elapsed = lastFrame === 0 ? 1 / fps : Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    const dt = elapsed * ctx.effects.speed;
    clock += dt;
    advancePointer(elapsed, now);
    paint(dt, false, frameOverrunMs);
    if (destroyed || !scene || !animating()) {
      return;
    }
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
    restPointer();
  };

  const start = (): void => {
    if (raf === 0 && !destroyed && scene) {
      lastFrame = 0;
      restPointer();
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

  const measure = (hintWidth?: number, hintHeight?: number): void => {
    if (!canvas || !scene) {
      return;
    }
    let cssWidth = hintWidth ?? 0;
    let cssHeight = hintHeight ?? 0;
    if (cssWidth <= 0 || cssHeight <= 0) {
      const rect = canvas.getBoundingClientRect();
      cssWidth = rect.width || win.innerWidth || 0;
      cssHeight = rect.height || win.innerHeight || 0;
    }
    if (cssWidth <= 0 || cssHeight <= 0) {
      return;
    }
    const size = resolveBackingSize(cssWidth, cssHeight, win.devicePixelRatio || 1, {
      ...scene,
      renderScale: (scene.renderScale ?? 1) * scaleMultiplier,
      maxPixels: Math.max(
        40_000,
        Math.floor((scene.maxPixels ?? DEFAULT_MAX_PIXELS) * scaleMultiplier * scaleMultiplier),
      ),
    });
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
    // Normalize against the new size now so a resize never reads as pointer speed.
    normalizePointer();
    scene.resize?.(view);
    if (spec.trackScroll) {
      refreshScrollBounds();
    }
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
    scaleMultiplier = 1;
    slowStreak = 0;
    lastFrame = 0;
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
      // Normalize now so the jump to the first real position never reads as speed.
      normalizePointer();
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
    resizeObserver = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      measure(box?.width, box?.height);
    });
    resizeObserver.observe(container);
  } else {
    win.addEventListener('resize', () => measure(), { signal, passive: true });
  }
  doc.addEventListener('visibilitychange', sync, { signal });
  reducedMotion?.addEventListener?.('change', sync, { signal });
  doc.addEventListener('pointermove', onPointerMove, { signal, passive: true, capture: true });
  doc.addEventListener('pointerout', onPointerOut, { signal, passive: true, capture: true });
  if (spec.trackScroll) {
    refreshScrollBounds(true);
    win.addEventListener(
      'scroll',
      () => {
        scroll.dirty = true;
      },
      { signal, passive: true },
    );
  }
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
    ...(spec.acceptsBursts
      ? {
          burst(normX: number, normY: number) {
            if (destroyed || !ctx.effects.interactive) {
              return;
            }
            click.x = clamp(normX, 0, 1);
            click.y = clamp(normY, 0, 1);
            click.age = 0;
            click.count += 1;
            const slot = clicks[nextClickSlot];
            if (slot) {
              slot.x = click.x;
              slot.y = click.y;
              slot.age = 0;
              slot.active = 1;
            }
            nextClickSlot = (nextClickSlot + 1) % clicks.length;
            scene?.burst?.(click.x, click.y);
            if (spec.onDemand && animating()) {
              start();
            }
          },
        }
      : {}),
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
