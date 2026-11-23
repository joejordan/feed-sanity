import { defineContentScript } from 'wxt/utils/define-content-script';
import { startSite } from '../core/site';
import { extensionPlatform } from '../platform/extension';
import { redditSite } from '../sites/reddit';
import { REDDIT_EXCLUDE_MATCHES, REDDIT_MATCHES } from '../sites/reddit/urls';

export default defineContentScript({
  matches: [...REDDIT_MATCHES],
  excludeMatches: [...REDDIT_EXCLUDE_MATCHES],
  runAt: 'document_start',
  async main() {
    await startSite(redditSite, extensionPlatform);
  },
});
