// Vice Horizon: a GTA VI-inspired Vice City dusk. Layered twilight sky with
// lit tropical cloud banks, a retro sliced sunset disc with horizon bloom, a
// hazy Art Deco skyline with window glints and neon trim, a shimmering ocean
// with perspective-compressed reflections, palms framing only the outer
// margins, warm bokeh, and damped parallax. Static layers are cached offscreen
// and rebuilt only on resize.

import type { RandomSource } from '../digital-rain/math';
import type { Layer } from './canvas';
import type { Rgb } from './palette';
import type { Scene, SceneFactory, SceneSpec, SceneViewport } from './scene-host';
import type { Palm } from './vice-palms';
import { createRandom } from '../digital-rain/math';
import { createLayer, createRadialSprite, wrap } from './canvas';
import { hexRgb, mixRgb, rgbCss } from './palette';
import { createFronds, drawPalm } from './vice-palms';

const HORIZON = 0.665;
const SKYLINE_MARGIN = 48;
/** Palms live in the outer margins; each margin strip spans this share of the width. */
const PALM_STRIP = 0.34;

const GOLD = hexRgb('#ffc46b');
const AMBER = hexRgb('#ff9a4a');
const CORAL = hexRgb('#ff6a5c');
const PINK = hexRgb('#ff4f9a');
const MAGENTA = hexRgb('#d6338a');
const CYAN = hexRgb('#4fe8ff');
const VIOLET = hexRgb('#9d6bff');
const NEON: readonly Rgb[] = [hexRgb('#ff3fa4'), CYAN, hexRgb('#b56cff')];

// Opaque paints precomputed once; per-frame alpha rides `globalAlpha`.
const PINK_CSS = rgbCss(PINK);
const VIOLET_CSS = rgbCss(VIOLET);
const REFLECTION_ROWS = 30;
/** Sun-reflection row tints: gold near the horizon, pink midway, magenta/cyan glints deep. */
const REFLECTION_CSS = Array.from({ length: REFLECTION_ROWS }, (_, k) => {
  const s = (k + 0.5) / REFLECTION_ROWS;
  if (s < 0.3) {
    return rgbCss(mixRgb(GOLD, AMBER, s / 0.3));
  }
  if (s < 0.65) {
    return rgbCss(mixRgb(CORAL, PINK, (s - 0.3) / 0.35));
  }
  return rgbCss(k % 4 === 0 ? CYAN : MAGENTA);
});
const WARMTH_STEPS = 8;
/** Water glint tints by warmth (distance to the sun's path), per cool base tone. */
const GLINT_CSS = [CYAN, VIOLET].map((tone) =>
  Array.from({ length: WARMTH_STEPS + 1 }, (_, i) => rgbCss(mixRgb(tone, PINK, i / WARMTH_STEPS))),
);

interface NeonMark {
  readonly x: number;
  readonly css: string;
}

interface WindowGlint {
  readonly x: number;
  readonly y: number;
  readonly css: string;
  readonly phase: number;
}

interface Skyline {
  readonly far: Layer;
  readonly near: Layer;
  /** Layer width in CSS px: the viewport plus parallax margins on both sides. */
  readonly span: number;
  readonly height: number;
  readonly neon: readonly NeonMark[];
  readonly glints: readonly WindowGlint[];
}

interface CloudBank {
  readonly layer: Layer;
  readonly x0: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly speed: number;
}

interface Mote {
  x: number;
  y: number;
  readonly r: number;
  readonly vx: number;
  readonly vy: number;
  readonly alpha: number;
  readonly sprite: number;
  readonly phase: number;
}

function gauss(x: number, mu: number, sigma: number): number {
  return Math.exp(-(((x - mu) / sigma) ** 2));
}

const ZIGGURAT: ReadonlyArray<readonly [number, number]> = [
  [0, 0.8],
  [0.12, 0.88],
  [0.24, 0.95],
  [0.36, 1],
];

/** Height of the full-width cornice where neon trim sits, per building style. */
function corniceY(top: number, w: number, h: number, style: number): number {
  if (style === 1 || style === 2) {
    return top + h * 0.2 + 1.5;
  }
  if (style === 3) {
    return top + Math.min(w * 0.38, h * 0.3);
  }
  if (style === 4) {
    return top + h * 0.12 + 1.5;
  }
  return top + 1.5;
}

/** Traces one Art Deco building outline standing on `baseY`. */
function traceBuilding(
  g: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  w: number,
  h: number,
  style: number,
): void {
  const top = baseY - h;
  g.moveTo(x, baseY);
  if (style === 1 || style === 2) {
    // Ziggurat setbacks (inset, height fraction), optionally crowned with a spire.
    let below = 0;
    for (const [inset, frac] of ZIGGURAT) {
      g.lineTo(x + w * inset, baseY - h * below);
      g.lineTo(x + w * inset, baseY - h * frac);
      below = frac;
    }
    if (style === 2) {
      g.lineTo(x + w * 0.47, top);
      g.lineTo(x + w * 0.49, top - h * 0.2);
      g.lineTo(x + w * 0.51, top - h * 0.2);
      g.lineTo(x + w * 0.53, top);
    }
    for (let i = ZIGGURAT.length - 1; i >= 0; i--) {
      const [inset, frac] = ZIGGURAT[i] ?? [0, 0];
      const lower = ZIGGURAT[i - 1]?.[1] ?? 0;
      g.lineTo(x + w * (1 - inset), baseY - h * frac);
      g.lineTo(x + w * (1 - inset), baseY - h * lower);
    }
  } else if (style === 3) {
    // Streamline Moderne rounded crown.
    const r = Math.min(w * 0.38, h * 0.3);
    g.lineTo(x, top + r);
    g.arcTo(x, top, x + r, top, r);
    g.lineTo(x + w - r, top);
    g.arcTo(x + w, top, x + w, top + r, r);
    g.lineTo(x + w, baseY);
  } else if (style === 4) {
    // Pointed pyramid crown.
    g.lineTo(x, top + h * 0.12);
    g.lineTo(x + w * 0.5, top - h * 0.06);
    g.lineTo(x + w, top + h * 0.12);
    g.lineTo(x + w, baseY);
  } else {
    // Flat roof with a rooftop box.
    g.lineTo(x, top);
    g.lineTo(x + w * 0.3, top);
    g.lineTo(x + w * 0.3, top - h * 0.05);
    g.lineTo(x + w * 0.62, top - h * 0.05);
    g.lineTo(x + w * 0.62, top);
    g.lineTo(x + w, top);
    g.lineTo(x + w, baseY);
  }
  g.closePath();
}

function buildSkyline(
  doc: Document,
  rand: RandomSource,
  w: number,
  h: number,
  ratio: number,
): Skyline | null {
  const height = Math.round(h * 0.26);
  const span = w + SKYLINE_MARGIN * 2;
  const far = createLayer(doc, span, height, ratio);
  const near = createLayer(doc, span, height, ratio);
  if (!far || !near) {
    return null;
  }
  const neon: NeonMark[] = [];
  const glints: WindowGlint[] = [];

  // Far layer: dense, low, hazy towers.
  far.g.beginPath();
  for (let x = 0; x < span; ) {
    const nx = x / span;
    const cluster = Math.max(gauss(nx, 0.3, 0.16), gauss(nx, 0.72, 0.18));
    const bw = 10 + rand() * 26;
    const bh = height * (0.12 + (0.18 + rand() * 0.32) * (0.35 + 0.65 * cluster));
    traceBuilding(far.g, x, height, bw, bh, Math.floor(rand() * 5));
    x += bw + rand() * 2;
  }
  far.g.fillStyle = '#3d1a4f';
  far.g.fill();
  far.g.globalCompositeOperation = 'source-atop';
  const haze = far.g.createLinearGradient(0, height * 0.45, 0, height);
  haze.addColorStop(0, 'rgba(255,120,150,0.05)');
  haze.addColorStop(1, 'rgba(255,128,128,0.42)');
  far.g.fillStyle = haze;
  far.g.fillRect(0, 0, span, height);
  far.g.fillStyle = rgbCss(GOLD, 0.45);
  for (let i = 0; i < span * 0.08; i++) {
    far.g.fillRect(rand() * span, height * (0.55 + rand() * 0.42), 1, 1.2);
  }
  far.g.globalCompositeOperation = 'source-over';

  // Near layer: downtown clusters either side of center with windows and neon trim.
  const body = near.g.createLinearGradient(0, 0, 0, height);
  body.addColorStop(0, '#2b1238');
  body.addColorStop(1, '#13081f');
  for (let x = 0; x < span; ) {
    const nx = x / span;
    const cluster = Math.max(gauss(nx, 0.28, 0.1), gauss(nx, 0.74, 0.11) * 0.92);
    const bw = 16 + rand() * 30;
    const bh = height * (0.1 + (0.22 + rand() * 0.6) * (0.2 + 0.8 * cluster));
    const style = Math.floor(rand() * 5);
    near.g.beginPath();
    traceBuilding(near.g, x, height, bw, bh, style);
    near.g.fillStyle = body;
    near.g.fill();

    const top = height - bh;
    // Windows start below every setback so none float beside a narrow crown.
    const cols = Math.floor((bw - 5) / 5);
    const rows = Math.floor((bh * 0.74 - 4) / 7);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (rand() > 0.11) {
          continue;
        }
        const roll = rand();
        let color = GOLD;
        if (roll > 0.9) {
          color = PINK;
        } else if (roll > 0.72) {
          color = CYAN;
        }
        const wx = x + 3 + col * 5;
        const wy = top + bh * 0.22 + row * 7;
        near.g.fillStyle = rgbCss(color, 0.45 + rand() * 0.45);
        near.g.fillRect(wx, wy, 1.6, 2.4);
        if (glints.length < 18 && rand() < 0.08) {
          glints.push({ x: wx, y: wy, css: rgbCss(color), phase: rand() * Math.PI * 2 });
        }
      }
    }

    if (bh > height * 0.36 && rand() < 0.42) {
      const color = NEON[Math.floor(rand() * NEON.length)] ?? CYAN;
      near.g.save();
      near.g.shadowColor = rgbCss(color, 0.9);
      near.g.shadowBlur = 7;
      near.g.fillStyle = rgbCss(color, 0.95);
      const roof = corniceY(top, bw, bh, style);
      near.g.fillRect(x + 1, roof, bw - 2, 1.4);
      if (rand() < 0.5) {
        near.g.fillRect(x + bw * 0.5 - 0.7, roof + 4, 1.4, bh * 0.45);
      }
      near.g.restore();
      neon.push({ x: x + bw / 2, css: rgbCss(color) });
    }
    x += bw + 1 + rand() * 7;
  }
  return { far, near, span, height, neon, glints };
}

function buildClouds(doc: Document, rand: RandomSource, w: number, horizonY: number): CloudBank[] {
  const banks: CloudBank[] = [];
  const ratio = 0.5;
  for (let i = 0; i < 6; i++) {
    const depth = i / 5;
    const width = w * (0.38 + rand() * 0.42);
    const height = horizonY * (0.07 + rand() * 0.06);
    const layer = createLayer(doc, width, height, ratio);
    if (!layer) {
      continue;
    }
    const { g } = layer;
    for (let p = 0; p < 22; p++) {
      const px = width * (0.08 + rand() * 0.84);
      const edge = Math.min(px, width - px) / (width / 2);
      const py = height * (0.5 + (rand() - 0.5) * 0.16);
      // Keep every puff inside the bank so no edge is ever clipped flat.
      const maxR = Math.min(py, height - py, Math.min(px, width - px) / 2.4) * 0.96;
      const r = Math.min(maxR, height * (0.22 + rand() * 0.24) * (0.55 + 0.45 * edge));
      g.save();
      g.translate(px, py);
      g.scale(2.4, 1);
      const puff = g.createRadialGradient(0, 0, 0, 0, 0, r);
      puff.addColorStop(0, 'rgba(92,34,104,0.72)');
      puff.addColorStop(1, 'rgba(92,34,104,0)');
      g.fillStyle = puff;
      g.fillRect(-r, -r, r * 2, r * 2);
      g.restore();
    }
    // Light the undersides with sunset tones; low banks glow warmer.
    g.globalCompositeOperation = 'source-atop';
    const lit = g.createLinearGradient(0, 0, 0, height);
    const warm = mixRgb(PINK, AMBER, depth);
    lit.addColorStop(0, 'rgba(58,20,82,0.6)');
    lit.addColorStop(0.55, rgbCss(mixRgb(MAGENTA, warm, 0.5), 0.55));
    lit.addColorStop(1, rgbCss(warm, 0.9));
    g.fillStyle = lit;
    g.fillRect(0, 0, width, height);
    g.globalCompositeOperation = 'source-over';
    banks.push({
      layer,
      x0: rand(),
      y: horizonY * (0.3 + depth * 0.5) - height / 2,
      width,
      height,
      speed: 2 + depth * 4 + rand() * 2,
    });
  }
  return banks;
}

function bokehSprite(doc: Document, color: Rgb): HTMLCanvasElement | null {
  return createRadialSprite(doc, 64, [
    [0, rgbCss(color, 0.5)],
    [0.7, rgbCss(color, 0.34)],
    [0.9, rgbCss(color, 0.55)],
    [1, rgbCss(color, 0)],
  ]);
}

/** Everything that depends only on the viewport, rebuilt on resize. */
interface ViceFrame {
  readonly horizonY: number;
  readonly oceanH: number;
  readonly sunR: number;
  readonly sky: CanvasGradient;
  readonly sea: CanvasGradient;
  readonly haze: CanvasGradient;
  readonly vignette: CanvasGradient;
  /** Built around the origin; drawn under a translate to the (parallaxed) sun. */
  readonly halo: CanvasGradient;
  /** Built around the origin in the squashed horizon space. */
  readonly bloom: CanvasGradient;
  /** Only the part of the disc above the horizon is ever visible, so only it is drawn. */
  readonly sun: Layer | null;
  readonly sunDisc: CanvasGradient | null;
}

function buildFrame(c: CanvasRenderingContext2D, doc: Document, view: SceneViewport): ViceFrame {
  const w = view.cssWidth;
  const h = view.cssHeight;
  const horizonY = Math.round(h * HORIZON);
  // Wide enough that the disc's rim peeks past a 600px reading column.
  const sunR = Math.max(130, Math.min(Math.min(w, h) * 0.4, 470));
  const linear = (y0: number, y1: number, stops: ReadonlyArray<readonly [number, string]>) => {
    const grad = c.createLinearGradient(0, y0, 0, y1);
    for (const [offset, color] of stops) {
      grad.addColorStop(offset, color);
    }
    return grad;
  };
  const halo = c.createRadialGradient(0, 0, sunR * 0.4, 0, 0, sunR * 2.7);
  halo.addColorStop(0, 'rgba(255,196,96,0.5)');
  halo.addColorStop(0.32, 'rgba(255,122,84,0.26)');
  halo.addColorStop(0.62, 'rgba(255,64,140,0.1)');
  halo.addColorStop(1, 'rgba(255,64,140,0)');
  const bloom = c.createRadialGradient(0, 0, 0, 0, 0, w * 0.75);
  bloom.addColorStop(0, 'rgba(255,184,98,0.6)');
  bloom.addColorStop(0.45, 'rgba(255,92,128,0.22)');
  bloom.addColorStop(1, 'rgba(255,92,128,0)');
  const vignette = c.createRadialGradient(
    w / 2,
    h * 0.52,
    Math.max(w, h) * 0.32,
    w / 2,
    h * 0.52,
    Math.hypot(w, h) * 0.62,
  );
  vignette.addColorStop(0, 'rgba(6,2,14,0)');
  vignette.addColorStop(1, 'rgba(6,2,14,0.55)');
  const sun = createLayer(doc, sunR * 2 + 4, sunR * 1.32 + 2, view.pixelRatio);
  const top = sunR + 2;
  const sunDisc = sun ? sun.g.createLinearGradient(0, top - sunR, 0, top + sunR) : null;
  for (const [offset, color] of [
    [0, '#fff4a8'],
    [0.28, '#ffd056'],
    [0.52, '#ff8d42'],
    [0.76, '#ff4f7d'],
    [1, '#c42a7c'],
  ] as const) {
    sunDisc?.addColorStop(offset, color);
  }
  return {
    horizonY,
    oceanH: h - horizonY,
    sunR,
    sky: linear(0, horizonY, [
      [0, '#0a0520'],
      [0.3, '#1f0e45'],
      [0.58, '#5a1a62'],
      [0.8, '#b3306c'],
      [0.93, '#f0625a'],
      [1, '#ffa24f'],
    ]),
    sea: linear(horizonY, h, [
      [0, '#5c1a5e'],
      [0.12, '#3a1252'],
      [0.45, '#1a0a2f'],
      [1, '#080411'],
    ]),
    haze: linear(horizonY - h * 0.1, horizonY, [
      [0, 'rgba(255,110,140,0)'],
      [1, 'rgba(255,124,120,0.22)'],
    ]),
    vignette,
    halo,
    bloom,
    sun,
    sunDisc,
  };
}

function buildPalms(rand: RandomSource, w: number, h: number): Palm[] {
  const scale = Math.min(h, w * 0.62);
  const reachCap = w * 0.15;
  const specs: Array<{
    x: number;
    height: number;
    lean: number;
    bend: number;
    back: boolean;
  }> = [
    { x: 0.14, height: 0.54, lean: 0.05, bend: 0.035, back: true },
    { x: 0.868, height: 0.57, lean: -0.05, bend: -0.03, back: true },
    { x: 0.038, height: 0.78, lean: 0.13, bend: -0.05, back: false },
    { x: 0.963, height: 0.81, lean: -0.12, bend: 0.05, back: false },
  ];
  return specs
    .filter((spec) => !spec.back || w >= 760)
    .map((spec) => {
      const height = scale * spec.height;
      const baseX = w * spec.x;
      const leftSide = spec.x < 0.5;
      // Keep crowns inside the outer margins so the reading column stays clean.
      const crownLimit = leftSide ? w * 0.11 - baseX : w * 0.89 - baseX;
      const lean = leftSide
        ? Math.min(spec.lean, crownLimit / height)
        : Math.max(spec.lean, crownLimit / height);
      return {
        baseX,
        baseY: h + scale * 0.02,
        height,
        lean,
        bend: spec.bend,
        reach: Math.min(height * 0.36, reachCap),
        fronds: createFronds(rand, !leftSide),
        sunSide: leftSide ? 1 : -1,
        back: spec.back,
        leaflets: spec.back ? 20 : 26,
        silhouette: spec.back ? '#1c0b26' : '#0b0410',
        rim: spec.back ? 'rgba(255,110,150,0.4)' : 'rgba(255,140,100,0.72)',
        phase: rand() * Math.PI * 2,
      };
    });
}

const createViceCanvas: SceneFactory = (canvas) => {
  const c = canvas.getContext('2d');
  if (!c) {
    return null;
  }
  const doc = canvas.ownerDocument;
  const seed = 0x0c_17_56;
  let frame: ViceFrame | null = null;
  let skyline: Skyline | null = null;
  let clouds: CloudBank[] = [];
  let palms: Palm[] = [];
  // Pre-rendered palm silhouette strips built once on resize (zero per-frame Bezier
  // rasterization) with outer/bottom bleed and gently swayed via a shear transform on blit.
  let palmStrips: {
    readonly left: Layer;
    readonly right: Layer;
    readonly width: number;
    readonly bleedX: number;
    readonly bleedY: number;
  } | null = null;
  const bokeh = [AMBER, PINK, GOLD].map((color) => bokehSprite(doc, color));
  let drift = 0;
  let sliceClock = 0;

  const starRand = createRandom(seed ^ 0x1f);
  const stars = Array.from({ length: 90 }, () => ({
    x: starRand(),
    y: starRand() ** 1.4 * 0.62,
    s: 0.5 + starRand() * 1.1,
    phase: starRand() * Math.PI * 2,
    rate: 0.6 + starRand() * 1.4,
  }));
  const glintRand = createRandom(seed ^ 0x2e);
  const glints = Array.from({ length: 140 }, () => ({
    x: glintRand(),
    s: glintRand(),
    len: 0.5 + glintRand(),
    phase: glintRand() * Math.PI * 2,
  }));
  const moteRand = createRandom(seed ^ 0x3d);
  const motes: Mote[] = Array.from({ length: 16 }, () => ({
    x: moteRand(),
    y: 0.25 + moteRand() * 0.75,
    r: 4 + moteRand() * 11,
    vx: 2 + moteRand() * 5,
    vy: -(2 + moteRand() * 5),
    alpha: 0.07 + moteRand() * 0.12,
    sprite: Math.floor(moteRand() * 3),
    phase: moteRand() * Math.PI * 2,
  }));

  const scene: Scene = {
    kind: 'canvas2d',
    renderScale: 0.75,
    maxPixelRatio: 1.25,
    maxPixels: 1_200_000,
    resize(view) {
      const rand = createRandom(seed);
      const w = view.cssWidth;
      const h = view.cssHeight;
      frame = buildFrame(c, doc, view);
      skyline = buildSkyline(doc, rand, w, h, view.pixelRatio);
      clouds = buildClouds(doc, rand, w, h * HORIZON);
      const builtPalms = buildPalms(rand, w, h);
      const stripW = Math.ceil(w * PALM_STRIP);
      // Outer horizontal and bottom bleed so pointer parallax + shear sway never
      // expose a clipped offscreen edge or lift palm trunks off the viewport bottom.
      const bleedX = Math.ceil(24 + h * 0.015);
      const bleedY = 16;
      const left = createLayer(doc, stripW + bleedX, h + bleedY, view.pixelRatio);
      const right = createLayer(doc, stripW + bleedX, h + bleedY, view.pixelRatio);
      if (left && right) {
        for (const [strip, offsetX, onLeft] of [
          [left, -bleedX, true],
          [right, w - stripW, false],
        ] as const) {
          for (const palm of builtPalms) {
            if (palm.baseX < w / 2 === onLeft) {
              drawPalm(strip.g, palm, 0, 0, -offsetX, 0);
            }
          }
        }
        palmStrips = { left, right, width: stripW, bleedX, bleedY };
        palms = [];
      } else {
        palmStrips = null;
        palms = builtPalms;
      }
    },
    render({ view, time, dt, pointer }) {
      if (!frame) {
        return;
      }
      const { horizonY, oceanH, sunR } = frame;
      const w = view.cssWidth;
      const h = view.cssHeight;
      const ratio = view.pixelRatio;
      const px = (pointer.nx - 0.5) * pointer.presence;
      const py = (pointer.ny - 0.5) * pointer.presence;
      drift += dt;
      sliceClock += dt;
      c.setTransform(ratio, 0, 0, ratio, 0, 0);
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = 1;

      // 1. Twilight sky.
      c.fillStyle = frame.sky;
      c.fillRect(0, 0, w, horizonY + 1);

      // 2. Delicate twilight stars, fading as the sky warms.
      c.fillStyle = '#fff1fb';
      for (const star of stars) {
        c.globalAlpha =
          (1 - star.y / 0.62) * 0.75 * (0.55 + 0.45 * Math.sin(time * star.rate + star.phase));
        c.fillRect(star.x * w - px * 3, star.y * horizonY - py * 2, star.s, star.s);
      }
      c.globalAlpha = 1;

      // 3. Sun halo and disc.
      const sunX = w / 2 - px * 8;
      const sunY = horizonY - sunR * 0.32;
      c.globalCompositeOperation = 'screen';
      c.setTransform(ratio, 0, 0, ratio, sunX * ratio, sunY * ratio);
      c.fillStyle = frame.halo;
      c.fillRect(-sunX, -sunY, w, horizonY);
      c.setTransform(ratio, 0, 0, ratio, 0, 0);
      c.globalCompositeOperation = 'source-over';

      const { sun, sunDisc } = frame;
      if (sun && sunDisc) {
        const sg = sun.g;
        const sunW = sunR * 2 + 4;
        const sunH = sunR * 1.32 + 2;
        const cx = sunW / 2;
        const cy = sunR + 2;
        sg.setTransform(ratio, 0, 0, ratio, 0, 0);
        sg.globalCompositeOperation = 'source-over';
        sg.clearRect(0, 0, sunW, sunH);
        sg.fillStyle = sunDisc;
        sg.beginPath();
        sg.arc(cx, cy, sunR, 0, Math.PI * 2);
        sg.fill();
        // Retro slices drift downward and widen, cut cleanly so the sky shows through.
        sg.globalCompositeOperation = 'destination-out';
        sg.fillStyle = '#000';
        const slices = 7;
        const offset = (sliceClock * 0.07) % 1;
        for (let i = 0; i < slices; i++) {
          const p = (i + offset) / slices;
          const y = cy + sunR * (0.04 + p * 0.96);
          if (y > sunH) {
            break;
          }
          const thick = sunR * (0.008 + p * p * 0.075);
          sg.fillRect(0, y - thick / 2, sunW, thick);
        }
        c.drawImage(sun.canvas, sunX - cx, sunY - cy, sunW, sunH);
      }

      // 4. Lit tropical cloud banks drifting slowly.
      for (const bank of clouds) {
        const travel = w + bank.width;
        const x = wrap(bank.x0 * travel + drift * bank.speed, travel) - bank.width;
        c.drawImage(bank.layer.canvas, x - px * 6, bank.y - py * 3, bank.width, bank.height);
      }

      // 5. Atmospheric horizon bloom (upper half only: the opaque sea covers the rest).
      c.globalCompositeOperation = 'screen';
      c.save();
      c.translate(sunX, horizonY);
      c.scale(1, 0.16);
      c.fillStyle = frame.bloom;
      c.fillRect(-w, -w * 0.8, w * 2, w * 0.8);
      c.restore();
      c.globalCompositeOperation = 'source-over';

      // 6. Skyline: hazy far towers, then the downtown silhouette with neon trim.
      const nearX = -SKYLINE_MARGIN - px * 16;
      if (skyline) {
        const top = horizonY - skyline.height;
        c.drawImage(
          skyline.far.canvas,
          -SKYLINE_MARGIN - px * 10,
          top,
          skyline.span,
          skyline.height,
        );
        c.fillStyle = frame.haze;
        c.fillRect(0, horizonY - h * 0.1, w, h * 0.1);
        c.drawImage(skyline.near.canvas, nearX, top, skyline.span, skyline.height);
        for (const glint of skyline.glints) {
          c.globalAlpha = Math.max(0, Math.sin(time * 0.35 + glint.phase)) * 0.9;
          c.fillStyle = glint.css;
          c.fillRect(nearX + glint.x - 0.4, top + glint.y - 0.4, 2.4, 3.2);
        }
        c.globalAlpha = 1;
      }

      // 7. Ocean.
      c.fillStyle = frame.sea;
      c.fillRect(0, horizonY, w, oceanH);

      // Mirrored skyline reflection, compressed by perspective and broken into
      // wavering strips like light on moving water.
      if (skyline) {
        const strips = 20;
        const source = skyline.near.canvas;
        const sliceH = skyline.height / strips;
        const squash = Math.min(oceanH * 0.5, skyline.height) / skyline.height;
        c.save();
        c.translate(0, horizonY);
        c.scale(1, -squash);
        for (let i = 0; i < strips; i++) {
          const depth = i / strips;
          const wobble = Math.sin(time * 1.4 + i * 0.85) * (0.6 + depth * 6);
          c.globalAlpha = 0.34 * (1 - depth) ** 1.3;
          c.drawImage(
            source,
            0,
            (skyline.height - (i + 1) * sliceH) * ratio,
            source.width,
            sliceH * ratio,
            nearX + wobble,
            -(i + 1) * sliceH,
            skyline.span,
            sliceH + 0.5,
          );
        }
        c.restore();
        c.globalAlpha = 1;
      }

      c.globalCompositeOperation = 'lighter';
      // Full-width sky reflections: faint swells that keep the gutters alive.
      for (let k = 0; k < 18; k++) {
        const s = (k + 0.5) / 18;
        const y = horizonY + 3 + oceanH * s ** 1.8 + Math.sin(time * 0.8 + k * 1.7) * (0.5 + s * 2);
        c.globalAlpha = (1 - s) * 0.07 * (0.6 + 0.4 * Math.sin(time * 1.1 + k * 2.3));
        c.fillStyle = k % 2 === 0 ? PINK_CSS : VIOLET_CSS;
        c.fillRect(0, y, w, 0.8 + s * 2.2);
      }
      // Sun reflection: perspective-compressed shimmering bands.
      for (let k = 0; k < REFLECTION_ROWS; k++) {
        const s = (k + 0.5) / REFLECTION_ROWS;
        const y = horizonY + 2 + oceanH * s ** 1.65;
        const thick = 0.7 + s * 2;
        const halfW = sunR * (0.4 + s * 0.6);
        // Deep rows fade fast so the near water stays calm at the column edges.
        const rowAlpha = (1 - s) ** 1.5 * 0.66;
        c.fillStyle = REFLECTION_CSS[k] ?? PINK_CSS;
        for (let j = 0; j < 4; j++) {
          const u = (j - 1.5) / 1.5;
          const shimmer = Math.abs(Math.sin(time * 0.9 + k * 2.7 + j * 1.3));
          const cx =
            sunX + u * halfW * 0.72 + Math.sin(time * 1.2 + k * 1.9 + j * 2.3) * halfW * 0.1;
          const segW = halfW * 0.44 * (0.3 + 0.7 * shimmer) * (1 - Math.abs(u) * 0.35);
          c.globalAlpha = rowAlpha * (0.45 + 0.55 * shimmer);
          c.fillRect(cx - segW / 2, y, segW, thick);
        }
      }

      // Scattered sky glints across the water, cool away from the sun.
      for (const [i, glint] of glints.entries()) {
        const y = horizonY + 3 + oceanH * glint.s ** 1.65;
        const x = wrap(glint.x * w + drift * (6 + glint.s * 18), w);
        const len = (3 + glint.s * 15) * glint.len;
        const warmth = Math.exp(-(((x - sunX) / (w * 0.28)) ** 2));
        c.globalAlpha = Math.max(0, Math.sin(time * 1.3 + glint.phase)) * (0.07 + glint.s * 0.07);
        c.fillStyle = GLINT_CSS[i % 2]?.[Math.round(warmth * WARMTH_STEPS)] ?? PINK_CSS;
        c.fillRect(x - len / 2, y, len, 0.7 + glint.s * 0.8);
      }

      // Neon trims reflected as wavering vertical streaks.
      if (skyline) {
        for (const [i, mark] of skyline.neon.entries()) {
          const baseX = mark.x + nearX;
          c.fillStyle = mark.css;
          for (let d = 0; d < 9; d++) {
            const s = d / 9;
            const y = horizonY + 3 + s * oceanH * 0.34;
            const wobble = Math.sin(time * 2 + d * 1.3 + i) * (1.2 + s * 4);
            c.globalAlpha = (1 - s) * 0.32 * (0.6 + 0.4 * Math.sin(time * 1.7 + d + i));
            c.fillRect(baseX + wobble - (1 + s * 2), y, 2 + s * 4, 1.6 + s * 4);
          }
        }
      }
      c.globalAlpha = 1;

      // Glare along the waterline.
      c.fillStyle = 'rgba(255,196,120,0.75)';
      c.fillRect(0, horizonY, w, 1);
      c.fillStyle = 'rgba(255,140,110,0.18)';
      c.fillRect(0, horizonY - 1, w, 4);
      c.globalCompositeOperation = 'source-over';

      // 8. Palms framing only the outer margins (cached strips swayed via shear transform).
      const sway = Math.sin(time * 0.55) * 0.6 + Math.sin(time * 1.13 + 1) * 0.4;
      if (palmStrips) {
        const { left, right, width, bleedX, bleedY } = palmStrips;
        const shear = sway * 0.012;
        const shiftX = -px * 24;
        const shiftY = -py * 6;
        c.setTransform(ratio, 0, shear * ratio, ratio, shiftX * ratio, (h + shiftY) * ratio);
        c.drawImage(left.canvas, -bleedX, -h, width + bleedX, h + bleedY);
        c.drawImage(right.canvas, w - width, -h, width + bleedX, h + bleedY);
        c.setTransform(ratio, 0, 0, ratio, 0, 0);
      } else {
        for (const palm of palms) {
          const depth = palm.back ? 18 : 28;
          drawPalm(
            c,
            palm,
            sway * (palm.back ? 0.7 : 1),
            time,
            -px * depth,
            -py * (palm.back ? 4 : 7),
          );
        }
      }

      // 9. Warm bokeh motes.
      c.globalCompositeOperation = 'screen';
      for (const mote of motes) {
        mote.x = wrap(mote.x + (mote.vx * dt) / w, 1);
        mote.y += (mote.vy * dt) / h;
        if (mote.y < 0.2) {
          mote.y = 1.02;
        }
        const sprite = bokeh[mote.sprite];
        if (!sprite) {
          continue;
        }
        c.globalAlpha = mote.alpha * (0.7 + 0.3 * Math.sin(time * 0.8 + mote.phase));
        const size = mote.r * 2;
        c.drawImage(
          sprite,
          mote.x * w - px * 36 - mote.r,
          mote.y * h - py * 10 - mote.r,
          size,
          size,
        );
      }
      c.globalAlpha = 1;

      // 10. Soft lens vignette.
      c.globalCompositeOperation = 'source-over';
      c.fillStyle = frame.vignette;
      c.fillRect(0, 0, w, h);
      c.setTransform(1, 0, 0, 1, 0, 0);
    },
  };
  return scene;
};

function viceCss(): string {
  return [
    'radial-gradient(circle at 50% 56%, rgba(255,214,110,0.95) 0 11%, rgba(255,120,90,0.5) 17%, rgba(255,64,140,0.18) 30%, transparent 46%)',
    'linear-gradient(180deg, #0a0520 0%, #1f0e45 20%, #5a1a62 40%, #b3306c 54%, #ffa24f 66.5%, #5c1a5e 66.6%, #1a0a2f 80%, #080411 100%)',
  ].join(', ');
}

export const VICE_HORIZON_SCENE: SceneSpec = {
  factories: [createViceCanvas],
  cssFallback: viceCss,
  fps: 20,
  startTime: 3.2,
};
