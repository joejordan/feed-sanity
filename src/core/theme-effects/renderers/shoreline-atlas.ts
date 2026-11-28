// Procedural coastal botanical & marine detail atlas for the Coral Shoreline
// backdrop. Zero external assets, Trusted Types safe (Canvas 2D vector geometry
// only), generated once and shared by both the WebGL data texture and the
// Canvas 2D fallback renderer.
//
// RGB channels in the 1024×1024 shader atlas:
//   - R: Feathered coconut palm fronds overhanging the beach corners (cast as
//        swaying, wave-refracted sunlit shadows across sand & shallow water).
//   - G: Coral-sand treasures (ribbed scallop shells, five-armed sea stars,
//        spiral shells, and water-worn pebbles) stored as shaded relief height.
//   - B: Submerged coral reef formations (staghorn branches & fluted brain
//        coral domes) along the deeper lagoon margin.

import type { Rgb } from './palette';
import { createRandom } from '../digital-rain/math';
import { mixRgb, rgbCss } from './palette';

const TAU = Math.PI * 2;
const ATLAS_SEED = 0x5c_0a_57_a1;
const LEAFLET_NORM = Math.hypot(0.48, 0.88);
const LEAFLET_FWD = 0.48 / LEAFLET_NORM;
const LEAFLET_SIDE = 0.88 / LEAFLET_NORM;

export interface PalmFrondSpec {
  readonly ox: number;
  readonly oy: number;
  readonly angle: number;
  readonly length: number;
  readonly bow: number;
  readonly leafletCount: number;
  readonly leafletLength: number;
  readonly droop: number;
}

export interface ShoreShellSpec {
  readonly kind: 'scallop' | 'starfish' | 'spiral' | 'pebble';
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly rotation: number;
  readonly tone: number;
}

export interface ReefHeadSpec {
  readonly kind: 'brain' | 'staghorn';
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly rotation: number;
  readonly branches: number;
  readonly tone: number;
}

export interface ShorelineArt {
  readonly fronds: readonly PalmFrondSpec[];
  readonly shells: readonly ShoreShellSpec[];
  readonly reef: readonly ReefHeadSpec[];
}

/** Builds deterministic palm fronds, beach shells/starfish, and submerged coral heads. */
export function buildShorelineArt(seed = ATLAS_SEED): ShorelineArt {
  const rand = createRandom(seed);

  // Overhanging coconut palm fronds fanning out from upper-left & lower-left beach corners.
  const fronds: PalmFrondSpec[] = [
    // Upper-left crown arching gently across the sunlit sand into the shallows
    {
      ox: -0.04,
      oy: -0.02,
      angle: 0.42,
      length: 0.44,
      bow: 0.12,
      leafletCount: 28,
      leafletLength: 0.088,
      droop: 0.26,
    },
    {
      ox: -0.03,
      oy: 0.04,
      angle: 0.78,
      length: 0.39,
      bow: 0.14,
      leafletCount: 24,
      leafletLength: 0.078,
      droop: 0.3,
    },
    {
      ox: 0.06,
      oy: -0.04,
      angle: 1.05,
      length: 0.34,
      bow: -0.09,
      leafletCount: 22,
      leafletLength: 0.072,
      droop: 0.22,
    },
    // Lower-left beach palm reaching up and rightward over the wet tide line
    {
      ox: -0.04,
      oy: 1.03,
      angle: -0.44,
      length: 0.45,
      bow: -0.11,
      leafletCount: 28,
      leafletLength: 0.09,
      droop: 0.24,
    },
    {
      ox: 0.04,
      oy: 1.04,
      angle: -0.84,
      length: 0.36,
      bow: 0.1,
      leafletCount: 24,
      leafletLength: 0.074,
      droop: 0.25,
    },
    {
      ox: -0.05,
      oy: 0.9,
      angle: -0.14,
      length: 0.35,
      bow: -0.13,
      leafletCount: 22,
      leafletLength: 0.07,
      droop: 0.28,
    },
  ];

  // Delicate sun-bleached shells, sea stars, and smooth coral pebbles tucked along the lower & outer beach edge.
  const shells: ShoreShellSpec[] = [
    { kind: 'starfish', x: 0.095, y: 0.82, radius: 0.017, rotation: 0.35, tone: 0.94 },
    { kind: 'scallop', x: 0.165, y: 0.73, radius: 0.012, rotation: -0.5, tone: 0.78 },
    { kind: 'spiral', x: 0.055, y: 0.56, radius: 0.011, rotation: 1.1, tone: 0.74 },
    { kind: 'scallop', x: 0.048, y: 0.22, radius: 0.012, rotation: 0.65, tone: 0.76 },
    { kind: 'starfish', x: 0.042, y: 0.69, radius: 0.013, rotation: -0.9, tone: 0.9 },
    { kind: 'spiral', x: 0.19, y: 0.91, radius: 0.011, rotation: -1.4, tone: 0.75 },
    { kind: 'scallop', x: 0.125, y: 0.93, radius: 0.011, rotation: 2.1, tone: 0.72 },
  ];
  for (let i = 0; i < 14; i++) {
    shells.push({
      kind: 'pebble',
      x: 0.015 + rand() * 0.18,
      y: 0.06 + rand() * 0.88,
      radius: 0.0028 + rand() * 0.0042,
      rotation: rand() * TAU,
      tone: 0.4 + rand() * 0.32,
    });
  }

  // Submerged reef formations tucked into the deep right-side lagoon corners.
  const reef: ReefHeadSpec[] = [
    { kind: 'staghorn', x: 0.93, y: 0.16, radius: 0.095, rotation: -0.6, branches: 7, tone: 0.92 },
    { kind: 'brain', x: 0.85, y: 0.11, radius: 0.056, rotation: 0.4, branches: 6, tone: 0.78 },
    { kind: 'staghorn', x: 0.95, y: 0.31, radius: 0.075, rotation: 0.8, branches: 6, tone: 0.82 },
    { kind: 'brain', x: 0.91, y: 0.78, radius: 0.068, rotation: -0.3, branches: 7, tone: 0.88 },
    { kind: 'staghorn', x: 0.84, y: 0.87, radius: 0.086, rotation: 1.9, branches: 7, tone: 0.85 },
    { kind: 'brain', x: 0.96, y: 0.9, radius: 0.062, rotation: 1.1, branches: 6, tone: 0.74 },
    { kind: 'staghorn', x: 0.79, y: 0.06, radius: 0.062, rotation: -1.2, branches: 5, tone: 0.7 },
    { kind: 'brain', x: 0.78, y: 0.94, radius: 0.05, rotation: 0.2, branches: 5, tone: 0.68 },
  ];

  return { fronds, shells, reef };
}

let cachedArt: ShorelineArt | null = null;

/** Shared coastal art geometry, built once per runtime. */
export function shorelineArt(): ShorelineArt {
  cachedArt ??= buildShorelineArt();
  return cachedArt;
}

/** Draws one feathered coconut palm frond (curved rachis + tapering paired leaflets). */
function tracePalmFrond(
  g: CanvasRenderingContext2D,
  frond: PalmFrondSpec,
  size: number,
  fillStyle: string,
): void {
  const ox = frond.ox * size;
  const oy = frond.oy * size;
  const len = frond.length * size;
  const cos = Math.cos(frond.angle);
  const sin = Math.sin(frond.angle);

  const spinePoint = (s: number): readonly [number, number, number, number] => {
    const lx = len * s;
    const ly = 4 * frond.bow * len * s * (1 - s);
    const dly = 4 * frond.bow * (1 - 2 * s);
    const tl = Math.hypot(1, dly);
    const tx = 1 / tl;
    const ty = dly / tl;
    return [
      ox + lx * cos - ly * sin,
      oy + lx * sin + ly * cos,
      tx * cos - ty * sin,
      tx * sin + ty * cos,
    ];
  };

  g.fillStyle = fillStyle;
  g.strokeStyle = fillStyle;
  g.lineCap = 'round';

  // Tapered curved central rachis
  g.beginPath();
  const [x0, y0] = spinePoint(0);
  g.moveTo(x0, y0);
  for (let i = 1; i <= 14; i++) {
    const [px, py] = spinePoint(i / 14);
    g.lineTo(px, py);
  }
  g.lineWidth = Math.max(1.6, size * 0.0055);
  g.stroke();

  // Paired slender coconut leaflets fanning along both sides of the rachis
  const count = frond.leafletCount;
  const maxBlade = frond.leafletLength * size;
  for (let i = 1; i < count; i++) {
    const s = 0.08 + (i / count) * 0.9;
    const [bx, by, tx, ty] = spinePoint(s);
    const env = Math.sin(Math.PI * s ** 0.72);
    const bladeLen = maxBlade * (0.26 + 0.74 * env);
    const bladeWidth = Math.max(1.4, size * 0.0052 * (0.45 + 0.55 * env));
    const nx = -ty;
    const ny = tx;

    for (const side of [-1, 1] as const) {
      // Leaflets sweep forward along the frond and droop gently at their tips
      const ux = tx * LEAFLET_FWD + nx * side * LEAFLET_SIDE;
      const uy = ty * LEAFLET_FWD + ny * side * LEAFLET_SIDE;
      const px = -uy * side;
      const py = ux * side;

      const midX = bx + ux * bladeLen * 0.55 + px * bladeLen * frond.droop * 0.45;
      const midY = by + uy * bladeLen * 0.55 + py * bladeLen * frond.droop * 0.45;
      const tipX = bx + ux * bladeLen + px * bladeLen * frond.droop;
      const tipY = by + uy * bladeLen + py * bladeLen * frond.droop;

      g.beginPath();
      g.moveTo(bx, by);
      g.quadraticCurveTo(midX + px * bladeWidth, midY + py * bladeWidth, tipX, tipY);
      g.quadraticCurveTo(midX - px * bladeWidth * 0.55, midY - py * bladeWidth * 0.55, bx, by);
      g.closePath();
      g.fill();
    }
  }
}

function paintShell(
  g: CanvasRenderingContext2D,
  shell: ShoreShellSpec,
  size: number,
  colorForTone: (tone: number) => string,
): void {
  const cx = shell.x * size;
  const cy = shell.y * size;
  const r = shell.radius * size;
  g.save();
  g.translate(cx, cy);
  g.rotate(shell.rotation);

  switch (shell.kind) {
    case 'starfish': {
      g.fillStyle = colorForTone(shell.tone);
      g.beginPath();
      const arms = 5;
      for (let i = 0; i < arms * 2; i++) {
        const a = (i * Math.PI) / arms;
        const rad = i % 2 === 0 ? r : r * 0.34;
        const px = Math.cos(a) * rad;
        const py = Math.sin(a) * rad;
        if (i === 0) {
          g.moveTo(px, py);
        } else {
          g.lineTo(px, py);
        }
      }
      g.closePath();
      g.fill();
      g.fillStyle = colorForTone(Math.min(1, shell.tone * 1.05));
      g.beginPath();
      g.arc(0, 0, r * 0.28, 0, TAU);
      g.fill();
      break;
    }
    case 'scallop': {
      g.fillStyle = colorForTone(shell.tone * 0.82);
      g.beginPath();
      g.moveTo(0, r * 0.72);
      g.arc(0, r * 0.15, r * 0.92, -Math.PI * 0.86, -Math.PI * 0.14);
      g.closePath();
      g.fill();
      g.strokeStyle = colorForTone(shell.tone);
      g.lineWidth = Math.max(1, r * 0.12);
      for (let i = -3; i <= 3; i++) {
        const a = -Math.PI / 2 + i * 0.24;
        g.beginPath();
        g.moveTo(0, r * 0.62);
        g.lineTo(Math.cos(a) * r * 0.84, r * 0.15 + Math.sin(a) * r * 0.84);
        g.stroke();
      }
      break;
    }
    case 'spiral':
      g.fillStyle = colorForTone(shell.tone);
      g.beginPath();
      g.moveTo(r * 1.15, 0);
      g.quadraticCurveTo(0, -r * 0.56, -r * 0.72, 0);
      g.quadraticCurveTo(0, r * 0.56, r * 1.15, 0);
      g.closePath();
      g.fill();
      break;
    case 'pebble':
      g.fillStyle = colorForTone(shell.tone);
      g.beginPath();
      g.ellipse(0, 0, r, r * 0.72, 0, 0, TAU);
      g.fill();
      break;
  }
  g.restore();
}

function paintReefHead(
  g: CanvasRenderingContext2D,
  head: ReefHeadSpec,
  size: number,
  colorForTone: (tone: number) => string,
): void {
  const cx = head.x * size;
  const cy = head.y * size;
  const r = head.radius * size;
  g.save();
  g.translate(cx, cy);
  g.rotate(head.rotation);

  if (head.kind === 'brain') {
    // Organic lobed dome with fluted crown
    g.fillStyle = colorForTone(head.tone * 0.65);
    g.beginPath();
    const lobes = head.branches * 2;
    for (let i = 0; i <= lobes * 4; i++) {
      const a = (i / (lobes * 4)) * TAU;
      const rad = r * (0.86 + 0.14 * Math.sin(a * head.branches));
      const px = Math.cos(a) * rad;
      const py = Math.sin(a) * rad * 0.88;
      if (i === 0) {
        g.moveTo(px, py);
      } else {
        g.lineTo(px, py);
      }
    }
    g.closePath();
    g.fill();
    g.fillStyle = colorForTone(head.tone);
    g.beginPath();
    g.ellipse(-r * 0.08, -r * 0.08, r * 0.62, r * 0.54, 0.3, 0, TAU);
    g.fill();
  } else {
    // Branching staghorn coral arms with forked tips
    g.strokeStyle = colorForTone(head.tone);
    g.lineCap = 'round';
    for (let i = 0; i < head.branches; i++) {
      const a = (i / head.branches) * TAU + (i % 2 === 0 ? 0.12 : -0.1);
      const armLen = r * (0.68 + (0.3 * ((i * 37) % 10)) / 10);
      const mx = Math.cos(a) * armLen * 0.56;
      const my = Math.sin(a) * armLen * 0.56;
      const ex = Math.cos(a + 0.12) * armLen;
      const ey = Math.sin(a + 0.12) * armLen;
      g.lineWidth = Math.max(2, r * 0.16);
      g.beginPath();
      g.moveTo(0, 0);
      g.quadraticCurveTo(mx * 0.9, my * 1.08, ex, ey);
      g.stroke();

      // Secondary fork
      const fx = mx + Math.cos(a - 0.52) * armLen * 0.45;
      const fy = my + Math.sin(a - 0.52) * armLen * 0.45;
      g.lineWidth = Math.max(1.5, r * 0.11);
      g.beginPath();
      g.moveTo(mx, my);
      g.lineTo(fx, fy);
      g.stroke();
    }
    g.fillStyle = colorForTone(head.tone);
    g.beginPath();
    g.arc(0, 0, r * 0.24, 0, TAU);
    g.fill();
  }
  g.restore();
}

/**
 * Paints the 3-channel GPU data texture (`R` = palm frond shadows, `G` = beach
 * shells & sea stars, `B` = submerged coral reef heads). Never calls `clearRect`
 * so the opaque black base stays intact for additive channel writes.
 */
export function paintShorelineAtlas(
  g: CanvasRenderingContext2D,
  size: number,
  art: ShorelineArt = shorelineArt(),
): void {
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#000000';
  g.fillRect(0, 0, size, size);

  // Additive channel writes keep R, G, and B strictly independent.
  g.globalCompositeOperation = 'lighter';

  // Red channel: feathered coconut palm shadows
  for (const frond of art.fronds) {
    tracePalmFrond(g, frond, size, 'rgb(210,0,0)');
  }

  // Green channel: coral-sand shells, sea stars & smooth pebbles
  for (const shell of art.shells) {
    paintShell(g, shell, size, (tone) => `rgb(0,${Math.round(tone * 255)},0)`);
  }

  // Blue channel: submerged coral reef formations
  for (const head of art.reef) {
    paintReefHead(g, head, size, (tone) => `rgb(0,0,${Math.round(tone * 255)})`);
  }

  g.restore();
}

/** Paints tinted coconut palm frond shadows onto a Canvas 2D sprite layer. */
export function paintPalmShadowLayer(
  g: CanvasRenderingContext2D,
  size: number,
  color: Rgb,
  art: ShorelineArt = shorelineArt(),
): void {
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, size, size);
  const fill = rgbCss(color, 0.85);
  for (const frond of art.fronds) {
    tracePalmFrond(g, frond, size, fill);
  }
  g.restore();
}

/** Paints shells, sea stars, and submerged reef heads for the Canvas 2D fallback. */
export function paintShoreDetailsLayer(
  g: CanvasRenderingContext2D,
  size: number,
  colors: {
    readonly shell: Rgb;
    readonly coral: Rgb;
    readonly reef: Rgb;
  },
  art: ShorelineArt = shorelineArt(),
): void {
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, size, size);
  for (const shell of art.shells) {
    const base = shell.kind === 'starfish' ? colors.coral : colors.shell;
    paintShell(g, shell, size, (tone) =>
      rgbCss(mixRgb(base, colors.coral, (1 - tone) * 0.2), 0.78),
    );
  }
  for (const head of art.reef) {
    paintReefHead(g, head, size, (tone) =>
      rgbCss(mixRgb(colors.reef, colors.coral, tone * 0.35), 0.45 * tone),
    );
  }
  g.restore();
}
