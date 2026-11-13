import { Listeners } from './listeners';
import { createLogger } from './log';

const listeners = new Listeners(createLogger('navigation'));
let lastHref = '';
let observer: MutationObserver | undefined;

function check(): void {
  if (location.href !== lastHref) {
    lastHref = location.href;
    listeners.emit();
  }
}

function stopWatching(): void {
  observer?.disconnect();
  observer = undefined;
  removeEventListener('popstate', check);
  removeEventListener('hashchange', check);
}

/**
 * Calls `listener` when the page address changes without a reload, as it does
 * when moving around a single-page app. Returns a function that stops it.
 *
 * A content script cannot see the page's `history.pushState` calls, so the
 * address is compared whenever the document changes. A new page always
 * changes the document, and the listener runs before any observer created
 * after this call sees those changes.
 */
export function onUrlChange(listener: () => void): () => void {
  if (listeners.size === 0) {
    lastHref = location.href;
    observer = new MutationObserver(check);
    observer.observe(document, { childList: true, subtree: true });
    addEventListener('popstate', check);
    addEventListener('hashchange', check);
  }
  const remove = listeners.add(listener);
  return () => {
    remove();
    if (listeners.size === 0) {
      stopWatching();
    }
  };
}
