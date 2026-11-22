// Geometry shared by the features that put UI over videos: boxes on the
// screen and where host player controls are.

import type { Locator } from '../core/locator';
import type { Video } from '../facebook/videos';
import { OWN_ATTR } from '../core/surface';

const OWN_SELECTOR = `[${OWN_ATTR}]`;

export type Box = Pick<DOMRectReadOnly, 'bottom' | 'height' | 'left' | 'right' | 'top' | 'width'>;

export type Edges = Pick<Box, 'bottom' | 'left' | 'right' | 'top'>;

/** One of the host player's controls, measured. */
export interface ControlBox {
  readonly element: Element;
  readonly box: Box;
  /** True for a slider that runs from side to side. */
  readonly bar: boolean;
}

export const overlaps = (a: Edges, b: Edges): boolean =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/** True when the point `x`, `y` is on `box`, edges included. */
export const pointIn = (box: Edges, x: number, y: number): boolean =>
  x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;

/** Where the host's controls on `video` are on the screen now. Reads layout. */
export const measureControls = (video: Pick<Video, 'controls'>): ControlBox[] =>
  video.controls().map(({ element, bar }) => ({
    element,
    box: element.getBoundingClientRect(),
    bar,
  }));

/**
 * True when an interactive control or Feed Sanity overlay lies over `below` at
 * (`x`, `y`). Large full-frame click-capture layers (>= half the picture area)
 * are treated as the picture itself rather than a button.
 */
export function hasControlAt(
  x: number,
  y: number,
  below: Element,
  picture: DOMRect,
  controls: Pick<Locator, 'matches'>,
  doc: Document = document,
): boolean {
  const stack = doc.elementsFromPoint(x, y);
  const index = stack.findIndex((item) => item === below || item.contains(below));
  const over = index === -1 ? stack : stack.slice(0, index);
  return over.some((item) => {
    if (item.matches(OWN_SELECTOR)) {
      return true;
    }
    if (!controls.matches(item)) {
      return false;
    }
    const rect = item.getBoundingClientRect();
    return rect.width * rect.height < (picture.width * picture.height) / 2;
  });
}
