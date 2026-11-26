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
    'Drops Promoted posts before they render so ads vanish without leaving blank gaps.',
  suggestedTitle: 'Hide Suggested topic posts',
  suggestedDescription: 'Hides algorithmic topic and community recommendations in your timeline.',
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
