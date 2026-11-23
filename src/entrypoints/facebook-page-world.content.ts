import { defineContentScript } from 'wxt/utils/define-content-script';
import { EXCLUDE_GLOBS, EXCLUDE_MATCHES, MATCHES } from '../facebook/urls';
import { startFacebookPageWorld } from '../sites/facebook/page-world';

export default defineContentScript({
  matches: [...MATCHES],
  excludeMatches: [...EXCLUDE_MATCHES],
  excludeGlobs: [...EXCLUDE_GLOBS],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    startFacebookPageWorld();
  },
});
