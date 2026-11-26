import { defineContentScript } from 'wxt/utils/define-content-script';
import { readSiteEnabledHint } from '../core/site-hint';
import { startInstagramPageWorld } from '../sites/instagram/page-world';
import { INSTAGRAM_EXCLUDE_MATCHES, INSTAGRAM_MATCHES } from '../sites/instagram/urls';

export default defineContentScript({
  exclude: ['safari'],
  matches: [...INSTAGRAM_MATCHES],
  excludeMatches: [...INSTAGRAM_EXCLUDE_MATCHES],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    startInstagramPageWorld(globalThis, { startActive: readSiteEnabledHint('instagram', false) });
  },
});
