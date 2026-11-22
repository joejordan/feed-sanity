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
  sponsoredDescription:
    'Hide Sponsored ads in the Instagram feed using React fiber metadata and feed labels.',
  suggestedTitle: 'Hide Suggested posts',
  suggestedDescription: 'Hide "Suggested for you" posts from accounts you do not follow.',
});
