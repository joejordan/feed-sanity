// Pluggable live backdrop effect registry (Matrix Digital Rain, Vice City VI
// Horizon, Aurora Borealis, Interactive Constellations, Retro Cyber Grid,
// Prism Light Beams, and Dot Matrix Spotlight).
//
// Strictly Trusted Types safe (Canvas 2D + DOM element styling, zero innerHTML),
// zero external assets, and automatically pauses on `prefers-reduced-motion` or
// hidden tabs.

import type { ThemeColorScheme, ThemePalette } from '../theming';
import type { DigitalRainOptions } from './digital-rain/settings';
import type { BackdropEffectId, ThemeEffectsConfig } from './model';
import { hexWithAlpha } from '../theme';
import { RAIN_CHARSETS } from './digital-rain/charsets';
import { mountDigitalRain } from './digital-rain/mount';
import { RAIN_PRESETS } from './digital-rain/settings';

export interface BackdropContext {
  readonly doc: Document;
  readonly container: HTMLElement;
  readonly palette: ThemePalette | null;
  readonly hostScheme: ThemeColorScheme;
  readonly effects: ThemeEffectsConfig;
}

export interface BackdropInstance {
  update: (ctx: BackdropContext) => void;
  burst?: (normX: number, normY: number) => void;
  destroy: () => void;
}

export interface BackdropPlugin {
  readonly id: Exclude<BackdropEffectId, 'none'>;
  readonly mount: (ctx: BackdropContext) => BackdropInstance;
}

const ACCENT_DEFAULT_DARK = '#3b82f6';
const ACCENT_DEFAULT_LIGHT = '#1d4ed8';

function resolveAccent(ctx: BackdropContext): string {
  if (ctx.palette) {
    return ctx.palette.accent;
  }
  return ctx.hostScheme === 'light' ? ACCENT_DEFAULT_LIGHT : ACCENT_DEFAULT_DARK;
}

function resolveScheme(ctx: BackdropContext): ThemeColorScheme {
  return ctx.palette?.colorScheme ?? ctx.hostScheme;
}

function createFullCanvas(doc: Document, container: HTMLElement): HTMLCanvasElement {
  const canvas = doc.createElement('canvas');
  canvas.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;';
  container.append(canvas);
  return canvas;
}

function isReducedMotion(doc: Document): boolean {
  return doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/* -------------------------------------------------------------------------- */
/* 1. Matrix Digital Rain (`@ignitesoftware/digital-rain` engine)             */
/* -------------------------------------------------------------------------- */

function buildDigitalRainOptions(ctx: BackdropContext): DigitalRainOptions {
  const { effects, palette } = ctx;
  const scheme = resolveScheme(ctx);
  const charset = RAIN_CHARSETS[effects.rainCharset] ?? RAIN_CHARSETS.matrix;

  let colorOptions: DigitalRainOptions;
  if (effects.rainLook === 'theme') {
    const accent = resolveAccent(ctx);
    const fallbackHead = scheme === 'light' ? '#0f172a' : '#e4ffe9';
    const head = palette ? palette.text : fallbackHead;
    colorOptions = {
      trailColor: accent,
      headColor: head,
      appearance: scheme === 'light' ? 'ink' : 'emissive',
      bloom: scheme === 'light' ? 0 : 0.35,
    };
  } else {
    colorOptions = RAIN_PRESETS[effects.rainLook];
  }

  return {
    ...colorOptions,
    backgroundColor: 'transparent',
    charset,
    density: effects.rainDensity,
    speed: effects.speed,
    paused: effects.paused,
    interactive: effects.interactive,
    timeWarp: effects.interactive,
    clickCascade: effects.interactive,
    exposure: Math.max(0.3, Math.min(1.4, effects.intensity * 1.15)),
    resolution: 0.8,
  };
}

function mountDigitalRainBackdrop(ctx: BackdropContext): BackdropInstance {
  const canvas = createFullCanvas(ctx.doc, ctx.container);
  const rain = mountDigitalRain(canvas, {
    pointerTarget: ctx.doc.documentElement,
    ...buildDigitalRainOptions(ctx),
  });
  return {
    update(next) {
      rain.update(buildDigitalRainOptions(next));
    },
    burst(x, y) {
      rain.cascade(x, y);
    },
    destroy() {
      rain.destroy();
      canvas.remove();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* 2. Vice Horizon (GTA VI Vice City Sunset, Neon Water & Swaying Palms)      */
/* -------------------------------------------------------------------------- */

interface ViceParticle {
  x: number;
  y: number;
  r: number;
  vy: number;
  phase: number;
  hue: string;
}

function drawPalmTree(
  c: CanvasRenderingContext2D,
  baseX: number,
  baseY: number,
  height: number,
  lean: number,
  sway: number,
  rimColor: string,
): void {
  const topX = baseX + lean * height + sway * 16;
  const topY = baseY - height;
  const ctrlX = baseX + lean * height * 0.42 + sway * 6;
  const ctrlY = baseY - height * 0.56;

  // Trunk silhouette
  c.save();
  c.strokeStyle = '#0c0514';
  c.lineWidth = Math.max(10, height * 0.045);
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(baseX, baseY);
  c.quadraticCurveTo(ctrlX, ctrlY, topX, topY);
  c.stroke();

  // Warm neon rim highlight along the horizon-facing side of the trunk
  c.strokeStyle = rimColor;
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(baseX + (lean >= 0 ? 4 : -4), baseY);
  c.quadraticCurveTo(ctrlX + (lean >= 0 ? 3 : -3), ctrlY, topX, topY);
  c.stroke();

  // Fronds radiating from crown
  const frondAngles = [-2.55, -2.15, -1.7, -1.15, -0.55, -0.05, 0.45, 2.85];
  const frondLen = height * 0.36;
  for (let i = 0; i < frondAngles.length; i++) {
    const a = (frondAngles[i] ?? 0) + sway * 0.06;
    const len = frondLen * (i % 2 === 0 ? 1 : 0.82);
    const ex = topX + Math.cos(a) * len;
    const ey = topY + Math.sin(a) * len + len * 0.28;
    const cx = topX + Math.cos(a) * len * 0.55;
    const cy = topY + Math.sin(a) * len * 0.35 - len * 0.14;

    c.strokeStyle = '#0b0413';
    c.lineWidth = Math.max(4, height * 0.022);
    c.beginPath();
    c.moveTo(topX, topY);
    c.quadraticCurveTo(cx, cy, ex, ey);
    c.stroke();

    // Leaflets hanging off each frond
    c.lineWidth = Math.max(1.5, height * 0.008);
    for (let t = 0.2; t <= 0.92; t += 0.12) {
      const omt = 1 - t;
      const px = omt * omt * topX + 2 * omt * t * cx + t * t * ex;
      const py = omt * omt * topY + 2 * omt * t * cy + t * t * ey;
      const drop = (1 - Math.abs(t - 0.45)) * len * 0.24;
      c.beginPath();
      c.moveTo(px, py);
      c.lineTo(px + Math.cos(a + 0.5) * drop * 0.45, py + drop);
      c.stroke();
    }
  }
  c.restore();
}

function mountViceHorizonBackdrop(initialCtx: BackdropContext): BackdropInstance {
  let ctx = initialCtx;
  const canvas = createFullCanvas(ctx.doc, ctx.container);
  const g = canvas.getContext('2d');
  if (!g) {
    return {
      update: () => undefined,
      destroy: () => canvas.remove(),
    };
  }

  const win = ctx.doc.defaultView ?? globalThis;
  const abort = new AbortController();
  let width = 0;
  let height = 0;
  let frame = 0;
  let phase = 0;
  let lastTime = 0;
  let pointerX = 0.5;
  let smoothPointerX = 0.5;

  const viceHues = ['#ffb800', '#ff4d8d', '#28d7ff'] as const;
  const particles: ViceParticle[] = Array.from({ length: 42 }, (_, idx) => ({
    x: ((idx * 97) % 1000) / 1000,
    y: ((idx * 53) % 700) / 1000,
    r: 1 + (idx % 3) * 0.7,
    vy: 0.008 + (idx % 5) * 0.003,
    phase: idx * 0.7,
    hue: viceHues[idx % viceHues.length] ?? '#ffb800',
  }));

  const resize = (): void => {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, win.devicePixelRatio || 1);
    width = Math.max(1, Math.round((rect.width || win.innerWidth || 1280) * dpr));
    height = Math.max(1, Math.round((rect.height || win.innerHeight || 720) * dpr));
    if (canvas.width !== width) {
      canvas.width = width;
    }
    if (canvas.height !== height) {
      canvas.height = height;
    }
  };

  const draw = (): void => {
    if (width <= 0 || height <= 0) {
      return;
    }
    const horizonY = height * 0.68;
    const parallax = ctx.effects.interactive ? (smoothPointerX - 0.5) * 28 : 0;

    // 1. Tropical Vice twilight sky
    const sky = g.createLinearGradient(0, 0, 0, horizonY);
    sky.addColorStop(0, '#0d061c');
    sky.addColorStop(0.36, '#280f45');
    sky.addColorStop(0.68, '#8a1b5c');
    sky.addColorStop(0.88, '#e84a5f');
    sky.addColorStop(1, '#ff9a3c');
    g.fillStyle = sky;
    g.fillRect(0, 0, width, horizonY + 2);

    // 2. Subtle neon ocean water below horizon
    const water = g.createLinearGradient(0, horizonY, 0, height);
    water.addColorStop(0, '#2a0d38');
    water.addColorStop(0.45, '#130722');
    water.addColorStop(1, '#080312');
    g.fillStyle = water;
    g.fillRect(0, horizonY, width, height - horizonY);

    // 3. Twilight stars + floating neon embers
    for (const p of particles) {
      const tw = 0.35 + 0.65 * Math.abs(Math.sin(phase * 1.4 + p.phase));
      g.globalAlpha = tw * 0.7;
      g.fillStyle = p.hue;
      g.beginPath();
      g.arc(p.x * width + parallax * 0.3, p.y * horizonY, p.r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;

    // 4. Giant glowing Vice City sliced retro sun
    const sunRadius = Math.min(width, height) * 0.21;
    const sunX = width * 0.5 + parallax * 0.6;
    const sunY = horizonY - sunRadius * 0.32;

    // Outer halo
    const halo = g.createRadialGradient(sunX, sunY, sunRadius * 0.3, sunX, sunY, sunRadius * 2.1);
    halo.addColorStop(0, 'rgba(255, 184, 0, 0.42)');
    halo.addColorStop(0.45, 'rgba(255, 77, 141, 0.22)');
    halo.addColorStop(1, 'rgba(255, 77, 141, 0)');
    g.fillStyle = halo;
    g.fillRect(0, 0, width, horizonY);

    // Sun disc clipped above horizon
    g.save();
    g.beginPath();
    g.rect(0, 0, width, horizonY);
    g.clip();
    const sunGrad = g.createLinearGradient(sunX, sunY - sunRadius, sunX, sunY + sunRadius);
    sunGrad.addColorStop(0, '#ffe875');
    sunGrad.addColorStop(0.45, '#ff8a3d');
    sunGrad.addColorStop(0.82, '#ff3b8d');
    sunGrad.addColorStop(1, '#a81c6b');
    g.fillStyle = sunGrad;
    g.beginPath();
    g.arc(sunX, sunY, sunRadius, 0, Math.PI * 2);
    g.fill();

    // Retro horizontal slices across lower half of the sun
    g.fillStyle = '#381048';
    for (let i = 0; i < 6; i++) {
      const sliceY = sunY + sunRadius * (0.08 + i * 0.14);
      const sliceH = Math.max(2, sunRadius * (0.016 + i * 0.008));
      g.fillRect(sunX - sunRadius - 4, sliceY, sunRadius * 2 + 8, sliceH);
    }
    g.restore();

    // 5. Shimmering neon water reflection lines + horizon glow
    g.fillStyle = 'rgba(255, 138, 61, 0.45)';
    g.fillRect(0, horizonY - 1, width, 3);
    for (let i = 0; i < 16; i++) {
      const t = i / 16;
      const y = horizonY + 8 + t * t * (height - horizonY - 12);
      const wave = Math.sin(phase * 2.4 + i * 0.9) * 18;
      const barW = sunRadius * (2.1 - t * 1.35) + Math.cos(phase * 1.8 + i) * 14;
      g.globalAlpha = (1 - t) * 0.45;
      g.fillStyle = i % 2 === 0 ? '#ff6b4a' : '#ff4d8d';
      g.fillRect(sunX - barW / 2 + wave, y, barW, Math.max(1.5, (1 - t) * 4.5));
    }
    g.globalAlpha = 1;

    // 6. Swaying Vice City palm silhouettes framing left & right viewport margins
    const swayL = Math.sin(phase * 0.9);
    const swayR = Math.sin(phase * 0.85 + 1.1);
    const rim = 'rgba(255, 110, 148, 0.55)';
    drawPalmTree(g, width * 0.03 + parallax * 0.9, height + 20, height * 0.62, 0.22, swayL, rim);
    drawPalmTree(g, width * 0.11 + parallax * 0.7, height + 30, height * 0.44, 0.28, swayR, rim);
    drawPalmTree(g, width * 0.97 + parallax * 0.9, height + 20, height * 0.64, -0.24, swayR, rim);
    drawPalmTree(g, width * 0.89 + parallax * 0.7, height + 30, height * 0.46, -0.28, swayL, rim);
  };

  const running = (): boolean =>
    !ctx.effects.paused && !ctx.doc.hidden && !isReducedMotion(ctx.doc);

  const tick = (time: number): void => {
    frame = 0;
    const dt = lastTime === 0 ? 0 : Math.min(0.05, (time - lastTime) / 1000);
    lastTime = time;
    phase += dt * ctx.effects.speed;
    smoothPointerX += (pointerX - smoothPointerX) * Math.min(1, dt * 5);
    for (const p of particles) {
      p.y -= p.vy * dt * ctx.effects.speed;
      if (p.y < 0) {
        p.y = 0.98;
      }
    }
    draw();
    if (running()) {
      frame = requestAnimationFrame(tick);
    }
  };

  const syncRun = (): void => {
    if (running()) {
      if (frame === 0) {
        lastTime = 0;
        frame = requestAnimationFrame(tick);
      }
    } else {
      if (frame !== 0) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      draw();
    }
  };

  resize();
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : undefined;
  ro?.observe(canvas);
  ctx.doc.addEventListener('visibilitychange', syncRun, { signal: abort.signal });
  ctx.doc.documentElement.addEventListener(
    'pointermove',
    (event) => {
      const w = win.innerWidth || 1;
      pointerX = (event as PointerEvent).clientX / w;
    },
    { signal: abort.signal, passive: true },
  );
  syncRun();

  return {
    update(next) {
      ctx = next;
      syncRun();
    },
    destroy() {
      abort.abort();
      ro?.disconnect();
      if (frame !== 0) {
        cancelAnimationFrame(frame);
      }
      canvas.remove();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* 3. Interactive Starfield & Constellations                                  */
/* -------------------------------------------------------------------------- */

interface StarNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  twinkle: number;
}

function mountStarfieldBackdrop(initialCtx: BackdropContext): BackdropInstance {
  let ctx = initialCtx;
  const canvas = createFullCanvas(ctx.doc, ctx.container);
  const g = canvas.getContext('2d');
  if (!g) {
    return {
      update: () => undefined,
      destroy: () => canvas.remove(),
    };
  }

  const win = ctx.doc.defaultView ?? globalThis;
  const abort = new AbortController();
  let width = 0;
  let height = 0;
  let frame = 0;
  let lastTime = 0;
  let timeAcc = 0;
  let pointer = { x: -9999, y: -9999, active: false };

  const stars: StarNode[] = Array.from({ length: 78 }, (_, idx) => {
    const angle = (idx * 2.399_96) % (Math.PI * 2);
    const spd = 8 + (idx % 7) * 3.5;
    return {
      x: ((idx * 173 + 37) % 1000) / 1000,
      y: ((idx * 317 + 89) % 1000) / 1000,
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd,
      r: 1 + (idx % 3) * 0.75,
      twinkle: idx * 0.85,
    };
  });

  const resize = (): void => {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, win.devicePixelRatio || 1);
    width = Math.max(1, Math.round((rect.width || win.innerWidth || 1280) * dpr));
    height = Math.max(1, Math.round((rect.height || win.innerHeight || 720) * dpr));
    if (canvas.width !== width) {
      canvas.width = width;
    }
    if (canvas.height !== height) {
      canvas.height = height;
    }
  };

  const draw = (): void => {
    if (width <= 0 || height <= 0) {
      return;
    }
    g.clearRect(0, 0, width, height);
    const accent = resolveAccent(ctx);
    const starColor = ctx.palette?.text ?? (resolveScheme(ctx) === 'light' ? '#1e293b' : '#f8fafc');
    const linkDist = Math.min(width, height) * 0.16;
    const pointerDist = linkDist * 1.45;
    const dpr = Math.min(2, win.devicePixelRatio || 1);
    const px = pointer.x * dpr;
    const py = pointer.y * dpr;

    // Constellation links
    g.lineWidth = Math.max(1, dpr * 0.8);
    for (let i = 0; i < stars.length; i++) {
      const a = stars[i];
      if (!a) {
        continue;
      }
      const ax = a.x * width;
      const ay = a.y * height;
      for (let j = i + 1; j < stars.length; j++) {
        const b = stars[j];
        if (!b) {
          continue;
        }
        const dx = ax - b.x * width;
        const dy = ay - b.y * height;
        const dist = Math.hypot(dx, dy);
        if (dist < linkDist) {
          g.strokeStyle = hexWithAlpha(accent, (1 - dist / linkDist) * 0.32);
          g.beginPath();
          g.moveTo(ax, ay);
          g.lineTo(b.x * width, b.y * height);
          g.stroke();
        }
      }
      if (ctx.effects.interactive && pointer.active) {
        const distP = Math.hypot(ax - px, ay - py);
        if (distP < pointerDist) {
          g.strokeStyle = hexWithAlpha(accent, (1 - distP / pointerDist) * 0.65);
          g.beginPath();
          g.moveTo(ax, ay);
          g.lineTo(px, py);
          g.stroke();
        }
      }
    }

    // Star nodes
    for (const s of stars) {
      const alpha = 0.4 + 0.6 * Math.abs(Math.sin(timeAcc * 1.3 + s.twinkle));
      g.fillStyle = hexWithAlpha(starColor, alpha);
      g.beginPath();
      g.arc(s.x * width, s.y * height, s.r * dpr, 0, Math.PI * 2);
      g.fill();
    }
  };

  const running = (): boolean =>
    !ctx.effects.paused && !ctx.doc.hidden && !isReducedMotion(ctx.doc);

  const tick = (time: number): void => {
    frame = 0;
    const dt = lastTime === 0 ? 0 : Math.min(0.05, (time - lastTime) / 1000);
    lastTime = time;
    timeAcc += dt * ctx.effects.speed;
    if (width > 0 && height > 0) {
      for (const s of stars) {
        s.x += (s.vx * dt * ctx.effects.speed) / width;
        s.y += (s.vy * dt * ctx.effects.speed) / height;
        if (s.x < 0) s.x += 1;
        if (s.x > 1) s.x -= 1;
        if (s.y < 0) s.y += 1;
        if (s.y > 1) s.y -= 1;
      }
    }
    draw();
    if (running()) {
      frame = requestAnimationFrame(tick);
    }
  };

  const syncRun = (): void => {
    if (running()) {
      if (frame === 0) {
        lastTime = 0;
        frame = requestAnimationFrame(tick);
      }
    } else {
      if (frame !== 0) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      draw();
    }
  };

  resize();
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : undefined;
  ro?.observe(canvas);
  ctx.doc.addEventListener('visibilitychange', syncRun, { signal: abort.signal });
  ctx.doc.documentElement.addEventListener(
    'pointermove',
    (event) => {
      const pe = event as PointerEvent;
      pointer = { x: pe.clientX, y: pe.clientY, active: true };
    },
    { signal: abort.signal, passive: true },
  );
  ctx.doc.documentElement.addEventListener(
    'pointerleave',
    () => {
      pointer.active = false;
    },
    { signal: abort.signal, passive: true },
  );
  syncRun();

  return {
    update(next) {
      ctx = next;
      syncRun();
    },
    destroy() {
      abort.abort();
      ro?.disconnect();
      if (frame !== 0) {
        cancelAnimationFrame(frame);
      }
      canvas.remove();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* 4. CSS GPU Backdrops: Aurora, Cyber Grid, Prism Beams, Dot Spotlight       */
/* -------------------------------------------------------------------------- */

function mountCssBackdrop(
  initialCtx: BackdropContext,
  render: (
    ctx: BackdropContext,
    style: HTMLStyleElement,
    layer: HTMLElement,
    onCleanup: (fn: () => void) => void,
  ) => void,
): BackdropInstance {
  const style = initialCtx.doc.createElement('style');
  const layer = initialCtx.doc.createElement('div');
  layer.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;';
  initialCtx.container.append(style, layer);

  const cleanups: Array<() => void> = [];
  const addCleanup = (fn: () => void): void => {
    cleanups.push(fn);
  };

  render(initialCtx, style, layer, addCleanup);

  return {
    update(next) {
      render(next, style, layer, () => undefined);
    },
    destroy() {
      for (const stop of cleanups.splice(0)) {
        stop();
      }
      style.remove();
      layer.remove();
    },
  };
}

function mountAuroraBackdrop(initialCtx: BackdropContext): BackdropInstance {
  return mountCssBackdrop(initialCtx, (ctx, style, layer) => {
    const accent = resolveAccent(ctx);
    const alt1 = ctx.palette?.danger ?? '#ec4899';
    const alt2 = resolveScheme(ctx) === 'light' ? '#38bdf8' : '#22d3ee';
    const dur = Math.max(6, Math.round(20 / Math.max(0.25, ctx.effects.speed)));
    const state = ctx.effects.paused ? 'paused' : 'running';
    layer.className = 'fs-fx-aurora';
    style.textContent = `
@keyframes fs-aurora-drift {
  0% { transform: translate3d(-6%, -4%, 0) scale(1); }
  50% { transform: translate3d(6%, 5%, 0) scale(1.1); }
  100% { transform: translate3d(-6%, -4%, 0) scale(1); }
}
.fs-fx-aurora::before,
.fs-fx-aurora::after {
  content: "";
  position: absolute;
  inset: -25%;
  filter: blur(64px);
  animation: fs-aurora-drift ${dur}s ease-in-out infinite;
  animation-play-state: ${state};
}
.fs-fx-aurora::before {
  background:
    radial-gradient(ellipse 46% 36% at 22% 24%, ${hexWithAlpha(accent, 0.55)}, transparent 70%),
    radial-gradient(ellipse 42% 34% at 78% 28%, ${hexWithAlpha(alt2, 0.45)}, transparent 70%);
}
.fs-fx-aurora::after {
  animation-direction: reverse;
  animation-duration: ${Math.round(dur * 1.25)}s;
  background:
    radial-gradient(ellipse 48% 36% at 62% 76%, ${hexWithAlpha(alt1, 0.42)}, transparent 70%),
    radial-gradient(ellipse 40% 30% at 24% 78%, ${hexWithAlpha(accent, 0.34)}, transparent 70%);
}
@media (prefers-reduced-motion: reduce) {
  .fs-fx-aurora::before, .fs-fx-aurora::after { animation: none; }
}`;
  });
}

function mountCyberGridBackdrop(initialCtx: BackdropContext): BackdropInstance {
  return mountCssBackdrop(initialCtx, (ctx, style, layer) => {
    const accent = resolveAccent(ctx);
    const alt = ctx.palette?.danger ?? '#ff2a85';
    const dur = Math.max(2, Number((6 / Math.max(0.25, ctx.effects.speed)).toFixed(2)));
    const state = ctx.effects.paused ? 'paused' : 'running';
    layer.className = 'fs-fx-cyber-grid';
    style.textContent = `
@keyframes fs-grid-scroll {
  from { background-position: 0 0, 0 0; }
  to { background-position: 0 48px, 0 0; }
}
.fs-fx-cyber-grid {
  perspective: 420px;
}
.fs-fx-cyber-grid::before {
  content: "";
  position: absolute;
  inset: 0 0 42% 0;
  background: radial-gradient(ellipse 75% 85% at 50% 100%, ${hexWithAlpha(alt, 0.34)}, transparent 72%);
}
.fs-fx-cyber-grid::after {
  content: "";
  position: absolute;
  left: -40%;
  right: -40%;
  top: 44%;
  bottom: -40%;
  transform: rotateX(62deg);
  transform-origin: center top;
  background-image:
    linear-gradient(to bottom, ${hexWithAlpha(accent, 0.42)} 1px, transparent 1px),
    linear-gradient(to right, ${hexWithAlpha(accent, 0.38)} 1px, transparent 1px);
  background-size: 48px 48px;
  mask-image: linear-gradient(to bottom, transparent 0%, black 22%, black 90%, transparent 100%);
  -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 22%, black 90%, transparent 100%);
  animation: fs-grid-scroll ${dur}s linear infinite;
  animation-play-state: ${state};
}
@media (prefers-reduced-motion: reduce) {
  .fs-fx-cyber-grid::after { animation: none; }
}`;
  });
}

function mountPrismBeamsBackdrop(initialCtx: BackdropContext): BackdropInstance {
  return mountCssBackdrop(initialCtx, (ctx, style, layer) => {
    const accent = resolveAccent(ctx);
    const alt = ctx.palette?.danger ?? '#ff3b8d';
    const dur = Math.max(5, Math.round(16 / Math.max(0.25, ctx.effects.speed)));
    const state = ctx.effects.paused ? 'paused' : 'running';
    layer.className = 'fs-fx-prism-beams';
    style.textContent = `
@keyframes fs-beam-sweep {
  0% { transform: translateX(-18%) rotate(-18deg); }
  50% { transform: translateX(18%) rotate(-14deg); }
  100% { transform: translateX(-18%) rotate(-18deg); }
}
.fs-fx-prism-beams::before {
  content: "";
  position: absolute;
  inset: -40%;
  background: repeating-linear-gradient(
    90deg,
    transparent 0%,
    transparent 8%,
    ${hexWithAlpha(accent, 0.24)} 12%,
    transparent 16%,
    ${hexWithAlpha(alt, 0.2)} 22%,
    transparent 28%,
    rgba(40, 215, 255, 0.18) 34%,
    transparent 42%
  );
  filter: blur(28px);
  animation: fs-beam-sweep ${dur}s ease-in-out infinite;
  animation-play-state: ${state};
}
@media (prefers-reduced-motion: reduce) {
  .fs-fx-prism-beams::before { animation: none; }
}`;
  });
}

function mountDotSpotlightBackdrop(initialCtx: BackdropContext): BackdropInstance {
  let activeCtx = initialCtx;
  return mountCssBackdrop(initialCtx, (ctx, style, layer, onCleanup) => {
    activeCtx = ctx;
    const accent = resolveAccent(ctx);
    const dotBase =
      resolveScheme(ctx) === 'light' ? 'rgba(15, 23, 42, 0.16)' : 'rgba(255, 255, 255, 0.16)';
    layer.className = 'fs-fx-dot-spot';
    style.textContent = `
.fs-fx-dot-spot {
  background-image: radial-gradient(${dotBase} 1.25px, transparent 1.25px);
  background-size: 24px 24px;
}
.fs-fx-dot-spot::after {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(
    360px circle at var(--fs-spot-x, 50%) var(--fs-spot-y, 35%),
    ${hexWithAlpha(accent, 0.36)},
    transparent 70%
  );
}`;

    const abort = new AbortController();
    ctx.doc.documentElement.addEventListener(
      'pointermove',
      (event) => {
        if (!activeCtx.effects.interactive) {
          return;
        }
        const pe = event as PointerEvent;
        layer.style.setProperty('--fs-spot-x', `${pe.clientX}px`);
        layer.style.setProperty('--fs-spot-y', `${pe.clientY}px`);
      },
      { signal: abort.signal, passive: true },
    );
    onCleanup(() => abort.abort());
  });
}

export const BACKDROP_REGISTRY: Readonly<
  Record<Exclude<BackdropEffectId, 'none'>, BackdropPlugin>
> = {
  'digital-rain': { id: 'digital-rain', mount: mountDigitalRainBackdrop },
  'vice-horizon': { id: 'vice-horizon', mount: mountViceHorizonBackdrop },
  aurora: { id: 'aurora', mount: mountAuroraBackdrop },
  starfield: { id: 'starfield', mount: mountStarfieldBackdrop },
  'cyber-grid': { id: 'cyber-grid', mount: mountCyberGridBackdrop },
  'prism-beams': { id: 'prism-beams', mount: mountPrismBeamsBackdrop },
  'dot-spotlight': { id: 'dot-spotlight', mount: mountDotSpotlightBackdrop },
};
