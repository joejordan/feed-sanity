// Generates scannable titles and plain-English rule summaries for the Filter
// Rules list cards and editor header.

import type { Action, Filter, Rule } from '../../core/filter-types';
import type { FilterActionOption, FilterSchema } from './schema';
import { normalizeRuleOperator } from '../../core/filter-engine';
import { DAY_LABELS, findActionOption, findTargetOption } from './schema';

function truncate(value: string, max = 28): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function summarizeRule(rule: Rule, schema: FilterSchema): string {
  if (rule.target === 'day') {
    const days = DAY_LABELS.filter((_day, idx) => rule.condition?.[`day_${idx}`] === true);
    return days.length > 0 ? `day is ${days.join(', ')}` : 'day of week';
  }
  if (rule.target === 'age') {
    const value = rule.condition?.value ?? '';
    const unit = rule.condition?.units === 'h' ? 'h' : 'd';
    const dir = rule.operator === 'lt' ? 'newer than' : 'older than';
    return value === '' ? `age ${dir} …` : `age ${dir} ${value}${unit}`;
  }
  const { operator, not } = normalizeRuleOperator(rule);
  const targetLabel = findTargetOption(schema, rule.target)?.label ?? rule.target ?? 'Content';
  const neg = not ? 'does not ' : '';
  const text = truncate(rule.condition?.text ?? '');

  if (operator === 'contains_selector') {
    return `${not ? 'missing' : 'matches'} selector ${text ? `\`${text}\`` : '…'}`;
  }
  if (operator === 'matches') {
    const flags = (rule.condition?.modifier ?? '').replace('I', '');
    return `${targetLabel} ${neg}matches /${text || '…'}/${flags}`;
  }
  let verb = 'contains';
  if (operator === 'equals') {
    verb = not ? 'equal' : 'equals';
  } else if (operator === 'startswith') {
    verb = not ? 'start with' : 'starts with';
  } else if (operator === 'endswith') {
    verb = not ? 'end with' : 'ends with';
  } else if (not) {
    verb = 'contain';
  }
  return `${targetLabel} ${neg}${verb} ${text ? `"${text}"` : '…'}`;
}

function summarizeAction(action: Action | undefined, schema: FilterSchema): string {
  if (!action?.action) {
    return 'Do nothing';
  }
  const option = findActionOption(schema, action.action);
  const base = option?.label ?? action.action;
  if (action.action === 'hide' && action.show_note) {
    return `${base} (with note)`;
  }
  if ((action.action === 'move-to-tab' || action.action === 'copy-to-tab') && action.tab) {
    return `${base} "${truncate(action.tab, 20)}"`;
  }
  if (action.action === 'replace' && action.find) {
    return `Replace "${truncate(action.find, 16)}"`;
  }
  return base;
}

/**
 * Computes a readable display title for `filter`: uses `filter.title` when set,
 * otherwise derives a smart title from the primary action and first condition
 * (e.g. `Hide "crypto"`), falling back to `'Untitled filter'`.
 */
export function displayFilterTitle(filter: Filter, schema: FilterSchema): string {
  const explicit = filter.title?.trim();
  if (explicit) {
    return explicit;
  }
  const firstAction = filter.actions?.[0];
  const firstRule = filter.rules?.[0];
  const snippet = truncate(firstRule?.condition?.text ?? '', 24);
  if (snippet) {
    const actionBadge = findActionOption(schema, firstAction?.action)?.badge ?? 'Filter';
    return `${actionBadge} "${snippet}"`;
  }
  return 'Untitled filter';
}

export interface FilterSummary {
  readonly title: string;
  readonly line: string;
  readonly primaryAction: FilterActionOption | undefined;
  readonly extraActionCount: number;
}

/** Builds the plain-English summary rendered on each rule card and editor header. */
export function summarizeFilter(filter: Filter, schema: FilterSchema): FilterSummary {
  const rules = filter.rules ?? [];
  const actions = filter.actions ?? [];
  const primary = actions[0];
  const primaryAction = findActionOption(schema, primary?.action);
  const actionPart = summarizeAction(primary, schema);
  const extraActionCount = Math.max(0, actions.length - 1);

  let conditionPart = 'no conditions yet';
  if (rules.length === 1 && rules[0]) {
    conditionPart = summarizeRule(rules[0], schema);
  } else if (rules.length > 1) {
    const joiner = filter.match === 'ALL' ? ' AND ' : ' OR ';
    const preview = rules.slice(0, 2).map((rule) => summarizeRule(rule, schema));
    const more = rules.length > 2 ? ` (+${rules.length - 2} more)` : '';
    conditionPart = `${preview.join(joiner)}${more}`;
  }

  return {
    title: displayFilterTitle(filter, schema),
    line: `${actionPart} when ${conditionPart}`,
    primaryAction,
    extraActionCount,
  };
}
