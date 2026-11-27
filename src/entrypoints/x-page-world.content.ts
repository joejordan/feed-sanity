import { defineContentScript } from 'wxt/utils/define-content-script';
import { readSiteEnabledHint } from '../core/site-hint';
import { startXPageWorld } from '../sites/x/page-world';
import { X_EXCLUDE_MATCHES, X_MATCHES } from '../sites/x/urls';

export default defineContentScript({
  exclude: ['safari'],
  matches: [...X_MATCHES],
  excludeMatches: [...X_EXCLUDE_MATCHES],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    startXPageWorld(globalThis, { startActive: readSiteEnabledHint('x', true) });
  },
});
