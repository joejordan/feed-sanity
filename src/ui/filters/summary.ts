// Generates scannable titles and plain-English rule summaries for the Filter
// Rules list cards and editor header.

import type { Action, Filter, Rule } from '../../core/filter-types';
import type { FilterActionOption, FilterSchema } from './schema';
import { normalizeRuleOperator } from '../../core/filter-engine';
import { DAY_LABELS, findActionOption, findTargetOption } from './schema';
import { extractSimpleChips } from './simple-model';

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

function summarizeAction(
  action: Action | undefined,
  option: FilterActionOption | undefined,
): string {
  if (!action?.action) {
    return 'Do nothing';
  }
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

/** True when every rule in `rules` is a plain positive `contains` check on the same target under OR (`ANY`). */
function isSharedTargetContainsOr(filter: Filter): boolean {
  const rules = filter.rules ?? [];
  if (rules.length < 2 || filter.match === 'ALL') {
    return false;
  }
  const target = rules[0]?.target;
  if (!target || target === 'day' || target === 'age') {
    return false;
  }
  return rules.every((rule) => {
    const { operator, not } = normalizeRuleOperator(rule);
    return rule.target === target && !not && operator === 'contains';
  });
}

function buildDisplayTitle(
  filter: Filter,
  primaryAction: FilterActionOption | undefined,
  sharedContainsOr: boolean,
): string {
  const explicit = filter.title?.trim();
  if (explicit) {
    return explicit;
  }
  const actionLabel = primaryAction?.simple?.title ?? primaryAction?.badge ?? 'Filter';

  if (sharedContainsOr) {
    const words = extractSimpleChips(filter);
    if (words.length > 0) {
      const head = words
        .slice(0, 2)
        .map((w) => truncate(w, 18))
        .join(', ');
      const suffix = words.length > 2 ? ` +${words.length - 2}` : '';
      return `${actionLabel} "${head}${suffix}"`;
    }
  }

  const firstRule = filter.rules?.[0];
  const snippet = truncate(firstRule?.condition?.text ?? '', 24);
  if (snippet) {
    return `${actionLabel} "${snippet}"`;
  }
  return 'Untitled filter';
}

/**
 * Computes a readable display title for `filter`: uses `filter.title` when set,
 * otherwise derives a smart title from the primary action and conditions
 * (e.g. `Hide "crypto, giveaway"`), falling back to `'Untitled filter'`.
 */
export function displayFilterTitle(filter: Filter, schema: FilterSchema): string {
  const primaryAction = findActionOption(schema, filter.actions?.[0]?.action);
  return buildDisplayTitle(filter, primaryAction, isSharedTargetContainsOr(filter));
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
  const sharedContainsOr = isSharedTargetContainsOr(filter);
  const actionPart = summarizeAction(primary, primaryAction);
  const extraActionCount = Math.max(0, actions.length - 1);

  let conditionPart = 'no conditions yet';
  if (rules.length === 1 && rules[0]) {
    conditionPart = summarizeRule(rules[0], schema);
  } else if (sharedContainsOr) {
    const target = rules[0]?.target;
    const targetLabel = findTargetOption(schema, target)?.label ?? target ?? 'Content';
    const quoted = rules
      .slice(0, 3)
      .map((rule) => {
        const text = truncate(rule.condition?.text ?? '');
        return text ? `"${text}"` : '…';
      })
      .join(' or ');
    const more = rules.length > 3 ? ` (+${rules.length - 3} more)` : '';
    conditionPart = `${targetLabel} contains ${quoted}${more}`;
  } else if (rules.length > 1) {
    const joiner = filter.match === 'ALL' ? ' AND ' : ' OR ';
    const preview = rules.slice(0, 2).map((rule) => summarizeRule(rule, schema));
    const more = rules.length > 2 ? ` (+${rules.length - 2} more)` : '';
    conditionPart = `${preview.join(joiner)}${more}`;
  }

  return {
    title: buildDisplayTitle(filter, primaryAction, sharedContainsOr),
    line: `${actionPart} when ${conditionPart}`,
    primaryAction,
    extraActionCount,
  };
}
