import { defineContentScript } from 'wxt/utils/define-content-script';
import { EXCLUDE_GLOBS, EXCLUDE_MATCHES, MATCHES } from '../facebook/urls';
import { startPageWorld } from '../page-world';

// The page-world side of the bridge, run by the browser in the page's own
// world beside Facebook's scripts. Chrome runs `world: 'MAIN'` content
// scripts from version 111 in Manifest V3, and Firefox from version 128 in
// Manifest V2 and V3. It needs no permission and is not held back by the
// page's content security policy. It has no extension API, and the page can
// see and change everything it does, so it holds nothing but the readers.
export default defineContentScript({
  matches: MATCHES,
  excludeMatches: EXCLUDE_MATCHES,
  excludeGlobs: EXCLUDE_GLOBS,
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    startPageWorld();
  },
});
