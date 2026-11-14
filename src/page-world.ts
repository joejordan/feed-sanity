// The page-world side of the bridge, as every build runs it. It runs in the
// page's own world with the page's privileges, so it holds only the generic
// responder and this project's readers, and imports nothing else. Each build
// puts it in the page its own way: see `installPageWorld` in
// `src/core/platform.ts`.
import { servePageWorld } from './core/page-world';
import { PAGE_READERS } from './facebook/react-readers';

export function startPageWorld(): void {
  servePageWorld(PAGE_READERS);
}
