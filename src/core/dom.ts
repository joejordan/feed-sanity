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
