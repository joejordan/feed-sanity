import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { isExcludedUrl } from '../core/urls';
import { startInstagramPageWorld } from '../sites/instagram/page-world';
import { INSTAGRAM_EXCLUDE_MATCHES } from '../sites/instagram/urls';

// Safari MAIN-world entrypoint registered at `document_start` via
// `browser.scripting.registerContentScripts` (with on-demand `executeScript` fallback).
export default defineUnlistedScript({
  include: ['safari'],
  main() {
    if (isExcludedUrl(location.href, INSTAGRAM_EXCLUDE_MATCHES)) {
      return;
    }
    startInstagramPageWorld();
  },
});
