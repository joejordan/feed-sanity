import type { Post } from '../../facebook/posts';
import type { Hiding } from './engine';
import { MARK, OWN } from '../../facebook/selectors';

/** What each note was made from, to tell whether it still says the right thing. */
const made = new WeakMap<Element, Hiding>();

const currentNote = (element: Element): Element | undefined =>
  [...element.children].find((child) => child.classList.contains(MARK.hiddenNote));

/** The note that stands in for a hidden post. Clicking it shows the post, and clicking again hides it. */
function createNote(hiding: Hiding, post: HTMLElement): HTMLElement {
  const note = document.createElement('button');
  note.type = 'button';
  note.className = MARK.hiddenNote;
  note.setAttribute(OWN, '');
  if (hiding.css) {
    note.style.cssText = hiding.css;
  }
  for (const [className, line] of [
    [MARK.hiddenNoteReveal, hiding.reveal],
    [MARK.hiddenNoteRehide, hiding.rehide],
  ] as const) {
    const span = document.createElement('span');
    span.className = className;
    span.textContent = line;
    note.append(span);
  }
  note.addEventListener('click', () => post.classList.toggle(MARK.hiddenShown));
  made.set(note, hiding);
  return note;
}

const sameNote = (a: Hiding | undefined, b: Hiding): boolean =>
  a?.reveal === b.reveal && a.rehide === b.rehide && a.css === b.css;

/**
 * Hides a post. With `showNote`, a note stays in its place. A post the page
 * is about gets the note regardless and starts out visible. Safe to call
 * again on a post that is already hidden.
 */
export function hidePost(post: Post, hiding: Hiding): void {
  const { element } = post;
  const mustStayVisible = post.permalink || element.classList.contains(MARK.popupPost);
  if (mustStayVisible && !element.classList.contains(MARK.hidden)) {
    element.classList.add(MARK.hiddenShown);
  }
  element.classList.add(MARK.hidden);

  const note = currentNote(element);
  if (!hiding.showNote && !mustStayVisible) {
    note?.remove();
    // With no note to click, a post the user had revealed could not be hidden again.
    element.classList.remove(MARK.hiddenShown);
  } else if (!note || !sameNote(made.get(note), hiding)) {
    note?.remove();
    element.prepend(createNote(hiding, element));
  }
}

/** Undoes `hidePost`. */
export function unhidePost({ element }: Post): void {
  element.classList.remove(MARK.hidden, MARK.hiddenShown);
  currentNote(element)?.remove();
}
