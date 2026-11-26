import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { isExcludedUrl } from '../core/urls';
import { startXPageWorld } from '../sites/x/page-world';
import { X_EXCLUDE_MATCHES } from '../sites/x/urls';

// Safari MAIN-world entrypoint registered at `document_start` via
// `browser.scripting.registerContentScripts` (with on-demand `executeScript` fallback).
export default defineUnlistedScript({
  include: ['safari'],
  main() {
    if (isExcludedUrl(location.href, X_EXCLUDE_MATCHES)) {
      return;
    }
    startXPageWorld();
  },
});
