// Hiding a post and leaving a note in its place. The filter engine will need
// the same action when it is ported, and this file moves there with it.

import type { Post } from '../../facebook/posts';
import { addStyle } from '../../core/dom';
import { MARK, OWN } from '../../facebook/selectors';
import css from './hide-posts.css?inline';

const STYLE_ID = 'feed_sanity_hide_posts';

const revealLine = (text: string): string => `${text} -- Click to reveal post`;
const rehideLine = (text: string): string => `${text} -- Click to rehide post`;

const currentNote = (element: Element): Element | undefined =>
  [...element.children].find((child) => child.classList.contains(MARK.hiddenNote));

/** The note that stands in for a hidden post. Clicking it shows the post, and clicking again hides it. */
function createNote(text: string, post: HTMLElement): HTMLElement {
  const note = document.createElement('button');
  note.type = 'button';
  note.className = MARK.hiddenNote;
  note.setAttribute(OWN, '');
  for (const [className, line] of [
    [MARK.hiddenNoteReveal, revealLine(text)],
    [MARK.hiddenNoteRehide, rehideLine(text)],
  ] as const) {
    const span = document.createElement('span');
    span.className = className;
    span.textContent = line;
    note.append(span);
  }
  note.addEventListener('click', () => post.classList.toggle(MARK.hiddenShown));
  return note;
}

/** Adds the page styles that hidden posts and their notes rely on. */
export function addHideStyles(): Promise<void> {
  return addStyle(STYLE_ID, css);
}

/**
 * Hides a post. With `showNote`, a note saying `noteText` stays in its place.
 * A post the page is about gets the note regardless and starts out visible.
 * Safe to call again on a post that is already hidden.
 */
export function hidePost(post: Post, noteText: string, showNote: boolean): void {
  const { element } = post;
  const mustStayVisible = post.permalink || element.classList.contains(MARK.popupPost);
  if (mustStayVisible && !element.classList.contains(MARK.hidden)) {
    element.classList.add(MARK.hiddenShown);
  }
  element.classList.add(MARK.hidden);

  const note = currentNote(element);
  if (!showNote && !mustStayVisible) {
    note?.remove();
    // With no note to click, a post the user had revealed could not be hidden again.
    element.classList.remove(MARK.hiddenShown);
  } else if (note?.firstElementChild?.textContent !== revealLine(noteText)) {
    note?.remove();
    element.prepend(createNote(noteText, element));
  }
}

/** Undoes `hidePost`. */
export function unhidePost({ element }: Post): void {
  element.classList.remove(MARK.hidden, MARK.hiddenShown);
  currentNote(element)?.remove();
}
