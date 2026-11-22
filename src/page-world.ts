// The page-world side of the bridge, as every build runs it. It runs in the
// page's own world with the page's privileges, so it holds only the generic
// responder and this project's readers, and imports nothing else. Each build
// puts it in the page its own way: see `installPageWorld` in
// `src/core/platform.ts`.
import { servePageWorld } from './core/page-world';
import { PAGE_ACTIONS } from './facebook/page-actions';
import { PAGE_MOUNTS } from './facebook/page-mounts';
import { PAGE_TOGGLES } from './facebook/page-toggles';
import { PAGE_READERS } from './facebook/react-readers';
import { startInstagramPageWorld } from './sites/instagram/page-world';
import { isInstagramHost } from './sites/instagram/urls';

export function startPageWorld(): void {
  if (typeof location !== 'undefined' && isInstagramHost(location.hostname)) {
    startInstagramPageWorld();
    return;
  }
  servePageWorld(PAGE_READERS, PAGE_TOGGLES, PAGE_ACTIONS, PAGE_MOUNTS);
}
