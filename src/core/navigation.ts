import { pageWatcher } from './page-watcher';

/**
 * Calls `listener` when the page address changes without a reload, as it does
 * when moving around a single-page app. Returns a function that stops it.
 *
 * The check runs on the content script's shared page watcher; see
 * `PageWatcher.onUrlChange` in `src/core/page-watcher.ts`.
 */
export function onUrlChange(listener: () => void): () => void {
  return pageWatcher.onUrlChange(listener);
}
