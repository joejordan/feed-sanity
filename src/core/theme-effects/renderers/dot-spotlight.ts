// Dot Spotlight: a crisp architectural dot grid with a vignette falloff and a
// damped cursor spotlight that tints nearby dots (after Aceternity "Dot
// Background"). Renders on demand only, so a resting pointer costs nothing.

import type { Layer } from './canvas';
import type { Rgb, ScenePalette } from './palette';
import type { Scene, SceneFactory, SceneSpec } from './scene-host';
import { createLayer } from './canvas';
import { mixRgb, rgbCss, WHITE } from './palette';

const SPACING = 22;
const SPOT_RADIUS = 250;

function dotTile(doc: Document, size: number, radius: number, color: string): Layer | null {
  const tile = createLayer(doc, size, size);
  if (tile) {
    tile.g.fillStyle = color;
    tile.g.beginPath();
    tile.g.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
    tile.g.fill();
  }
  return tile;
}

/** Spotlight assets: depend on palette and pixel ratio, never on pointer position. */
interface SpotPaints {
  readonly spot: Layer;
  readonly lit: CanvasPattern;
  /** Unit-alpha mask centered in the spot layer; presence rides globalAlpha. */
  readonly mask: CanvasGradient;
  /** Accent glow around the origin, drawn under a translate to the pointer. */
  readonly glow: CanvasGradient;
}

function spotPaints(doc: Document, palette: ScenePalette, ratio: number) {
  const light = palette.scheme === 'light';
  const tileSize = Math.max(4, Math.round(SPACING * ratio));
  const litColor: Rgb = light ? palette.accent : mixRgb(palette.accent, WHITE, 0.25);
  const tile = dotTile(doc, tileSize, Math.max(0.8, 1.5 * ratio), rgbCss(litColor));
  const r = SPOT_RADIUS * ratio;
  const spot = createLayer(doc, Math.ceil(r * 2), Math.ceil(r * 2));
  const lit = tile && spot ? spot.g.createPattern(tile.canvas, 'repeat') : null;
  if (!spot || !lit) {
    return null;
  }
  const mask = spot.g.createRadialGradient(r, r, 0, r, r, r);
  mask.addColorStop(0, 'rgba(0,0,0,0.9)');
  mask.addColorStop(0.45, 'rgba(0,0,0,0.4)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  const glow = spot.g.createRadialGradient(0, 0, 0, 0, 0, r * 1.1);
  glow.addColorStop(0, rgbCss(palette.accent, light ? 0.06 : 0.09));
  glow.addColorStop(1, rgbCss(palette.accent, 0));
  return { spot, lit, mask, glow } satisfies SpotPaints;
}

/**
 * The static dot field: a crisp pattern that stays bright in the gutters,
 * recedes behind the centered reading column (where frosted glass would blur
 * it into texture), and dissolves at the outer edges.
 */
function dotBase(
  doc: Document,
  palette: ScenePalette,
  width: number,
  height: number,
  ratio: number,
): Layer | null {
  const base = createLayer(doc, width, height);
  const tileSize = Math.max(4, Math.round(SPACING * ratio));
  const alpha = palette.scheme === 'light' ? 0.24 : 0.22;
  const tile = dotTile(doc, tileSize, Math.max(0.7, 1.15 * ratio), rgbCss(palette.text, alpha));
  const pattern = tile && base ? base.g.createPattern(tile.canvas, 'repeat') : null;
  if (!base || !pattern) {
    return null;
  }
  const { g } = base;
  g.fillStyle = pattern;
  g.fillRect(0, 0, width, height);
  g.globalCompositeOperation = 'destination-in';
  const falloff = g.createLinearGradient(0, 0, width, 0);
  for (const [offset, a] of [
    [0, 0.3],
    [0.12, 1],
    [0.3, 0.85],
    [0.5, 0.22],
    [0.7, 0.85],
    [0.88, 1],
    [1, 0.3],
  ] as const) {
    falloff.addColorStop(offset, `rgba(0,0,0,${a})`);
  }
  g.fillStyle = falloff;
  g.fillRect(0, 0, width, height);
  const fade = g.createLinearGradient(0, 0, 0, height);
  fade.addColorStop(0, 'rgba(0,0,0,0.55)');
  fade.addColorStop(0.18, 'rgba(0,0,0,1)');
  fade.addColorStop(0.82, 'rgba(0,0,0,1)');
  fade.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = fade;
  g.fillRect(0, 0, width, height);
  g.globalCompositeOperation = 'source-over';
  return base;
}

const createDotSpotlightCanvas: SceneFactory = (canvas) => {
  const c = canvas.getContext('2d');
  if (!c) {
    return null;
  }
  const doc = canvas.ownerDocument;
  let base: Layer | null = null;
  let baseKey = '';
  let paints: SpotPaints | null = null;
  // Tracked apart from `paints` so a failed build is not retried every frame.
  let paintsKey = '';

  const scene: Scene = {
    kind: 'canvas2d',
    maxPixelRatio: 1.5,
    maxPixels: 1_500_000,
    render({ palette, view, pointer }) {
      const { width, height, pixelRatio } = view;
      const ratioKey = `${palette.key}|${pixelRatio.toFixed(3)}`;
      const nextBaseKey = `${ratioKey}|${width}|${height}`;
      if (nextBaseKey !== baseKey) {
        baseKey = nextBaseKey;
        // Built in backing pixels so the pattern stays pixel-crisp at every ratio.
        base = dotBase(doc, palette, width, height, pixelRatio);
      }
      if (paintsKey !== ratioKey) {
        paintsKey = ratioKey;
        paints = spotPaints(doc, palette, pixelRatio);
      }

      // `copy` clears and blits the cached dot field in a single pass.
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalCompositeOperation = 'copy';
      if (base) {
        c.drawImage(base.canvas, 0, 0);
      } else {
        c.clearRect(0, 0, width, height);
      }
      c.globalCompositeOperation = 'source-over';

      const presence = pointer.presence;
      if (presence < 0.01 || !paints) {
        return;
      }
      const { spot, lit, mask, glow } = paints;
      const size = spot.canvas.width;
      const r = SPOT_RADIUS * pixelRatio;
      const cx = pointer.x * pixelRatio;
      const cy = pointer.y * pixelRatio;
      const sx = Math.round(cx - r);
      const sy = Math.round(cy - r);

      // Lit dots aligned to the global grid, masked by a soft radial falloff.
      const g = spot.g;
      g.globalCompositeOperation = 'source-over';
      g.setTransform(1, 0, 0, 1, -sx, -sy);
      g.clearRect(sx, sy, size, size);
      g.fillStyle = lit;
      g.fillRect(sx, sy, size, size);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'destination-in';
      g.fillStyle = mask;
      g.fillRect(0, 0, size, size);
      c.globalAlpha = presence;
      c.drawImage(spot.canvas, sx, sy);

      c.setTransform(1, 0, 0, 1, cx, cy);
      c.fillStyle = glow;
      c.fillRect(-r * 1.1, -r * 1.1, r * 2.2, r * 2.2);
      c.globalAlpha = 1;
      c.setTransform(1, 0, 0, 1, 0, 0);
    },
  };
  return scene;
};

function dotSpotlightCss(palette: ScenePalette): string {
  const dot = rgbCss(palette.text, palette.scheme === 'light' ? 0.2 : 0.16);
  return `radial-gradient(${dot} 1.1px, transparent 1.3px) 0 0 / ${SPACING}px ${SPACING}px`;
}

export const DOT_SPOTLIGHT_SCENE: SceneSpec = {
  factories: [createDotSpotlightCanvas],
  cssFallback: dotSpotlightCss,
  fps: 30,
  onDemand: true,
  pointerRate: 9,
};
