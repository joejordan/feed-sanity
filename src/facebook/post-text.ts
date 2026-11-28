import type { Locate, Locator } from '../core/locator';
import { OWN_ELEMENT, POST_FEEDBACK, POST_MESSAGE } from './selectors';

/** Elements whose text the page never shows as text. */
const UNSHOWN = '[hidden],script,style,noscript,template';

/**
 * Everything inside a post that is not the post's own: its comment and
 * reaction area and this project's elements, as one selector.
 */
export function notOwnSelector(locate: Locate): string {
  const feedback = locate(POST_FEEDBACK).selector();
  return feedback ? `${feedback},${OWN_ELEMENT}` : OWN_ELEMENT;
}

/**
 * True when `element`, inside `content`, is in a part matching `excluded`.
 * `content` itself and its ancestors never count, since the post in the
 * comments popup is itself an article.
 */
export function isExcluded(element: Element, content: Element, excluded: string): boolean {
  const hit = element.closest(excluded);
  return hit !== null && hit !== content && content.contains(hit);
}

/**
 * Calls `visit` with each text node under `root`, in document order, that
 * is not inside an element matching `skip`, until `visit` returns true.
 */
export function walkText(root: Element, skip: string, visit: (text: Text) => boolean): void {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node !== root && node.nodeType === Node.ELEMENT_NODE && (node as Element).matches(skip)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE && visit(node as Text)) {
      return;
    }
  }
}

/** Collapses runs of whitespace to single spaces and trims the ends. */
export const collapse = (text: string): string => text.replaceAll(/\s+/g, ' ').trim();

/** The text under `root` outside `skip`, its pieces joined with single spaces. */
export function textUnder(root: Element, skip: string): string {
  const pieces: string[] = [];
  walkText(root, skip, (text) => {
    pieces.push(text.data);
    return false;
  });
  return collapse(pieces.join(' '));
}

/** The selector for what a post's text leaves out. */
export const textSkip = (locate: Locate): string => `${notOwnSelector(locate)},${UNSHOWN}`;

/**
 * The matches of `target` inside `content` that are not in a comment, the
 * comment and reaction area or this project's elements. A `firstOf`
 * locator falls through to its next strategy when every match of one is
 * left out. A selector that does not parse finds nothing.
 */
export function postElements<E extends Element = Element>(
  content: Element,
  target: Locator | string,
  locate: Locate,
): E[] {
  const excluded = notOwnSelector(locate);
  const keep = (element: E): boolean => !isExcluded(element, content, excluded);
  if (typeof target !== 'string') {
    return target.all<E>(content, keep);
  }
  try {
    return [...content.querySelectorAll<E>(target)].filter(keep);
  } catch {
    return [];
  }
}

/** True when `target` has a match inside `content` that `postElements` would keep. Usually stops at the first. */
export function hasPostElement(content: Element, target: Locator, locate: Locate): boolean {
  const first = target.first(content);
  if (!first) {
    return false;
  }
  return (
    !isExcluded(first, content, notOwnSelector(locate)) ||
    postElements(content, target, locate).length > 0
  );
}

/** The author's messages in a post, without one nested in another (a shared post's message is in its own). */
export function postMessages(content: Element, locate: Locate): Element[] {
  const messages = postElements(content, locate(POST_MESSAGE), locate);
  return messages.filter(
    (message) => !messages.some((other) => other !== message && other.contains(message)),
  );
}

/** The author's message, its pieces joined with newlines, or `''` when the post has none. */
export function postBody(content: Element, locate: Locate): string {
  const skip = textSkip(locate);
  return postMessages(content, locate)
    .map((message) => textUnder(message, skip))
    .filter((text) => text !== '')
    .join('\n');
}

/**
 * All of the post's own text: every text node under `content` outside the
 * comments, the comment and reaction area and this project's elements,
 * joined with single spaces. When that is blank, the author's message.
 */
export function postText(content: Element, locate: Locate): string {
  return textUnder(content, textSkip(locate)) || postBody(content, locate);
}

/** True when the post has any text of its own. Stops at the first piece found. */
export function hasPostText(content: Element, locate: Locate): boolean {
  let found = false;
  walkText(content, textSkip(locate), (text) => {
    found = /\S/.test(text.data);
    return found;
  });
  return found;
}
