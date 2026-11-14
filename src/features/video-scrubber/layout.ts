/** How tall the strip that takes the pointer is, in pixels. The bar inside it grows upward on hover. */
export const STRIP_HEIGHT = 12;

/** Videos this wide or narrower, in pixels, get no strip; scrubber.css hides it. */
export const MIN_WIDTH = 120;

/** Room left between the strip and a control of Facebook's beside it, in pixels. */
const GAP = 2;

/** How far apart, in pixels, two edges can be to count as the same. */
const SAME_EDGE = 1;

/** Where the strip sits along the bottom edge of the video. */
export interface StripPlace {
  /** How far each end stays from the video's edge, in pixels. */
  readonly left: number;
  readonly right: number;
  /** Facebook's bar the strip stands in for, hidden while it does. */
  readonly hides: Element | null;
}

/** From side to side, standing in for nothing. */
export const AT_BOTTOM: StripPlace = { left: 0, right: 0, hides: null };

export type Box = Pick<DOMRectReadOnly, 'bottom' | 'height' | 'left' | 'right' | 'top' | 'width'>;

/** One of Facebook's controls, measured. */
export interface ControlBox {
  readonly element: Element;
  readonly box: Box;
  /** True for a slider that runs from side to side. */
  readonly bar: boolean;
}

export const samePlace = (a: StripPlace, b: StripPlace): boolean =>
  a.left === b.left && a.right === b.right && a.hides === b.hides;

const overlaps = (a: Box, b: Box): boolean =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

type Edges = Pick<Box, 'bottom' | 'left' | 'right' | 'top'>;

/** True when every edge of `a` is within a pixel of the same edge of `b`. */
export const sameBox = (a: Edges, b: Edges): boolean =>
  Math.abs(a.left - b.left) <= SAME_EDGE &&
  Math.abs(a.top - b.top) <= SAME_EDGE &&
  Math.abs(a.right - b.right) <= SAME_EDGE &&
  Math.abs(a.bottom - b.bottom) <= SAME_EDGE;

/**
 * Places the strip along the bottom edge of the video, using only where
 * Facebook's controls are on the screen.
 *
 * When a slider of Facebook's at least half as wide as the video lies over
 * that edge, reaching down to it or past it as the reel viewer's position
 * bar does, the strip takes its place: it runs between the bar's ends, and
 * `hides` names the bar. A slider that only dips into the band from above,
 * as the feed's can by a pixel, is left out like the other wide controls.
 * Nothing is stood in for on a video too narrow to get the strip. The
 * bottom of a reel is crowded with captions and buttons, and the bar's band
 * is the one clear place, which Facebook already lets the bar have over
 * anything else there.
 *
 * Otherwise the strip runs from side to side, and a control in its band
 * pushes the strip's end on that side clear of it. Controls with no size,
 * controls off the video, and controls at least half as wide as the video,
 * which are layers over the whole video, are left out.
 */
export function placeStrip(video: Box, controls: readonly ControlBox[]): StripPlace {
  const half = video.width / 2;
  const top = video.bottom - STRIP_HEIGHT;
  const inBand = ({ box }: ControlBox): boolean =>
    box.width > 0 && box.height > 0 && overlaps(box, video) && box.bottom > top;

  const overEdge = ({ box }: ControlBox): boolean => box.bottom >= video.bottom - SAME_EDGE;

  const bars =
    video.width > MIN_WIDTH
      ? controls.filter(
          (control) =>
            control.bar && control.box.width >= half && inBand(control) && overEdge(control),
        )
      : [];
  const widest = bars.reduce<ControlBox | undefined>(
    (best, control) => (best && best.box.width >= control.box.width ? best : control),
    undefined,
  );
  if (widest) {
    return {
      left: Math.max(0, widest.box.left - video.left),
      right: Math.max(0, video.right - widest.box.right),
      hides: widest.element,
    };
  }

  let left = 0;
  let right = 0;
  for (const { box } of controls.filter((control) => inBand(control) && control.box.width < half)) {
    if (box.left + box.width / 2 < video.left + half) {
      left = Math.max(left, box.right - video.left + GAP);
    } else {
      right = Math.max(right, video.right - box.left + GAP);
    }
  }
  return { left, right, hides: null };
}
