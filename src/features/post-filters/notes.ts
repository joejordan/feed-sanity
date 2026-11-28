import { OWN_ATTR } from '../../core/surface';
import { FILTER_NOTE_CLASS } from './markers';

/** Text of the note's toggle while the post is hidden. */
export const NOTE_SHOW = 'Show';
/** Text of the note's toggle while the post is revealed. */
export const NOTE_HIDE = 'Hide';

/** Class of the note's label. */
export const NOTE_LABEL_CLASS = `${FILTER_NOTE_CLASS}-label`;
/** Class of the note's Show / Hide text. */
export const NOTE_TOGGLE_CLASS = `${FILTER_NOTE_CLASS}-toggle`;

/**
 * The one-line note left where a filter hid a post. Clicking it calls
 * `onToggle`; the feature then decides whether the post is revealed and
 * calls `show`. The same note is reused each time the post is filtered.
 */
export class FilterNote {
  readonly button: HTMLButtonElement;
  readonly #label: HTMLSpanElement;
  readonly #toggle: HTMLSpanElement;

  constructor(doc: Document, onToggle: () => void) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.setAttribute(OWN_ATTR, 'filter-note');
    button.className = FILTER_NOTE_CLASS;
    button.setAttribute('aria-expanded', 'false');
    this.#label = doc.createElement('span');
    this.#label.className = NOTE_LABEL_CLASS;
    this.#toggle = doc.createElement('span');
    this.#toggle.className = NOTE_TOGGLE_CLASS;
    this.#toggle.textContent = NOTE_SHOW;
    button.append(this.#label, this.#toggle);
    button.addEventListener('click', (event) => {
      // The click is the note's own; Facebook's handlers on the post must not open it.
      event.preventDefault();
      event.stopPropagation();
      onToggle();
    });
    this.button = button;
  }

  /** Shows `label` and the toggle text for `revealed`. */
  show(label: string, revealed: boolean): void {
    if (this.#label.textContent !== label) {
      this.#label.textContent = label;
    }
    this.button.title = label;
    this.button.setAttribute('aria-expanded', String(revealed));
    this.#toggle.textContent = revealed ? NOTE_HIDE : NOTE_SHOW;
  }

  /** Puts the note first in `element`, unless it is there already. */
  place(element: HTMLElement): void {
    if (element.firstChild !== this.button) {
      element.prepend(this.button);
    }
  }

  remove(): void {
    this.button.remove();
  }
}
