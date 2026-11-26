import type { XPage } from '../feature';
import { createHideClutterFeature } from '../../../features/shared/hide-clutter';
import { X_NAV_EXPLORE, X_NAV_GROK, X_NAV_PREMIUM, X_SIDEBAR } from '../selectors';

/** Hides optional X chrome clutter (Grok, Premium, Right Sidebar, Explore) via zero-flash CSS rules. */
export default createHideClutterFeature<XPage>({
  id: 'x_hide_clutter',
  section: 'Timeline & Clutter',
  group: 'Hide from X',
  rules: [
    {
      key: 'x_hide_grok',
      spec: X_NAV_GROK,
      title: 'Grok',
      description: 'Nav link, floating drawer, and Grok buttons on posts and replies.',
    },
    {
      key: 'x_hide_premium',
      spec: X_NAV_PREMIUM,
      title: 'X Premium',
      description: 'Subscription upsell link in the left rail.',
    },
    {
      key: 'x_hide_sidebar',
      spec: X_SIDEBAR,
      title: 'Right sidebar',
      description: '"What\'s happening", "Who to follow", and live score cards.',
    },
    {
      key: 'x_hide_explore',
      spec: X_NAV_EXPLORE,
      title: 'Explore tab',
      description: 'Explore search link in the left rail.',
    },
  ],
});
