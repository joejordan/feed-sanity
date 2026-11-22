import type { CapablePage, FeedItem } from '../../capabilities';
import type { Feature } from '../../core/feature';
import type { OptionSpec } from '../../core/options';
import type { Scope } from '../../core/scope';
import { defineCapabilityFeature } from '../../capabilities';
import { concealPending, hideElement, markElement } from '../../core/surface';

export interface SharedFeedFiltersConfig<P extends FeedFilterablePage> {
  readonly id: string;
  /** Option key prefix (e.g. `'ig'` -> `ig_hide_sponsored`, `ig_hide_suggested`, `ig_keywords`). */
  readonly prefix: string;
  /** CSS selector matching pending feed items for zero-flash `concealPending`. */
  readonly itemSelector: string;
  readonly sponsoredTitle: string;
  readonly sponsoredDescription: string;
  readonly suggestedTitle: string;
  readonly suggestedDescription: string;
  readonly keywordsDescription?: string;
  /** Optional hook notified whenever the sponsored-hiding toggle changes (e.g. MAIN-world Network Tap). */
  readonly onSponsoredChange?: (page: P, enabled: boolean, scope: Scope) => void;
}

export interface FeedFilterablePage extends CapablePage {
  readonly doc: Document;
}

function parseKeywords(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line.length > 0);
}

function readItemLowerText(item: FeedItem): string {
  if (item.readLowerText) {
    return item.readLowerText();
  }
  return (item.content.textContent ?? '').toLowerCase();
}

function shouldHide(
  item: FeedItem,
  hideSponsored: boolean,
  hideSuggested: boolean,
  keywords: readonly string[],
): boolean {
  if ((hideSponsored && item.isAd === true) || (hideSuggested && item.isSuggested === true)) {
    return true;
  }
  if (keywords.length === 0) {
    return false;
  }
  const lower = readItemLowerText(item);
  return keywords.some((kw) => lower.includes(kw));
}

/**
 * Factory for site-agnostic feed filtering built on `defineCapabilityFeature`
 * (`requires: ['feed']`) + `concealPending` + `hideElement`. Powers Instagram,
 * X.com, and future feed-based adapters with zero duplicated lifecycle logic.
 */
export function createFeedFiltersFeature<P extends FeedFilterablePage>(
  config: SharedFeedFiltersConfig<P>,
): Feature<P> {
  const sponsoredKey = `${config.prefix}_hide_sponsored`;
  const suggestedKey = `${config.prefix}_hide_suggested`;
  const keywordsKey = `${config.prefix}_keywords`;
  const activeAttr = `data-feed-sanity-${config.prefix}-filtering`;
  const checkedAttr = `data-feed-sanity-${config.prefix}-checked`;
  const concealStyleId = `feed_sanity_${config.prefix}_conceal`;

  const optionsSpec: Record<string, OptionSpec> = {
    [sponsoredKey]: {
      section: 'Feed',
      title: config.sponsoredTitle,
      description: config.sponsoredDescription,
      default: true,
    },
    [suggestedKey]: {
      section: 'Feed',
      title: config.suggestedTitle,
      description: config.suggestedDescription,
      default: true,
    },
    [keywordsKey]: {
      section: 'Feed',
      title: 'Hide posts matching keywords',
      description:
        config.keywordsDescription ?? 'One keyword or phrase per line (case-insensitive).',
      default: '',
      multiline: true,
    },
  };

  return defineCapabilityFeature<typeof optionsSpec, 'feed', P>({
    id: config.id,
    requires: ['feed'],
    options: optionsSpec,
    setup({ page, caps, options, scope, badge }) {
      const { feed } = caps;

      let hideSponsored = options.get(sponsoredKey) === true;
      let hideSuggested = options.get(suggestedKey) === true;
      let rawKeywords = String(options.get(keywordsKey) ?? '');
      let keywords = parseKeywords(rawKeywords);

      let activeScope: Scope | undefined;
      let reevaluateActive: (() => void) | undefined;

      const startFiltering = (subScope: Scope): (() => void) => {
        const tracked = new Map<HTMLElement, FeedItem>();
        const hideRemovers = new Map<HTMLElement, () => void>();
        const checkedRemovers = new Map<HTMLElement, () => void>();
        let lastBadge = -1;

        const updateBadge = (): void => {
          if (hideRemovers.size !== lastBadge) {
            lastBadge = hideRemovers.size;
            badge(lastBadge);
          }
        };

        page.doc.documentElement?.setAttribute(activeAttr, '');
        concealPending(subScope, {
          id: concealStyleId,
          activeAttr,
          pendingSelector: `${config.itemSelector}:not([${checkedAttr}])`,
          maxMs: 250,
        });
        subScope.add(() => {
          page.doc.documentElement?.removeAttribute(activeAttr);
          hideRemovers.clear();
          checkedRemovers.clear();
          tracked.clear();
          lastBadge = 0;
          badge(0);
        });

        const evaluateOne = (item: FeedItem): void => {
          if (!checkedRemovers.has(item.element)) {
            checkedRemovers.set(
              item.element,
              markElement(subScope, item.element, checkedAttr, '1'),
            );
          }
          const hide = shouldHide(item, hideSponsored, hideSuggested, keywords);
          const existingHide = hideRemovers.get(item.element);
          if (hide && !existingHide) {
            hideRemovers.set(item.element, hideElement(subScope, item.element));
          } else if (!hide && existingHide) {
            existingHide();
            hideRemovers.delete(item.element);
          }
        };

        const forgetOne = (item: FeedItem): void => {
          tracked.delete(item.element);
          const unhide = hideRemovers.get(item.element);
          if (unhide) {
            unhide();
            hideRemovers.delete(item.element);
          }
          const unmark = checkedRemovers.get(item.element);
          if (unmark) {
            unmark();
            checkedRemovers.delete(item.element);
          }
        };

        subScope.add(
          feed.onAdd((item) => {
            tracked.set(item.element, item);
            evaluateOne(item);
            updateBadge();
          }),
        );
        subScope.add(
          feed.onUpdate((item) => {
            tracked.set(item.element, item);
            evaluateOne(item);
            updateBadge();
          }),
        );
        subScope.add(
          feed.onRemove((item) => {
            forgetOne(item);
            updateBadge();
          }),
        );
        subScope.add(
          feed.onReset(() => {
            for (const item of tracked.values()) {
              if (!item.element.isConnected) {
                forgetOne(item);
              }
            }
            updateBadge();
          }),
        );

        return () => {
          for (const item of tracked.values()) {
            evaluateOne(item);
          }
          updateBadge();
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

      config.onSponsoredChange?.(page, hideSponsored, scope);
      sync();

      options.watch(sponsoredKey, (val) => {
        const next = val === true;
        if (next === hideSponsored) {
          return;
        }
        hideSponsored = next;
        config.onSponsoredChange?.(page, hideSponsored, scope);
        sync();
      });
      options.watch(suggestedKey, (val) => {
        const next = val === true;
        if (next === hideSuggested) {
          return;
        }
        hideSuggested = next;
        sync();
      });
      options.watch(keywordsKey, (val) => {
        const nextRaw = String(val ?? '');
        if (nextRaw === rawKeywords) {
          return;
        }
        rawKeywords = nextRaw;
        keywords = parseKeywords(rawKeywords);
        sync();
      });
    },
  });
}
