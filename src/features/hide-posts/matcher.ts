export interface MatchSettings {
  /** True to match inside longer words, so that "the" also matches "them". */
  partial: boolean;
  caseSensitive: boolean;
}

const escapeRegExp = (text: string): string =>
  text.replaceAll(/[\\^$*+?.()|[\]{}]/g, String.raw`\$&`);

/**
 * Builds the pattern that finds any of the keywords, one per line, or null
 * when there are none. The keyword found is the first capture group.
 */
export function keywordMatcher(keywords: string, settings: MatchSettings): RegExp | null {
  const words = keywords
    .split('\n')
    .map((word) => word.trim())
    .filter((word) => word !== '')
    .map(escapeRegExp);
  if (words.length === 0) {
    return null;
  }
  const any = `(${words.join('|')})`;
  const pattern = settings.partial ? any : String.raw`(?:^|\b|\W)${any}(?:\W|\b|$)`;
  return new RegExp(pattern, settings.caseSensitive ? '' : 'i');
}
