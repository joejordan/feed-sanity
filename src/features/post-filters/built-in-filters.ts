import type { Filter, Rule } from './types';
import { REHIDE, REVEAL } from './engine';

/** What the notes say. */
export const SUGGESTED_NOTE = 'Post hidden because Facebook suggested it';
export const SPONSORED_NOTE = 'Post hidden because it is an ad';

/**
 * A rule that matches when the post has the part `target`, whatever its
 * text. `^` matches any text, empty or not, and a part the post does not
 * have never matches.
 */
const has = (target: string): Rule => ({
  target,
  operator: 'matches',
  condition: { text: '^' },
});

/**
 * One of the Hide Posts filters, which run ahead of the user's own: it
 * hides the posts `rule` matches, with `note` as its note, and stops there.
 */
export function hidePostsFilter(rule: Rule, note: string, showNote: boolean): Filter {
  return {
    title: 'Hide Posts',
    match: 'ALL',
    enabled: true,
    stop_on_match: true,
    rules: [rule],
    actions: [
      {
        action: 'hide',
        show_note: showNote,
        custom_note: note + REVEAL,
        custom_nyet: note + REHIDE,
      },
    ],
  };
}

/**
 * Hides the posts Facebook suggests from pages, people and groups the
 * person does not follow: those whose header has a Follow or Join button.
 */
export const suggestedFilter = (showNote: boolean): Filter =>
  hidePostsFilter(has('suggested'), SUGGESTED_NOTE, showNote);

/** Hides ads. Whether a post is one comes from React's data, through the page-world bridge. */
export const sponsoredFilter = (showNote: boolean): Filter =>
  hidePostsFilter(has('sponsored'), SPONSORED_NOTE, showNote);

/** True when a filter tests whether posts are ads, so the posts have to be looked up. */
export const testsSponsored = (filter: Filter): boolean =>
  filter.rules?.some((rule) => rule.target === 'sponsored') === true;
