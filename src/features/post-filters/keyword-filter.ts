import type { Filter } from './types';
import { REHIDE, REVEAL } from './engine';
import { escapeRegExp } from './rules';

export interface KeywordSettings {
  /** The keywords, one per line. */
  keywords: string;
  /** Also match inside longer words. */
  partial: boolean;
  caseSensitive: boolean;
  /** Also look in the descriptions of the post's photos. */
  captions: boolean;
  showNote: boolean;
  /** Name the matching keyword in the note. */
  showMatch: boolean;
}

/**
 * The Hide Posts keywords as a filter, which runs ahead of the user's own
 * filters. Null when there are no keywords.
 */
export function keywordFilter(settings: KeywordSettings): Filter | null {
  const words = settings.keywords
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map(escapeRegExp);
  if (words.length === 0) {
    return null;
  }
  const alternatives = `(${words.join('|')})`;
  const note = `Post Hidden by keyword${settings.showMatch ? ': $1' : ''}`;
  return {
    title: 'Hide Posts',
    match: 'ALL',
    enabled: true,
    stop_on_match: true,
    rules: [
      {
        target: settings.captions ? 'any+image' : 'any',
        operator: 'contains',
        match_partial_words: settings.partial,
        condition: { text: alternatives, modifier: settings.caseSensitive ? 'I' : 'i' },
      },
    ],
    actions: [
      {
        action: 'hide',
        show_note: settings.showNote,
        custom_note: note + REVEAL,
        custom_nyet: note + REHIDE,
      },
    ],
  };
}
