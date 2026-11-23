// Reversible, strictly Trusted-Types-safe DOM applicator for cross-site
// `FilterOutcome` actions (`hide` with optional revealable note, `class`, and
// `css` declarations), plus shared keyword parsing for `feed-filters` and
// `thread-filters`.

import type { FilterHiding, FilterOutcome } from '../../core/filter-engine';
import type { Scope } from '../../core/scope';
import { FILTERED_FEED } from '../../core/filter-engine';
import { hideElement, OWN_ATTR } from '../../core/surface';

/** Shared read-only empty outcome used when no custom filter rules are active. */
export const EMPTY_OUTCOME: FilterOutcome = Object.freeze({
  hiding: null,
  classes: [],
  styles: [],
  replacements: [],
  tabs: [FILTERED_FEED],
});

/** Splits a newline-separated keyword option into normalized lowercase phrases. */
export function parseKeywords(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line.length > 0);
}

function resolveTargets(root: HTMLElement, selector?: string): Element[] {
  if (!selector) {
    return [root];
  }
  try {
    return [...root.querySelectorAll(selector)];
  } catch {
    return [];
  }
}

function createHideNote(
  element: HTMLElement,
  hiding: FilterHiding,
  onToggleReveal: (revealed: boolean) => void,
): HTMLButtonElement {
  const doc = element.ownerDocument ?? document;
  const note = doc.createElement('button');
  note.type = 'button';
  note.setAttribute(OWN_ATTR, 'filter-note');
  note.textContent = hiding.reveal;
  note.style.cssText = [
    'display: block',
    'width: 100%',
    'padding: 8px 12px',
    'margin: 4px 0',
    'border: 1px solid currentColor',
    'border-radius: 8px',
    'background: transparent',
    'color: inherit',
    'opacity: 0.72',
    'font: inherit',
    'font-size: 13px',
    'text-align: left',
    'cursor: pointer',
    hiding.css ?? '',
  ]
    .filter(Boolean)
    .join('; ');

  let revealed = false;
  note.addEventListener('click', () => {
    revealed = !revealed;
    note.textContent = revealed ? hiding.rehide : hiding.reveal;
    onToggleReveal(revealed);
  });
  return note;
}

export interface AppliedFilterState {
  readonly hidden: boolean;
  readonly dispose: () => void;
}

const IMPORTANT_SUFFIX = /\s*!important\s*$/i;

/**
 * Applies `outcome` (plus optional `builtInHide` fallback) onto `element`
 * inside `parentScope`. Returns `{ hidden, dispose }` when any effect was
 * applied, or `null` when the item stays untouched.
 */
export function applyFilterOutcome(
  parentScope: Scope,
  element: HTMLElement,
  outcome: FilterOutcome,
  builtInHide: boolean,
  onHide?: (element: HTMLElement) => void,
): AppliedFilterState | null {
  const hiding: FilterHiding | null =
    outcome.hiding ??
    (builtInHide && outcome.unhidden !== true ? { reveal: '', rehide: '', showNote: false } : null);
  const hasEffects = hiding !== null || outcome.classes.length > 0 || outcome.styles.length > 0;
  if (!hasEffects || parentScope.disposed) {
    return null;
  }

  const itemScope = parentScope.child();

  if (hiding) {
    onHide?.(element);
    let releaseHide: (() => void) | undefined = hideElement(itemScope, element);
    if (hiding.showNote && element.parentNode) {
      const note = createHideNote(element, hiding, (revealed) => {
        if (revealed) {
          releaseHide?.();
          releaseHide = undefined;
        } else if (!releaseHide && !itemScope.disposed) {
          releaseHide = hideElement(itemScope, element);
        }
      });
      // When hiding a table row (e.g. Gmail `<tr>`), wrap the note inside a
      // full-width `<tr><td colspan="100">` so it spans the entire table.
      let inserted: HTMLElement = note;
      if (element.localName === 'tr') {
        const doc = element.ownerDocument ?? document;
        const tr = doc.createElement('tr');
        tr.setAttribute(OWN_ATTR, 'filter-note-row');
        const td = doc.createElement('td');
        td.colSpan = 100;
        td.append(note);
        tr.append(td);
        inserted = tr;
      }
      element.before(inserted);
      itemScope.add(() => inserted.remove());
    }
  }

  for (const { name, selector } of outcome.classes) {
    const tokens = name.split(/\s+/).filter((token) => token.length > 0);
    if (tokens.length === 0) {
      continue;
    }
    for (const target of resolveTargets(element, selector)) {
      const added = tokens.filter((token) => !target.classList.contains(token));
      if (added.length > 0) {
        target.classList.add(...added);
        itemScope.add(() => target.classList.remove(...added));
      }
    }
  }

  for (const { property, value, selector } of outcome.styles) {
    const priority = IMPORTANT_SUFFIX.test(value) ? 'important' : '';
    const cleanValue = priority ? value.replace(IMPORTANT_SUFFIX, '') : value;
    for (const target of resolveTargets(element, selector)) {
      if (!(target instanceof HTMLElement)) {
        continue;
      }
      const prevValue = target.style.getPropertyValue(property);
      const prevPriority = target.style.getPropertyPriority(property);
      target.style.setProperty(property, cleanValue, priority);
      itemScope.add(() => {
        if (prevValue) {
          target.style.setProperty(property, prevValue, prevPriority);
        } else {
          target.style.removeProperty(property);
        }
      });
    }
  }

  return {
    hidden: hiding !== null,
    dispose: () => itemScope.dispose(),
  };
}
