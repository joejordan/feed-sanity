// Small Canvas 2D helpers shared by the backdrop renderers.

export interface Layer {
  readonly canvas: HTMLCanvasElement;
  readonly g: CanvasRenderingContext2D;
}

/**
 * Creates an offscreen canvas sized `width × height` CSS px at `ratio` backing
 * pixels per CSS px, pre-scaled so callers draw in CSS px.
 */
export function createLayer(doc: Document, width: number, height: number, ratio = 1): Layer | null {
  const canvas = doc.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width * ratio));
  canvas.height = Math.max(1, Math.ceil(height * ratio));
  const g = canvas.getContext('2d');
  if (!g) {
    return null;
  }
  g.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { canvas, g };
}

/** Releases an offscreen layer's pixel backing store immediately instead of waiting for GC. */
export function releaseLayer(layer: Layer | null): void {
  if (layer) {
    layer.canvas.width = 0;
    layer.canvas.height = 0;
  }
}

/** A square sprite filled with a radial gradient (glows, bokeh, star halos). */
export function createRadialSprite(
  doc: Document,
  size: number,
  stops: ReadonlyArray<readonly [number, string]>,
): HTMLCanvasElement | null {
  const layer = createLayer(doc, size, size);
  if (!layer) {
    return null;
  }
  const half = size / 2;
  const grad = layer.g.createRadialGradient(half, half, 0, half, half, half);
  for (const [offset, color] of stops) {
    grad.addColorStop(offset, color);
  }
  layer.g.fillStyle = grad;
  layer.g.fillRect(0, 0, size, size);
  return layer.canvas;
}

/** Positive modulo: wraps `value` into `0..size`. */
export function wrap(value: number, size: number): number {
  return ((value % size) + size) % size;
}
