import type { LocatorSpec } from '../../../core/locator';
import type { Scope } from '../../../core/scope';
import { hideElement } from '../../../core/surface';
import { defineInstagramFeature } from '../feature';
import { IG_NAV_EXPLORE, IG_NAV_REELS, IG_NAV_THREADS } from '../selectors';

const NAV_RULES = [
  { key: 'ig_hide_reels_nav', spec: IG_NAV_REELS },
  { key: 'ig_hide_explore_nav', spec: IG_NAV_EXPLORE },
  { key: 'ig_hide_threads_nav', spec: IG_NAV_THREADS },
] as const;

function navItemContainer(link: Element): Element {
  // Instagram wraps each left-nav link inside a small wrapper div or list item.
  const parent = link.parentElement;
  if (parent && parent.childElementCount === 1 && parent.tagName !== 'NAV') {
    return parent;
  }
  return link;
}

/** Hides optional navigation links (Reels, Explore, Threads) cleanly via `hideElement`. */
export default defineInstagramFeature({
  id: 'ig_hide_clutter',
  options: {
    ig_hide_reels_nav: {
      section: 'Navigation',
      title: 'Hide Reels link',
      description: 'Hide the Reels tab from Instagram navigation.',
      default: false,
    },
    ig_hide_explore_nav: {
      section: 'Navigation',
      title: 'Hide Explore link',
      description: 'Hide the Explore tab from Instagram navigation.',
      default: false,
    },
    ig_hide_threads_nav: {
      section: 'Navigation',
      title: 'Hide Threads link',
      description: 'Hide the Threads promotional link from Instagram navigation.',
      default: false,
    },
  },
  setup({ page, options, scope }) {
    const watchNav = (spec: LocatorSpec, ruleScope: Scope): void => {
      const hidden = new Map<Element, () => void>();
      ruleScope.add(
        page.watch(page.locate(spec), {
          added: (link) => {
            const target = navItemContainer(link);
            if (!hidden.has(link)) {
              hidden.set(link, hideElement(ruleScope, target));
            }
          },
          removed: (link) => {
            hidden.get(link)?.();
            hidden.delete(link);
          },
        }),
      );
    };

    for (const { key, spec } of NAV_RULES) {
      let activeScope: Scope | undefined;
      options.watch(key, (enabled) => {
        if (enabled && !activeScope) {
          activeScope = scope.child();
          watchNav(spec, activeScope);
        } else if (!enabled && activeScope) {
          activeScope.dispose();
          activeScope = undefined;
        }
      });
    }
  },
});
