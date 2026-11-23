// Pure live rule tester powering the Filter Editor's collapsible "Test rule"
// sandbox. Runs the exact shared `testFilterRule` matcher against editable
// sample fields in a single pass so users can verify plain text, regexes, and
// combinators before saving.

import type { Filter, Rule } from '../../core/filter-types';
import { normalizeRuleOperator, testFilterRule } from '../../core/filter-engine';

export interface RuleTestBreakdown {
  readonly index: number;
  readonly matched: boolean;
  readonly skipped: boolean;
  readonly captured: string | null;
  readonly error: string | null;
}

export interface FilterTestReport {
  readonly matched: boolean;
  readonly rules: readonly RuleTestBreakdown[];
}

/**
 * Evaluates a single `filter` (even if currently paused) against `sampleFields`
 * and returns the overall match verdict and per-condition pass/fail breakdown.
 */
export function testFilterAgainstSample(
  filter: Filter,
  sampleFields: Readonly<Record<string, string>>,
): FilterTestReport {
  const allContent = Object.values(sampleFields)
    .filter((value) => value.trim().length > 0)
    .join(' ');

  const getField = (name: string): string | string[] | null => {
    if (name === 'all_content' || name === 'any') {
      return allContent;
    }
    if (Object.hasOwn(sampleFields, name)) {
      const value = sampleFields[name] ?? '';
      if (name === 'hashtag' || name === 'label') {
        const parts = value
          .split(/[\s,]+/)
          .map((item) => item.trim())
          .filter((item) => item.length > 0);
        return parts.length > 0 ? parts : '';
      }
      return value;
    }
    return '';
  };

  const context = {
    fields: { get: getField },
  };

  const rules = filter.rules ?? [];
  const breakdown: RuleTestBreakdown[] = [];
  let overall = false;
  let allFailed = false;

  for (let index = 0; index < rules.length; index++) {
    const rule = rules[index] as Rule;
    const { operator } = normalizeRuleOperator(rule);
    if (operator === 'contains_selector' || rule.target === 'age') {
      breakdown.push({
        index,
        matched: false,
        skipped: true,
        captured: null,
        error: null,
      });
      if (filter.match === 'ALL') {
        allFailed = true;
      }
      continue;
    }
    try {
      const res = testFilterRule(rule, context);
      breakdown.push({
        index,
        matched: res.matched,
        skipped: false,
        captured: res.caught?.[0] ?? null,
        error: null,
      });
      if (res.matched) {
        overall = true;
      } else if (filter.match === 'ALL') {
        allFailed = true;
      }
    } catch (error) {
      breakdown.push({
        index,
        matched: false,
        skipped: false,
        captured: null,
        error: error instanceof Error ? error.message : 'Could not evaluate condition.',
      });
      if (filter.match === 'ALL') {
        allFailed = true;
      }
    }
  }

  const matched = filter.match === 'ALL' ? rules.length > 0 && !allFailed : overall;
  return { matched, rules: breakdown };
}
