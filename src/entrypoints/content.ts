import { defineContentScript } from 'wxt/utils/define-content-script';
import { EXCLUDE_GLOBS, EXCLUDE_MATCHES, MATCHES } from '../facebook/urls';
import { extensionStore } from '../platform/extension-store';
import { start } from '../start';

export default defineContentScript({
  matches: MATCHES,
  excludeMatches: EXCLUDE_MATCHES,
  excludeGlobs: EXCLUDE_GLOBS,
  runAt: 'document_start',
  async main() {
    await start(extensionStore);
  },
});
