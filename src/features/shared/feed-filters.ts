import type { CapablePage, FeedItem } from '../../capabilities';
import type { DomEnvironment } from '../../core/dom-env';
import type { Feature } from '../../core/feature';
import type { FilterFields } from '../../core/filter-engine';
import type { Filter } from '../../core/filter-types';
import type { OptionSpec } from '../../core/options';
import type { Scope } from '../../core/scope';
import type { AppliedFilterState } from './apply-filter-outcome';
import { defineCapabilityFeature } from '../../capabilities';
import { EMPTY_OUTCOME, runFilters } from '../../core/filter-engine';
import { getFilterHitTracker } from '../../core/filter-hits';
import { isRunnable, savedFilters } from '../../core/filter-types';
import { concealPending, markElement, OWN_ATTR } from '../../core/surface';
import { applyFilterOutcome, parseKeywords } from './apply-filter-outcome';

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
  readonly env?: Pick<DomEnvironment, 'doc' | 'onShadowRoot'>;
}

function readItemLowerText(item: FeedItem): string {
  if (item.readLowerText) {
    return item.readLowerText();
  }
  return (item.content.textContent ?? '').toLowerCase();
}

function fallbackFields(item: FeedItem): FilterFields {
  let fullText: string | undefined;
  return {
    get(name) {
      if (name === 'text' || name === 'body') {
        fullText ??= item.content.textContent ?? '';
        return fullText;
      }
      if (name === 'sponsored') {
        return item.isAd ? 'sponsored' : null;
      }
      if (name === 'suggested') {
        return item.isSuggested ? 'suggested' : null;
      }
      return null;
    },
  };
}

function pauseMediaIn(root: ParentNode): void {
  if (root instanceof Element && root.shadowRoot && !root.hasAttribute(OWN_ATTR)) {
    pauseMediaIn(root.shadowRoot);
  }
  for (const child of root.children) {
    if (child.hasAttribute(OWN_ATTR)) {
      continue;
    }
    if (child instanceof HTMLMediaElement && !child.paused) {
      child.pause();
    }
    if (child.shadowRoot) {
      pauseMediaIn(child.shadowRoot);
    }
    if (child.childElementCount > 0) {
      pauseMediaIn(child);
    }
  }
}

function matchesBuiltInHide(
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
 * (`requires: ['feed']`) + `concealPending` + shared `runFilters` +
 * reversible `applyFilterOutcome`. Powers Instagram, X.com, and future
 * feed-based adapters with both quick toggles and custom Filter Rules.
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
      section: 'Filtering',
      group: 'Quick Shields',
      title: config.sponsoredTitle,
      description: config.sponsoredDescription,
      keywords: ['ads', 'sponsored', 'promoted'],
      default: true,
    },
    [suggestedKey]: {
      section: 'Filtering',
      group: 'Quick Shields',
      title: config.suggestedTitle,
      description: config.suggestedDescription,
      keywords: ['suggested', 'recommended', 'algorithm'],
      default: true,
    },
    [keywordsKey]: {
      section: 'Filtering',
      group: 'Bulk Keyword Blocklist',
      advanced: true,
      title: 'Hide posts matching keywords',
      description:
        config.keywordsDescription ?? 'One keyword or phrase per line (case-insensitive).',
      keywords: ['mute', 'words', 'blocklist'],
      default: '',
      multiline: true,
    },
  };

  return defineCapabilityFeature<typeof optionsSpec, 'feed', P>({
    id: config.id,
    requires: ['feed'],
    options: optionsSpec,
    setup({ page, caps, options, data, scope, badge }) {
      const { feed } = caps;
      const customSaved = savedFilters(data);
      const hitTracker = getFilterHitTracker(data);

      let hideSponsored = options.get(sponsoredKey) === true;
      let hideSuggested = options.get(suggestedKey) === true;
      let rawKeywords = String(options.get(keywordsKey) ?? '');
      let keywords = parseKeywords(rawKeywords);
      let customFilters: readonly Filter[] = customSaved.get().filter(isRunnable);

      let activeScope: Scope | undefined;
      let reevaluateActive: (() => void) | undefined;

      const startFiltering = (subScope: Scope): (() => void) => {
        const tracked = new Map<HTMLElement, FeedItem>();
        const applied = new Map<HTMLElement, AppliedFilterState>();
        const checkedRemovers = new Map<HTMLElement, () => void>();
        let hiddenCount = 0;
        let lastBadge = -1;

        const updateBadge = (): void => {
          if (hiddenCount !== lastBadge) {
            lastBadge = hiddenCount;
            badge(lastBadge);
          }
        };

        if (page.doc.documentElement) {
          markElement(subScope, page.doc.documentElement, activeAttr);
        }
        concealPending(
          subScope,
          {
            id: concealStyleId,
            activeAttr,
            pendingSelector: `:is(${config.itemSelector}):not([${checkedAttr}])`,
            maxMs: 300,
          },
          page.env,
        );
        subScope.add(() => {
          applied.clear();
          checkedRemovers.clear();
          tracked.clear();
          hitTracker.clear();
          hiddenCount = 0;
          lastBadge = 0;
          badge(0);
        });

        const evaluateOne = (item: FeedItem): void => {
          // Dispose any prior DOM mutations (such as `replace` text redactions)
          // before re-evaluating rules so text-matching filters stay idempotent.
          const prev = applied.get(item.element);
          if (prev) {
            if (prev.hidden) {
              hiddenCount--;
            }
            prev.dispose();
            applied.delete(item.element);
          }
          const builtInHide = matchesBuiltInHide(item, hideSponsored, hideSuggested, keywords);
          const matchedFilters: Filter[] = [];
          const outcome =
            customFilters.length > 0
              ? runFilters(customFilters, {
                  fields: item.readFields ? item.readFields() : fallbackFields(item),
                  element: item.element,
                  itemNoun: 'post',
                  onFilterMatch: (filter) => matchedFilters.push(filter),
                })
              : EMPTY_OUTCOME;
          hitTracker.setItemMatches(item.element, matchedFilters);
          const willHide = outcome.hiding !== null || (builtInHide && !outcome.kept);
          if ((willHide || item.pending !== true) && !checkedRemovers.has(item.element)) {
            checkedRemovers.set(
              item.element,
              markElement(subScope, item.element, checkedAttr, '1'),
            );
          }
          const next = applyFilterOutcome(
            subScope,
            item.element,
            outcome,
            builtInHide,
            pauseMediaIn,
          );
          if (next) {
            if (next.hidden) {
              hiddenCount++;
            }
            applied.set(item.element, next);
          }
        };

        const forgetOne = (item: FeedItem): void => {
          tracked.delete(item.element);
          hitTracker.forgetItem(item.element);
          const prev = applied.get(item.element);
          if (prev) {
            if (prev.hidden) {
              hiddenCount--;
            }
            prev.dispose();
            applied.delete(item.element);
          }
          const unmark = checkedRemovers.get(item.element);
          if (unmark) {
            unmark();
            checkedRemovers.delete(item.element);
          }
        };

        const onItem = (item: FeedItem): void => {
          tracked.set(item.element, item);
          evaluateOne(item);
          updateBadge();
        };

        subScope.add(feed.onAdd(onItem));
        subScope.add(feed.onUpdate(onItem));
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
        const want =
          hideSponsored || hideSuggested || keywords.length > 0 || customFilters.length > 0;
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
      scope.add(
        customSaved.onChange((next) => {
          customFilters = next.filter(isRunnable);
          sync();
        }),
      );
    },
  });
}
