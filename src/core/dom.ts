import { pageWatcher } from './page-watcher';

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
 * Adds a style sheet to the page, for styling the page's own elements. Does
 * nothing if one with this ID is already there. UI this project draws itself
 * goes in a shadow root instead; see `src/ui/mount.tsx`.
 *
 * Returns a function that removes the style sheet again, for `scope.add`.
 * Before the page has a <head>, the sheet is added once it does.
 */
export function addStyle(id: string, css: string): () => void {
  let removed = false;
  let style: HTMLStyleElement | undefined;
  const insert = (head: Element): void => {
    if (removed || document.querySelector(`#${CSS.escape(id)}`)) {
      return;
    }
    style = document.createElement('style');
    style.id = id;
    style.textContent = css;
    head.append(style);
  };
  if (document.head) {
    insert(document.head);
  } else {
    // Never rejects.
    waitForElement('head').then(insert);
  }
  return () => {
    removed = true;
    style?.remove();
  };
}

/** The elements matching `selector` in `root`, including `root` itself. */
export function probe(root: Element, selector: string): Element[] {
  return [...(root.matches(selector) ? [root] : []), ...root.querySelectorAll(selector)];
}
