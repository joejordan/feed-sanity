// Geometry shared by the features that put UI over videos: boxes on the
// screen and where Facebook's controls are.

import type { Video } from '../facebook/videos';

export type Box = Pick<DOMRectReadOnly, 'bottom' | 'height' | 'left' | 'right' | 'top' | 'width'>;

export type Edges = Pick<Box, 'bottom' | 'left' | 'right' | 'top'>;

/** One of Facebook's controls, measured. */
export interface ControlBox {
  readonly element: Element;
  readonly box: Box;
  /** True for a slider that runs from side to side. */
  readonly bar: boolean;
}

export const overlaps = (a: Edges, b: Edges): boolean =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/** Where Facebook's controls on `video` are on the screen now. Reads layout. */
export const measureControls = (video: Video): ControlBox[] =>
  video.controls().map(({ element, bar }) => ({
    element,
    box: element.getBoundingClientRect(),
    bar,
  }));
