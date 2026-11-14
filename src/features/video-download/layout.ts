import type { Box, ControlBox, Edges } from '../video-layout';
import { overlaps } from '../video-layout';
import { LABELS_HEIGHT } from '../video-scrubber/layout';

/**
 * The button's width and height, in pixels. Facebook's corner buttons in
 * the reel viewer are 40 pixels too.
 */
export const BUTTON_SIZE = 40;

/** Room between the button and the video's edges, in pixels. */
const MARGIN = 8;

/** Room kept between the button and a control of Facebook's, in pixels. */
const GAP = 4;

/** Videos narrower than this, in pixels, such as previews, get no button. */
export const MIN_WIDTH = 120;

/** The tooltip's height, and its distance from the button, in pixels, as on Facebook's player. */
export const TIP_HEIGHT = 32;
export const TIP_GAP = 8;

/** The room kept for the tooltip's width, in pixels: the longest name is about 140. */
const TIP_WIDTH = 160;

/**
 * Where the tooltip goes: under the button, starting at its left edge or
 * ending at its right edge, or beside it on the right. Null when it has no
 * room inside the video.
 */
export type TipPlace = 'below-end' | 'below-start' | 'beside' | null;

/** Where the button sits, in pixels from the video's top left corner, and where its tooltip goes. */
export interface ButtonPlace {
  readonly left: number;
  readonly top: number;
  readonly tip: TipPlace;
}

export const samePlace = (a: ButtonPlace | null, b: ButtonPlace | null): boolean =>
  a === b || (a !== null && b !== null && a.left === b.left && a.top === b.top && a.tip === b.tip);

/**
 * Where the tooltip of a button at `left`, `top` goes in a video of this
 * size: below the button when there is room above the video scrubber's
 * labels, which it gives way to, else beside it, else nowhere.
 */
function placeTip(left: number, top: number, video: Box): TipPlace {
  const bottom = video.height - LABELS_HEIGHT;
  if (top + BUTTON_SIZE + TIP_GAP + TIP_HEIGHT <= bottom) {
    if (left + TIP_WIDTH <= video.width - MARGIN) {
      return 'below-start';
    }
    if (left + BUTTON_SIZE - TIP_WIDTH >= MARGIN) {
      return 'below-end';
    }
  }
  const fitsBeside =
    top + (BUTTON_SIZE + TIP_HEIGHT) / 2 <= bottom &&
    left + BUTTON_SIZE + TIP_GAP + TIP_WIDTH <= video.width - MARGIN;
  return fitsBeside ? 'beside' : null;
}

/**
 * Places the button in the video's top left corner, clear of Facebook's
 * controls, using only where they are on the screen. When a control is in
 * the way, the button looks for room both right along the top edge and down
 * the left edge, moving past each control it meets, and takes the place
 * nearer the corner, the top edge on a tie. Under a story's header, the
 * left edge wins. Null when neither edge has room, or the video is too
 * small, and then the button is not shown.
 *
 * Controls with no size, controls off the video, and controls that cover
 * half the video or more, which are layers over the whole picture, are left
 * out. The tooltip takes no pointer events, so it may lie over a control.
 */
export function placeButton(video: Box, controls: readonly ControlBox[]): ButtonPlace | null {
  if (video.width < MIN_WIDTH || video.height < BUTTON_SIZE + 2 * MARGIN) {
    return null;
  }
  const area = video.width * video.height;
  const inTheWay = controls
    .map(({ box }) => box)
    .filter(
      (box) =>
        box.width > 0 &&
        box.height > 0 &&
        overlaps(box, video) &&
        box.width * box.height < area / 2,
    );
  /**
   * The first control in the way of a button at `left`, `top`, leaving out
   * those in `passed`. Each step of a search moves past the control that
   * was hit, which is then passed, so both searches end even when rounding
   * leaves the moved button a hair short of the control's far edge.
   */
  const blocker = (left: number, top: number, passed: Set<Edges>): Edges | undefined => {
    const button = {
      left: video.left + left - GAP,
      top: video.top + top - GAP,
      right: video.left + left + BUTTON_SIZE + GAP,
      bottom: video.top + top + BUTTON_SIZE + GAP,
    };
    const hit = inTheWay.find((box) => !passed.has(box) && overlaps(box, button));
    if (hit) {
      passed.add(hit);
    }
    return hit;
  };
  const at = (left: number, top: number): ButtonPlace => ({
    left,
    top,
    tip: placeTip(left, top, video),
  });
  const along = (onTop: boolean): ButtonPlace | null => {
    const passed = new Set<Edges>();
    const length = onTop ? video.width : video.height;
    for (let offset = MARGIN; offset + BUTTON_SIZE + MARGIN <= length; ) {
      const left = onTop ? offset : MARGIN;
      const top = onTop ? MARGIN : offset;
      const hit = blocker(left, top, passed);
      if (!hit) {
        return at(left, top);
      }
      offset = onTop ? hit.right - video.left + GAP : hit.bottom - video.top + GAP;
    }
    return null;
  };
  const top = along(true);
  const left = along(false);
  if (!(top && left)) {
    return top ?? left;
  }
  return left.top < top.left ? left : top;
}
