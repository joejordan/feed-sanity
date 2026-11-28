// Validation for filters: regex values and flags, CSS selectors and age
// amounts. Used for inline errors in the editor and by `OptionsPanel.problem`
// so a broken enabled filter cannot be saved. No `innerHTML` anywhere.

import type { Action, Condition, Filter, TextCondition } from '../../core/filter-types';
import type { FilterSchema } from './schema';
import {
  compileReplacePattern,
  compileTextCondition,
  USER_REGEX_FLAGS,
} from '../../core/filter-engine';
import { displayFilterTitle } from './summary';

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** Checks a regex flags string. Returns an error message, or null when it is usable. */
export function validateRegexFlags(flags: string): string | null {
  const seen = new Set<string>();
  for (const flag of flags) {
    if (flag === 'i') {
      return 'Use "Match case" instead of the i flag.';
    }
    if (!USER_REGEX_FLAGS.includes(flag)) {
      return `"${flag}" is not a flag you can use here. Use d, m, s, u or v.`;
    }
    if (seen.has(flag)) {
      return `The ${flag} flag is listed twice.`;
    }
    seen.add(flag);
  }
  return null;
}

/** Checks a CSS selector by querying a detached fragment. */
export function validateCssSelector(selector: string): string | null {
  const trimmed = selector.trim();
  if (!trimmed || typeof document === 'undefined') {
    return null;
  }
  try {
    document.createDocumentFragment().querySelector(trimmed);
    return null;
  } catch {
    return 'This is not a valid CSS selector.';
  }
}

function checkSelector(selector: string, schema?: FilterSchema): string | null {
  return schema?.validateSelector
    ? schema.validateSelector(selector)
    : validateCssSelector(selector);
}

function textIssue(condition: TextCondition): string | null {
  if (condition.test === 'regex') {
    const flagIssue = validateRegexFlags(condition.regexFlags ?? '');
    if (flagIssue) {
      return flagIssue;
    }
  }
  try {
    compileTextCondition(condition);
    return null;
  } catch (error) {
    return `Invalid regular expression: ${messageOf(error, 'it does not compile')}`;
  }
}

// Conditions are immutable and edits replace only the one that changed, so the
// dialog revalidating every filter on each keystroke compiles just that one.
const textIssues = new WeakMap<TextCondition, string | null>();

/** Validates one condition. Returns an error message, or null. */
export function validateCondition(condition: Condition, schema?: FilterSchema): string | null {
  switch (condition.kind) {
    case 'text': {
      let issue = textIssues.get(condition);
      if (issue === undefined) {
        issue = textIssue(condition);
        textIssues.set(condition, issue);
      }
      return issue;
    }
    case 'element':
      return checkSelector(condition.selector, schema);
    case 'age':
      return Number.isFinite(condition.amount) && condition.amount >= 0
        ? null
        : 'The age must be zero or more.';
    default:
      return null;
  }
}

/** Validates one action. Returns an error message, or null. */
export function validateAction(action: Action, schema?: FilterSchema): string | null {
  switch (action.kind) {
    case 'replace':
      if (!action.find) {
        return null;
      }
      try {
        compileReplacePattern(action.find);
        return null;
      } catch (error) {
        return `Invalid find pattern: ${messageOf(error, 'it does not compile')}`;
      }
    case 'style':
    case 'add_class':
      return action.selector?.trim() ? checkSelector(action.selector, schema) : null;
    default:
      return null;
  }
}

/** Every validation error in `filter`. */
export function validateFilter(filter: Filter, schema?: FilterSchema): string[] {
  const errors: string[] = [];
  for (const condition of filter.conditions) {
    const issue = validateCondition(condition, schema);
    if (issue) {
      errors.push(issue);
    }
  }
  for (const action of filter.actions) {
    const issue = validateAction(action, schema);
    if (issue) {
      errors.push(issue);
    }
  }
  return errors;
}

/** Why `filters` cannot be saved (an enabled filter has an error), or null. */
export function filtersProblem(filters: readonly Filter[], schema?: FilterSchema): string | null {
  const broken = filters
    .filter((filter) => filter.enabled && validateFilter(filter, schema).length > 0)
    .map((filter) =>
      schema ? displayFilterTitle(filter, schema) : filter.name.trim() || 'Untitled filter',
    );
  return broken.length > 0 ? `Fix these filters before saving: ${broken.join(', ')}.` : null;
}
