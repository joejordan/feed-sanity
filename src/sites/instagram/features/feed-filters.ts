import type { Scope } from '../../../core/scope';
import type { InstagramPost } from '../feed';
import { concealPending, hideElement, markElement } from '../../../core/surface';
import { defineInstagramFeature } from '../feature';

const ACTIVE_ATTR = 'data-feed-sanity-ig-filtering';
const CHECKED_ATTR = 'data-feed-sanity-ig-checked';
const CONCEAL_STYLE_ID = 'feed_sanity_ig_conceal';

function parseKeywords(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line.length > 0);
}

function shouldHide(
  post: InstagramPost,
  hideSponsored: boolean,
  hideSuggested: boolean,
  keywords: readonly string[],
): boolean {
  if ((hideSponsored && post.isAd) || (hideSuggested && post.isSuggested)) {
    return true;
  }
  if (keywords.length === 0) {
    return false;
  }
  const lower = post.readLowerText();
  return keywords.some((kw) => lower.includes(kw));
}

/**
 * Hides Sponsored ads, "Suggested for you" algorithmic posts, and keyword-matched
 * posts in Instagram's feed with zero-flash pre-paint concealment (`concealPending`)
 * and live toolbar badge counting. Stays completely idle when all three rules are off.
 */
export default defineInstagramFeature({
  id: 'ig_feed_filters',
  options: {
    ig_hide_sponsored: {
      section: 'Feed',
      title: 'Hide Sponsored posts',
      description:
        'Hide Sponsored ads in the Instagram feed using React fiber metadata and feed labels.',
      default: true,
    },
    ig_hide_suggested: {
      section: 'Feed',
      title: 'Hide Suggested posts',
      description: 'Hide "Suggested for you" posts from accounts you do not follow.',
      default: true,
    },
    ig_keywords: {
      section: 'Feed',
      title: 'Hide posts matching keywords',
      description: 'One keyword or phrase per line (case-insensitive).',
      default: '',
      multiline: true,
    },
  },
  setup({ page, options, scope, badge }) {
    let hideSponsored = options.get('ig_hide_sponsored');
    let hideSuggested = options.get('ig_hide_suggested');
    let keywords = parseKeywords(options.get('ig_keywords'));

    let activeScope: Scope | undefined;
    let reevaluateActive: (() => void) | undefined;

    const startFiltering = (subScope: Scope): (() => void) => {
      const tracked = new Map<HTMLElement, InstagramPost>();
      const hideRemovers = new Map<HTMLElement, () => void>();
      const checkedRemovers = new Map<HTMLElement, () => void>();

      const updateBadge = (): void => {
        badge(hideRemovers.size);
      };

      page.doc.documentElement?.setAttribute(ACTIVE_ATTR, '');
      concealPending(subScope, {
        id: CONCEAL_STYLE_ID,
        activeAttr: ACTIVE_ATTR,
        pendingSelector: `article:not([${CHECKED_ATTR}])`,
        maxMs: 250,
      });
      subScope.add(() => {
        page.doc.documentElement?.removeAttribute(ACTIVE_ATTR);
        hideRemovers.clear();
        checkedRemovers.clear();
        tracked.clear();
        badge(0);
      });

      const evaluate = (post: InstagramPost): void => {
        if (!checkedRemovers.has(post.element)) {
          checkedRemovers.set(post.element, markElement(subScope, post.element, CHECKED_ATTR, '1'));
        }
        const hide = shouldHide(post, hideSponsored, hideSuggested, keywords);
        const existingHide = hideRemovers.get(post.element);
        if (hide && !existingHide) {
          hideRemovers.set(post.element, hideElement(subScope, post.element));
          updateBadge();
        } else if (!hide && existingHide) {
          existingHide();
          hideRemovers.delete(post.element);
          updateBadge();
        }
      };

      const forget = (post: InstagramPost): void => {
        tracked.delete(post.element);
        const unhide = hideRemovers.get(post.element);
        if (unhide) {
          unhide();
          hideRemovers.delete(post.element);
          updateBadge();
        }
        const unmark = checkedRemovers.get(post.element);
        if (unmark) {
          unmark();
          checkedRemovers.delete(post.element);
        }
      };

      subScope.add(
        page.feed.onAdd((post) => {
          tracked.set(post.element, post);
          evaluate(post);
        }),
      );
      subScope.add(
        page.feed.onUpdate((post) => {
          tracked.set(post.element, post);
          evaluate(post);
        }),
      );
      subScope.add(page.feed.onRemove(forget));
      subScope.add(
        page.feed.onReset(() => {
          for (const post of [...tracked.values()]) {
            if (!post.element.isConnected) {
              forget(post);
            }
          }
        }),
      );

      return () => {
        for (const post of tracked.values()) {
          evaluate(post);
        }
      };
    };

    const sync = (): void => {
      const want = hideSponsored || hideSuggested || keywords.length > 0;
      if (want && !activeScope) {
        activeScope = scope.child();
        reevaluateActive = startFiltering(activeScope);
      } else if (!want && activeScope) {
        activeScope.dispose();
        activeScope = undefined;
        reevaluateActive = undefined;
      } else if (want) {
        reevaluateActive?.();
      }
    };

    sync();

    options.watch('ig_hide_sponsored', (val) => {
      hideSponsored = val;
      sync();
    });
    options.watch('ig_hide_suggested', (val) => {
      hideSuggested = val;
      sync();
    });
    options.watch('ig_keywords', (val) => {
      keywords = parseKeywords(val);
      sync();
    });
  },
});
