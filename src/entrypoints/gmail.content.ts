import { defineContentScript } from 'wxt/utils/define-content-script';
import { startSite } from '../core/site';
import { extensionPlatform } from '../platform/extension';
import { gmailSite } from '../sites/gmail';
import { GMAIL_EXCLUDE_MATCHES, GMAIL_MATCHES } from '../sites/gmail/urls';

export default defineContentScript({
  matches: [...GMAIL_MATCHES],
  excludeMatches: [...GMAIL_EXCLUDE_MATCHES],
  runAt: 'document_start',
  async main() {
    await startSite(gmailSite, extensionPlatform);
  },
});
