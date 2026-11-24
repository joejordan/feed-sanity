// High-craft swaying palm silhouettes for the Vice Horizon backdrop: tapered
// curved trunks with ring texture and sunset rim light, layered pinnate fronds
// built from individually tapered leaflets, and a coconut cluster.

import type { RandomSource } from '../digital-rain/math';

export interface Frond {
  /** Launch angle in canvas radians (0 = right, -PI/2 = up). */
  readonly angle: number;
  /** Length as a fraction of the palm's frond reach. */
  readonly length: number;
  readonly droop: number;
  readonly phase: number;
}

export interface Palm {
  readonly baseX: number;
  readonly baseY: number;
  readonly height: number;
  /** Horizontal crown offset as a fraction of height (+ leans right). */
  readonly lean: number;
  /** S-curve strength of the trunk as a fraction of height. */
  readonly bend: number;
  /** Frond reach in CSS px. */
  readonly reach: number;
  readonly fronds: readonly Frond[];
  /** +1 when the sun is to the palm's right (left-margin palms), -1 otherwise. */
  readonly sunSide: 1 | -1;
  /** Back-row palms sit deeper (less parallax, softer silhouette). */
  readonly back: boolean;
  readonly leaflets: number;
  readonly silhouette: string;
  readonly rim: string;
  readonly phase: number;
}

const TRUNK_SAMPLES = 22;

// A full fountain crown: upper fronds arch over, lower fronds hang. Mirrored per side.
const FROND_ANGLES = [
  -2.88, -2.55, -2.24, -1.96, -1.7, -1.46, -1.22, -0.96, -0.68, -0.38, -0.08, 0.24, 2.96,
];

export function createFronds(rand: RandomSource, mirrored: boolean): Frond[] {
  return FROND_ANGLES.map((base) => {
    const angle = mirrored ? -Math.PI - base : base;
    const horizontal = Math.abs(Math.cos(angle));
    return {
      angle: angle + (rand() - 0.5) * 0.12,
      length: (0.82 + rand() * 0.18) * (0.78 + 0.22 * horizontal),
      droop: 0.2 + 0.42 * horizontal + rand() * 0.08,
      phase: rand() * Math.PI * 2,
    };
  });
}

interface Point {
  x: number;
  y: number;
}

/** Per-leaflet constants that depend only on the leaflet index, shared by every frond. */
interface LeafletTable {
  readonly t: Float64Array;
  /** Length factor (envelope × taper × 0.22) as a share of the frond length. */
  readonly length: Float64Array;
  readonly cos: Float64Array;
  readonly sin: Float64Array;
  /** Downward pull that bends leaflets into a drooping V, like a feather seen edge-on. */
  readonly droop: Float64Array;
}

const leafletTables = new Map<number, LeafletTable>();

function leafletTable(count: number): LeafletTable {
  const cached = leafletTables.get(count);
  if (cached) {
    return cached;
  }
  const table: LeafletTable = {
    t: new Float64Array(count),
    length: new Float64Array(count),
    cos: new Float64Array(count),
    sin: new Float64Array(count),
    droop: new Float64Array(count),
  };
  for (let j = 0; j < count; j++) {
    const t = 0.1 + (0.88 * j) / count;
    const spread = 1.02 - 0.42 * t;
    table.t[j] = t;
    table.length[j] = 0.22 * Math.sin(Math.PI * Math.min(1, t * 1.1)) ** 0.6 * (1.1 - 0.4 * t);
    table.cos[j] = Math.cos(spread);
    table.sin[j] = Math.sin(spread);
    table.droop[j] = 0.42 + 0.3 * t;
  }
  leafletTables.set(count, table);
  return table;
}

function cubic(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

function cubicSlope(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return 3 * u * u * (p1 - p0) + 6 * u * t * (p2 - p1) + 3 * t * t * (p3 - p2);
}

export function drawPalm(
  c: CanvasRenderingContext2D,
  palm: Palm,
  sway: number,
  time: number,
  shiftX: number,
  shiftY: number,
): void {
  const h = palm.height;
  const bx = palm.baseX + shiftX;
  const by = palm.baseY + shiftY * 0.3;
  const topX = bx + palm.lean * h + sway * h * 0.011;
  const topY = by - h + shiftY * 0.7;
  const c1x = bx + palm.lean * h * 0.05;
  const c1y = by - h * 0.34;
  const c2x = bx + palm.lean * h * 0.72 + palm.bend * h + sway * h * 0.004;
  const c2y = by - h * 0.72;
  const baseW = Math.min(30, Math.max(7, h * 0.03));

  // Trunk outline sampled along the curve with a gentle taper and root flare.
  const left: Point[] = [];
  const right: Point[] = [];
  const center: Point[] = [];
  const normals: Point[] = [];
  const widths: number[] = [];
  for (let i = 0; i <= TRUNK_SAMPLES; i++) {
    const t = i / TRUNK_SAMPLES;
    const x = cubic(bx, c1x, c2x, topX, t);
    const y = cubic(by, c1y, c2y, topY, t);
    const dx = cubicSlope(bx, c1x, c2x, topX, t);
    const dy = cubicSlope(by, c1y, c2y, topY, t);
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const flare = t < 0.07 ? 1 + (0.07 - t) * 5 : 1;
    const half = (baseW * (1 - 0.52 * t) * flare) / 2;
    center.push({ x, y });
    normals.push({ x: nx, y: ny });
    widths.push(half);
    left.push({ x: x - nx * half, y: y - ny * half });
    right.push({ x: x + nx * half, y: y + ny * half });
  }

  c.fillStyle = palm.silhouette;
  c.beginPath();
  for (const [i, p] of left.entries()) {
    if (i === 0) {
      c.moveTo(p.x, p.y);
    } else {
      c.lineTo(p.x, p.y);
    }
  }
  for (let i = right.length - 1; i >= 0; i--) {
    const p = right[i];
    if (p) {
      c.lineTo(p.x, p.y);
    }
  }
  c.closePath();
  c.fill();

  // Sunset rim light along the sun-facing edge, brightening toward the crown.
  const rimEdge = palm.sunSide === 1 ? right : left;
  const rimGradient = c.createLinearGradient(bx, by, topX, topY);
  rimGradient.addColorStop(0, 'rgba(255,120,110,0)');
  rimGradient.addColorStop(0.35, 'rgba(255,120,110,0.18)');
  rimGradient.addColorStop(1, palm.rim);
  c.strokeStyle = rimGradient;
  c.lineWidth = 1.3;
  c.lineJoin = 'round';
  c.beginPath();
  for (const [i, p] of rimEdge.entries()) {
    if (i === 0) {
      c.moveTo(p.x, p.y);
    } else {
      c.lineTo(p.x, p.y);
    }
  }
  c.stroke();

  // Trunk rings catch the rim light on the sun-facing half only.
  c.lineWidth = 0.8;
  c.beginPath();
  const side = palm.sunSide;
  for (let i = 2; i < TRUNK_SAMPLES; i++) {
    const p = center[i];
    const n = normals[i];
    const half = widths[i];
    if (!p || !n || half === undefined) {
      continue;
    }
    const ex = p.x + n.x * half * side;
    const ey = p.y + n.y * half * side;
    c.moveTo(p.x + n.x * half * 0.1 * side, p.y + n.y * half * 0.1 * side + half * 0.25);
    c.quadraticCurveTo(p.x + n.x * half * 0.6 * side, p.y + half * 0.45, ex, ey);
  }
  c.stroke();

  // Fronds: rachis curves with tapered, gravity-drooped leaflets on both sides.
  const crown = { x: topX, y: topY };
  c.beginPath();
  const ribs: Array<readonly [number, number, number, number, number, number]> = [];
  for (const frond of palm.fronds) {
    const flutter = Math.sin(time * 1.15 + frond.phase + palm.phase) * 0.018;
    const ang = frond.angle + sway * 0.045 + flutter;
    const len = palm.reach * frond.length;
    const dirX = Math.cos(ang);
    const dirY = Math.sin(ang);
    // Fountain arch: rise along the launch direction, then sweep outward and droop.
    const side = dirX >= 0 ? 1 : -1;
    const p1x = crown.x + dirX * len * 0.5;
    const p1y = crown.y + dirY * len * 0.5;
    const p2x = crown.x + side * len * (0.55 + 0.45 * Math.abs(dirX));
    const p2y = crown.y + dirY * len * 0.2 + len * (frond.droop + flutter * 2);
    ribs.push([crown.x, crown.y, p1x, p1y, p2x, p2y]);

    const leaves = leafletTable(palm.leaflets);
    const blade = Math.max(1.1, len * 0.011);
    for (let j = 0; j < palm.leaflets; j++) {
      const t = leaves.t[j] ?? 0;
      const leafLen = len * (leaves.length[j] ?? 0);
      if (leafLen < 1.5) {
        continue;
      }
      const u = 1 - t;
      const bxp = u * u * crown.x + 2 * u * t * p1x + t * t * p2x;
      const byp = u * u * crown.y + 2 * u * t * p1y + t * t * p2y;
      let tx = 2 * u * (p1x - crown.x) + 2 * t * (p2x - p1x);
      let ty = 2 * u * (p1y - crown.y) + 2 * t * (p2y - p1y);
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      const cos = leaves.cos[j] ?? 1;
      const droop = leaves.droop[j] ?? 0;
      // Two leaflets per node, mirrored across the rachis (sin is odd in the spread angle).
      for (let side = -1; side <= 1; side += 2) {
        const sin = (leaves.sin[j] ?? 0) * side;
        let dx = tx * cos - ty * sin;
        let dy = tx * sin + ty * cos + droop;
        const dl = Math.hypot(dx, dy) || 1;
        dx /= dl;
        dy /= dl;
        const tipX = bxp + dx * leafLen;
        const tipY = byp + dy * leafLen;
        const midX = bxp + dx * leafLen * 0.5;
        const midY = byp + dy * leafLen * 0.5 + leafLen * 0.08;
        c.moveTo(bxp - tx * blade, byp - ty * blade);
        c.quadraticCurveTo(midX - tx * blade * 0.5, midY - ty * blade * 0.5, tipX, tipY);
        c.quadraticCurveTo(
          midX + tx * blade,
          midY + ty * blade,
          bxp + tx * blade,
          byp + ty * blade,
        );
        c.closePath();
      }
    }
  }
  c.fill();

  c.strokeStyle = palm.silhouette;
  c.lineWidth = Math.max(1.4, h * 0.0055);
  c.lineCap = 'round';
  c.beginPath();
  for (const [x0, y0, x1, y1, x2, y2] of ribs) {
    c.moveTo(x0, y0);
    c.quadraticCurveTo(x1, y1, x2, y2);
  }
  c.stroke();

  // Faint rim along the upper edge of each rachis.
  c.strokeStyle = palm.rim;
  c.globalAlpha = 0.42;
  c.lineWidth = 0.8;
  c.beginPath();
  for (const [x0, y0, x1, y1, x2, y2] of ribs) {
    c.moveTo(x0, y0 - 1);
    c.quadraticCurveTo(x1, y1 - 1.2, x2, y2 - 0.8);
  }
  c.stroke();
  c.globalAlpha = 1;
  c.lineCap = 'butt';

  // Crown bulb and coconut cluster where the fronds meet the trunk.
  c.fillStyle = palm.silhouette;
  c.beginPath();
  c.ellipse(topX, topY + baseW * 0.15, baseW * 0.62, baseW * 0.85, 0, 0, Math.PI * 2);
  c.fill();
  const nut = baseW * 0.36;
  c.beginPath();
  for (const [ox, oy] of [
    [-0.7, 0.55],
    [0.15, 0.85],
    [0.8, 0.5],
    [-0.1, 0.25],
  ] as const) {
    const x = topX + ox * baseW * 0.7;
    const y = topY + oy * baseW * 0.8;
    c.moveTo(x + nut, y);
    c.arc(x, y, nut, 0, Math.PI * 2);
  }
  c.fill();
}
