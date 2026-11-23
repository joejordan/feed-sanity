import type { RedditPage } from '../feature';
import { createFeedFiltersFeature } from '../../../features/shared/feed-filters';

/**
 * Hides Promoted ads (`shreddit-ad-post`, SSR-indexed promoted `t3_*` posts,
 * and Shadow DOM "Promoted" badges), recommended/suggested posts, keyword
 * matches, and custom Filter Rules (including reversible text redaction across
 * nested open Shadow Roots).
 */
export default createFeedFiltersFeature<RedditPage>({
  id: 'reddit_feed_filters',
  prefix: 'reddit',
  itemSelector:
    'shreddit-post, shreddit-ad-post, shreddit-dynamic-ad-link, article[data-testid="post-container"]',
  sponsoredTitle: 'Hide Promoted posts',
  sponsoredDescription: 'Hide Promoted ads and ad links in Home, Popular, and subreddit feeds.',
  suggestedTitle: 'Hide Recommended posts',
  suggestedDescription:
    'Hide algorithmic "Because you visited" and "Popular near you" recommendations.',
});
