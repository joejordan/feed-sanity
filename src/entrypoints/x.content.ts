import { defineContentScript } from 'wxt/utils/define-content-script';
import { startSite } from '../core/site';
import { extensionPlatform } from '../platform/extension';
import { xSite } from '../sites/x';
import { X_EXCLUDE_MATCHES, X_MATCHES } from '../sites/x/urls';

export default defineContentScript({
  matches: [...X_MATCHES],
  excludeMatches: [...X_EXCLUDE_MATCHES],
  runAt: 'document_start',
  async main() {
    await startSite(xSite, extensionPlatform);
  },
});
