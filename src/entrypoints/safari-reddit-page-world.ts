import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { readSiteEnabledHint } from '../core/site-hint';
import { isExcludedUrl } from '../core/urls';
import { startRedditPageWorld } from '../sites/reddit/page-world';
import { REDDIT_EXCLUDE_MATCHES } from '../sites/reddit/urls';

// Safari MAIN-world entrypoint registered at `document_start` via
// `browser.scripting.registerContentScripts` (with on-demand `executeScript` fallback).
export default defineUnlistedScript({
  include: ['safari'],
  main() {
    if (isExcludedUrl(location.href, REDDIT_EXCLUDE_MATCHES)) {
      return;
    }
    startRedditPageWorld(globalThis, document, {
      startActive: readSiteEnabledHint('reddit', false),
    });
  },
});
