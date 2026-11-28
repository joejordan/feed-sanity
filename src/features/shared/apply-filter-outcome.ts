// Reversible, strictly Trusted-Types-safe DOM applicator for cross-site
// `FilterOutcome`s (hiding with an optional revealable note, classes, inline
// styles and text replacements), plus shared keyword parsing for
// `feed-filters` and `thread-filters`.

import type { FilterHiding, FilterOutcome } from '../../core/filter-engine';
import type { Scope } from '../../core/scope';
import { queryDeepAll } from '../../core/dom';
import { hideElement, OWN_ATTR } from '../../core/surface';

/** Splits a newline-separated keyword option into normalized lowercase phrases. */
export function parseKeywords(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line.length > 0);
}

/** The matches of `selector` inside `root`, through open shadow roots. A bad selector finds nothing. */
function queryTargets(root: HTMLElement, selector: string): Element[] {
  try {
    return queryDeepAll(root, selector, OWN_ATTR);
  } catch {
    return [];
  }
}

/**
 * Adds `outcome`'s classes and inline styles until `scope` is disposed.
 * `targetsOf` gives the elements a selector picks, or the item itself when
 * there is none. A class already there is left alone and not removed later.
 * A style is put back exactly as it was, value and priority.
 */
export function applyClassesAndStyles(
  scope: Scope,
  outcome: Pick<FilterOutcome, 'classes' | 'styles'>,
  targetsOf: (selector: string | undefined) => readonly Element[],
): void {
  if (outcome.classes.length === 0 && outcome.styles.length === 0) {
    return;
  }
  const cache = new Map<string | undefined, readonly Element[]>();
  const targets = (selector: string | undefined): readonly Element[] => {
    let found = cache.get(selector);
    if (!found) {
      found = targetsOf(selector);
      cache.set(selector, found);
    }
    return found;
  };
  for (const { name, selector } of outcome.classes) {
    const tokens = name.split(/\s+/).filter((token) => token.length > 0);
    if (tokens.length === 0) {
      continue;
    }
    for (const target of targets(selector)) {
      const added = tokens.filter((token) => !target.classList.contains(token));
      if (added.length > 0) {
        target.classList.add(...added);
        scope.add(() => target.classList.remove(...added));
      }
    }
  }
  for (const { property, value, important, selector } of outcome.styles) {
    for (const target of targets(selector)) {
      if (!(target instanceof HTMLElement || target instanceof SVGElement)) {
        continue;
      }
      const { style } = target;
      const before = style.getPropertyValue(property);
      const beforePriority = style.getPropertyPriority(property);
      style.setProperty(property, value, important ? 'important' : '');
      scope.add(() => {
        if (before) {
          style.setProperty(property, before, beforePriority);
        } else {
          style.removeProperty(property);
        }
      });
    }
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
  note.setAttribute('aria-expanded', 'false');
  const label = doc.createElement('span');
  label.textContent = hiding.label;
  label.style.cssText = 'min-width: 0; overflow: hidden; text-overflow: ellipsis;';
  const pill = doc.createElement('span');
  pill.textContent = 'Show';
  pill.style.cssText =
    'flex-shrink: 0; padding: 2px 8px; border-radius: 999px; border: 1px solid color-mix(in srgb, currentColor 24%, transparent); font-size: 11.5px; font-weight: 600;';
  note.append(label, pill);
  note.style.cssText = [
    'display: flex',
    'align-items: center',
    'justify-content: space-between',
    'gap: 10px',
    'width: 100%',
    'box-sizing: border-box',
    'padding: 8px 12px',
    'margin: 4px 0',
    'border: 1px solid color-mix(in srgb, currentColor 22%, transparent)',
    'border-radius: 10px',
    'background: color-mix(in srgb, currentColor 5%, transparent)',
    'color: inherit',
    'opacity: 0.84',
    'font: inherit',
    'font-size: 13px',
    'text-align: left',
    'cursor: pointer',
    'transition: opacity 120ms ease, background 120ms ease',
  ].join('; ');

  let revealed = false;
  note.addEventListener('click', () => {
    revealed = !revealed;
    note.setAttribute('aria-expanded', String(revealed));
    pill.textContent = revealed ? 'Hide' : 'Show';
    onToggleReveal(revealed);
  });
  return note;
}

export interface AppliedFilterState {
  readonly hidden: boolean;
  readonly dispose: () => void;
}

const SKIP_REPLACE_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT']);

function applyTextReplacements(
  root: HTMLElement,
  replacements: FilterOutcome['replacements'],
  itemScope: Scope,
): void {
  const originals: [node: Text, before: string][] = [];
  const walk = (node: Node): void => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const textNode = child as Text;
        const before = textNode.nodeValue ?? '';
        if (!before) {
          continue;
        }
        let after = before;
        for (const { find, replaceWith } of replacements) {
          after = after.replace(find, replaceWith);
        }
        if (after !== before) {
          originals.push([textNode, before]);
          textNode.nodeValue = after;
        }
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as Element;
        if (SKIP_REPLACE_TAGS.has(el.tagName) || el.hasAttribute(OWN_ATTR)) {
          continue;
        }
        walk(el);
        if (el.shadowRoot) {
          walk(el.shadowRoot);
        }
      }
    }
  };
  walk(root);
  if (root.shadowRoot) {
    walk(root.shadowRoot);
  }
  if (originals.length > 0) {
    itemScope.add(() => {
      for (const [textNode, before] of originals.toReversed()) {
        textNode.nodeValue = before;
      }
    });
  }
}

/** A quick-switch hide (ads, suggested, keywords): no note. */
const BUILT_IN_HIDING: FilterHiding = Object.freeze({
  label: '',
  showNote: false,
  forceNote: false,
});

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
    outcome.hiding ?? (builtInHide && !outcome.kept ? BUILT_IN_HIDING : null);
  const hasEffects =
    hiding !== null ||
    outcome.classes.length > 0 ||
    outcome.styles.length > 0 ||
    outcome.replacements.length > 0;
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

  applyClassesAndStyles(itemScope, outcome, (selector) =>
    selector ? queryTargets(element, selector) : [element],
  );

  if (outcome.replacements.length > 0) {
    applyTextReplacements(element, outcome.replacements, itemScope);
  }

  return {
    hidden: hiding !== null,
    dispose: () => itemScope.dispose(),
  };
}
