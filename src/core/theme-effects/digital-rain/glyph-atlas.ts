// Adapted from `@ignitesoftware/digital-rain` (Joe Jordan / Ignite Software).
// Pre-rendered glyph sprite sheets with optional Gaussian glow halos.

export interface SpriteSheet {
  readonly image: CanvasImageSource;
  readonly tile: number;
  readonly drawSize: number;
  readonly perRow: number;
}

export const TRAIL_TINT = 0;
export const HEAD_TINT = 1;
export const TINT_COUNT = 2;

export interface GlyphAtlas {
  readonly crisp: SpriteSheet;
  readonly halo: SpriteSheet | null;
}

export interface GlyphAtlasSpec {
  glyphs: readonly string[];
  fontFamily: string;
  fontWeight: number;
  fontPixels: number;
  trailColor: string;
  headColor: string;
  mirrored: boolean;
  halo: boolean;
}

type Surface = HTMLCanvasElement | OffscreenCanvas;
type SurfaceContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const MAX_SHEET_WIDTH = 4096;
const MAX_SHEET_PIXELS = 6_000_000;
const HALO_SCALE = 0.5;
const HALO_CORE_BLUR = 0.4;
const HALO_WIDE_BLUR = 1.1;
const HALO_PASSES = 2;

export function fontShorthand(weight: number, pixels: number, family: string): string {
  return `${weight} ${pixels}px ${family}`;
}

function createSurface(
  width: number,
  height: number,
  doc: Document,
): [Surface, SurfaceContext] | null {
  if (typeof OffscreenCanvas === 'function') {
    const surface = new OffscreenCanvas(width, height);
    const context = surface.getContext('2d');
    if (context) {
      return [surface, context];
    }
  }
  const surface = doc.createElement('canvas');
  surface.width = width;
  surface.height = height;
  const context = surface.getContext('2d');
  return context ? [surface, context] : null;
}

interface SheetPlan {
  natural: number;
  maxScale: number;
  paint: (context: SurfaceContext, glyph: string, x: number, y: number, scale: number) => void;
}

function buildSheet(spec: GlyphAtlasSpec, plan: SheetPlan, doc: Document): SpriteSheet | null {
  const sprites = spec.glyphs.length * TINT_COUNT;
  const colors: string[] = [];
  colors[TRAIL_TINT] = spec.trailColor;
  colors[HEAD_TINT] = spec.headColor;
  const budgetScale = Math.sqrt(MAX_SHEET_PIXELS / (sprites * plan.natural * plan.natural));
  const scale = Math.min(plan.maxScale, budgetScale);
  const tile = Math.max(4, Math.ceil(plan.natural * scale));
  const perRow = Math.max(1, Math.min(sprites, Math.floor(MAX_SHEET_WIDTH / tile)));
  const created = createSurface(perRow * tile, Math.ceil(sprites / perRow) * tile, doc);
  if (!created) {
    return null;
  }
  const [surface, context] = created;

  context.font = fontShorthand(spec.fontWeight, spec.fontPixels * scale, spec.fontFamily);
  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';
  const metrics = context.measureText('M');
  const ascent = metrics.fontBoundingBoxAscent ?? spec.fontPixels * scale * 0.8;
  const descent = metrics.fontBoundingBoxDescent ?? spec.fontPixels * scale * 0.2;
  const baselineShift = (ascent - descent) / 2;

  for (const [index, glyph] of spec.glyphs.entries()) {
    for (const [tint, color] of colors.entries()) {
      const sprite = index * TINT_COUNT + tint;
      const centerX = (sprite % perRow) * tile + tile / 2;
      const centerY = Math.floor(sprite / perRow) * tile + tile / 2;
      context.save();
      context.beginPath();
      context.rect(centerX - tile / 2, centerY - tile / 2, tile, tile);
      context.clip();
      context.fillStyle = color;
      context.shadowColor = color;
      if (spec.mirrored) {
        context.translate(centerX * 2, 0);
        context.scale(-1, 1);
      }
      plan.paint(context, glyph, centerX, centerY + baselineShift, scale);
      context.restore();
    }
  }
  return { image: surface, tile, drawSize: plan.natural, perRow };
}

function measureWidest(spec: GlyphAtlasSpec, doc: Document): number {
  const created = createSurface(1, 1, doc);
  if (!created) {
    return spec.fontPixels;
  }
  const [, context] = created;
  context.font = fontShorthand(spec.fontWeight, spec.fontPixels, spec.fontFamily);
  return Math.max(...spec.glyphs.map((glyph) => context.measureText(glyph).width));
}

export function buildGlyphAtlas(spec: GlyphAtlasSpec, doc: Document): GlyphAtlas | null {
  if (spec.glyphs.length === 0) {
    return null;
  }
  const natural = Math.ceil(Math.max(spec.fontPixels * 1.3, measureWidest(spec, doc))) + 4;

  const crisp = buildSheet(
    spec,
    {
      natural,
      maxScale: 1,
      paint: (context, glyph, x, y) => context.fillText(glyph, x, y),
    },
    doc,
  );
  if (!crisp) {
    return null;
  }

  const wideBlur = spec.fontPixels * HALO_WIDE_BLUR;
  const halo = spec.halo
    ? buildSheet(
        spec,
        {
          natural: natural + 2 * Math.ceil(wideBlur * 1.5),
          maxScale: HALO_SCALE,
          paint: (context, glyph, x, y, scale) => {
            const away = context.canvas.width + natural * 4;
            context.shadowOffsetX = away;
            const textX = spec.mirrored ? x + away : x - away;
            for (const blur of [HALO_CORE_BLUR, HALO_WIDE_BLUR]) {
              context.shadowBlur = spec.fontPixels * blur * scale;
              for (let pass = 0; pass < HALO_PASSES; pass += 1) {
                context.fillText(glyph, textX, y);
              }
            }
          },
        },
        doc,
      )
    : null;

  return { crisp, halo };
}
