import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { isExcludedUrl } from '../core/urls';
import { EXCLUDE_GLOBS, EXCLUDE_MATCHES } from '../facebook/urls';
import { startFacebookPageWorld } from '../sites/facebook/page-world';

// Safari MAIN-world entrypoint registered at `document_start` via
// `browser.scripting.registerContentScripts` (with on-demand `executeScript` fallback).
export default defineUnlistedScript({
  include: ['safari'],
  main() {
    if (isExcludedUrl(location.href, EXCLUDE_MATCHES, EXCLUDE_GLOBS)) {
      return;
    }
    startFacebookPageWorld();
  },
});
