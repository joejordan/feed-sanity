import type { Locate, Locator } from '../core/locator';
import { CAPTIONED_IMAGE, COMMENT, OWN_ELEMENT, POST_REACTIONS } from './selectors';

/**
 * Selects the parts of a post whose text is not the post's own: its comment
 * area, the comments themselves, and anything this project added. Built once
 * for each call, because it is tested on every element of a post.
 */
function notPostText(locate: Locate): string {
  return [OWN_ELEMENT, locate(POST_REACTIONS).selector(), locate(COMMENT).selector()]
    .filter((selector) => selector !== null)
    .join(',');
}

function collect(node: Node, parts: string[], skip: string): void {
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      parts.push(child.nodeValue ?? '');
    } else if (child instanceof Element && !child.matches(skip)) {
      collect(child, parts, skip);
    }
  }
}

/**
 * The text of a post as its reader sees it: author, message and anything
 * attached, without the comments. Pieces of text are joined with spaces, so
 * words in neighbouring elements do not run together. Pass a post's
 * `content` element, or a part of it.
 */
export function postText(content: Element, locate: Locate): string {
  const parts: string[] = [];
  collect(content, parts, notPostText(locate));
  return parts.join(' ').replaceAll(/\s+/g, ' ').trim();
}

/**
 * The elements in a post's `content` that `target` finds, leaving out those
 * in its comments. A locator that falls back moves on to its next strategy
 * when everything the first one finds is in the comments.
 */
export function postElements<E extends Element = Element>(
  content: Element,
  target: Locator | string,
  locate: Locate,
): E[] {
  const skip = notPostText(locate);
  const keep = (element: Element): boolean => {
    const inside = element.closest(skip);
    // A match at or above the content element does not make it a comment's.
    return !inside || inside.contains(content);
  };
  return typeof target === 'string'
    ? [...content.querySelectorAll<E>(target)].filter(keep)
    : target.all<E>(content, keep);
}

/** The descriptions of a post's photos, leaving out photos in its comments. */
export function postCaptions(content: Element, locate: Locate): string[] {
  return postElements<HTMLImageElement>(content, locate(CAPTIONED_IMAGE), locate)
    .map((image) => image.alt.trim())
    .filter((caption) => caption !== '');
}
