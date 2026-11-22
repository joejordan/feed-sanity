import { defineContentScript } from 'wxt/utils/define-content-script';
import { servePageWorld } from '../core/page-world';
import { PAGE_ACTIONS } from '../facebook/page-actions';
import { PAGE_MOUNTS } from '../facebook/page-mounts';
import { PAGE_TOGGLES } from '../facebook/page-toggles';
import { PAGE_READERS } from '../facebook/react-readers';
import { EXCLUDE_GLOBS, EXCLUDE_MATCHES, MATCHES } from '../facebook/urls';

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
    servePageWorld(PAGE_READERS, PAGE_TOGGLES, PAGE_ACTIONS, PAGE_MOUNTS);
  },
});
