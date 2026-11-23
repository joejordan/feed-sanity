// The page-world side of the bridge, as every build runs it. It runs in the
// page's own world with the page's privileges, so it holds only the generic
// responder and this project's readers, and imports nothing else. Each build
// puts it in the page its own way: see `installPageWorld` in
// `src/core/platform.ts`.
import { isFacebookHost } from './facebook/urls';
import { startFacebookPageWorld } from './sites/facebook/page-world';
import { startInstagramPageWorld } from './sites/instagram/page-world';
import { isInstagramHost } from './sites/instagram/urls';
import { startRedditPageWorld } from './sites/reddit/page-world';
import { isRedditHost } from './sites/reddit/urls';
import { startXPageWorld } from './sites/x/page-world';
import { isXHost } from './sites/x/urls';

export function startPageWorld(): void {
  if (typeof location === 'undefined') {
    return;
  }
  const { hostname } = location;
  if (isFacebookHost(hostname)) {
    startFacebookPageWorld();
  } else if (isInstagramHost(hostname)) {
    startInstagramPageWorld();
  } else if (isXHost(hostname)) {
    startXPageWorld();
  } else if (isRedditHost(hostname)) {
    startRedditPageWorld();
  }
}
