import { defineContentScript } from 'wxt/utils/define-content-script';
import { startSite } from '../core/site';
import { EXCLUDE_GLOBS, EXCLUDE_MATCHES, MATCHES } from '../facebook/urls';
import { extensionPlatform } from '../platform/extension';
import { facebookSite } from '../sites/facebook';

export default defineContentScript({
  matches: [...MATCHES],
  excludeMatches: [...EXCLUDE_MATCHES],
  excludeGlobs: [...EXCLUDE_GLOBS],
  runAt: 'document_start',
  async main() {
    await startSite(facebookSite, extensionPlatform);
  },
});
