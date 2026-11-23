import { defineContentScript } from 'wxt/utils/define-content-script';
import { startInstagramPageWorld } from '../sites/instagram/page-world';
import { INSTAGRAM_EXCLUDE_MATCHES, INSTAGRAM_MATCHES } from '../sites/instagram/urls';

export default defineContentScript({
  matches: [...INSTAGRAM_MATCHES],
  excludeMatches: [...INSTAGRAM_EXCLUDE_MATCHES],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    startInstagramPageWorld();
  },
});
