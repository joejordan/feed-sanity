// Runs one filter's conditions against sample part values, for the editor's
// "Test rule" box and the Simple preview. It uses the engine's own
// `testCondition`, so the verdict is the one the page would give.

import type { FilterFields, FilterFieldValue } from '../../core/filter-engine';
import type { Condition, Filter } from '../../core/filter-types';
import type { FilterSchema } from './schema';
import { listPart, testCondition } from '../../core/filter-engine';
import { validateCondition } from './validate';

export interface ConditionTestResult {
  readonly index: number;
  readonly matched: boolean;
  /** True for conditions a sample cannot answer (element and age conditions). */
  readonly skipped: boolean;
  /** The text that matched. */
  readonly caught: string | null;
  readonly error: string | null;
}

export interface FilterTestReport {
  readonly matched: boolean;
  readonly conditions: readonly ConditionTestResult[];
}

/** Splits a list part's sample text on commas, whitespace and leading `#`. */
function splitList(text: string): readonly string[] | null {
  return listPart(
    text
      .split(/[\s,]+/)
      .map((item) => item.replace(/^#/, '').trim())
      .filter((item) => item.length > 0),
  );
}

/**
 * Builds `FilterFields` from sample values. `text` (the whole item) is the
 * sample's own `text` when given, otherwise every sample value joined. List
 * parts (per `schema`) are split into items. A part with no sample is null.
 */
export function sampleFields(
  samples: Readonly<Record<string, string>>,
  schema?: FilterSchema,
): FilterFields {
  const listParts = new Set(
    (schema?.targets ?? []).filter((target) => target.list).map((target) => target.value),
  );
  const values = new Map<string, FilterFieldValue>();
  return {
    get(name) {
      const value = samples[name];
      if (name === 'text' && !value?.trim()) {
        return Object.values(samples)
          .filter((sample) => sample.trim().length > 0)
          .join(' ');
      }
      if (value === undefined) {
        return values.get(name) ?? null;
      }
      return listParts.has(name) ? splitList(value) : value;
    },
    set(name, value) {
      values.set(name, value);
    },
  };
}

function testOne(condition: Condition, index: number, fields: FilterFields): ConditionTestResult {
  if (condition.kind === 'element' || condition.kind === 'age') {
    return { index, matched: false, skipped: true, caught: null, error: null };
  }
  const error = validateCondition(condition);
  if (error) {
    return { index, matched: false, skipped: false, caught: null, error };
  }
  const result = testCondition(condition, { fields });
  return { index, matched: result.matched, skipped: false, caught: result.caught ?? null, error };
}

/**
 * Tests every condition of `filter` (even a paused one) against `samples` and
 * combines them with the filter's join. Skipped conditions count as not matched.
 */
export function testFilterAgainstSample(
  filter: Filter,
  samples: Readonly<Record<string, string>>,
  schema?: FilterSchema,
): FilterTestReport {
  const fields = sampleFields(samples, schema);
  const conditions = filter.conditions.map((condition, index) => testOne(condition, index, fields));
  const matched =
    filter.join === 'all'
      ? conditions.length > 0 && conditions.every((result) => result.matched)
      : conditions.some((result) => result.matched);
  return { matched, conditions };
}
