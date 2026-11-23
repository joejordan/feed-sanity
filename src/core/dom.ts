import { PageWatcher, pageWatcher } from './page-watcher';

/**
 * Resolves with the first element matching `selector`, waiting for it to be
 * added if the page does not have it yet. Content scripts start before the
 * document is parsed, so even <head> may be missing at first.
 *
 * It never gives up. Only wait for elements that are sure to appear.
 */
export function waitForElement(selector: string): Promise<Element> {
  return pageWatcher.waitForElement(selector);
}

/**
 * Adds a style sheet to `root` (defaults to the main `document`, also accepts
 * same-origin iframe `Document`s and open `ShadowRoot`s). Does nothing if one
 * with this ID is already present in `root`.
 *
 * Returns a function that removes the style sheet again, for `scope.add`.
 * Before a document has a `<head>`, the sheet is added once it does.
 */
export function addStyle(
  id: string,
  css: string,
  root: Document | ShadowRoot = document,
): () => void {
  const selector = `#${CSS.escape(id)}`;
  if (root.nodeType !== Node.DOCUMENT_NODE) {
    if (root.querySelector(selector)) {
      return () => undefined;
    }
    const owner = root.ownerDocument ?? document;
    const style = owner.createElement('style');
    style.id = id;
    style.textContent = css;
    root.append(style);
    return () => style.remove();
  }
  const doc = root as Document;
  let removed = false;
  let style: HTMLStyleElement | undefined;
  let stopWait: (() => void) | undefined;
  const insert = (head: Element): void => {
    if (removed || doc.querySelector(selector)) {
      return;
    }
    style = doc.createElement('style');
    style.id = id;
    style.textContent = css;
    head.append(style);
  };
  if (doc.head) {
    insert(doc.head);
  } else {
    const watcher = doc === document ? pageWatcher : new PageWatcher(undefined, doc);
    stopWait = watcher.watch('head', {
      added: (head) => {
        stopWait?.();
        stopWait = undefined;
        insert(head);
      },
    });
  }
  return () => {
    removed = true;
    stopWait?.();
    stopWait = undefined;
    style?.remove();
  };
}

/** The elements matching `selector` in `root`, including `root` itself. */
export function probe(root: Element, selector: string): Element[] {
  return [...(root.matches(selector) ? [root] : []), ...root.querySelectorAll(selector)];
}

/** True when `node` is a `ShadowRoot` (works across realms/DOM implementations). */
export function isShadowRoot(node: Node): node is ShadowRoot {
  return node.nodeType === Node.DOCUMENT_FRAGMENT_NODE && 'host' in node;
}

/** Returns the host `Element` when `node` lives inside a `ShadowRoot`, else `null`. */
export function shadowHostOf(node: Node): Element | null {
  const root = node.getRootNode();
  return isShadowRoot(root) ? root.host : null;
}

/** Like `ancestor.contains(node)`, but steps across open Shadow DOM boundaries. */
export function containsAcrossShadows(ancestor: Element, node: Node): boolean {
  let current: Node | null = node;
  while (current) {
    if (ancestor.contains(current)) {
      return true;
    }
    current = shadowHostOf(current);
  }
  return false;
}

/** Like `node.parentElement`, stepping out to the shadow host at a `ShadowRoot` boundary. */
export function parentAcrossShadows(node: Element): Element | null {
  return node.parentElement ?? shadowHostOf(node);
}

/** Like `element.closest(selector)`, stepping out across open Shadow DOM boundaries. */
export function closestAcrossShadows(element: Element, selector: string): Element | null {
  let current: Element | null = element;
  while (current) {
    const match = current.closest(selector);
    if (match) {
      return match;
    }
    current = shadowHostOf(current);
  }
  return null;
}

function walkElementSubtreeForShadows(
  parent: ParentNode,
  skipAttr: string | undefined,
  onShadow: (shadow: ShadowRoot) => void,
): void {
  for (const child of parent.children) {
    if (skipAttr && child.hasAttribute(skipAttr)) {
      continue;
    }
    if (child.shadowRoot) {
      onShadow(child.shadowRoot);
    }
    if (child.childElementCount > 0) {
      walkElementSubtreeForShadows(child, skipAttr, onShadow);
    }
  }
}

function isInsideSkipped(el: Element, boundary: ParentNode, skipAttr: string): boolean {
  let current: Element | null = el;
  while (current && current !== boundary) {
    if (current.hasAttribute(skipAttr)) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

/**
 * Queries `selector` across `root` and any nested open `ShadowRoot`s while
 * skipping subtrees marked with `skipAttr` (such as `OWN_ATTR`).
 */
export function queryDeepAll(root: ParentNode, selector: string, skipAttr?: string): Element[] {
  if (skipAttr && root instanceof Element && root.hasAttribute(skipAttr)) {
    return [];
  }
  const out: Element[] = [];
  const visitScope = (scope: ParentNode): void => {
    for (const match of scope.querySelectorAll(selector)) {
      if (!skipAttr || !isInsideSkipped(match, scope, skipAttr)) {
        out.push(match);
      }
    }
    walkElementSubtreeForShadows(scope, skipAttr, visitScope);
  };
  visitScope(root);
  if (root instanceof Element && root.shadowRoot) {
    visitScope(root.shadowRoot);
  }
  return out;
}

/**
 * Shallow-first (BFS) query for the first element matching `selector` inside
 * `root` or its nested open `ShadowRoot`s, skipping subtrees marked with `skipAttr`.
 */
export function queryDeepFirst(
  root: ParentNode,
  selector: string,
  skipAttr?: string,
): Element | null {
  if (skipAttr && root instanceof Element && root.hasAttribute(skipAttr)) {
    return null;
  }
  const queue: ParentNode[] =
    root instanceof Element && root.shadowRoot ? [root, root.shadowRoot] : [root];
  for (const scope of queue) {
    if (skipAttr) {
      for (const candidate of scope.querySelectorAll(selector)) {
        if (!isInsideSkipped(candidate, scope, skipAttr)) {
          return candidate;
        }
      }
    } else {
      const found = scope.querySelector(selector);
      if (found) {
        return found;
      }
    }
    walkElementSubtreeForShadows(scope, skipAttr, (shadow) => queue.push(shadow));
  }
  return null;
}
