import type { Locate, Locator } from '../core/locator';
import { STORY_CARD, STORY_MENU, STORY_STRIP, VIDEO_CONTROL } from './selectors';

// How the stories viewer is built, as recorded in docs/porting.md under
// "The stories viewer". A story's picture, video or photo, is inside its
// card (`STORY_CARD`). The header's buttons on the right, the menu button
// and the pause and play button among them, lie over the top of the card
// but outside it, so they are found from the card by where they are on the
// screen.

/** How many levels above a story card the search for its header goes. */
const MAX_HEADER_LEVELS = 6;

/** How many levels above the menu button the search for the pause button goes. */
const MAX_BUTTON_LEVELS = 4;

/** How far apart, in pixels, two edges can be to count as touching. */
const TOUCHING = 2;

/** The tallest, in pixels, that an empty strip along a card's bottom edge can be to count as Facebook's. */
const MAX_STRIP_HEIGHT = 24;

/** True on `/stories/` and the pages under it, the stories viewer. Reads only the path. */
const onStoriesPage = (): boolean => /^\/stories(?:\/|$)/.test(location.pathname);

/** The story card `element` is in, or null when it is in none or the page is not a stories page. */
export function storyCardOf(element: Element, locate: Locate): HTMLElement | null {
  if (!onStoriesPage()) {
    return null;
  }
  const card = locate(STORY_CARD).closest(element);
  return card instanceof HTMLElement ? card : null;
}

/**
 * The first element `locator` finds under `start` or the elements above it,
 * up to `levels` levels, for which `keep` is true, and the element it was
 * found under.
 */
function findUp(
  start: Element | null,
  levels: number,
  locator: Locator,
  keep: (found: Element) => boolean,
): { root: Element; found: Element } | null {
  let node = start;
  for (let level = 0; node && level < levels; level++) {
    const found = locator.all(node).find(keep);
    if (found) {
      return { root: node, found };
    }
    node = node.parentElement;
  }
  return null;
}

/** A story card's header: the menu button, and the element that holds it and the card. */
export interface StoryHeader {
  readonly root: Element;
  readonly menu: Element;
}

/** True when `button` lies over the top quarter of `card`, as a header's buttons do. */
const overTop = (button: DOMRect, card: DOMRect): boolean => {
  const middle = button.left + button.width / 2;
  return (
    button.width > 0 &&
    middle >= card.left &&
    middle <= card.right &&
    button.top >= card.top &&
    button.top <= card.top + card.height / 4
  );
};

/** The header last found for each card, used again while its menu button still lies over the card's top. */
const headers = new WeakMap<Element, StoryHeader>();

/**
 * The header of the story in `card`: the nearest element above the card
 * that holds a menu button lying over the card's top. Null when there is
 * none within a few levels. Reads layout.
 */
export function storyHeaderOf(card: Element, locate: Locate): StoryHeader | null {
  const box = card.getBoundingClientRect();
  const known = headers.get(card);
  if (
    known?.root.contains(card) &&
    known.root.contains(known.menu) &&
    overTop(known.menu.getBoundingClientRect(), box)
  ) {
    return known;
  }
  const hit = findUp(card.parentElement, MAX_HEADER_LEVELS, locate(STORY_MENU), (menu) =>
    overTop(menu.getBoundingClientRect(), box),
  );
  if (!hit) {
    headers.delete(card);
    return null;
  }
  const header = { root: hit.root, menu: hit.found };
  headers.set(card, header);
  return header;
}

/**
 * The story's own pause and play button: the control just to the left of
 * the header's menu button, with the same top and its right edge at the
 * menu button's left edge. Its label is translated, so it is found by where
 * it is. Null when it is not there. Reads layout.
 */
export function storyPauseButton(card: Element, locate: Locate): Element | null {
  const header = storyHeaderOf(card, locate);
  if (!header) {
    return null;
  }
  const { menu } = header;
  const edge = menu.getBoundingClientRect();
  const hit = findUp(menu.parentElement, MAX_BUTTON_LEVELS, locate(VIDEO_CONTROL), (found) => {
    if (found === menu || found.contains(menu)) {
      return false;
    }
    const box = found.getBoundingClientRect();
    return (
      box.width > 0 &&
      Math.abs(box.top - edge.top) <= TOUCHING &&
      Math.abs(box.right - edge.left) <= TOUCHING
    );
  });
  return hit?.found ?? null;
}

/**
 * Facebook's invisible strip along the bottom edge of `picture`, the video
 * of the story in `card`, which takes the pointer there above anything this
 * project puts in the card: an empty child of the card, at least half as
 * wide as the picture, along its bottom edge, no taller than 24 pixels, that
 * takes pointer events. Null when there is none. Reads layout and style.
 */
export function storyBottomStrip(card: Element, picture: Element, locate: Locate): Element | null {
  const box = picture.getBoundingClientRect();
  const strips = locate(STORY_STRIP);
  const strip = [...card.children].find((found) => {
    if (!strips.matches(found)) {
      return false;
    }
    const edge = found.getBoundingClientRect();
    return (
      edge.height > 0 &&
      edge.height <= MAX_STRIP_HEIGHT &&
      edge.width >= box.width / 2 &&
      Math.abs(edge.bottom - box.bottom) <= TOUCHING &&
      getComputedStyle(found).pointerEvents !== 'none'
    );
  });
  return strip ?? null;
}

/** True while the story's menu is open, when a press on the story is meant to close it. */
export function storyMenuOpen(card: Element, locate: Locate): boolean {
  return storyHeaderOf(card, locate)?.menu.getAttribute('aria-expanded') === 'true';
}
