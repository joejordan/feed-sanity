import type { LocatorOverrides } from '../core/locator';
import { isUsableSelector, readLocatorOverrides } from '../core/locator';

export const OVERRIDES_EXAMPLE = '{ "post": ["[role=article]"] }';

/** What the user typed as locator overrides, checked. */
export type CheckedOverrides =
  | { readonly overrides: LocatorOverrides; readonly problems: readonly [] }
  | { readonly overrides: null; readonly problems: readonly string[] };

/** The overrides as the editor shows them. */
export const overridesText = (overrides: LocatorOverrides): string =>
  JSON.stringify(overrides, null, 2);

function problemsWith(parsed: unknown, names: ReadonlySet<string>): string[] {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return [`Write an object of locator names and lists of selectors, as in ${OVERRIDES_EXAMPLE}.`];
  }
  const problems: string[] = [];
  for (const [name, selectors] of Object.entries(parsed)) {
    if (!names.has(name)) {
      problems.push(`"${name}" is not a locator. The names are in the Locators table.`);
    } else if (
      !Array.isArray(selectors) ||
      !selectors.every((selector) => typeof selector === 'string')
    ) {
      problems.push(`"${name}" needs a list of selectors in quotes, as in ["[role=article]"].`);
    } else if (selectors.every((selector) => selector.trim() === '')) {
      problems.push(`"${name}" has no selectors. Take it out to use the built-in ones.`);
    } else {
      for (const selector of selectors) {
        if (selector.trim() !== '' && !isUsableSelector(selector)) {
          problems.push(`"${selector}" for "${name}" is not a valid selector.`);
        }
      }
    }
  }
  // The same mistake twice, such as a bad selector given twice, is told once.
  return [...new Set(problems)];
}

/**
 * Checks locator overrides typed as JSON against the locator `names`.
 * Empty text means no overrides.
 */
export function checkOverrides(text: string, names: Iterable<string>): CheckedOverrides {
  if (text.trim() === '') {
    return { overrides: {}, problems: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? ` ${error.message}` : '';
    return { overrides: null, problems: [`This is not valid JSON.${reason}`] };
  }
  const problems = problemsWith(parsed, new Set(names));
  return problems.length > 0
    ? { overrides: null, problems }
    : { overrides: readLocatorOverrides(parsed), problems: [] };
}
