// Botanical art for the Jungle Canopy backdrop: monstera, palm and fern fronds,
// banana blades, fan palms, heart-leaf vines, and their stems, generated once as
// plain polygons and shared by the WebGL and Canvas 2D renderers.
//
// The plants grow from the four corners of a square "frame" (`0..1` on both
// axes) and leave its centre cross empty, so a renderer can pin each quadrant to
// a viewport corner at any aspect ratio without stretching a single leaf.

import type { RandomSource } from '../digital-rain/math';
import type { Rgb } from './palette';
import { clamp, createRandom } from '../digital-rain/math';
import { mixRgb, rgbCss } from './palette';

export type CanopyLayer = 'near' | 'mid';

export interface CanopyLeaf {
  readonly layer: CanopyLayer;
  /**
   * Closed outlines as flat `x, y` pairs in frame units. Solid rings wind one
   * way and holes the other, so one nonzero fill cuts the holes.
   */
  readonly rings: readonly Float32Array[];
  /** Open vein polylines as flat `x, y` pairs, midrib first. */
  readonly veins: readonly Float32Array[];
  /** Per-leaf brightness (`0..1`) that keeps overlapping leaves distinct. */
  readonly tone: number;
}

type Corner = 'tl' | 'tr' | 'bl' | 'br';

const CORNERS: readonly Corner[] = ['tl', 'tr', 'bl', 'br'];
/** Leaves stop short of the frame's centre cross so quadrants never bleed into each other. */
export const CANOPY_QUADRANT_LIMIT = 0.975;
const DEFAULT_SEED = 0x1e_af_5e_ed;
const TAU = Math.PI * 2;

/** A point list in corner space: `u` runs inward from the side edge, `v` inward from the top or bottom edge. */
type Path = number[];

interface Frame {
  readonly ox: number;
  readonly oy: number;
  readonly cos: number;
  readonly sin: number;
}

function frameAt(ox: number, oy: number, dir: number): Frame {
  return { ox, oy, cos: Math.cos(dir), sin: Math.sin(dir) };
}

/** Appends the local point (`x` along the leaf, `y` across it) to `path` in corner space. */
function push(path: Path, f: Frame, x: number, y: number): void {
  path.push(f.ox + x * f.cos - y * f.sin, f.oy + x * f.sin + y * f.cos);
}

/** Appends `source`'s points to `target` in reverse order, closing a two-sided outline. */
function appendReversed(target: Path, source: Path): void {
  for (let i = source.length - 2; i >= 0; i -= 2) {
    target.push(source[i] ?? 0, source[i + 1] ?? 0);
  }
}

/** Position and unit tangent at `s` (`0..1`) along a midrib of `length` that bows sideways by `bow`. */
function bowedSpine(
  length: number,
  bow: number,
  s: number,
): readonly [x: number, y: number, tx: number, ty: number] {
  const ty = 4 * bow * (1 - 2 * s);
  const tl = Math.hypot(1, ty);
  return [length * s, 4 * bow * length * s * (1 - s), 1 / tl, ty / tl];
}

/** A slit with a rounded end: `1` at its centre, falling off steeply to either side. */
function slit(distance: number, width: number): number {
  const x = distance / width;
  return 1 / (1 + x * x * x * x);
}

function signedArea(ring: Float32Array): number {
  let area = 0;
  const n = ring.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    area += (ring[i] ?? 0) * (ring[j + 1] ?? 0) - (ring[j] ?? 0) * (ring[i + 1] ?? 0);
  }
  return area / 2;
}

function reversed(ring: Float32Array): Float32Array {
  const out = new Float32Array(ring.length);
  for (let i = 0; i < ring.length; i += 2) {
    const j = ring.length - 2 - i;
    out[i] = ring[j] ?? 0;
    out[i + 1] = ring[j + 1] ?? 0;
  }
  return out;
}

/** Collects one corner's plants and maps them from corner space into the shared frame. */
class CornerBuilder {
  readonly leaves: CanopyLeaf[] = [];
  /** `+1` when gravity runs along `+v` (top corners hang down), `-1` for bottom corners. */
  readonly gravity: 1 | -1;
  private readonly flipX: boolean;
  private readonly flipY: boolean;

  constructor(
    corner: Corner,
    readonly rand: RandomSource,
  ) {
    this.flipX = corner === 'tr' || corner === 'br';
    this.flipY = corner === 'bl' || corner === 'br';
    this.gravity = this.flipY ? -1 : 1;
  }

  private toFrame(path: Path): Float32Array {
    const out = new Float32Array(path.length);
    for (let i = 0; i < path.length; i += 2) {
      const u = Math.min(CANOPY_QUADRANT_LIMIT, path[i] ?? 0) * 0.5;
      const v = Math.min(CANOPY_QUADRANT_LIMIT, path[i + 1] ?? 0) * 0.5;
      out[i] = this.flipX ? 1 - u : u;
      out[i + 1] = this.flipY ? 1 - v : v;
    }
    return out;
  }

  add(
    layer: CanopyLayer,
    solids: readonly Path[],
    holes: readonly Path[] = [],
    veins: readonly Path[] = [],
  ): void {
    const rings: Float32Array[] = [];
    for (const path of solids) {
      const ring = this.toFrame(path);
      rings.push(signedArea(ring) < 0 ? reversed(ring) : ring);
    }
    for (const path of holes) {
      const ring = this.toFrame(path);
      rings.push(signedArea(ring) > 0 ? reversed(ring) : ring);
    }
    this.leaves.push({
      layer,
      rings,
      veins: veins.map((path) => this.toFrame(path)),
      tone: 0.15 + this.rand() * 0.85,
    });
  }
}

/** A tapered, gently bowed stem from `(x0, y0)` to `(x1, y1)` as one closed ring. */
function stemRing(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  bow: number,
  w0: number,
  w1: number,
): Path {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const left: Path = [];
  const right: Path = [];
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const s = i / steps;
    const arc = 4 * bow * len * s * (1 - s);
    const cx = x0 + dx * s + nx * arc;
    const cy = y0 + dy * s + ny * arc;
    // The bowed centreline tilts the normal slightly; the straight normal is close enough at stem widths.
    const half = (w0 + (w1 - w0) * s) / 2;
    left.push(cx + nx * half, cy + ny * half);
    right.push(cx - nx * half, cy - ny * half);
  }
  appendReversed(left, right);
  return left;
}

/** Radius of a heart-shaped blade at polar angle `t` (`0` = tip, `±PI` = stem notch). */
function heartRadius(t: number, tipSharpness: number): number {
  const body = (0.5 + 0.5 * Math.cos(t)) ** 0.42;
  const tip = 1 + tipSharpness * Math.exp(-((t / 0.3) ** 2));
  return body * tip;
}

/**
 * A heart-shaped blade attached by its notch at the frame origin. With `splits`
 * it becomes a monstera: deep slits run in from the margin and oval holes open
 * beside the midrib.
 */
function heartLeaf(
  b: CornerBuilder,
  layer: CanopyLayer,
  f: Frame,
  length: number,
  options: { readonly splits?: number; readonly width?: number; readonly stem?: Path } = {},
): void {
  const { rand } = b;
  const width = options.width ?? 0.74;
  const splits = options.splits ?? 0;
  const notches: Array<{ t: number; depth: number; width: number }> = [];
  const lobeAngles: number[] = [];
  for (const side of [-1, 1]) {
    for (let k = 0; k < splits; k++) {
      const t = side * (0.6 + (k * 1.6) / splits + (rand() - 0.5) * 0.07);
      // Splits run deepest along the middle of the blade, as on a mature leaf.
      const depth = 0.44 + 0.2 * Math.sin((Math.PI * (k + 0.5)) / splits) + rand() * 0.1;
      notches.push({ t, depth, width: 0.036 + rand() * 0.014 });
      lobeAngles.push(side * (0.6 + ((k + 0.5) * 1.6) / splits));
    }
    if (splits === 0) {
      lobeAngles.push(side * 0.5, side * 1.05, side * 1.6);
    }
  }
  const radiusAt = (t: number): number => {
    let r = heartRadius(t, splits > 0 ? 0.12 : 0.26);
    for (const notch of notches) {
      r *= 1 - notch.depth * slit(t - notch.t, notch.width);
    }
    return r * length;
  };

  const blade: Path = [];
  // Slits are only a few hundredths of a radian wide, so a split blade needs a fine outline.
  const steps = splits > 0 ? 720 : 96;
  for (let i = 0; i < steps; i++) {
    const t = -Math.PI + (TAU * i) / steps;
    const r = radiusAt(t);
    push(blade, f, r * Math.cos(t), r * Math.sin(t) * width);
  }

  const holes: Path[] = [];
  if (splits > 0) {
    for (const t of lobeAngles) {
      if (Math.abs(t) > 1.9 || rand() < 0.25) {
        continue;
      }
      const centre = heartRadius(t, 0) * length * (0.3 + rand() * 0.1);
      const along = length * (0.05 + rand() * 0.025);
      const across = length * 0.019;
      const hole: Path = [];
      for (let i = 0; i < 12; i++) {
        const a = (TAU * i) / 12;
        const rr = centre + Math.cos(a) * along;
        const tt = t + (Math.sin(a) * across) / centre;
        push(hole, f, rr * Math.cos(tt), rr * Math.sin(tt) * width);
      }
      holes.push(hole);
    }
  }

  const veins: Path[] = [];
  const midrib: Path = [];
  push(midrib, f, 0, 0);
  push(midrib, f, radiusAt(0) * 0.94, 0);
  veins.push(midrib);
  for (const t of lobeAngles) {
    const reach = heartRadius(t, 0) * length * 0.8;
    const vein: Path = [];
    // Side veins leave the midrib in turn, the ones bound for the tip farthest along it.
    push(vein, f, length * Math.max(0.03, 0.46 - 0.24 * Math.abs(t)), 0);
    push(vein, f, reach * Math.cos(t), reach * Math.sin(t) * width);
    veins.push(vein);
  }

  b.add(layer, options.stem ? [options.stem, blade] : [blade], holes, veins);
}

/**
 * A long blade along a bowed midrib (banana, bird of paradise). `tears` cuts
 * wind-torn slits that follow the side veins, the mark of a banana leaf.
 */
function bladeLeaf(
  b: CornerBuilder,
  layer: CanopyLayer,
  f: Frame,
  length: number,
  halfWidth: number,
  bow: number,
  tears: number,
): void {
  const { rand } = b;
  const tearsBySide: number[][] = [[], []];
  for (let i = 0; i < tears; i++) {
    tearsBySide[i % 2]?.push(0.22 + rand() * 0.62);
  }
  const edge = (s: number, side: number): number => {
    let w = halfWidth * Math.sin(Math.PI * s ** 0.8) ** 0.6;
    for (const at of tearsBySide[side] ?? []) {
      w *= 1 - 0.86 * slit(s - at, 0.011);
    }
    return w;
  };
  const left: Path = [];
  const right: Path = [];
  const steps = 150;
  for (let i = 0; i <= steps; i++) {
    const s = i / steps;
    const [x, y, tx, ty] = bowedSpine(length, bow, s);
    const wl = edge(s, 0);
    const wr = edge(s, 1);
    // Side veins lean toward the tip, so the margin (and every tear) leans with them.
    push(left, f, x - ty * wl + tx * wl * 0.22, y + tx * wl + ty * wl * 0.22);
    push(right, f, x + ty * wr + tx * wr * 0.22, y - tx * wr + ty * wr * 0.22);
  }
  appendReversed(left, right);

  const veins: Path[] = [];
  const midrib: Path = [];
  for (let i = 0; i <= 16; i++) {
    const [x, y] = bowedSpine(length, bow, i / 16);
    push(midrib, f, x, y);
  }
  veins.push(midrib);
  for (let s = 0.12; s < 0.92; s += 0.1) {
    const [x, y, tx, ty] = bowedSpine(length, bow, s);
    for (const side of [0, 1]) {
      const w = edge(s, side) * 0.9;
      const sign = side === 0 ? 1 : -1;
      const vein: Path = [];
      push(vein, f, x, y);
      push(vein, f, x - sign * ty * w + tx * w * 0.22, y + sign * tx * w + ty * w * 0.22);
      veins.push(vein);
    }
  }
  b.add(layer, [left], [], veins);
}

/**
 * A feather frond: a bowed rachis carrying paired leaflets that sag with
 * gravity. `fern` gives the short, dense, triangular frond of a tree fern;
 * otherwise it is a palm frond, widest past the middle.
 */
function frond(
  b: CornerBuilder,
  layer: CanopyLayer,
  f: Frame,
  length: number,
  bow: number,
  options: { readonly pairs: number; readonly leaflet: number; readonly fern?: boolean },
): void {
  const { pairs, leaflet, fern = false } = options;
  const solids: Path[] = [];
  const rachis: Path = [];
  const rachisRight: Path = [];
  const midrib: Path = [];
  // Gravity in the frond's own frame, so leaflets sag the same way wherever it points.
  const gx = b.gravity * f.sin;
  const gy = b.gravity * f.cos;

  for (let i = 0; i <= 14; i++) {
    const s = i / 14;
    const [x, y, tx, ty] = bowedSpine(length, bow, s);
    const half = length * 0.007 * (1 - 0.85 * s);
    push(rachis, f, x - ty * half, y + tx * half);
    push(rachisRight, f, x + ty * half, y - tx * half);
    push(midrib, f, x, y);
  }
  appendReversed(rachis, rachisRight);
  solids.push(rachis);

  for (let j = 0; j < pairs; j++) {
    const s = 0.07 + (0.91 * j) / pairs;
    const [x, y, tx, ty] = bowedSpine(length, bow, s);
    const envelope = fern
      ? (1 - s) ** 0.75 * Math.min(1, s / 0.1)
      : Math.sin(Math.PI * Math.min(1, s * 1.08)) ** 0.55 * (1.08 - 0.42 * s);
    const len = leaflet * envelope;
    if (len < 0.004) {
      continue;
    }
    const spread = fern ? 1.25 - 0.3 * s : 1.12 - 0.58 * s;
    const blade = len * (fern ? 0.13 : 0.085);
    for (const side of [-1, 1]) {
      const cos = Math.cos(spread);
      const sin = Math.sin(spread) * side;
      let dx = tx * cos - ty * sin + gx * 0.34;
      let dy = tx * sin + ty * cos + gy * 0.34;
      const dl = Math.hypot(dx, dy) || 1;
      dx /= dl;
      dy /= dl;
      const ring: Path = [];
      push(ring, f, x - tx * blade, y - ty * blade);
      push(
        ring,
        f,
        x + dx * len * 0.45 - tx * blade * 1.25,
        y + dy * len * 0.45 - ty * blade * 1.25,
      );
      push(ring, f, x + dx * len, y + dy * len);
      push(
        ring,
        f,
        x + dx * len * 0.45 + tx * blade * 1.25,
        y + dy * len * 0.45 + ty * blade * 1.25,
      );
      push(ring, f, x + tx * blade, y + ty * blade);
      solids.push(ring);
    }
  }
  b.add(layer, solids, [], [midrib]);
}

/** A pleated fan palm (Licuala): a near-circle of blunt, split segments on a thin stalk. */
function fanPalm(b: CornerBuilder, layer: CanopyLayer, f: Frame, radius: number, stem: Path): void {
  const { rand } = b;
  const segments = 13;
  const span = 2.05;
  const step = (span * 2) / segments;
  const blade: Path = [];
  const veins: Path[] = [];
  const polar = (path: Path, r: number, t: number): void =>
    push(path, f, r * Math.cos(t), r * Math.sin(t));

  push(blade, f, 0, 0);
  for (let i = 0; i < segments; i++) {
    const t0 = -span + i * step;
    const reach = radius * (0.9 + rand() * 0.1);
    polar(blade, radius * (0.42 + rand() * 0.14), t0);
    polar(blade, reach * 0.96, t0 + step * 0.2);
    polar(blade, reach, t0 + step * 0.36);
    polar(blade, reach * 0.95, t0 + step * 0.5);
    polar(blade, reach, t0 + step * 0.64);
    polar(blade, reach * 0.96, t0 + step * 0.8);
    const vein: Path = [];
    push(vein, f, 0, 0);
    polar(vein, reach * 0.93, t0 + step * 0.5);
    veins.push(vein);
  }
  polar(blade, radius * 0.45, span);
  b.add(layer, [stem, blade], [], veins);
}

/** A woody vine sagging between two anchors, hung with small heart leaves. */
function liana(
  b: CornerBuilder,
  layer: CanopyLayer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  sag: number,
  leafCount: number,
): void {
  const { rand } = b;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  // `stemRing` bows along its left normal; pick the sign that sags with gravity.
  const bow = (dx >= 0 ? 1 : -1) * b.gravity * sag;
  b.add(layer, [stemRing(x0, y0, x1, y1, bow, len * 0.012, len * 0.008)]);
  const nx = -dy / len;
  const ny = dx / len;
  for (let i = 0; i < leafCount; i++) {
    const s = (i + 0.5 + (rand() - 0.5) * 0.5) / leafCount;
    const arc = 4 * bow * len * s * (1 - s);
    const px = x0 + dx * s + nx * arc;
    const py = y0 + dy * s + ny * arc;
    const dir = (b.gravity * Math.PI) / 2 + (rand() - 0.5) * 1.1;
    heartLeaf(b, layer, frameAt(px, py, dir), len * (0.07 + rand() * 0.05), { width: 0.66 });
  }
}

/** A trailing vine that hangs (or climbs) from `(x, y)` with alternating heart leaves. */
function trailingVine(
  b: CornerBuilder,
  layer: CanopyLayer,
  x: number,
  y: number,
  length: number,
  leafSize: number,
): void {
  const { rand } = b;
  const drift = (rand() - 0.5) * 0.12;
  const endX = x + drift;
  const endY = y + b.gravity * length;
  b.add(layer, [stemRing(x, y, endX, endY, (rand() - 0.5) * 0.12, 0.007, 0.003)]);
  const count = Math.max(3, Math.round(length / (leafSize * 1.15)));
  for (let i = 0; i < count; i++) {
    const s = (i + 0.6) / count;
    const side = i % 2 === 0 ? 1 : -1;
    const dir = (b.gravity * Math.PI) / 2 + side * (0.75 + rand() * 0.35);
    const px = x + drift * s;
    const py = y + b.gravity * length * s;
    heartLeaf(b, layer, frameAt(px, py, dir), leafSize * (0.8 + rand() * 0.4), { width: 0.68 });
  }
}

/** Overhanging canopy for a top corner: arching palm fronds, a banana blade, and hanging vines. */
function buildTopCorner(b: CornerBuilder): void {
  const { rand } = b;
  const j = (amount: number): number => (rand() - 0.5) * amount;

  // Deeper layer first: fronds and heart leaves that read as hazy canopy behind.
  frond(b, 'mid', frameAt(0.34 + j(0.06), -0.06, 0.62 + j(0.1)), 0.62, 0.13, {
    pairs: 20,
    leaflet: 0.15,
  });
  frond(b, 'mid', frameAt(-0.05, 0.34 + j(0.05), 0.2 + j(0.1)), 0.74, 0.11, {
    pairs: 22,
    leaflet: 0.16,
  });
  liana(b, 'mid', 0.3, -0.04, 0.95, 0.03, 0.2, 7);
  trailingVine(b, 'mid', 0.74 + j(0.05), -0.02, 0.36, 0.06);
  bladeLeaf(b, 'mid', frameAt(-0.05, 0.66 + j(0.04), 0.5 + j(0.1)), 0.46, 0.075, 0.1, 3);
  heartLeaf(b, 'mid', frameAt(0.56 + j(0.04), 0.16, 1.2 + j(0.2)), 0.15, {
    stem: stemRing(0.5, -0.04, 0.56, 0.16, 0.1, 0.01, 0.006),
  });

  // Closest layer: the big silhouettes that frame the corner.
  frond(b, 'near', frameAt(-0.07, 0.07 + j(0.03), 0.26 + j(0.06)), 0.97, 0.15, {
    pairs: 24,
    leaflet: 0.21,
  });
  frond(b, 'near', frameAt(-0.03, -0.05, 0.98 + j(0.08)), 0.86, -0.1, {
    pairs: 22,
    leaflet: 0.19,
  });
  frond(b, 'near', frameAt(0.24 + j(0.04), -0.08, 1.3 + j(0.08)), 0.56, 0.08, {
    pairs: 18,
    leaflet: 0.15,
  });
  bladeLeaf(b, 'near', frameAt(-0.06, 0.5 + j(0.04), 0.58 + j(0.08)), 0.6, 0.105, 0.12, 5);
  liana(b, 'near', 0.08, -0.03, 0.9, -0.04, 0.24, 6);
  trailingVine(b, 'near', 0.52 + j(0.05), -0.02, 0.44, 0.075);
  trailingVine(b, 'near', 0.84 + j(0.04), -0.02, 0.26, 0.06);
}

/** Understory for a bottom corner: monstera, a tall banana blade, a fan palm, and ferns. */
function buildBottomCorner(b: CornerBuilder): void {
  const { rand } = b;
  const j = (amount: number): number => (rand() - 0.5) * amount;

  frond(b, 'mid', frameAt(0.22 + j(0.05), -0.06, 1.2 + j(0.08)), 0.92, -0.12, {
    pairs: 24,
    leaflet: 0.17,
  });
  frond(b, 'mid', frameAt(0.42 + j(0.05), -0.06, 0.95 + j(0.08)), 0.7, -0.14, {
    pairs: 20,
    leaflet: 0.15,
  });
  const fanX = 0.63 + j(0.04);
  const fanY = 0.4 + j(0.04);
  fanPalm(
    b,
    'mid',
    frameAt(fanX, fanY, 1.15 + j(0.2)),
    0.2,
    stemRing(0.52, -0.05, fanX, fanY, -0.08, 0.014, 0.008),
  );
  heartLeaf(b, 'mid', frameAt(0.4 + j(0.04), 0.6, 1.85 + j(0.2)), 0.19, {
    width: 0.62,
    stem: stemRing(0.3, -0.05, 0.4, 0.6, 0.06, 0.013, 0.007),
  });
  heartLeaf(b, 'mid', frameAt(0.84 + j(0.03), 0.22, 0.85 + j(0.2)), 0.13, {
    width: 0.62,
    stem: stemRing(0.74, -0.05, 0.84, 0.22, -0.08, 0.011, 0.006),
  });
  for (let i = 0; i < 3; i++) {
    frond(
      b,
      'mid',
      frameAt(0.7 + i * 0.1, -0.04, 1.05 + i * 0.4 + j(0.15)),
      0.3 + rand() * 0.08,
      0.1,
      {
        pairs: 16,
        leaflet: 0.09,
        fern: true,
      },
    );
  }

  bladeLeaf(b, 'near', frameAt(-0.04, 0.02, 1.32 + j(0.06)), 0.92, 0.125, -0.07, 6);
  const m1x = 0.25 + j(0.03);
  const m1y = 0.36 + j(0.03);
  heartLeaf(b, 'near', frameAt(m1x, m1y, 0.92 + j(0.15)), 0.33, {
    splits: 5,
    stem: stemRing(0.04, -0.06, m1x, m1y, -0.07, 0.016, 0.009),
  });
  const m2x = 0.1 + j(0.03);
  const m2y = 0.68 + j(0.03);
  heartLeaf(b, 'near', frameAt(m2x, m2y, 1.4 + j(0.15)), 0.26, {
    splits: 4,
    stem: stemRing(-0.06, 0.3, m2x, m2y, 0.08, 0.014, 0.008),
  });
  const m3x = 0.5 + j(0.03);
  const m3y = 0.19 + j(0.02);
  heartLeaf(b, 'near', frameAt(m3x, m3y, 0.36 + j(0.15)), 0.3, {
    splits: 5,
    stem: stemRing(0.2, -0.07, m3x, m3y, -0.1, 0.015, 0.009),
  });
  for (let i = 0; i < 4; i++) {
    frond(
      b,
      'near',
      frameAt(0.56 + i * 0.11, -0.04, 0.95 + i * 0.36 + j(0.12)),
      0.22 + rand() * 0.1,
      i < 2 ? 0.12 : -0.12,
      { pairs: 15, leaflet: 0.075, fern: true },
    );
  }
}

/** Generates the whole foliage frame. The same seed always grows the same jungle. */
export function buildCanopyFoliage(seed: number = DEFAULT_SEED): readonly CanopyLeaf[] {
  const leaves: CanopyLeaf[] = [];
  for (const [index, corner] of CORNERS.entries()) {
    const builder = new CornerBuilder(corner, createRandom(seed + index * 977));
    if (corner === 'tl' || corner === 'tr') {
      buildTopCorner(builder);
    } else {
      buildBottomCorner(builder);
    }
    leaves.push(...builder.leaves);
  }
  return leaves;
}

let defaultFoliage: readonly CanopyLeaf[] | undefined;

/** The built-in jungle, grown on first use and shared by every renderer. */
export function canopyFoliage(): readonly CanopyLeaf[] {
  defaultFoliage ??= buildCanopyFoliage();
  return defaultFoliage;
}

function tracePath(g: CanvasRenderingContext2D, points: Float32Array, size: number): void {
  g.moveTo((points[0] ?? 0) * size, (points[1] ?? 0) * size);
  for (let i = 2; i < points.length; i += 2) {
    g.lineTo((points[i] ?? 0) * size, (points[i + 1] ?? 0) * size);
  }
}

function traceLeaf(g: CanvasRenderingContext2D, leaf: CanopyLeaf, size: number): void {
  g.beginPath();
  for (const ring of leaf.rings) {
    tracePath(g, ring, size);
    g.closePath();
  }
}

/** Traces the midrib (`side === false`) or every side vein (`side === true`) of `leaf`. */
function traceVeins(
  g: CanvasRenderingContext2D,
  leaf: CanopyLeaf,
  size: number,
  side: boolean,
): void {
  g.beginPath();
  for (const [index, vein] of leaf.veins.entries()) {
    if (index > 0 === side) {
      tracePath(g, vein, size);
    }
  }
}

function channel(value: number): number {
  return Math.round(clamp(value, 0, 1) * 255);
}

/**
 * Levels of the data texture. In blue, a near leaf's tone sits in the low band
 * (`min..max`) with its veins above it. In green, a mid leaf's tone runs from
 * `mid` up to `1`, so any coverage at all reads as "leaf".
 */
export const CANOPY_TONE_BAND = {
  min: 0.1,
  max: 0.45,
  sideVein: 0.68,
  midrib: 1,
  mid: 0.55,
} as const;

/**
 * Paints the foliage as a data texture for the shader: red holds the near
 * layer's coverage, green the mid layer's coverage and tone, and blue the near
 * layer's tone and veins. Canvas cannot write one channel alone, so each shape
 * first multiplies its own channels away under itself and then adds its values,
 * which keeps overlapping leaves at separate tones instead of one flat mass.
 */
export function paintCanopyAtlas(
  g: CanvasRenderingContext2D,
  size: number,
  leaves: readonly CanopyLeaf[] = canopyFoliage(),
): void {
  const band = CANOPY_TONE_BAND;
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#000000';
  g.fillRect(0, 0, size, size);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const strokeBlue = (level: number, width: number): void => {
    g.lineWidth = Math.max(1, size * width);
    g.globalCompositeOperation = 'multiply';
    g.strokeStyle = '#ffff00';
    g.stroke();
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = `rgb(0,0,${channel(level)})`;
    g.stroke();
  };
  for (const leaf of leaves) {
    traceLeaf(g, leaf, size);
    g.globalCompositeOperation = 'multiply';
    if (leaf.layer === 'mid') {
      g.fillStyle = '#ff00ff';
      g.fill();
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = `rgb(0,${channel(band.mid + leaf.tone * (1 - band.mid))},0)`;
      g.fill();
      continue;
    }
    g.fillStyle = '#00ff00';
    g.fill();
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = `rgb(255,0,${channel(band.min + leaf.tone * (band.max - band.min))})`;
    g.fill();
    traceVeins(g, leaf, size, true);
    strokeBlue(band.sideVein, 0.0013);
    traceVeins(g, leaf, size, false);
    strokeBlue(band.midrib, 0.002);
  }
  g.globalCompositeOperation = 'source-over';
}

export interface CanopyTint {
  /** Leaf body for the darkest leaves in the layer. */
  readonly shade: Rgb;
  /** Leaf body for the brightest leaves in the layer. */
  readonly lit: Rgb;
  /** Vein stroke; omit to leave a hazy layer unveined. */
  readonly vein?: Rgb;
}

/** Paints one foliage layer in real colours for the Canvas 2D fallback renderer. */
export function paintCanopyLayer(
  g: CanvasRenderingContext2D,
  size: number,
  layer: CanopyLayer,
  tint: CanopyTint,
  leaves: readonly CanopyLeaf[] = canopyFoliage(),
): void {
  g.clearRect(0, 0, size, size);
  g.globalCompositeOperation = 'source-over';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const leaf of leaves) {
    if (leaf.layer !== layer) {
      continue;
    }
    traceLeaf(g, leaf, size);
    g.fillStyle = rgbCss(mixRgb(tint.shade, tint.lit, leaf.tone));
    g.fill();
    if (tint.vein) {
      traceVeins(g, leaf, size, true);
      g.lineWidth = Math.max(1, size * 0.0013);
      g.strokeStyle = rgbCss(tint.vein, 0.16);
      g.stroke();
      traceVeins(g, leaf, size, false);
      g.lineWidth = Math.max(1, size * 0.002);
      g.strokeStyle = rgbCss(tint.vein, 0.32);
      g.stroke();
    }
  }
}
