// Cross-site capability feature for filtering inbox/messaging thread rows
// (inline Promotions/Social ads and keyword rules) on any site exposing
// `ThreadListCapability` (Gmail, Proton Mail, Outlook Web, etc.).

import type { CapablePage, ThreadRow } from '../../capabilities';
import type { Feature } from '../../core/feature';
import type { OptionSpec } from '../../core/options';
import type { Scope } from '../../core/scope';
import { defineCapabilityFeature } from '../../capabilities';
import { hideElement } from '../../core/surface';

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

function parseKeywords(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line.length > 0);
}

/**
 * Declares a site-agnostic thread-list filtering feature built purely on
 * `ThreadListCapability`. Hides inline ad rows and keyword-matched threads
 * reversibly via `hideElement` and reports the hidden count on the toolbar badge.
 */
export function createThreadFiltersFeature<P extends CapablePage>(
  config: ThreadFiltersConfig,
): Feature<P> {
  const adsKey = `${config.prefix}_hide_ads`;
  const keywordsKey = `${config.prefix}_keywords`;
  const section = config.section ?? 'Inbox';

  const optionsSpec: Record<string, OptionSpec> = {
    [adsKey]: {
      section,
      title: config.adsTitle ?? 'Hide inbox ads',
      description:
        config.adsDescription ?? 'Hide sponsored ad rows in Promotions and Social inbox tabs.',
      default: config.adsDefault ?? true,
    },
    [keywordsKey]: {
      section,
      title: config.keywordsTitle ?? 'Hide threads containing keywords',
      description:
        config.keywordsDescription ??
        'Hide inbox threads whose sender, subject, or snippet matches any keyword (one per line).',
      default: '',
      multiline: true,
    },
  };

  return defineCapabilityFeature<typeof optionsSpec, 'threads', P>({
    id: config.id,
    requires: ['threads'],
    options: optionsSpec,
    setup({ caps, options, scope, badge }) {
      const { threads } = caps;
      let hideAds = options.get(adsKey) === true;
      let keywords = parseKeywords(String(options.get(keywordsKey) ?? ''));

      const tracked = new Map<HTMLElement, ThreadRow>();
      const hidden = new Map<HTMLElement, () => void>();
      let activeScope: Scope | undefined;

      const updateBadge = (): void => badge(hidden.size);
      const isActive = (): boolean => hideAds || keywords.length > 0;

      const forget = (element: HTMLElement): boolean => {
        tracked.delete(element);
        const unhide = hidden.get(element);
        if (unhide) {
          unhide();
          hidden.delete(element);
          return true;
        }
        return false;
      };

      const evaluate = (row: ThreadRow, currentScope: Scope, deferBadge = false): void => {
        let shouldHide = false;
        if (hideAds && row.isAd === true) {
          shouldHide = true;
        } else if (keywords.length > 0) {
          const text = row.readLowerText
            ? row.readLowerText()
            : (row.element.textContent ?? '').toLowerCase();
          shouldHide = keywords.some((word) => text.includes(word));
        }

        const existing = hidden.get(row.element);
        if (shouldHide && !existing) {
          hidden.set(row.element, hideElement(currentScope, row.element));
          if (!deferBadge) {
            updateBadge();
          }
        } else if (!shouldHide && existing) {
          existing();
          hidden.delete(row.element);
          if (!deferBadge) {
            updateBadge();
          }
        }
      };

      const sync = (): void => {
        if (!isActive()) {
          if (activeScope) {
            activeScope.dispose();
            activeScope = undefined;
          }
          tracked.clear();
          hidden.clear();
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
            hidden.clear();
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

      sync();
    },
  });
}
