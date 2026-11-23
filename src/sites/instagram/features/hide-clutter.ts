import type { InstagramPage } from '../feature';
import { createHideClutterFeature } from '../../../features/shared/hide-clutter';
import { IG_NAV_EXPLORE, IG_NAV_REELS, IG_NAV_THREADS } from '../selectors';

function navItemContainer(link: Element): Element {
  // Instagram wraps each left-nav link inside a small wrapper div or list item.
  const parent = link.parentElement;
  if (parent && parent.childElementCount === 1 && parent.tagName !== 'NAV') {
    return parent;
  }
  return link;
}

/** Hides optional navigation links (Reels, Explore, Threads) cleanly via `createHideClutterFeature`. */
export default createHideClutterFeature<InstagramPage>({
  id: 'ig_hide_clutter',
  section: 'Feed & Clutter',
  group: 'Hide Navigation',
  rules: [
    {
      key: 'ig_hide_reels_nav',
      spec: IG_NAV_REELS,
      title: 'Hide Reels link',
      description: 'Hide the Reels tab from Instagram navigation.',
      target: navItemContainer,
    },
    {
      key: 'ig_hide_explore_nav',
      spec: IG_NAV_EXPLORE,
      title: 'Hide Explore link',
      description: 'Hide the Explore tab from Instagram navigation.',
      target: navItemContainer,
    },
    {
      key: 'ig_hide_threads_nav',
      spec: IG_NAV_THREADS,
      title: 'Hide Threads link',
      description: 'Hide the Threads promotional link from Instagram navigation.',
      target: navItemContainer,
    },
  ],
});
