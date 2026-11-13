/**
 * Resolves with the first element matching `selector`, waiting for it to be
 * added if the page does not have it yet. Content scripts start before the
 * document is parsed, so even <head> may be missing at first.
 *
 * It never gives up, and it searches the whole document on every change
 * until the element shows up. Only wait for elements that are sure to appear.
 */
export function waitForElement(selector: string): Promise<Element> {
  const existing = document.querySelector(selector);
  if (existing) {
    return Promise.resolve(existing);
  }
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const element = document.querySelector(selector);
      if (element) {
        observer.disconnect();
        resolve(element);
      }
    });
    observer.observe(document, { childList: true, subtree: true });
  });
}

/**
 * Adds a style sheet to the page, for styling the page's own elements. Does
 * nothing if one with this ID is already there. UI this project draws itself
 * goes in a shadow root instead; see `src/ui/mount.tsx`.
 */
export async function addStyle(id: string, css: string): Promise<void> {
  const head = await waitForElement('head');
  if (document.querySelector(`#${CSS.escape(id)}`)) {
    return;
  }
  const style = document.createElement('style');
  style.id = id;
  style.textContent = css;
  head.append(style);
}

/** The elements matching `selector` in `root`, including `root` itself. */
export function probe(root: Element, selector: string): Element[] {
  return [...(root.matches(selector) ? [root] : []), ...root.querySelectorAll(selector)];
}

/** Elements that never hold page content worth reacting to. */
const SKIPPED_TAGS = /^(?:SCRIPT|LINK|INPUT|BR|STYLE|META|IFRAME|AUDIO|EMBED)$/i;

const isWatched = (node: Node): node is Element =>
  node.nodeType === Node.ELEMENT_NODE && !SKIPPED_TAGS.test(node.nodeName);

export interface TreeChanges {
  added?: (element: Element) => void;
  removed?: (element: Element) => void;
}

/**
 * Reports each element added to or removed from `root`, at any depth. Only
 * the top element of an added or removed subtree is reported; use `probe` to
 * look inside it. Returns a function that stops watching.
 */
export function watchTree(root: Node, changes: TreeChanges): () => void {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (isWatched(node)) {
          changes.added?.(node);
        }
      }
      for (const node of mutation.removedNodes) {
        if (isWatched(node)) {
          changes.removed?.(node);
        }
      }
    }
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}
