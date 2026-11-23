// Pure, Trusted-Types-safe validation for filter rules, regex patterns/flags,
// and CSS selectors. Used both for inline live feedback in the Filter Editor
// and for `OptionsPanel.problem` so broken rules cannot be saved silently.

import type { Action, Filter, Rule } from '../../core/filter-types';
import type { FilterSchema } from './schema';
import { compileTextPattern, normalizeRuleOperator } from '../../core/filter-engine';

const VALID_REGEX_FLAGS = /^[dgimsuvy]*$/;

function hasDuplicateChars(text: string): boolean {
  const seen = new Set<string>();
  for (const ch of text) {
    if (seen.has(ch)) {
      return true;
    }
    seen.add(ch);
  }
  return false;
}

/** Validates a CSS selector without touching `innerHTML` (strictly Trusted Types safe). */
export function validateCssSelector(selector: string): string | null {
  const trimmed = selector.trim();
  if (!trimmed) {
    return null;
  }
  if (typeof document === 'undefined') {
    return null;
  }
  try {
    document.createDocumentFragment().querySelector(trimmed);
    return null;
  } catch {
    return 'Invalid CSS selector syntax.';
  }
}

function checkSelector(selector: string, schema?: FilterSchema): string | null {
  return schema?.validateSelector
    ? schema.validateSelector(selector)
    : validateCssSelector(selector);
}

/** Validates a single condition `rule`. Returns a human-readable error message, or `null`. */
export function validateRule(rule: Rule, schema?: FilterSchema): string | null {
  const { operator } = normalizeRuleOperator(rule);
  const text = rule.condition?.text ?? '';

  if (operator === 'contains_selector') {
    if (!text.trim()) {
      return null;
    }
    return checkSelector(text, schema);
  }

  if (rule.target === 'day' || rule.target === 'age') {
    if (
      rule.target === 'age' &&
      rule.condition?.value !== undefined &&
      rule.condition.value !== ''
    ) {
      const num = Number(rule.condition.value);
      if (!Number.isFinite(num) || num < 0) {
        return 'Age must be a non-negative number.';
      }
    }
    return null;
  }

  if (operator === 'matches') {
    const flags = (rule.condition?.modifier ?? '').replace('I', '');
    if (!VALID_REGEX_FLAGS.test(flags) || hasDuplicateChars(flags)) {
      return `Invalid regex flags "${flags}". Use valid flags such as i, m, s, or u.`;
    }
  }

  const isRegex = operator === 'matches' || rule.matcher !== 'str';
  if (!isRegex || !text) {
    return null;
  }

  try {
    compileTextPattern(rule, operator);
    return null;
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'invalid regular expression';
    return `Invalid regular expression: ${detail}`;
  }
}

/** Validates a single `action`. Returns a human-readable error message, or `null`. */
export function validateAction(action: Action, schema?: FilterSchema): string | null {
  if (action.action === 'replace' && action.find) {
    try {
      void new RegExp(action.find, 'gi');
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'invalid regular expression';
      return `Invalid replace pattern: ${detail}`;
    }
  }
  if ((action.action === 'css' || action.action === 'class') && action.selector?.trim()) {
    return checkSelector(action.selector, schema);
  }
  return null;
}

/** Collects every validation error for `filter` (only checked for enabled filters when saving). */
export function validateFilter(filter: Filter, schema?: FilterSchema): string[] {
  const errors: string[] = [];
  for (const rule of filter.rules ?? []) {
    const issue = validateRule(rule, schema);
    if (issue) {
      errors.push(issue);
    }
  }
  for (const action of filter.actions ?? []) {
    const issue = validateAction(action, schema);
    if (issue) {
      errors.push(issue);
    }
  }
  return errors;
}

/**
 * Returns a concise save-blocking summary string for `OptionsPanel.problem`
 * when any enabled filter contains a syntax error, or `null` when all are valid.
 */
export function filtersProblem(filters: readonly Filter[], schema?: FilterSchema): string | null {
  const broken: string[] = [];
  for (const filter of filters) {
    if (filter.enabled === false) {
      continue;
    }
    if (validateFilter(filter, schema).length > 0) {
      broken.push(filter.title?.trim() || 'Untitled filter');
    }
  }
  if (broken.length === 0) {
    return null;
  }
  return `Fix invalid filter syntax before saving: ${broken.join(', ')}.`;
}
