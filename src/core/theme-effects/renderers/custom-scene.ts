// Tier 2 Declarative Scene Layer Renderer (Canvas 2D, safe by default).
//
// Composites up to 6 declarative layers (`gradient`, `particles`, `waves`,
// `grid`, `rays`, `silhouette`) with semantic palette tokens, blend modes,
// pointer/scroll parallax, click bursts, cached glow sprites, and deterministic
// still frames.

import type {
  CustomSceneSpec,
  GradientSceneLayer,
  GridSceneLayer,
  ParticlesSceneLayer,
  RaysSceneLayer,
  SceneColorRef,
  SceneColorToken,
  SilhouetteSceneLayer,
  WavesSceneLayer,
} from '../scene-schema';
import type { Rgb, ScenePalette } from './palette';
import type { Scene, SceneFrame } from './scene-host';
import type { BackdropContext, BackdropInstance } from './types';
import { clamp, createRandom, degreesToRadians } from '../digital-rain/math';
import { createRadialSprite, wrap } from './canvas';
import { hexRgb, mixRgb, rgbCss } from './palette';
import { mountScene } from './scene-host';

type ParsedColorRef =
  | { readonly token: SceneColorToken }
  | { readonly token: null; readonly rgb: Rgb };

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Transient click-burst velocity impulse, damped back to 0 over time. */
  ivx: number;
  ivy: number;
  size: number;
  font: string;
  phase: number;
  rot: number;
  rotSpeed: number;
  glyphIndex: number;
  useSecondary: boolean;
}

interface Building {
  readonly x: number;
  readonly width: number;
  readonly height: number;
  readonly windows: number;
}

interface DrawCtx {
  readonly c: CanvasRenderingContext2D;
  readonly doc: Document;
  readonly frame: SceneFrame;
  readonly w: number;
  readonly h: number;
  readonly ox: number;
  readonly oy: number;
}

type LayerRuntime =
  | {
      readonly kind: 'gradient';
      readonly spec: GradientSceneLayer;
      readonly colors: readonly ParsedColorRef[];
    }
  | {
      readonly kind: 'particles';
      readonly spec: ParticlesSceneLayer;
      readonly primary: ParsedColorRef;
      readonly secondary: ParsedColorRef | null;
      readonly particles: Particle[];
      readonly glyphList: readonly string[];
      spritePalette: ScenePalette | null;
      primarySprite: HTMLCanvasElement | null;
      secondarySprite: HTMLCanvasElement | null;
    }
  | {
      readonly kind: 'waves';
      readonly spec: WavesSceneLayer;
      readonly primary: ParsedColorRef;
      readonly secondary: ParsedColorRef | null;
    }
  | {
      readonly kind: 'grid';
      readonly spec: GridSceneLayer;
      readonly primary: ParsedColorRef;
      readonly secondary: ParsedColorRef | null;
    }
  | {
      readonly kind: 'rays';
      readonly spec: RaysSceneLayer;
      readonly primary: ParsedColorRef;
      readonly secondary: ParsedColorRef | null;
    }
  | {
      readonly kind: 'silhouette';
      readonly spec: SilhouetteSceneLayer;
      readonly primary: ParsedColorRef;
      readonly secondary: ParsedColorRef | null;
      readonly buildings?: readonly Building[];
    };

const ZERO_OFFSET: readonly [number, number] = [0, 0];
const DEFAULT_GLYPHS: readonly string[] = ['✦', '·', '✧'];

function parseColor(ref: SceneColorRef): ParsedColorRef {
  if (
    ref === 'accent' ||
    ref === 'alt' ||
    ref === 'background' ||
    ref === 'surface' ||
    ref === 'text'
  ) {
    return { token: ref };
  }
  return { token: null, rgb: hexRgb(ref) };
}

function resolveColor(ref: ParsedColorRef, palette: ScenePalette): Rgb {
  if (ref.token === null) {
    return ref.rgb;
  }
  return palette[ref.token];
}

function buildParticles(
  layer: ParticlesSceneLayer,
  glyphList: readonly string[],
  seed: number,
): Particle[] {
  const rand = createRandom(seed);
  const radCenter = degreesToRadians(layer.angle);
  const radSpread = degreesToRadians(layer.spread);
  const list: Particle[] = [];
  for (let i = 0; i < layer.count; i++) {
    const dir = radCenter + (rand() * 2 - 1) * radSpread;
    const speedMag = (0.45 + rand() * 0.9) * layer.speed * 58;
    const size = layer.sizeMin + rand() * (layer.sizeMax - layer.sizeMin);
    list.push({
      x: rand(),
      y: rand(),
      vx: Math.cos(dir) * speedMag,
      vy: Math.sin(dir) * speedMag,
      ivx: 0,
      ivy: 0,
      size,
      font: `${Math.round(size * 2.2)}px monospace`,
      phase: rand() * Math.PI * 2,
      rot: rand() * Math.PI * 2,
      rotSpeed: (rand() - 0.5) * 2.2,
      glyphIndex: Math.floor(rand() * glyphList.length),
      useSecondary: Boolean(layer.secondaryColor) && rand() > 0.55,
    });
  }
  return list;
}

function buildSkyline(seed: number): Building[] {
  const rand = createRandom(seed);
  const buildings: Building[] = [];
  let cursor = -0.02;
  while (cursor < 1.04) {
    const width = 0.025 + rand() * 0.055;
    const height = 0.06 + rand() * 0.24;
    buildings.push({
      x: cursor,
      width,
      height,
      windows: Math.floor(2 + rand() * 4),
    });
    cursor += width * (0.75 + rand() * 0.35);
  }
  return buildings;
}

function buildRuntimeLayer(layer: CustomSceneSpec['layers'][number], index: number): LayerRuntime {
  const seed = 0x51_a7_9b_31 + index * 7919;
  switch (layer.kind) {
    case 'gradient':
      return { kind: 'gradient', spec: layer, colors: layer.colors.map(parseColor) };
    case 'particles': {
      const glyphList = layer.glyphs ? Array.from(layer.glyphs) : DEFAULT_GLYPHS;
      return {
        kind: 'particles',
        spec: layer,
        primary: parseColor(layer.color),
        secondary: layer.secondaryColor ? parseColor(layer.secondaryColor) : null,
        particles: buildParticles(layer, glyphList, seed),
        glyphList,
        spritePalette: null,
        primarySprite: null,
        secondarySprite: null,
      };
    }
    case 'waves':
      return {
        kind: 'waves',
        spec: layer,
        primary: parseColor(layer.color),
        secondary: layer.secondaryColor ? parseColor(layer.secondaryColor) : null,
      };
    case 'grid':
      return {
        kind: 'grid',
        spec: layer,
        primary: parseColor(layer.color),
        secondary: layer.secondaryColor ? parseColor(layer.secondaryColor) : null,
      };
    case 'rays':
      return {
        kind: 'rays',
        spec: layer,
        primary: parseColor(layer.color),
        secondary: layer.secondaryColor ? parseColor(layer.secondaryColor) : null,
      };
    case 'silhouette':
      return {
        kind: 'silhouette',
        spec: layer,
        primary: parseColor(layer.color),
        secondary: layer.secondaryColor ? parseColor(layer.secondaryColor) : null,
        ...(layer.style === 'skyline' ? { buildings: buildSkyline(seed) } : {}),
      };
  }
}

function buildRuntimeLayers(spec: CustomSceneSpec): LayerRuntime[] {
  return spec.layers.map((layer, index) => buildRuntimeLayer(layer, index));
}

function parallaxOffset(
  frame: SceneFrame,
  parallax: number | undefined,
): readonly [number, number] {
  if (!parallax || parallax <= 0) {
    return ZERO_OFFSET;
  }
  const px = (frame.pointer.nx - 0.5) * frame.pointer.presence * parallax * 46;
  const py =
    (frame.pointer.ny - 0.5) * frame.pointer.presence * parallax * 32 -
    (frame.scroll.y - 0.5) * parallax * 54;
  return [px, py];
}

function drawGradientLayer(
  runtime: Extract<LayerRuntime, { kind: 'gradient' }>,
  { c, frame, w, h, ox, oy }: DrawCtx,
): void {
  const { spec: layer, colors } = runtime;
  const drift = (layer.drift ?? 0.2) * frame.time * 0.25;
  let grad: CanvasGradient;
  if (layer.style === 'radial') {
    const cx = (layer.x ?? 0.5) * w + Math.sin(drift) * w * 0.06 + ox;
    const cy = (layer.y ?? 0.5) * h + Math.cos(drift * 0.8) * h * 0.05 + oy;
    const radius = Math.hypot(w, h) * 0.65;
    grad = c.createRadialGradient(cx, cy, 0, cx, cy, radius);
  } else {
    const angleRad = degreesToRadians((layer.angle ?? 180) + Math.sin(drift) * 12);
    const dx = Math.cos(angleRad) * w * 0.6;
    const dy = Math.sin(angleRad) * h * 0.6;
    grad = c.createLinearGradient(
      w * 0.5 - dx + ox * 0.4,
      h * 0.5 - dy + oy * 0.4,
      w * 0.5 + dx + ox * 0.4,
      h * 0.5 + dy + oy * 0.4,
    );
  }
  const denom = Math.max(1, colors.length - 1);
  for (let i = 0; i < colors.length; i++) {
    grad.addColorStop(i / denom, rgbCss(resolveColor(colors[i]!, frame.palette), 1));
  }
  c.fillStyle = grad;
  c.fillRect(0, 0, w, h);
}

function ensureGlowSprites(
  runtime: Extract<LayerRuntime, { kind: 'particles' }>,
  doc: Document,
  palette: ScenePalette,
  primary: Rgb,
  secondary: Rgb,
): void {
  if (runtime.spritePalette === palette) {
    return;
  }
  runtime.spritePalette = palette;
  runtime.primarySprite = createRadialSprite(doc, 64, [
    [0, rgbCss(primary, 1)],
    [0.45, rgbCss(primary, 0.35)],
    [1, rgbCss(primary, 0)],
  ]);
  runtime.secondarySprite = runtime.secondary
    ? createRadialSprite(doc, 64, [
        [0, rgbCss(secondary, 1)],
        [0.45, rgbCss(secondary, 0.35)],
        [1, rgbCss(secondary, 0)],
      ])
    : runtime.primarySprite;
}

function drawParticlesLayer(
  runtime: Extract<LayerRuntime, { kind: 'particles' }>,
  { c, doc, frame, w, h, ox, oy }: DrawCtx,
): void {
  const { spec: layer, particles, glyphList } = runtime;
  const primary = resolveColor(runtime.primary, frame.palette);
  const secondary = runtime.secondary ? resolveColor(runtime.secondary, frame.palette) : primary;
  const primaryCss = rgbCss(primary, 1);
  const secondaryCss = rgbCss(secondary, 1);
  const baseAlpha = c.globalAlpha;
  const swirl = layer.swirl ?? 0;
  const dt = frame.still ? 0 : frame.dt;

  if (layer.shape === 'glow') {
    ensureGlowSprites(runtime, doc, frame.palette, primary, secondary);
  } else if (layer.shape === 'glyph') {
    c.textAlign = 'center';
    c.textBaseline = 'middle';
  }

  for (const p of particles) {
    if (dt > 0) {
      const sway = swirl > 0 ? Math.sin(frame.time * 1.4 + p.phase) * swirl * 28 : 0;
      p.x = wrap(p.x + ((p.vx + p.ivx + sway) * dt) / Math.max(1, w) + 0.06, 1.12) - 0.06;
      p.y = wrap(p.y + ((p.vy + p.ivy) * dt) / Math.max(1, h) + 0.06, 1.12) - 0.06;
      if (p.ivx !== 0 || p.ivy !== 0) {
        const decay = Math.exp(-dt * 2.8);
        p.ivx = Math.abs(p.ivx * decay) < 0.25 ? 0 : p.ivx * decay;
        p.ivy = Math.abs(p.ivy * decay) < 0.25 ? 0 : p.ivy * decay;
      }
      p.rot += p.rotSpeed * dt;
    }

    const px = p.x * w + ox;
    const py = p.y * h + oy;
    const twinkle = layer.twinkle
      ? 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(frame.time * 2.4 + p.phase))
      : 1;
    const alpha = clamp(0.85 * twinkle, 0.1, 1);
    const colorCss = p.useSecondary ? secondaryCss : primaryCss;
    const r = p.size;

    c.globalAlpha = baseAlpha * alpha;

    if (layer.shape === 'glow') {
      const sprite = p.useSecondary ? runtime.secondarySprite : runtime.primarySprite;
      const radius = r * 2.4;
      if (sprite) {
        c.drawImage(sprite, px - radius, py - radius, radius * 2, radius * 2);
      } else {
        c.fillStyle = colorCss;
        c.beginPath();
        c.arc(px, py, r, 0, Math.PI * 2);
        c.fill();
      }
      continue;
    }

    if (layer.shape === 'circle') {
      c.fillStyle = colorCss;
      c.beginPath();
      c.arc(px, py, r, 0, Math.PI * 2);
      c.fill();
      continue;
    }

    if (layer.shape === 'ring') {
      c.strokeStyle = colorCss;
      c.lineWidth = Math.max(1, r * 0.25);
      c.beginPath();
      c.arc(px, py, r, 0, Math.PI * 2);
      c.stroke();
      continue;
    }

    if (layer.shape === 'glyph') {
      const ch = glyphList[p.glyphIndex % glyphList.length] ?? '✦';
      c.fillStyle = colorCss;
      c.font = p.font;
      c.fillText(ch, px, py);
      continue;
    }

    // Rotated shapes (`petal`, `rain`, `star`, `snow`).
    c.save();
    c.translate(px, py);
    if (layer.shape === 'petal') {
      c.rotate(p.rot);
      c.fillStyle = colorCss;
      c.beginPath();
      c.ellipse(0, 0, r * 1.1, r * 0.55, 0, 0, Math.PI * 2);
      c.fill();
    } else if (layer.shape === 'rain') {
      c.rotate(Math.atan2(p.vy, p.vx));
      c.strokeStyle = colorCss;
      c.lineWidth = Math.max(1, r * 0.35);
      c.beginPath();
      c.moveTo(-r * 1.8, 0);
      c.lineTo(r * 1.8, 0);
      c.stroke();
    } else {
      c.rotate(p.rot);
      c.strokeStyle = colorCss;
      c.lineWidth = Math.max(1, r * 0.22);
      const spikes = layer.shape === 'snow' ? 3 : 2;
      c.beginPath();
      for (let s = 0; s < spikes; s++) {
        const a = (s * Math.PI) / spikes;
        c.moveTo(Math.cos(a) * -r, Math.sin(a) * -r);
        c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      c.stroke();
    }
    c.restore();
  }
  c.globalAlpha = baseAlpha;
}

function drawWavesLayer(
  runtime: Extract<LayerRuntime, { kind: 'waves' }>,
  { c, frame, w, h, ox, oy }: DrawCtx,
): void {
  const layer = runtime.spec;
  const primary = resolveColor(runtime.primary, frame.palette);
  const secondary = runtime.secondary ? resolveColor(runtime.secondary, frame.palette) : primary;
  const steps = Math.max(24, Math.min(80, Math.round(w / 24)));
  const grad = c.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, rgbCss(primary, 0.15));
  grad.addColorStop(0.5, rgbCss(secondary, 0.85));
  grad.addColorStop(1, rgbCss(primary, 0.15));
  c.strokeStyle = grad;
  c.lineCap = 'round';

  for (let band = 0; band < layer.count; band++) {
    const bandFrac = layer.count === 1 ? 0 : band / (layer.count - 1) - 0.5;
    const baseY = layer.y * h + bandFrac * h * 0.16 + oy;
    const amp = layer.amplitude * h * (1 - Math.abs(bandFrac) * 0.35);
    c.lineWidth = Math.max(1, layer.thickness * (1 - Math.abs(bandFrac) * 0.3));
    c.beginPath();
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = t * w;
      const phase =
        t * Math.PI * 2 * layer.frequency + frame.time * (0.65 + band * 0.18) + band * 1.3;
      const y =
        baseY +
        Math.sin(phase + ox * 0.01) * amp +
        Math.cos(phase * 0.55 - frame.time * 0.35) * amp * 0.45;
      if (s === 0) {
        c.moveTo(x, y);
      } else {
        c.lineTo(x, y);
      }
    }
    c.stroke();
  }
}

function drawGridLayer(
  runtime: Extract<LayerRuntime, { kind: 'grid' }>,
  { c, frame, w, h, ox, oy }: DrawCtx,
): void {
  const layer = runtime.spec;
  const primary = resolveColor(runtime.primary, frame.palette);
  const secondary = runtime.secondary ? resolveColor(runtime.secondary, frame.palette) : primary;
  const horizonY = clamp(layer.horizon * h + oy * 0.5, h * 0.15, h * 0.9);
  const vanishX = w * 0.5 + ox * 1.4;
  const glow = layer.glow ?? 0.55;

  if (glow > 0) {
    const g = c.createLinearGradient(0, horizonY - h * 0.12, 0, horizonY + h * 0.14);
    g.addColorStop(0, rgbCss(secondary, 0));
    g.addColorStop(0.5, rgbCss(secondary, glow * 0.45));
    g.addColorStop(1, rgbCss(primary, 0));
    c.fillStyle = g;
    c.fillRect(0, horizonY - h * 0.12, w, h * 0.26);
  }

  c.strokeStyle = rgbCss(primary, 0.55);
  c.lineWidth = 1;
  const cols = Math.max(6, Math.min(28, Math.round(w / layer.spacing)));
  c.beginPath();
  for (let i = -cols; i <= cols; i++) {
    c.moveTo(vanishX + i * layer.spacing * 0.18, horizonY);
    c.lineTo(vanishX + i * layer.spacing * 2.2, h + 4);
  }
  c.stroke();

  const rows = 14;
  const scrollOffset = (frame.time * 0.75) % 1;
  for (let r = 0; r < rows; r++) {
    const depth = (r + scrollOffset) / rows;
    const y = horizonY + depth * depth * (h - horizonY);
    c.strokeStyle = rgbCss(primary, 0.15 + depth * 0.6);
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(w, y);
    c.stroke();
  }
}

function drawRaysLayer(
  runtime: Extract<LayerRuntime, { kind: 'rays' }>,
  { c, frame, w, h, ox, oy }: DrawCtx,
): void {
  const layer = runtime.spec;
  const primary = resolveColor(runtime.primary, frame.palette);
  const secondary = runtime.secondary ? resolveColor(runtime.secondary, frame.palette) : primary;
  const originX = layer.originX * w + ox * 0.8;
  const originY = layer.originY * h + oy * 0.8;
  const reach = Math.hypot(w, h) * 1.35;
  const halfBeam = (Math.PI / layer.count) * layer.spread;

  const makeBeamGrad = (color: Rgb): CanvasGradient => {
    const g = c.createRadialGradient(originX, originY, 0, originX, originY, reach * 0.85);
    g.addColorStop(0, rgbCss(color, 0.55));
    g.addColorStop(0.65, rgbCss(color, 0.14));
    g.addColorStop(1, rgbCss(color, 0));
    return g;
  };

  const grads = [makeBeamGrad(primary), runtime.secondary ? makeBeamGrad(secondary) : null];
  for (let pass = 0; pass < (grads[1] ? 2 : 1); pass++) {
    c.fillStyle = grads[pass]!;
    c.beginPath();
    for (let i = 0; i < layer.count; i++) {
      if (grads[1] && i % 2 !== pass) {
        continue;
      }
      const baseAngle =
        (i / layer.count) * Math.PI * 2 +
        frame.time * layer.rotationSpeed * 0.45 +
        Math.sin(frame.time * 0.3 + i) * 0.08;
      c.moveTo(originX, originY);
      c.lineTo(
        originX + Math.cos(baseAngle - halfBeam) * reach,
        originY + Math.sin(baseAngle - halfBeam) * reach,
      );
      c.lineTo(
        originX + Math.cos(baseAngle + halfBeam) * reach,
        originY + Math.sin(baseAngle + halfBeam) * reach,
      );
      c.closePath();
    }
    c.fill();
  }
}

function drawSilhouetteLayer(
  runtime: Extract<LayerRuntime, { kind: 'silhouette' }>,
  { c, frame, w, h, ox, oy }: DrawCtx,
): void {
  const layer = runtime.spec;
  const primary = resolveColor(runtime.primary, frame.palette);
  const secondary = runtime.secondary
    ? resolveColor(runtime.secondary, frame.palette)
    : mixRgb(primary, frame.palette.accent, 0.25);

  if (layer.style === 'sun' || layer.style === 'moon') {
    const cx = layer.x * w + ox * 0.5;
    const cy = layer.y * h + oy * 0.5;
    const r = Math.min(w, h) * 0.14 * layer.scale;
    const halo = c.createRadialGradient(cx, cy, r * 0.4, cx, cy, r * 2.4);
    halo.addColorStop(0, rgbCss(primary, 0.45));
    halo.addColorStop(1, rgbCss(primary, 0));
    c.fillStyle = halo;
    c.beginPath();
    c.arc(cx, cy, r * 2.4, 0, Math.PI * 2);
    c.fill();

    const body = c.createLinearGradient(cx, cy - r, cx, cy + r);
    body.addColorStop(0, rgbCss(primary, 0.95));
    body.addColorStop(1, rgbCss(secondary, 0.92));
    c.fillStyle = body;
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.fill();
    if (layer.style === 'moon') {
      c.fillStyle = rgbCss(frame.palette.background, 0.85);
      c.beginPath();
      c.arc(cx + r * 0.36, cy - r * 0.12, r * 0.86, 0, Math.PI * 2);
      c.fill();
    }
    return;
  }

  const baseY = layer.y * h + oy;
  if (layer.style === 'skyline' && runtime.buildings) {
    c.fillStyle = rgbCss(primary, 0.94);
    for (const b of runtime.buildings) {
      const bx = b.x * w + ox;
      const bw = b.width * w;
      const bh = b.height * h * layer.scale;
      c.fillRect(bx, baseY - bh, bw, h - (baseY - bh) + 8);
    }
    if (runtime.secondary) {
      c.fillStyle = rgbCss(secondary, 0.35);
      for (const b of runtime.buildings) {
        const bx = b.x * w + ox;
        const bw = b.width * w;
        const bh = b.height * h * layer.scale;
        const pad = Math.max(2, bw * 0.18);
        const cols = Math.max(1, b.windows);
        const winW = Math.max(2, (bw - pad * 2) / cols - 2);
        for (let col = 0; col < cols; col++) {
          for (let row = 0; row < 4; row++) {
            if ((col + row) % 2 === 0) {
              c.fillRect(bx + pad + col * (winW + 2), baseY - bh + 8 + row * 12, winW, 5);
            }
          }
        }
      }
    }
    return;
  }

  // Mountains or rolling hills ridge.
  const segments = layer.style === 'mountains' ? 14 : 36;
  const amp = h * 0.16 * layer.scale;
  c.fillStyle = rgbCss(primary, 0.92);
  c.beginPath();
  c.moveTo(-20, h + 10);
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const x = t * (w + 40) - 20 + ox;
    const ridge =
      layer.style === 'mountains'
        ? Math.abs(Math.sin(t * Math.PI * 3.5 + layer.x * 5)) * amp +
          Math.abs(Math.cos(t * Math.PI * 7.2)) * amp * 0.35
        : (Math.sin(t * Math.PI * 2.2 + layer.x * 4) * 0.5 + 0.5) * amp * 0.8 +
          Math.sin(t * Math.PI * 4.6) * amp * 0.2;
    c.lineTo(x, baseY - ridge);
  }
  c.lineTo(w + 20, h + 10);
  c.closePath();
  c.fill();
}

function buildSceneCssFallback(spec: CustomSceneSpec | undefined, palette: ScenePalette): string {
  const firstGradient = spec?.layers.find(
    (layer): layer is GradientSceneLayer => layer.kind === 'gradient',
  );
  if (firstGradient && firstGradient.colors.length >= 2) {
    const stops = firstGradient.colors.map((ref) =>
      rgbCss(resolveColor(parseColor(ref), palette), 0.72),
    );
    return `linear-gradient(${firstGradient.angle ?? 180}deg, ${stops.join(', ')})`;
  }
  return `radial-gradient(ellipse 75% 65% at 50% 35%, ${rgbCss(palette.accent, 0.28)} 0%, ${rgbCss(palette.background, 0.92)} 100%)`;
}

function sceneHasParallax(spec: CustomSceneSpec | undefined): boolean {
  return spec?.layers.some((layer) => (layer.parallax ?? 0) > 0) ?? false;
}

function sameSceneSpec(a: CustomSceneSpec | undefined, b: CustomSceneSpec | undefined): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Mounts a Tier 2 declarative multi-layer Canvas 2D scene backdrop. */
export function mountCustomSceneBackdrop(initial: BackdropContext): BackdropInstance {
  let activeSpec = initial.effects.customScene;
  let activeFps = activeSpec?.fps ?? 24;
  let activeParallax = sceneHasParallax(activeSpec);
  let layers = activeSpec ? buildRuntimeLayers(activeSpec) : [];

  const mountInner = (ctx: BackdropContext): BackdropInstance => {
    const sceneFactory = (canvas: HTMLCanvasElement): Scene | null => {
      const context = canvas.getContext('2d');
      if (!context) {
        return null;
      }
      return {
        kind: 'canvas2d',
        renderScale: 1,
        maxPixelRatio: 1.25,
        render(frame) {
          const { width, height } = frame.view;
          context.setTransform(1, 0, 0, 1, 0, 0);
          context.clearRect(0, 0, width, height);
          context.setTransform(frame.view.pixelRatio, 0, 0, frame.view.pixelRatio, 0, 0);

          const w = frame.view.cssWidth;
          const h = frame.view.cssHeight;
          for (const runtime of layers) {
            const [ox, oy] = parallaxOffset(frame, runtime.spec.parallax);
            context.save();
            context.globalAlpha = runtime.spec.opacity ?? 1;
            context.globalCompositeOperation = runtime.spec.blendMode ?? 'source-over';
            const drawCtx: DrawCtx = { c: context, doc: ctx.doc, frame, w, h, ox, oy };
            switch (runtime.kind) {
              case 'gradient':
                drawGradientLayer(runtime, drawCtx);
                break;
              case 'particles':
                drawParticlesLayer(runtime, drawCtx);
                break;
              case 'waves':
                drawWavesLayer(runtime, drawCtx);
                break;
              case 'grid':
                drawGridLayer(runtime, drawCtx);
                break;
              case 'rays':
                drawRaysLayer(runtime, drawCtx);
                break;
              case 'silhouette':
                drawSilhouetteLayer(runtime, drawCtx);
                break;
            }
            context.restore();
          }
        },
        burst(normX, normY) {
          for (const runtime of layers) {
            if (runtime.kind !== 'particles' || !runtime.spec.clickBurst) {
              continue;
            }
            for (const p of runtime.particles) {
              const dx = p.x - normX;
              const dy = p.y - normY;
              const distSq = dx * dx + dy * dy;
              if (distSq < 0.06 && distSq > 0.000_01) {
                const dist = Math.sqrt(distSq);
                const kick = (1 - dist / 0.25) * 110;
                p.ivx = clamp(p.ivx + (dx / dist) * kick, -220, 220);
                p.ivy = clamp(p.ivy + (dy / dist) * kick, -220, 220);
              }
            }
          }
        },
      };
    };

    return mountScene(ctx, {
      factories: [sceneFactory],
      cssFallback: (palette) => buildSceneCssFallback(activeSpec, palette),
      fps: activeFps,
      startTime: 4,
      trackScroll: activeParallax,
      acceptsBursts: true,
    });
  };

  let host = mountInner(initial);

  return {
    update(next) {
      const nextSpec = next.effects.customScene;
      if (!sameSceneSpec(activeSpec, nextSpec)) {
        activeSpec = nextSpec;
        layers = activeSpec ? buildRuntimeLayers(activeSpec) : [];
        const nextFps = activeSpec?.fps ?? 24;
        const nextParallax = sceneHasParallax(activeSpec);
        if (nextFps !== activeFps || nextParallax !== activeParallax) {
          host.destroy();
          activeFps = nextFps;
          activeParallax = nextParallax;
          host = mountInner(next);
          return;
        }
      }
      host.update(next);
    },
    burst(normX, normY) {
      host.burst?.(normX, normY);
    },
    destroy() {
      host.destroy();
    },
  };
}
