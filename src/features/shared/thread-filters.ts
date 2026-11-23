// Cross-site capability feature for filtering inbox/messaging thread rows
// (inline Promotions/Social ads, quick keywords, and custom Filter Rules) on
// any site exposing `ThreadListCapability` (Gmail, Proton Mail, Outlook Web).

import type { CapablePage, ThreadRow } from '../../capabilities';
import type { Feature } from '../../core/feature';
import type { FilterFields } from '../../core/filter-engine';
import type { Filter } from '../../core/filter-types';
import type { OptionSpec } from '../../core/options';
import type { Scope } from '../../core/scope';
import type { AppliedFilterState } from './apply-filter-outcome';
import { defineCapabilityFeature } from '../../capabilities';
import { runFilterList } from '../../core/filter-engine';
import { getFilterHitTracker } from '../../core/filter-hits';
import { isRunnable, savedFilters } from '../../core/filter-types';
import { applyFilterOutcome, EMPTY_OUTCOME, parseKeywords } from './apply-filter-outcome';

export interface ThreadFiltersConfig {
  readonly id: string;
  readonly prefix: string;
  readonly section?: string;
  readonly adsTitle?: string;
  readonly adsDescription?: string;
  readonly adsDefault?: boolean;
  readonly keywordsTitle?: string;
  readonly keywordsDescription?: string;
}

function fallbackRowFields(row: ThreadRow): FilterFields {
  let fullText: string | undefined;
  return {
    get(name) {
      if (name === 'all_content' || name === 'any') {
        fullText ??= row.element.textContent ?? '';
        return fullText;
      }
      if (name === 'sponsored') {
        return row.isAd ? 'sponsored' : '';
      }
      return null;
    },
  };
}

/**
 * Declares a site-agnostic thread-list filtering feature built purely on
 * `ThreadListCapability`. Evaluates built-in ad/keyword toggles and saved
 * custom Filter Rules reversibly via `applyFilterOutcome`, reporting hidden
 * count on the toolbar badge.
 */
export function createThreadFiltersFeature<P extends CapablePage>(
  config: ThreadFiltersConfig,
): Feature<P> {
  const adsKey = `${config.prefix}_hide_ads`;
  const keywordsKey = `${config.prefix}_keywords`;
  const section = config.section ?? 'Inbox Filtering';

  const optionsSpec: Record<string, OptionSpec> = {
    [adsKey]: {
      section,
      group: 'Quick Shields',
      title: config.adsTitle ?? 'Hide inbox ads',
      description:
        config.adsDescription ?? 'Hide sponsored ad rows in Promotions and Social inbox tabs.',
      keywords: ['ads', 'sponsored', 'promotions'],
      default: config.adsDefault ?? true,
    },
    [keywordsKey]: {
      section,
      group: 'Bulk Keyword Blocklist',
      advanced: true,
      title: config.keywordsTitle ?? 'Hide threads containing keywords',
      description:
        config.keywordsDescription ??
        'Hide inbox threads whose sender, subject, or snippet matches any keyword (one per line).',
      keywords: ['mute', 'words', 'blocklist'],
      default: '',
      multiline: true,
    },
  };

  return defineCapabilityFeature<typeof optionsSpec, 'threads', P>({
    id: config.id,
    requires: ['threads'],
    options: optionsSpec,
    setup({ caps, options, data, scope, badge }) {
      const { threads } = caps;
      const customSaved = savedFilters(data);
      const hitTracker = getFilterHitTracker(data);

      let hideAds = options.get(adsKey) === true;
      let keywords = parseKeywords(String(options.get(keywordsKey) ?? ''));
      let customFilters: readonly Filter[] = customSaved.get().filter(isRunnable);

      const tracked = new Map<HTMLElement, ThreadRow>();
      const applied = new Map<HTMLElement, AppliedFilterState>();
      let hiddenCount = 0;
      let activeScope: Scope | undefined;

      const updateBadge = (): void => badge(hiddenCount);
      const isActive = (): boolean => hideAds || keywords.length > 0 || customFilters.length > 0;

      const forget = (element: HTMLElement): boolean => {
        tracked.delete(element);
        hitTracker.forgetItem(element);
        const prev = applied.get(element);
        if (prev) {
          const wasHidden = prev.hidden;
          if (wasHidden) {
            hiddenCount--;
          }
          prev.dispose();
          applied.delete(element);
          return wasHidden;
        }
        return false;
      };

      const evaluate = (row: ThreadRow, currentScope: Scope, deferBadge = false): void => {
        const prev = applied.get(row.element);
        const wasHidden = prev?.hidden === true;
        if (prev) {
          if (wasHidden) {
            hiddenCount--;
          }
          prev.dispose();
          applied.delete(row.element);
        }

        let builtInHide = false;
        if (hideAds && row.isAd === true) {
          builtInHide = true;
        } else if (keywords.length > 0) {
          const text = row.readLowerText
            ? row.readLowerText()
            : (row.element.textContent ?? '').toLowerCase();
          builtInHide = keywords.some((word) => text.includes(word));
        }

        const matchedFilters: Filter[] = [];
        const outcome =
          customFilters.length > 0
            ? runFilterList(customFilters, {
                fields: row.readFields ? row.readFields() : fallbackRowFields(row),
                element: row.element,
                itemLabel: 'Thread',
                onFilterMatch: (filter) => matchedFilters.push(filter),
              })
            : EMPTY_OUTCOME;
        hitTracker.setItemMatches(row.element, matchedFilters);

        const next = applyFilterOutcome(currentScope, row.element, outcome, builtInHide);
        const nowHidden = next?.hidden === true;
        if (next) {
          if (nowHidden) {
            hiddenCount++;
          }
          applied.set(row.element, next);
        }
        if (!deferBadge && nowHidden !== wasHidden) {
          updateBadge();
        }
      };

      const sync = (): void => {
        if (!isActive()) {
          if (activeScope) {
            activeScope.dispose();
            activeScope = undefined;
          }
          tracked.clear();
          applied.clear();
          hiddenCount = 0;
          updateBadge();
          return;
        }
        if (!activeScope) {
          const nextScope = scope.child();
          activeScope = nextScope;
          nextScope.add(
            threads.onAdd((row) => {
              tracked.set(row.element, row);
              evaluate(row, nextScope);
            }),
          );
          if (threads.onUpdate) {
            nextScope.add(
              threads.onUpdate((row) => {
                tracked.set(row.element, row);
                evaluate(row, nextScope);
              }),
            );
          }
          nextScope.add(
            threads.onRemove((row) => {
              if (forget(row.element)) {
                updateBadge();
              }
            }),
          );
          if (threads.onReset) {
            nextScope.add(
              threads.onReset(() => {
                let changed = false;
                for (const el of [...tracked.keys()]) {
                  if (!el.isConnected && forget(el)) {
                    changed = true;
                  }
                }
                if (changed) {
                  updateBadge();
                }
              }),
            );
          }
          nextScope.add(() => {
            tracked.clear();
            applied.clear();
            hitTracker.clear();
            hiddenCount = 0;
          });
          return;
        }
        for (const row of tracked.values()) {
          evaluate(row, activeScope, true);
        }
        updateBadge();
      };

      options.watch(adsKey, (val) => {
        const next = val === true;
        if (next === hideAds) {
          return;
        }
        hideAds = next;
        sync();
      });

      options.watch(keywordsKey, (val) => {
        const next = parseKeywords(String(val ?? ''));
        if (next.length === keywords.length && next.every((word, i) => word === keywords[i])) {
          return;
        }
        keywords = next;
        sync();
      });

      scope.add(
        customSaved.onChange((next) => {
          customFilters = next.filter(isRunnable);
          sync();
        }),
      );

      sync();
    },
  });
}
