import type { GmailPage } from '../feature';
import { createThreadFiltersFeature } from '../../../features/shared/thread-filters';

/**
 * Hides inline Promotions/Social ad rows and keyword-matched email threads in
 * Gmail using the cross-site `ThreadListCapability` (zero React, Trusted Types safe).
 */
export default createThreadFiltersFeature<GmailPage>({
  id: 'gmail_thread_filters',
  prefix: 'gmail',
  adsTitle: 'Hide inbox ads',
  adsDescription: 'Hide sponsored ad rows in Gmail Promotions and Social tabs.',
  keywordsTitle: 'Hide threads containing keywords',
  keywordsDescription:
    'Hide inbox threads whose sender, subject, or snippet matches any keyword (one per line).',
});
