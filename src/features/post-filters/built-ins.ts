// The filters behind post filters' own switches. They are ordinary filters,
// built in memory each time the options change and never saved, so the
// engine, the hit counts and the badge treat them like the user's own.

import type { Condition, Filter } from '../../core/filter-types';
import type { FilterSettings } from './settings';
import { isRunnable, newFilter } from '../../core/filter-types';
import { SPONSORED } from '../../facebook/post-fields';

/** Ids of the built-in filters. User filters get random ids starting with `f`. */
export const BUILT_IN_IDS = {
  keywords: 'feed-sanity:keywords',
  suggested: 'feed-sanity:suggested',
  sponsored: 'feed-sanity:sponsored',
} as const;

/** Note texts of the built-in filters. */
export const BUILT_IN_NOTES = {
  keywordMatch: 'Hidden: mentions “{match}”',
  keyword: 'Hidden by your keyword list',
  suggested: 'Hidden because Facebook suggested it',
  sponsored: 'Hidden because it is an ad',
} as const;

/** The non-blank lines of the keyword option, trimmed. Punctuation stays as it is. */
function keywordLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

function hidingFilter(id: string, name: string, condition: Condition, noteText: string): Filter {
  return newFilter({
    id,
    name,
    join: 'all',
    stopAfter: true,
    conditions: [condition],
    actions: [{ kind: 'hide', noteText }],
  });
}

/** The filters the switches in `settings` ask for, in the order they run. */
export function builtInFilters(settings: FilterSettings): Filter[] {
  const filters: Filter[] = [];
  const keywords = keywordLines(settings.keywords);
  if (keywords.length > 0) {
    filters.push(
      hidingFilter(
        BUILT_IN_IDS.keywords,
        'Keyword list',
        {
          kind: 'text',
          part: settings.captions ? 'text_with_images' : 'text',
          test: 'contains',
          values: keywords,
          ...(settings.matchCase ? { matchCase: true } : {}),
          ...(settings.partial ? {} : { wholeWords: true }),
        },
        settings.showMatch ? BUILT_IN_NOTES.keywordMatch : BUILT_IN_NOTES.keyword,
      ),
    );
  }
  if (settings.suggested) {
    filters.push(
      hidingFilter(
        BUILT_IN_IDS.suggested,
        'Suggested posts',
        // `^` matches any text, so this holds whenever the part is not null.
        { kind: 'text', part: 'suggested', test: 'regex', values: ['^'] },
        BUILT_IN_NOTES.suggested,
      ),
    );
  }
  if (settings.sponsored) {
    filters.push(
      hidingFilter(
        BUILT_IN_IDS.sponsored,
        'Ads',
        { kind: 'text', part: 'sponsored', test: 'is', values: [SPONSORED], matchCase: true },
        BUILT_IN_NOTES.sponsored,
      ),
    );
  }
  return filters;
}

/** True when a runnable filter in `filters` has a condition on the part `part`. */
export function testsPart(filters: readonly Filter[], part: string): boolean {
  return filters.some(
    (filter) =>
      isRunnable(filter) &&
      filter.conditions.some((condition) => condition.kind === 'text' && condition.part === part),
  );
}
