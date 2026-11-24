// Cyber Grid: an anti-aliased outrun perspective floor scrolling toward the
// viewer, a vanishing-point horizon glow, geometric mountain silhouettes, and a
// slow horizon scan pulse, drawn crisp at any viewport size.

import type { Rgb, ScenePalette } from './palette';
import type { Scene, SceneFactory, SceneSpec } from './scene-host';
import { createRandom } from '../digital-rain/math';
import { mixRgb, rgbCss, WHITE } from './palette';

const HORIZON = 0.56;
const Z_NEAR = 1;
const Z_FAR = 26;
const ROW_SPACING = 0.62;
const COLUMN_SPREAD = 0.07;
const SCAN_PERIOD = 7.5;
const SCAN_DURATION = 2.6;

interface Ridge {
  readonly points: ReadonlyArray<readonly [number, number]>;
}

function buildRidge(seed: number, steps: number, peak: number, valley: number): Ridge {
  const rand = createRandom(seed);
  const points: Array<readonly [number, number]> = [[-0.05, 0]];
  let x = -0.05;
  while (x < 1.05) {
    x += (0.6 + rand() * 0.9) / steps;
    // Taller toward the outer edges, low behind the centered reading column.
    const edge = Math.abs(x - 0.5) * 2;
    const envelope = valley + (peak - valley) * edge ** 1.4;
    points.push([x, envelope * (0.35 + rand() * 0.65)]);
  }
  points.push([1.05, 0]);
  return { points };
}

const FAR_RIDGE = buildRidge(0x2f_6b_1d, 44, 0.13, 0.035);
const NEAR_RIDGE = buildRidge(0x7a_31_c9, 28, 0.21, 0.03);

const SKY_STARS = (() => {
  const rand = createRandom(0x11_aa_77);
  return Array.from({ length: 64 }, () => ({
    x: rand(),
    y: rand() * 0.85,
    s: 0.5 + rand() * 0.9,
    phase: rand() * Math.PI * 2,
  }));
})();

function drawRidge(
  c: CanvasRenderingContext2D,
  ridge: Ridge,
  w: number,
  horizonY: number,
  height: number,
  shift: number,
  fill: CanvasGradient,
  rim: string,
  facet: string,
): void {
  c.beginPath();
  for (const [i, [px, py]] of ridge.points.entries()) {
    const x = px * w + shift;
    const y = horizonY - py * height;
    if (i === 0) {
      c.moveTo(x, horizonY);
    }
    c.lineTo(x, y);
  }
  c.lineTo(w * 1.05 + shift, horizonY);
  c.closePath();
  c.fillStyle = fill;
  c.fill();
  c.strokeStyle = rim;
  c.lineWidth = 1;
  c.lineJoin = 'miter';
  c.stroke();

  // Faint facet lines from each peak to the foot of the ridge read as low-poly wireframe.
  c.strokeStyle = facet;
  c.lineWidth = 0.75;
  c.beginPath();
  const pts = ridge.points;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const next = pts[i + 1];
    if (!prev || !cur || !next || cur[1] < prev[1] || cur[1] < next[1]) {
      continue;
    }
    const x = cur[0] * w + shift;
    c.moveTo(x, horizonY - cur[1] * height);
    c.lineTo(x + (next[0] - cur[0]) * w * 0.35, horizonY);
  }
  c.stroke();
}

const MAX_ROWS = 64;

/** Every gradient and color string that depends only on palette and viewport size. */
interface GridPaints {
  readonly key: string;
  readonly line: Rgb;
  readonly lineCss: string;
  readonly star: string;
  readonly sky: CanvasGradient;
  /** Built around the origin; drawn under a translate to the moving vanishing point. */
  readonly bloom: CanvasGradient;
  readonly farFill: CanvasGradient;
  readonly farRim: string;
  readonly farFacet: string;
  readonly nearFill: CanvasGradient;
  readonly nearRim: string;
  readonly nearFacet: string;
  readonly floor: CanvasGradient;
  readonly verticals: readonly [CanvasGradient, CanvasGradient];
  readonly halo: CanvasGradient;
  readonly horizon: string;
}

function gridPaints(
  c: CanvasRenderingContext2D,
  palette: ScenePalette,
  key: string,
  w: number,
  h: number,
): GridPaints {
  const light = palette.scheme === 'light';
  const bg = palette.background;
  const glow = palette.alt;
  const line = light ? palette.accent : mixRgb(palette.accent, WHITE, 0.15);
  const horizonY = Math.round(h * HORIZON);
  const linear = (y0: number, y1: number, stops: ReadonlyArray<readonly [number, string]>) => {
    const grad = c.createLinearGradient(0, y0, 0, y1);
    for (const [offset, color] of stops) {
      grad.addColorStop(offset, color);
    }
    return grad;
  };
  const bloom = c.createRadialGradient(0, 0, 0, 0, 0, w * 0.55);
  bloom.addColorStop(0, rgbCss(mixRgb(glow, WHITE, 0.2), light ? 0.22 : 0.42));
  bloom.addColorStop(0.4, rgbCss(glow, light ? 0.08 : 0.14));
  bloom.addColorStop(1, rgbCss(glow, 0));
  const farAlpha = light ? 0.3 : 0.4;
  const nearAlpha = light ? 0.5 : 0.62;
  const vertical = (passAlpha: number) =>
    linear(horizonY, h, [
      [0, rgbCss(line, 0)],
      [0.25, rgbCss(line, 0.35 * passAlpha)],
      [1, rgbCss(line, passAlpha)],
    ]);
  return {
    key,
    line,
    lineCss: rgbCss(line),
    star: rgbCss(light ? palette.text : WHITE),
    sky: linear(0, horizonY, [
      [0, rgbCss(bg)],
      [0.62, rgbCss(mixRgb(bg, glow, light ? 0.08 : 0.16))],
      [1, rgbCss(mixRgb(bg, glow, light ? 0.22 : 0.42))],
    ]),
    bloom,
    farFill: linear(horizonY - h * 0.12, horizonY, [
      [0, rgbCss(mixRgb(bg, glow, 0.2))],
      [1, rgbCss(mixRgb(bg, glow, 0.32))],
    ]),
    farRim: rgbCss(glow, farAlpha),
    farFacet: rgbCss(glow, farAlpha * 0.28),
    nearFill: linear(horizonY - h * 0.2, horizonY, [
      [0, rgbCss(mixRgb(bg, palette.accent, 0.1))],
      [1, rgbCss(bg)],
    ]),
    nearRim: rgbCss(line, nearAlpha),
    nearFacet: rgbCss(line, nearAlpha * 0.28),
    floor: linear(horizonY, h, [
      [0, rgbCss(mixRgb(bg, glow, light ? 0.14 : 0.26))],
      [0.35, rgbCss(mixRgb(bg, glow, 0.06))],
      [1, rgbCss(bg)],
    ]),
    verticals: [vertical(0.16), vertical(0.75)],
    halo: linear(horizonY - 10, horizonY + 10, [
      [0, rgbCss(glow, 0)],
      [0.5, rgbCss(mixRgb(glow, WHITE, 0.25), light ? 0.3 : 0.55)],
      [1, rgbCss(glow, 0)],
    ]),
    horizon: rgbCss(mixRgb(glow, WHITE, 0.55), light ? 0.6 : 0.9),
  };
}

const createCyberGridCanvas: SceneFactory = (canvas) => {
  const c = canvas.getContext('2d');
  if (!c) {
    return null;
  }
  let scroll = 0;
  let scanClock = SCAN_PERIOD - 1.2;
  let paints: GridPaints | null = null;
  const rowY = new Float64Array(MAX_ROWS);
  const rowFog = new Float64Array(MAX_ROWS);

  const scene: Scene = {
    kind: 'canvas2d',
    maxPixelRatio: 1.75,
    render({ palette, view, time, dt, pointer }) {
      const light = palette.scheme === 'light';
      const w = view.cssWidth;
      const h = view.cssHeight;
      const key = `${palette.key}|${w}|${h}`;
      if (paints?.key !== key) {
        paints = gridPaints(c, palette, key, w, h);
      }
      const horizonY = Math.round(h * HORIZON);
      const floorH = h - horizonY;
      const lean = (pointer.nx - 0.5) * pointer.presence;
      const vx = w / 2 - lean * 36;
      const pr = view.pixelRatio;
      c.setTransform(pr, 0, 0, pr, 0, 0);

      // Sky: palette night fading into a warm horizon glow.
      c.fillStyle = paints.sky;
      c.fillRect(0, 0, w, horizonY + 1);

      c.fillStyle = paints.star;
      for (const star of SKY_STARS) {
        c.globalAlpha =
          (light ? 0.18 : 0.5) * (0.6 + 0.4 * Math.sin(time * 0.9 + star.phase)) * (1 - star.y);
        c.fillRect(star.x * w, star.y * horizonY, star.s, star.s);
      }
      c.globalAlpha = 1;

      // Vanishing-point bloom behind the mountains.
      c.setTransform(pr, 0, 0, pr, vx * pr, horizonY * pr);
      c.fillStyle = paints.bloom;
      c.fillRect(-vx, -horizonY, w, h);
      c.setTransform(pr, 0, 0, pr, 0, 0);

      // Geometric mountains with luminous ridge lines.
      drawRidge(
        c,
        FAR_RIDGE,
        w,
        horizonY,
        h,
        -lean * 6,
        paints.farFill,
        paints.farRim,
        paints.farFacet,
      );
      drawRidge(
        c,
        NEAR_RIDGE,
        w,
        horizonY,
        h,
        -lean * 12,
        paints.nearFill,
        paints.nearRim,
        paints.nearFacet,
      );

      // Floor.
      c.fillStyle = paints.floor;
      c.fillRect(0, horizonY, w, floorH);

      scroll = (scroll + dt * 0.9) % ROW_SPACING;
      // Horizontal rows at perspective depths, densest near the horizon.
      let rowCount = 0;
      for (let k = 0; k < MAX_ROWS; k++) {
        const z = Z_NEAR + k * ROW_SPACING - scroll;
        if (z < Z_NEAR * 0.98 || z > Z_FAR) {
          continue;
        }
        const y = horizonY + (floorH * Z_NEAR) / z;
        if (y - horizonY < 1.2) {
          break;
        }
        rowY[rowCount] = y;
        rowFog[rowCount] = (1 - z / Z_FAR) ** 1.6;
        rowCount += 1;
      }
      // Columns converge on the vanishing point; at the bottom edge (z = Z_NEAR) they sit `spread` apart.
      const spread = w * COLUMN_SPREAD;
      const columnCount = Math.ceil((w * 1.6) / spread);
      // Two passes: a soft glow, then a crisp hairline.
      for (const [pass, vertical] of paints.verticals.entries()) {
        c.lineWidth = pass === 0 ? 3.2 : 1;
        const passAlpha = pass === 0 ? 0.16 : 0.75;
        c.strokeStyle = paints.lineCss;
        for (let r = 0; r < rowCount; r++) {
          const y = rowY[r] ?? 0;
          c.globalAlpha = (rowFog[r] ?? 0) * passAlpha * (light ? 0.75 : 1);
          c.beginPath();
          c.moveTo(0, y);
          c.lineTo(w, y);
          c.stroke();
        }
        c.globalAlpha = light ? 0.75 : 1;
        c.strokeStyle = vertical;
        c.beginPath();
        for (let i = -columnCount; i <= columnCount; i++) {
          c.moveTo(vx, horizonY);
          c.lineTo(vx + i * spread, h);
        }
        c.stroke();
      }
      c.globalAlpha = 1;

      // Horizon scan pulse rolling toward the viewer.
      scanClock += dt;
      const phase = scanClock % SCAN_PERIOD;
      if (phase < SCAN_DURATION) {
        const s = phase / SCAN_DURATION;
        const y = horizonY + floorH * s * s;
        const band = 2 + s * 14;
        const pulse = c.createLinearGradient(0, y - band, 0, y + band);
        const a = Math.sin(Math.PI * s) * (light ? 0.22 : 0.36);
        pulse.addColorStop(0, rgbCss(paints.line, 0));
        pulse.addColorStop(0.5, rgbCss(mixRgb(paints.line, WHITE, 0.4), a));
        pulse.addColorStop(1, rgbCss(paints.line, 0));
        c.fillStyle = pulse;
        c.fillRect(0, y - band, w, band * 2);
      }

      // Crisp horizon line with a soft halo.
      c.fillStyle = paints.halo;
      c.fillRect(0, horizonY - 10, w, 20);
      c.fillStyle = paints.horizon;
      c.fillRect(0, horizonY - 0.5, w, 1);
      c.setTransform(1, 0, 0, 1, 0, 0);
    },
  };
  return scene;
};

function cyberGridCss(palette: ScenePalette): string {
  const bg = rgbCss(palette.background);
  const glow = rgbCss(mixRgb(palette.background, palette.alt, 0.42));
  return [
    `radial-gradient(ellipse 60% 22% at 50% 56%, ${rgbCss(palette.alt, 0.35)}, transparent 70%)`,
    `linear-gradient(180deg, ${bg} 0%, ${glow} 56%, ${rgbCss(palette.accent, 0.5)} 56.2%, ${bg} 57%, ${bg} 100%)`,
  ].join(', ');
}

export const CYBER_GRID_SCENE: SceneSpec = {
  factories: [createCyberGridCanvas],
  cssFallback: cyberGridCss,
  fps: 30,
  startTime: 2,
};
