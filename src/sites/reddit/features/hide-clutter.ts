import type { RedditPage } from '../feature';
import { createHideClutterFeature } from '../../../features/shared/hide-clutter';
import {
  REDDIT_GAMES_NAV,
  REDDIT_PROMO_BANNER,
  REDDIT_RECENT_POSTS,
  REDDIT_RIGHT_RAIL,
} from '../selectors';

/**
 * Hides optional Reddit (Shreddit) chrome clutter across both light DOM and
 * nested open Shadow Roots via zero-flash scoped CSS rules.
 */
export default createHideClutterFeature<RedditPage>({
  id: 'reddit_hide_clutter',
  section: 'Layout & Clutter',
  group: 'Hide from Reddit',
  rules: [
    {
      key: 'reddit_hide_sidebar',
      spec: REDDIT_RIGHT_RAIL,
      title: 'Right sidebar',
      description: 'Popular Communities, carousels, and the community info rail.',
    },
    {
      key: 'reddit_hide_recent',
      spec: REDDIT_RECENT_POSTS,
      title: 'Recent Posts',
      description: 'The Recent Posts widget in the right rail.',
    },
    {
      key: 'reddit_hide_games',
      spec: REDDIT_GAMES_NAV,
      title: 'Games',
      description: 'The Games section in the left navigation drawer.',
    },
    {
      key: 'reddit_hide_promos',
      spec: REDDIT_PROMO_BANNER,
      title: 'App promos and signup drawers',
      description: 'Install-app banners, signup prompts, and promotional overlays.',
    },
  ],
});
