import type { InstagramPage } from '../feature';
import { createFeedFiltersFeature } from '../../../features/shared/feed-filters';

/**
 * Hides Sponsored ads, "Suggested for you" algorithmic posts, and keyword-matched
 * posts in Instagram's feed via the shared `FeedCapability` filter engine.
 */
export default createFeedFiltersFeature<InstagramPage>({
  id: 'ig_feed_filters',
  prefix: 'ig',
  itemSelector: 'article',
  sponsoredTitle: 'Hide Sponsored posts',
  sponsoredDescription: 'Hides Sponsored posts as they load in your feed.',
  suggestedTitle: 'Hide Suggested posts',
  suggestedDescription: 'Hides "Suggested for you" posts from accounts you do not follow.',
});
