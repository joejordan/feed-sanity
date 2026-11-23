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
  group: 'Hide Page Clutter',
  rules: [
    {
      key: 'reddit_hide_sidebar',
      spec: REDDIT_RIGHT_RAIL,
      title: 'Hide right sidebar',
      description:
        'Hide the right sidebar rail (Popular Communities, carousels, and community info).',
    },
    {
      key: 'reddit_hide_recent',
      spec: REDDIT_RECENT_POSTS,
      title: 'Hide Recent Posts panel',
      description: 'Hide the Recent Posts widget from the sidebar.',
    },
    {
      key: 'reddit_hide_games',
      spec: REDDIT_GAMES_NAV,
      title: 'Hide Games navigation',
      description: 'Hide the Games section in the left navigation drawer.',
    },
    {
      key: 'reddit_hide_promos',
      spec: REDDIT_PROMO_BANNER,
      title: 'Hide promo banners and signup drawers',
      description: 'Hide app-install prompts, signup drawers, and promotional banners.',
    },
  ],
});
