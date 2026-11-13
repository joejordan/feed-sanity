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
 * words in neighbouring elements do not run together.
 */
export function postText(post: Element): string {
  const parts: string[] = [];
  collect(post, parts);
  return parts.join(' ').replaceAll(/\s+/g, ' ').trim();
}

/** The descriptions of a post's photos, leaving out photos in its comments. */
export function postCaptions(post: Element): string[] {
  const captions: string[] = [];
  for (const image of post.querySelectorAll<HTMLImageElement>(CAPTIONED_IMAGE)) {
    const inside = image.closest(NOT_POST_TEXT);
    const caption = image.alt.trim();
    // A match at or above the post itself does not make the photo a comment's.
    if (caption && (!inside || inside.contains(post))) {
      captions.push(caption);
    }
  }
  return captions;
}
