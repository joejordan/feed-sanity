// Constellations: crisp multi-depth twinkling stars, a faint nebula wash,
// graceful tapered shooting stars, and ultra-subtle constellation filaments
// that only appear around the cursor (after Aceternity "Shooting Stars & Stars").

import type { Layer } from './canvas';
import type { Rgb, ScenePalette } from './palette';
import type { Scene, SceneFactory, SceneSpec } from './scene-host';
import { createRandom } from '../digital-rain/math';
import { deriveEffectParams, STARFIELD_PARAM_SPECS } from '../model';
import { createLayer, createRadialSprite, wrap } from './canvas';
import { mixRgb, rgbCss, WHITE } from './palette';

const starfieldParams = deriveEffectParams(STARFIELD_PARAM_SPECS, (p) => ({
  density: p.density as number,
  constellations: p.constellations as boolean,
  shootingStars: p.shootingStars as boolean,
}));

interface Star {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly alpha: number;
  readonly rate: number;
  readonly phase: number;
  readonly tone: 0 | 1 | 2;
}

interface Comet {
  x: number;
  y: number;
  readonly vx: number;
  readonly vy: number;
  life: number;
  readonly ttl: number;
  readonly length: number;
}

interface DepthLayer {
  readonly stars: readonly Star[];
  /** Star indices grouped by tone (ascending), so each tone is one fillStyle pass. */
  readonly byTone: ReadonlyArray<readonly number[]>;
  /** Stars per 10,000 CSS px² of viewport. */
  readonly density: number;
  /** Pointer parallax travel in CSS px. */
  readonly parallax: number;
  /** Slow drift in CSS px per second. */
  readonly drift: number;
}

const LINK_RADIUS = 210;
/** The Milky Way runs along y = 0.15 + 0.7x in normalized viewport space. */
const BAND_OFFSET = 0.15;
const BAND_SLOPE = 0.7;
const LINK_DISTANCE = 130;
const MAX_LINKED = 26;

function buildLayer(
  seed: number,
  max: number,
  size: readonly [number, number],
  alpha: readonly [number, number],
  band: number,
): Star[] {
  const rand = createRandom(seed);
  return Array.from({ length: max }, () => {
    // A share of stars gathers along the Milky Way for a natural, deep sky.
    const inBand = rand() < band;
    const u = rand();
    const spread = (rand() + rand() + rand() - 1.5) * 0.09;
    const toneRoll = rand();
    let tone: 0 | 1 | 2 = 0;
    if (toneRoll > 0.84) {
      tone = 2;
    } else if (toneRoll > 0.68) {
      tone = 1;
    }
    const loose = rand();
    return {
      x: inBand ? u : loose,
      y: inBand ? wrap(BAND_OFFSET + BAND_SLOPE * u + spread, 1) : rand(),
      size: size[0] + rand() * (size[1] - size[0]),
      alpha: alpha[0] + rand() * (alpha[1] - alpha[0]),
      rate: 0.5 + rand() * 1.6,
      phase: rand() * Math.PI * 2,
      tone,
    };
  });
}

function depthLayer(stars: Star[], density: number, parallax: number, drift: number): DepthLayer {
  const byTone: number[][] = [[], [], []];
  for (const [i, star] of stars.entries()) {
    byTone[star.tone]?.push(i);
  }
  return { stars, byTone, density, parallax, drift };
}

function glowSprite(doc: Document, color: Rgb): HTMLCanvasElement | null {
  return createRadialSprite(doc, 32, [
    [0, rgbCss(WHITE, 0.95)],
    [0.18, rgbCss(color, 0.55)],
    [0.5, rgbCss(color, 0.12)],
    [1, rgbCss(color, 0)],
  ]);
}

interface StarPaints {
  readonly palette: ScenePalette;
  readonly tones: readonly string[];
  readonly link: string;
  readonly comet: Rgb;
  readonly glow: HTMLCanvasElement | null;
  readonly headGlow: HTMLCanvasElement | null;
}

function starPaints(doc: Document, palette: ScenePalette): StarPaints {
  const light = palette.scheme === 'light';
  const starBase = light ? palette.text : mixRgb(palette.text, WHITE, 0.5);
  return {
    palette,
    tones: [
      rgbCss(starBase),
      rgbCss(mixRgb(starBase, palette.accent, 0.35)),
      rgbCss(mixRgb(starBase, palette.alt, 0.3)),
    ],
    link: rgbCss(light ? palette.accent : mixRgb(palette.accent, WHITE, 0.3)),
    comet: light ? palette.accent : mixRgb(palette.accent, WHITE, 0.65),
    glow: glowSprite(doc, light ? palette.accent : mixRgb(palette.accent, WHITE, 0.4)),
    headGlow: glowSprite(doc, mixRgb(palette.accent, WHITE, 0.6)),
  };
}

const createStarfieldCanvas: SceneFactory = (canvas) => {
  const c = canvas.getContext('2d');
  if (!c) {
    return null;
  }
  const doc = canvas.ownerDocument;
  const layers: readonly DepthLayer[] = [
    depthLayer(buildLayer(11, 340, [0.7, 1.1], [0.3, 0.62], 0.42), 1.15, 3, 1.1),
    depthLayer(buildLayer(23, 150, [1, 1.55], [0.5, 0.88], 0.2), 0.42, 7, 2.4),
    depthLayer(buildLayer(37, 40, [1.4, 2.2], [0.75, 1], 0), 0.1, 14, 4.2),
  ];
  const rand = createRandom(0x51_7c_c1_b7);
  const comets: Comet[] = [];
  let untilComet = 3.5;
  let drift = 0;
  let paints: StarPaints | null = null;
  // Static nebula + Milky Way wash pre-rendered into an offscreen layer once per resize/palette.
  let washLayer: Layer | null = null;
  let washes: CanvasGradient[] = [];
  let river: CanvasGradient | null = null;
  let washKey = '';
  const linked: Array<{ x: number; y: number; d: number }> = [];

  const spawnComet = (w: number, h: number): void => {
    const leftward = rand() < 0.5;
    const angle = 0.32 + rand() * 0.28;
    const speed = 640 + rand() * 360;
    comets.push({
      x: leftward ? w * (0.45 + rand() * 0.5) : w * (0.05 + rand() * 0.5),
      y: h * (0.02 + rand() * 0.3),
      vx: Math.cos(angle) * speed * (leftward ? -1 : 1),
      vy: Math.sin(angle) * speed,
      life: 0,
      ttl: 0.75 + rand() * 0.5,
      length: 130 + rand() * 110,
    });
  };

  const buildWashGradients = (
    target: CanvasRenderingContext2D,
    palette: ScenePalette,
    light: boolean,
    w: number,
    h: number,
    reach: number,
  ): { readonly washes: CanvasGradient[]; readonly river: CanvasGradient } => {
    const a = target.createRadialGradient(w * 0.16, h * 0.22, 0, w * 0.16, h * 0.22, w * 0.42);
    a.addColorStop(0, rgbCss(palette.accent, light ? 0.07 : 0.16));
    a.addColorStop(1, rgbCss(palette.accent, 0));
    const b = target.createRadialGradient(w * 0.86, h * 0.78, 0, w * 0.86, h * 0.78, w * 0.4);
    b.addColorStop(0, rgbCss(palette.alt, light ? 0.05 : 0.11));
    b.addColorStop(1, rgbCss(palette.alt, 0));
    const riverTone = mixRgb(palette.text, palette.accent, 0.35);
    const riv = target.createRadialGradient(0, 0, 0, 0, 0, reach);
    riv.addColorStop(0, rgbCss(riverTone, light ? 0.05 : 0.1));
    riv.addColorStop(0.55, rgbCss(riverTone, light ? 0.025 : 0.045));
    riv.addColorStop(1, rgbCss(riverTone, 0));
    return { washes: [a, b], river: riv };
  };

  const drawWash = (
    target: CanvasRenderingContext2D,
    washList: readonly CanvasGradient[],
    riverGrad: CanvasGradient | null,
    w: number,
    h: number,
    reach: number,
  ): void => {
    for (const wash of washList) {
      target.fillStyle = wash;
      target.fillRect(0, 0, w, h);
    }
    if (riverGrad) {
      target.save();
      target.translate(w * 0.5, h * (BAND_OFFSET + BAND_SLOPE * 0.5));
      target.rotate(Math.atan2(h * BAND_SLOPE, w));
      target.scale(1, 0.13);
      target.fillStyle = riverGrad;
      target.fillRect(-reach, -reach, reach * 2, reach * 2);
      target.restore();
    }
  };

  const scene: Scene = {
    kind: 'canvas2d',
    maxPixelRatio: 1.25,
    maxPixels: 1_200_000,
    render({ ctx, palette, view, time, dt, pointer, still }) {
      const {
        density: densityScale,
        constellations: showConstellations,
        shootingStars: showShootingStars,
      } = starfieldParams(ctx.effects.backdropParams);
      const light = palette.scheme === 'light';
      const w = view.cssWidth;
      const h = view.cssHeight;
      if (paints?.palette !== palette) {
        paints = starPaints(doc, palette);
      }
      const { tones, glow, headGlow } = paints;
      const reach = Math.hypot(w, h) * 0.62;
      const washScale = Math.min(0.5, view.pixelRatio);
      const key = `${palette.key}|${w}|${h}|${washScale.toFixed(3)}`;
      if (key !== washKey) {
        washKey = key;
        const nextW = Math.max(1, Math.ceil(w * washScale));
        const nextH = Math.max(1, Math.ceil(h * washScale));
        if (washLayer) {
          washLayer.canvas.width = nextW;
          washLayer.canvas.height = nextH;
          washLayer.g.setTransform(washScale, 0, 0, washScale, 0, 0);
        } else {
          washLayer = createLayer(doc, w, h, washScale);
        }
        if (washLayer) {
          const built = buildWashGradients(washLayer.g, palette, light, w, h, reach);
          drawWash(washLayer.g, built.washes, built.river, w, h, reach);
          washes = [];
          river = null;
        } else {
          const built = buildWashGradients(c, palette, light, w, h, reach);
          washes = built.washes;
          river = built.river;
        }
      }
      c.setTransform(view.pixelRatio, 0, 0, view.pixelRatio, 0, 0);
      if (washLayer) {
        c.globalCompositeOperation = 'copy';
        c.drawImage(washLayer.canvas, 0, 0, w, h);
        c.globalCompositeOperation = 'source-over';
      } else {
        c.clearRect(0, 0, w, h);
        drawWash(c, washes, river, w, h, reach);
      }

      drift += dt;
      const area = (w * h) / 10_000;
      const px = (pointer.nx - 0.5) * pointer.presence;
      const py = (pointer.ny - 0.5) * pointer.presence;
      linked.length = 0;

      for (let li = 0; li < layers.length; li++) {
        const layer = layers[li];
        if (!layer) {
          continue;
        }
        const count = Math.min(layer.stars.length, Math.round(area * layer.density * densityScale));
        const shiftX = -drift * layer.drift - px * layer.parallax;
        const shiftY = -drift * layer.drift * 0.35 - py * layer.parallax;
        for (const [tone, indices] of layer.byTone.entries()) {
          c.fillStyle = tones[tone] ?? '#fff';
          for (const i of indices) {
            const star = layer.stars[i];
            if (!star || i >= count) {
              break;
            }
            const x = wrap(star.x * w + shiftX, w);
            const y = wrap(star.y * h + shiftY, h);
            const twinkle = 0.7 + 0.3 * Math.sin(time * star.rate + star.phase);
            c.globalAlpha = star.alpha * twinkle * (light ? 0.7 : 1);
            const s = star.size;
            c.fillRect(x - s / 2, y - s / 2, s, s);
            if (li === 2 && glow) {
              c.globalAlpha = star.alpha * twinkle * (light ? 0.35 : 0.6);
              const gs = s * 8;
              c.drawImage(glow, x - gs / 2, y - gs / 2, gs, gs);
            }
            if (
              showConstellations &&
              li > 0 &&
              pointer.presence > 0.02 &&
              linked.length < MAX_LINKED
            ) {
              const d = Math.hypot(x - pointer.x, y - pointer.y);
              if (d < LINK_RADIUS) {
                linked.push({ x, y, d });
              }
            }
          }
        }
      }

      // Constellation filaments: only between stars near the cursor, fading with distance.
      if (linked.length > 1) {
        c.strokeStyle = paints.link;
        c.lineWidth = 0.7;
        for (let i = 0; i < linked.length; i++) {
          const a = linked[i];
          if (!a) {
            continue;
          }
          for (let j = i + 1; j < linked.length; j++) {
            const b = linked[j];
            if (!b) {
              continue;
            }
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d > LINK_DISTANCE) {
              continue;
            }
            const near = 1 - Math.max(a.d, b.d) / LINK_RADIUS;
            c.globalAlpha = pointer.presence * near * (1 - d / LINK_DISTANCE) * 0.32;
            c.beginPath();
            c.moveTo(a.x, a.y);
            c.lineTo(b.x, b.y);
            c.stroke();
          }
        }
      }

      // Shooting stars: rare, quick, tapered comet streaks.
      if (!showShootingStars) {
        comets.length = 0;
      } else if (!still) {
        untilComet -= dt;
        if (untilComet <= 0 && comets.length < 2) {
          spawnComet(w, h);
          untilComet = 6 + rand() * 9;
        }
      }
      for (let i = comets.length - 1; i >= 0; i--) {
        const comet = comets[i];
        if (!comet) {
          continue;
        }
        comet.life += dt;
        comet.x += comet.vx * dt;
        comet.y += comet.vy * dt;
        const progress = comet.life / comet.ttl;
        if (progress >= 1) {
          comets.splice(i, 1);
          continue;
        }
        const fade = Math.sin(Math.PI * progress);
        const speed = Math.hypot(comet.vx, comet.vy) || 1;
        const ux = comet.vx / speed;
        const uy = comet.vy / speed;
        const len = comet.length * (0.5 + 0.5 * fade);
        const tx = comet.x - ux * len;
        const ty = comet.y - uy * len;
        const tail = c.createLinearGradient(tx, ty, comet.x, comet.y);
        const head = paints.comet;
        tail.addColorStop(0, rgbCss(head, 0));
        tail.addColorStop(0.7, rgbCss(head, 0.35 * fade));
        tail.addColorStop(1, rgbCss(head, 0.95 * fade));
        c.globalAlpha = 1;
        c.fillStyle = tail;
        c.beginPath();
        c.moveTo(tx, ty);
        c.lineTo(comet.x - uy * 1.1, comet.y + ux * 1.1);
        c.lineTo(comet.x + ux * 1.5, comet.y + uy * 1.5);
        c.lineTo(comet.x + uy * 1.1, comet.y - ux * 1.1);
        c.closePath();
        c.fill();
        if (headGlow) {
          c.globalAlpha = fade * 0.9;
          c.drawImage(headGlow, comet.x - 9, comet.y - 9, 18, 18);
        }
      }
      c.globalAlpha = 1;
      c.setTransform(1, 0, 0, 1, 0, 0);
    },
    dispose() {
      if (washLayer) {
        washLayer.canvas.width = 0;
        washLayer.canvas.height = 0;
        washLayer = null;
      }
      washes = [];
      river = null;
    },
  };
  return scene;
};

function starfieldCss(palette: ScenePalette): string {
  const star = rgbCss(palette.scheme === 'light' ? palette.text : WHITE, 0.6);
  return [
    `radial-gradient(1px 1px at 12% 18%, ${star}, transparent)`,
    `radial-gradient(1px 1px at 34% 72%, ${star}, transparent)`,
    `radial-gradient(1.5px 1.5px at 68% 26%, ${star}, transparent)`,
    `radial-gradient(1px 1px at 86% 64%, ${star}, transparent)`,
    `radial-gradient(1px 1px at 52% 44%, ${star}, transparent)`,
    `radial-gradient(ellipse 50% 40% at 16% 22%, ${rgbCss(palette.accent, 0.12)}, transparent 70%)`,
    `radial-gradient(ellipse 45% 40% at 86% 78%, ${rgbCss(palette.alt, 0.08)}, transparent 70%)`,
  ].join(', ');
}

export const STARFIELD_SCENE: SceneSpec = {
  factories: [createStarfieldCanvas],
  cssFallback: starfieldCss,
  fps: 20,
  startTime: 4,
};
