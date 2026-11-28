// Titles and plain-English one-line summaries of filters, for the list cards
// and the editor header.

import type { Action, Condition, Filter } from '../../core/filter-types';
import type { FilterActionOption, FilterSchema } from './schema';
import {
  AGE_UNIT_LABELS,
  DAY_LABELS,
  ELEMENT_TEST_OPTION,
  findActionOption,
  findTargetOption,
  findTestOption,
} from './schema';
import { extractSimpleChips } from './simple-model';

function truncate(value: string, max = 28): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function quotedValues(values: readonly string[], regex: boolean): string {
  const shown = values.map((value) => value.trim()).filter((value) => value.length > 0);
  if (shown.length === 0) {
    return '…';
  }
  const quote = (value: string) => (regex ? `/${truncate(value)}/` : `"${truncate(value)}"`);
  const head = shown.slice(0, 3).map(quote).join(' or ');
  return shown.length > 3 ? `${head} (+${shown.length - 3} more)` : head;
}

function partLabel(part: string, schema: FilterSchema): string {
  return findTargetOption(schema, part)?.label ?? part;
}

/** One condition in words (`Author contains "Sam"`). */
export function summarizeCondition(condition: Condition, schema: FilterSchema): string {
  switch (condition.kind) {
    case 'text': {
      const test = findTestOption(condition.test);
      const verb = condition.negate ? test.negatedLabel : test.label;
      const values = quotedValues(condition.values, condition.test === 'regex');
      return `${partLabel(condition.part, schema)} ${verb} ${values}`;
    }
    case 'element': {
      const verb = condition.negate ? ELEMENT_TEST_OPTION.negatedLabel : ELEMENT_TEST_OPTION.label;
      const selector = condition.selector.trim();
      return `the ${schema.itemSingular} ${verb} ${selector ? `\`${truncate(selector)}\`` : '…'}`;
    }
    case 'weekday': {
      const days = [...condition.days].sort((a, b) => a - b).map((day) => DAY_LABELS[day]);
      return days.length > 0 ? `the day is ${days.join(', ')}` : 'the day is …';
    }
    case 'age':
      return `the ${schema.itemSingular} is ${condition.olderThan ? 'older' : 'newer'} than ${condition.amount} ${AGE_UNIT_LABELS[condition.unit]}`;
    default:
      return 'an unsupported condition';
  }
}

function summarizeAction(
  action: Action | undefined,
  option: FilterActionOption | undefined,
): string {
  if (!action) {
    return 'Do nothing';
  }
  if (action.kind === 'unknown') {
    return 'Run an unsupported action';
  }
  const base = option?.label ?? action.kind;
  if (action.kind === 'hide' && action.note === false) {
    return `${base} (no note)`;
  }
  if (action.kind === 'replace' && action.find) {
    return `Replace "${truncate(action.find, 16)}"`;
  }
  return base;
}

/** True when every condition is a plain positive "contains" on one part under `any`. */
function isOnePartContains(filter: Filter): boolean {
  const { conditions } = filter;
  const first = conditions[0];
  if (first?.kind !== 'text' || (conditions.length > 1 && filter.join === 'all')) {
    return false;
  }
  return conditions.every(
    (condition) =>
      condition.kind === 'text' &&
      condition.part === first.part &&
      condition.test === 'contains' &&
      !condition.negate,
  );
}

function firstValue(filter: Filter): string {
  for (const condition of filter.conditions) {
    if (condition.kind === 'text') {
      const value = condition.values.find((item) => item.trim());
      if (value) {
        return value;
      }
    } else if (condition.kind === 'element' && condition.selector.trim()) {
      return condition.selector;
    }
  }
  return '';
}

function buildDisplayTitle(
  filter: Filter,
  primaryAction: FilterActionOption | undefined,
  onePartContains: boolean,
): string {
  const explicit = filter.name.trim();
  if (explicit) {
    return explicit;
  }
  const actionLabel = primaryAction?.simple?.title ?? primaryAction?.badge ?? 'Filter';
  if (onePartContains) {
    const words = extractSimpleChips(filter);
    if (words.length > 0) {
      const head = words
        .slice(0, 2)
        .map((word) => truncate(word, 18))
        .join(', ');
      const suffix = words.length > 2 ? ` +${words.length - 2}` : '';
      return `${actionLabel} "${head}${suffix}"`;
    }
  }
  const snippet = truncate(firstValue(filter), 24);
  return snippet ? `${actionLabel} "${snippet}"` : 'Untitled filter';
}

/**
 * The filter's name, or a title made from its first action and values
 * (`Hide "crypto, giveaway"`), or `'Untitled filter'`.
 */
export function displayFilterTitle(filter: Filter, schema: FilterSchema): string {
  const primaryAction = findActionOption(schema, filter.actions[0]?.kind);
  return buildDisplayTitle(filter, primaryAction, isOnePartContains(filter));
}

export interface FilterSummary {
  readonly title: string;
  readonly line: string;
  readonly primaryAction: FilterActionOption | undefined;
  readonly extraActionCount: number;
}

/** The title and one-line summary shown on a filter's list card. */
export function summarizeFilter(filter: Filter, schema: FilterSchema): FilterSummary {
  const { conditions, actions } = filter;
  const primary = actions[0];
  const primaryAction = findActionOption(schema, primary?.kind);
  const onePartContains = isOnePartContains(filter);

  let conditionPart = 'no conditions yet';
  if (conditions.length === 1 && conditions[0]) {
    conditionPart = summarizeCondition(conditions[0], schema);
  } else if (onePartContains && conditions[0]?.kind === 'text') {
    const values = conditions.flatMap((condition) =>
      condition.kind === 'text' ? condition.values : [],
    );
    conditionPart = `${partLabel(conditions[0].part, schema)} contains ${quotedValues(values, false)}`;
  } else if (conditions.length > 1) {
    const joiner = filter.join === 'all' ? ' and ' : ' or ';
    const preview = conditions
      .slice(0, 2)
      .map((condition) => summarizeCondition(condition, schema));
    const more = conditions.length > 2 ? ` (+${conditions.length - 2} more)` : '';
    conditionPart = `${preview.join(joiner)}${more}`;
  }

  return {
    title: buildDisplayTitle(filter, primaryAction, onePartContains),
    line: `${summarizeAction(primary, primaryAction)} when ${conditionPart}`,
    primaryAction,
    extraActionCount: Math.max(0, actions.length - 1),
  };
}
