import { CAPTIONED_IMAGE, NOT_POST_TEXT } from './selectors';

function collect(node: Node, parts: string[]): void {
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      parts.push(child.nodeValue ?? '');
    } else if (child instanceof Element && !child.matches(NOT_POST_TEXT)) {
      collect(child, parts);
    }
  }
}

/**
 * The text of a post as its reader sees it: author, message and anything
 * attached, without the comments. Pieces of text are joined with spaces, so
 * words in neighbouring elements do not run together. Pass a post's
 * `content` element, or a part of it.
 */
export function postText(content: Element): string {
  const parts: string[] = [];
  collect(content, parts);
  return parts.join(' ').replaceAll(/\s+/g, ' ').trim();
}

/** The elements in a post's `content` matching `selector`, leaving out those in its comments. */
export function postElements<E extends Element = Element>(content: Element, selector: string): E[] {
  return [...content.querySelectorAll<E>(selector)].filter((element) => {
    const inside = element.closest(NOT_POST_TEXT);
    // A match at or above the content element does not make it a comment's.
    return !inside || inside.contains(content);
  });
}

/** The descriptions of a post's photos, leaving out photos in its comments. */
export function postCaptions(content: Element): string[] {
  return postElements<HTMLImageElement>(content, CAPTIONED_IMAGE)
    .map((image) => image.alt.trim())
    .filter((caption) => caption !== '');
}
