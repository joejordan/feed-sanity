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
  group: 'Hide from Sidebar',
  rules: [
    {
      key: 'ig_hide_reels_nav',
      spec: IG_NAV_REELS,
      title: 'Reels',
      description: 'Removes the Reels tab from the left sidebar.',
      target: navItemContainer,
    },
    {
      key: 'ig_hide_explore_nav',
      spec: IG_NAV_EXPLORE,
      title: 'Explore',
      description: 'Removes the Explore tab from the left sidebar.',
      target: navItemContainer,
    },
    {
      key: 'ig_hide_threads_nav',
      spec: IG_NAV_THREADS,
      title: 'Threads',
      description: 'Removes the Threads cross-promo link at the bottom of the menu.',
      target: navItemContainer,
    },
  ],
});
