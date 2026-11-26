import { defineContentScript } from 'wxt/utils/define-content-script';
import { readSiteEnabledHint } from '../core/site-hint';
import { startRedditPageWorld } from '../sites/reddit/page-world';
import { REDDIT_EXCLUDE_MATCHES, REDDIT_MATCHES } from '../sites/reddit/urls';

export default defineContentScript({
  exclude: ['safari'],
  matches: [...REDDIT_MATCHES],
  excludeMatches: [...REDDIT_EXCLUDE_MATCHES],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    startRedditPageWorld(globalThis, document, {
      startActive: readSiteEnabledHint('reddit', false),
    });
  },
});
