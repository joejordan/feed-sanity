import type { AtomTranslator } from '../../facebook/atoms';
import type { PostFields } from '../../facebook/post-fields';
import type { Post } from '../../facebook/posts';
import type { Outcome } from './engine';
import { TEXT_FIELDS } from '../../facebook/post-fields';
import { hidePost, unhidePost } from './hide';

/**
 * What an outcome changed on a post besides hiding it, kept so it can be
 * undone. The elements are held weakly, so that content Facebook has taken
 * out of a post can be freed.
 */
export interface Applied {
  classes: [element: WeakRef<Element>, name: string][];
  /** The value each style property had before. */
  styles: [element: WeakRef<HTMLElement>, property: string, before: string][];
}

/**
 * The text nodes a `replace` action has rewritten, with the text it left.
 * A node still holding that text is not rewritten again, or a replacement
 * that contains what it replaces would grow every time the post is filtered.
 */
const rewritten = new WeakMap<Node, string>();

function rewrite(root: Node, replacements: Outcome['replacements']): void {
  for (const child of root.childNodes) {
    if (child.nodeType !== Node.TEXT_NODE) {
      rewrite(child, replacements);
      continue;
    }
    const before = child.nodeValue ?? '';
    if (rewritten.get(child) === before) {
      continue;
    }
    // All of them at once: a node is skipped once it holds rewritten text,
    // so a second pass would never reach what the first one changed.
    const after = replacements.reduce(
      (text, { find, replace }) => text.replace(find, replace),
      before,
    );
    if (after !== before) {
      child.nodeValue = after;
      rewritten.set(child, after);
    }
  }
}

/** The elements an action targets: the post, or the ones inside it matching `selector`. */
function targets(post: HTMLElement, selector: string | undefined, atoms: AtomTranslator) {
  if (!selector) {
    return [post];
  }
  try {
    return [...post.querySelectorAll<HTMLElement>(atoms.translate(selector))];
  } catch {
    // Not a valid selector.
    return [];
  }
}

/** Takes back the classes and styles an earlier outcome put on a post. */
export function undo(applied: Applied | undefined): void {
  for (const [element, name] of applied?.classes ?? []) {
    element.deref()?.classList.remove(name);
  }
  // Last first, so a property set twice goes back to its first value.
  for (const [element, property, before] of (applied?.styles ?? []).toReversed()) {
    element.deref()?.style.setProperty(property, before);
  }
}

/**
 * Makes a post look the way `outcome` says. `previous` is what the last
 * outcome changed, which is undone first, so that a filter the user removed
 * or edited leaves nothing behind. Rewritten text is the exception: it stays
 * until Facebook draws the post again.
 */
export function applyOutcome(
  post: Post,
  outcome: Outcome,
  fields: PostFields,
  atoms: AtomTranslator,
  previous?: Applied,
): Applied {
  undo(previous);
  const applied: Applied = { classes: [], styles: [] };
  const { element } = post;

  for (const { name, selector } of outcome.classes) {
    const classNames = name.split(/\s+/).filter(Boolean);
    for (const target of targets(element, selector, atoms)) {
      const held = new WeakRef(target);
      for (const className of classNames) {
        if (!target.classList.contains(className)) {
          target.classList.add(className);
          applied.classes.push([held, className]);
        }
      }
    }
  }
  for (const { property, value, selector } of outcome.styles) {
    for (const target of targets(element, selector, atoms)) {
      applied.styles.push([new WeakRef(target), property, target.style.getPropertyValue(property)]);
      const plain = value.replace(/\s*!important\s*$/i, '');
      target.style.setProperty(property, plain, plain === value ? '' : 'important');
    }
  }
  if (outcome.replacements.length > 0) {
    for (const name of TEXT_FIELDS) {
      for (const holder of fields.elements(name)) {
        rewrite(holder, outcome.replacements);
      }
    }
  }
  if (outcome.hiding) {
    hidePost(post, outcome.hiding);
  } else {
    unhidePost(post);
  }
  return applied;
}
