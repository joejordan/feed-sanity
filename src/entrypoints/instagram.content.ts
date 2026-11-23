import { defineContentScript } from 'wxt/utils/define-content-script';
import { startSite } from '../core/site';
import { extensionPlatform } from '../platform/extension';
import { instagramSite } from '../sites/instagram';
import { INSTAGRAM_EXCLUDE_MATCHES, INSTAGRAM_MATCHES } from '../sites/instagram/urls';

export default defineContentScript({
  matches: [...INSTAGRAM_MATCHES],
  excludeMatches: [...INSTAGRAM_EXCLUDE_MATCHES],
  runAt: 'document_start',
  async main() {
    await startSite(instagramSite, extensionPlatform);
  },
});
