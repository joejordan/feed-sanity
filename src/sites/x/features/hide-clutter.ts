import type { XPage } from '../feature';
import { createHideClutterFeature } from '../../../features/shared/hide-clutter';
import { X_NAV_EXPLORE, X_NAV_GROK, X_NAV_PREMIUM, X_SIDEBAR } from '../selectors';

/** Hides optional X chrome clutter (Grok, Premium, Right Sidebar, Explore) via zero-flash CSS rules. */
export default createHideClutterFeature<XPage>({
  id: 'x_hide_clutter',
  section: 'Timeline & Clutter',
  group: 'Hide Page Clutter',
  rules: [
    {
      key: 'x_hide_grok',
      spec: X_NAV_GROK,
      title: 'Hide Grok',
      description:
        'Hide the Grok navigation link, floating drawer, and Grok buttons on posts and replies.',
    },
    {
      key: 'x_hide_premium',
      spec: X_NAV_PREMIUM,
      title: 'Hide Premium link',
      description: 'Hide the X Premium subscription link from navigation.',
    },
    {
      key: 'x_hide_sidebar',
      spec: X_SIDEBAR,
      title: 'Hide right sidebar',
      description:
        'Hide the right sidebar column ("What\'s happening", "Who to follow", and scores).',
    },
    {
      key: 'x_hide_explore',
      spec: X_NAV_EXPLORE,
      title: 'Hide Explore link',
      description: 'Hide the Explore tab from navigation.',
    },
  ],
});
