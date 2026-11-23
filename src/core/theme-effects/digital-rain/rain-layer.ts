// Adapted from `@ignitesoftware/digital-rain` (Joe Jordan / Ignite Software).
// Rain layer simulation and sprite painting.

import type { GlyphAtlas, SpriteSheet } from './glyph-atlas';
import type { RandomSource } from './math';
import { HEAD_TINT, TINT_COUNT, TRAIL_TINT } from './glyph-atlas';
import { clamp, lerp } from './math';

export interface LayerDynamics {
  density: number;
  trailLength: number;
  fallRate: number;
  speedVariance: number;
  mutationRate: number;
}

export interface WarpField {
  x: number;
  y: number;
  radius: number;
  strength: number;
}

export type StreamVisitor = (
  column: number,
  head: number,
  trail: number,
  firstRow: number,
  gain: number,
) => void;

interface Stream {
  active: boolean;
  head: number;
  pace: number;
  stretch: number;
  gain: number;
  warp: number;
}

interface CascadeStream {
  column: number;
  head: number;
  origin: number;
  trail: number;
  pace: number;
  delay: number;
}

const STREAMS_PER_COLUMN = 2;
const FOLLOW_GAP = 4;
const MUTATIONS_PER_SECOND = 1.6;
const CASCADE_REACH = 5;
const CASCADE_STAGGER = 0.035;
const MAX_CASCADE_STREAMS = 600;
const WARP_FLOOR = 0.03;

const STILL: LayerDynamics = {
  density: 0,
  trailLength: 1,
  fallRate: 0,
  speedVariance: 0,
  mutationRate: 0,
};

export class RainLayer {
  readonly #random: RandomSource;
  #dynamics: LayerDynamics = STILL;
  #glyphs = new Uint16Array(0);
  #glyphCount = 1;
  #streams: Stream[] = [];
  #cascades: CascadeStream[] = [];
  #mutationDebt = 0;
  #fallen: number;

  columns = 0;
  rows = 0;
  cellWidth = 1;
  cellHeight = 1;

  constructor(random: RandomSource, startEmpty = false) {
    this.#random = random;
    this.#fallen = startEmpty ? 0 : Number.POSITIVE_INFINITY;
  }

  #randomGlyph(): number {
    return Math.floor(this.#random() * this.#glyphCount);
  }

  #paceOf(stream: Stream): number {
    return lerp(1, lerp(0.45, 1.75, stream.pace), this.#dynamics.speedVariance);
  }

  #trailOf(stream: Stream): number {
    return Math.max(1, this.#dynamics.trailLength * lerp(0.65, 1.35, stream.stretch));
  }

  #reroll(stream: Stream): void {
    stream.pace = this.#random();
    stream.stretch = this.#random();
    stream.gain = lerp(0.8, 1, this.#random());
    stream.warp = 0;
  }

  #createStream(): Stream {
    const stream: Stream = {
      active: this.#random() < this.#dynamics.density,
      head: 0,
      pace: 0,
      stretch: 0,
      gain: 1,
      warp: 0,
    };
    this.#reroll(stream);
    stream.head = this.#random() * (this.rows + this.#trailOf(stream));
    stream.active &&= stream.head < this.#fallen * this.#paceOf(stream);
    return stream;
  }

  #restart(stream: Stream): void {
    stream.active = true;
    stream.head = -2 * this.#random();
    this.#reroll(stream);
  }

  #hasRoom(column: number): boolean {
    const first = column * STREAMS_PER_COLUMN;
    for (let slot = first; slot < first + STREAMS_PER_COLUMN; slot += 1) {
      const stream = this.#streams[slot];
      if (stream?.active && stream.head - this.#trailOf(stream) < FOLLOW_GAP) {
        return false;
      }
    }
    return true;
  }

  #spawnChance(deltaSeconds: number): number {
    const { density, fallRate, trailLength } = this.#dynamics;
    if (fallRate <= 0 || density <= 0) {
      return 0;
    }
    if (density >= 1) {
      return 1;
    }
    const period = (this.rows + trailLength) / fallRate;
    return (deltaSeconds * density) / (period * (1 - density));
  }

  #warpAt(column: number, head: number, warp: WarpField): number {
    if (warp.radius <= 0 || warp.strength <= 0) {
      return 0;
    }
    const dx = (column + 0.5) * this.cellWidth - warp.x;
    const dy = head * this.cellHeight - warp.y;
    const reach = 1 - (dx * dx + dy * dy) / (warp.radius * warp.radius);
    return reach > 0 ? reach * reach * warp.strength : 0;
  }

  #advance(column: number, from: number, to: number): void {
    if (this.#dynamics.mutationRate <= 0) {
      return;
    }
    const first = Math.max(0, Math.floor(from) + 1);
    const last = Math.min(this.rows - 1, Math.floor(to));
    for (let row = first; row <= last; row += 1) {
      this.#glyphs[column * this.rows + row] = this.#randomGlyph();
    }
  }

  #mutate(deltaSeconds: number): void {
    const cells = this.#glyphs.length;
    const rate = this.#dynamics.mutationRate * MUTATIONS_PER_SECOND;
    this.#mutationDebt += cells * rate * deltaSeconds;
    const swaps = Math.min(cells, Math.floor(this.#mutationDebt));
    this.#mutationDebt -= swaps;
    for (let swap = 0; swap < swaps; swap += 1) {
      this.#glyphs[Math.floor(this.#random() * cells)] = this.#randomGlyph();
    }
  }

  glyphAt(column: number, row: number): number {
    return this.#glyphs[column * this.rows + row] ?? 0;
  }

  setDynamics(dynamics: LayerDynamics): void {
    this.#dynamics = dynamics;
  }

  setGlyphCount(count: number): void {
    const next = Math.max(1, Math.floor(count));
    if (next === this.#glyphCount) {
      return;
    }
    this.#glyphCount = next;
    for (let index = 0; index < this.#glyphs.length; index += 1) {
      this.#glyphs[index] = this.#randomGlyph();
    }
  }

  resize(columns: number, rows: number, cellWidth: number, cellHeight: number): void {
    this.cellWidth = cellWidth;
    this.cellHeight = cellHeight;
    if (columns === this.columns && rows === this.rows) {
      return;
    }

    const glyphs = new Uint16Array(columns * rows);
    for (let column = 0; column < columns; column += 1) {
      for (let row = 0; row < rows; row += 1) {
        glyphs[column * rows + row] =
          column < this.columns && row < this.rows
            ? this.glyphAt(column, row)
            : this.#randomGlyph();
      }
    }
    this.#glyphs = glyphs;
    this.columns = columns;
    this.rows = rows;

    const slots = columns * STREAMS_PER_COLUMN;
    this.#streams.length = Math.min(this.#streams.length, slots);
    while (this.#streams.length < slots) {
      this.#streams.push(this.#createStream());
    }
    this.#cascades = this.#cascades.filter((cascade) => cascade.column < columns);
  }

  step(deltaSeconds: number, warp: WarpField | null = null): void {
    if (this.#streams.length === 0) {
      return;
    }
    const spawnChance = this.#spawnChance(deltaSeconds);
    const distance = this.#dynamics.fallRate * deltaSeconds;
    this.#fallen += distance;

    for (let slot = 0; slot < this.#streams.length; slot += 1) {
      const stream = this.#streams[slot];
      if (!stream) {
        continue;
      }
      const column = Math.floor(slot / STREAMS_PER_COLUMN);
      if (!stream.active) {
        if (spawnChance > 0 && this.#random() < spawnChance && this.#hasRoom(column)) {
          this.#restart(stream);
        }
        continue;
      }
      stream.warp = warp ? this.#warpAt(column, stream.head, warp) : 0;
      const timeScale = 1 - (1 - WARP_FLOOR) * stream.warp;
      const head = stream.head + distance * this.#paceOf(stream) * timeScale;
      this.#advance(column, stream.head, head);
      stream.head = head;
      stream.active = head - this.#trailOf(stream) <= this.rows;
    }

    if (this.#cascades.length > 0) {
      this.#cascades = this.#cascades.filter((cascade) => {
        if (cascade.delay > 0) {
          cascade.delay -= deltaSeconds;
          return true;
        }
        const head = cascade.head + distance * cascade.pace;
        this.#advance(cascade.column, cascade.head, head);
        cascade.head = head;
        return head - cascade.trail <= this.rows;
      });
    }

    this.#mutate(deltaSeconds);
  }

  cascade(column: number, row: number, spread: number): number {
    if (this.#dynamics.fallRate <= 0 || row >= this.rows) {
      return 0;
    }
    const reach = Math.round(spread * CASCADE_REACH);
    const origin = Math.max(0, Math.floor(row));
    let started = 0;
    for (let offset = -reach; offset <= reach; offset += 1) {
      const target = Math.floor(column) + offset;
      if (target < 0 || target >= this.columns) {
        continue;
      }
      if (this.#cascades.length >= MAX_CASCADE_STREAMS) {
        break;
      }
      const steps = Math.abs(offset);
      const falloff = reach === 0 ? 0 : steps / reach;
      this.#cascades.push({
        column: target,
        head: origin,
        origin,
        trail: Math.max(2, this.#dynamics.trailLength * lerp(1.1, 0.55, falloff)),
        pace: lerp(1.6, 1, falloff) * lerp(0.9, 1.1, this.#random()),
        delay: steps * CASCADE_STAGGER,
      });
      started += 1;
    }
    return started;
  }

  visit(visitor: StreamVisitor): void {
    for (let slot = 0; slot < this.#streams.length; slot += 1) {
      const stream = this.#streams[slot];
      if (stream?.active) {
        visitor(
          Math.floor(slot / STREAMS_PER_COLUMN),
          stream.head,
          this.#trailOf(stream),
          0,
          stream.gain * (1 + 0.5 * stream.warp),
        );
      }
    }
    for (const cascade of this.#cascades) {
      if (cascade.delay <= 0) {
        visitor(cascade.column, cascade.head, cascade.trail, cascade.origin, 1.15);
      }
    }
  }
}

export interface LayerPaint {
  atlas: GlyphAtlas;
  opacity: number;
  bloom: number;
}

type CellPainter = (
  sprite: number,
  x: number,
  y: number,
  fade: number,
  heat: number,
  strength: number,
) => void;

const TRAIL_FALLOFF = 0.9;
const HEAD_BLEND_ROWS = 0.4;
const HEAD_GLOW = 2.4;
const TRAIL_GLOW = 0.8;
const MAX_GLOW_PASSES = 4;
const MIN_ALPHA = 0.012;
const MIN_HALO_ALPHA = 0.04;

function stamp(
  context: CanvasRenderingContext2D,
  sheet: SpriteSheet,
  sprite: number,
  x: number,
  y: number,
  alpha: number,
  floor: number,
): void {
  const { image, tile, drawSize, perRow } = sheet;
  const sourceX = (sprite % perRow) * tile;
  const sourceY = Math.floor(sprite / perRow) * tile;
  const left = Math.round(x - drawSize / 2);
  const top = Math.round(y - drawSize / 2);
  for (let remaining = alpha; remaining > floor; remaining -= 1) {
    context.globalAlpha = Math.min(1, remaining);
    context.drawImage(image, sourceX, sourceY, tile, tile, left, top, drawSize, drawSize);
  }
}

function eachLitCell(layer: RainLayer, opacity: number, paint: CellPainter): void {
  const { cellWidth, cellHeight } = layer;
  layer.visit((column, head, trail, firstRow, gain) => {
    const x = (column + 0.5) * cellWidth;
    const first = Math.max(firstRow, Math.ceil(head - trail));
    const last = Math.min(layer.rows - 1, Math.floor(head));
    for (let row = first; row <= last; row += 1) {
      const behind = head - row;
      const arrival = Math.min(1, 0.3 + behind * 4);
      paint(
        layer.glyphAt(column, row) * TINT_COUNT,
        x,
        (row + 0.5) * cellHeight,
        1 - behind / trail,
        clamp(1 - (behind - 1) / HEAD_BLEND_ROWS, 0, 1),
        arrival * gain * opacity,
      );
    }
  });
}

export function paintLayer(
  context: CanvasRenderingContext2D,
  layer: RainLayer,
  { atlas, opacity, bloom }: LayerPaint,
): void {
  const { crisp, halo } = atlas;

  if (halo && bloom > 0) {
    eachLitCell(layer, opacity, (sprite, x, y, fade, heat, strength) => {
      const glow = bloom * strength;
      const trailGlow = Math.min(1, glow * TRAIL_GLOW * fade ** 3 * (1 - heat));
      const headGlow = Math.min(MAX_GLOW_PASSES, glow * HEAD_GLOW * heat);
      stamp(context, halo, sprite + TRAIL_TINT, x, y, trailGlow, MIN_HALO_ALPHA);
      stamp(context, halo, sprite + HEAD_TINT, x, y, headGlow, MIN_HALO_ALPHA);
    });
  }

  eachLitCell(layer, opacity, (sprite, x, y, fade, heat, strength) => {
    const alpha = fade ** TRAIL_FALLOFF * strength;
    stamp(context, crisp, sprite + TRAIL_TINT, x, y, Math.min(1, alpha * (1 - heat)), MIN_ALPHA);
    stamp(context, crisp, sprite + HEAD_TINT, x, y, Math.min(1, alpha * heat), MIN_ALPHA);
  });
}
