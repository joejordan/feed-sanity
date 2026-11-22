import type { XPage } from '../feature';
import { createFeedFiltersFeature } from '../../../features/shared/feed-filters';

/**
 * Hides Promoted ads (both by stripping promoted entries from GraphQL timeline
 * responses via the MAIN-world Network Tap before React Native Web measures
 * virtualized row heights AND by hiding any DOM/fiber promoted tweets),
 * suggested topic posts, and keyword-matched tweets.
 */
export default createFeedFiltersFeature<XPage>({
  id: 'x_feed_filters',
  prefix: 'x',
  itemSelector: 'article[data-testid="tweet"]',
  sponsoredTitle: 'Hide Promoted posts',
  sponsoredDescription:
    'Strip Promoted ads from timeline API responses before render (preventing blank gaps) and hide any remaining promoted tweets.',
  suggestedTitle: 'Hide Suggested topic posts',
  suggestedDescription: 'Hide algorithmic topic and community recommendations in the timeline.',
  onSponsoredChange: (() => {
    const cleanedScopes = new WeakSet<object>();
    return (page, enabled, scope) => {
      page.setStripPromoted(enabled);
      if (enabled && !cleanedScopes.has(scope)) {
        cleanedScopes.add(scope);
        scope.add(() => page.setStripPromoted(false));
      }
    };
  })(),
});
