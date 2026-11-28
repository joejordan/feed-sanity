// Pure lossless Simple <-> Filter mapping.
// Compiles Simple mode's goal tiles and multi-word tag chips into standard
// `Filter` JSON and guards
// Simple mode with a strict `isSimpleCompatible()` predicate so legacy regex,
// `AND`, negated, multi-target, or custom-CSS rules are never truncated.

import type { Action, Filter, Rule } from '../../core/filter-types';
import type { FilterSchema, HighlightPreset } from './schema';
import { normalizeRuleOperator } from '../../core/filter-engine';
import { newFilter, newRule } from '../../core/filter-types';
import { getSimpleActions, getSimpleTargets, HIGHLIGHT_PRESETS } from './schema';

export type SimpleCompatibility =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

const DOMAIN_OR_URL =
  /^(?:https?:\/\/|www\.)|[a-z0-9-]+\.(?:com|org|net|io|co|gov|edu|app|dev|tv|news)(?:\/|$)/i;

/**
 * Checks whether `filter` can be represented losslessly in Simple mode without
 * hiding or dropping any legacy/advanced field.
 */
export function isSimpleCompatible(filter: Filter, schema: FilterSchema): SimpleCompatibility {
  const rules = filter.rules ?? [];
  const actions = filter.actions ?? [];

  if (rules.length === 0) {
    return { ok: false, reason: 'Has no conditions' };
  }
  if (rules.length > 1 && filter.match === 'ALL') {
    return { ok: false, reason: 'Uses ALL (AND) matching' };
  }

  const simpleTargets = getSimpleTargets(schema);
  const target = rules[0]?.target ?? '';
  if (!simpleTargets.some((opt) => opt.value === target)) {
    return { ok: false, reason: 'Uses an advanced field' };
  }

  for (const rule of rules) {
    if (rule.target !== target) {
      return { ok: false, reason: 'Matches multiple different fields' };
    }
    const { operator, not } = normalizeRuleOperator(rule);
    if (not) {
      return { ok: false, reason: 'Uses negated ("doesn\'t contain") logic' };
    }
    if (operator !== 'contains') {
      return { ok: false, reason: `Uses "${operator}" comparison` };
    }
    if (rule.matcher !== 'str') {
      return { ok: false, reason: 'Uses regular expressions' };
    }
    if (rule.match_partial_words !== true) {
      return { ok: false, reason: 'Uses whole-word-only matching' };
    }
    const cond = rule.condition;
    if (cond) {
      if ((cond.modifier ?? 'i') !== 'i') {
        return { ok: false, reason: 'Uses case-sensitive matching' };
      }
      if (cond.value !== undefined || cond.units !== undefined) {
        return { ok: false, reason: 'Uses age matching' };
      }
      if (Object.entries(cond).some(([key, val]) => key.startsWith('day_') && val === true)) {
        return { ok: false, reason: 'Uses day-of-week schedule' };
      }
    }
  }

  if (actions.length === 0 || !actions[0]) {
    return { ok: false, reason: 'Has no actions' };
  }
  if (actions.length > 1) {
    return { ok: false, reason: 'Uses multiple actions' };
  }
  const action = actions[0];
  const simpleActions = getSimpleActions(schema);
  if (!simpleActions.some((opt) => opt.value === action.action)) {
    return { ok: false, reason: 'Uses an advanced action' };
  }

  if (action.action === 'hide') {
    if (action.custom_note || action.custom_nyet || action.css) {
      return { ok: false, reason: 'Uses a custom hide note or CSS' };
    }
  } else if (action.action === 'css') {
    if (action.selector?.trim()) {
      return { ok: false, reason: 'Targets a custom CSS selector' };
    }
    if (!action.content || !HIGHLIGHT_PRESETS.some((preset) => preset.css === action.content)) {
      return {
        ok: false,
        reason: action.content ? 'Uses custom CSS declarations' : 'Has empty CSS declarations',
      };
    }
  }

  if (filter.stop_on_match === true && action.action !== 'unhide') {
    return { ok: false, reason: 'Uses Stop on match' };
  }

  return { ok: true };
}

/** Creates a safe, reversible Simple-mode starter filter for `schema`. */
export function newSimpleFilter(schema: FilterSchema): Filter {
  const defaultTarget = getSimpleTargets(schema)[0]?.value ?? schema.targets[0]?.value ?? 'any';
  const defaultAction = getSimpleActions(schema)[0]?.value ?? schema.actions[0]?.value ?? 'hide';
  return newFilter({
    match: 'ANY',
    enabled: true,
    stop_on_match: defaultAction === 'unhide',
    rules: [newRule(defaultTarget)],
    actions: [
      defaultAction === 'hide' ? { action: 'hide', show_note: true } : { action: defaultAction },
    ],
  });
}

/** Extracts non-empty trimmed match phrases from a Simple-compatible filter's rules. */
export function extractSimpleChips(filter: Filter): string[] {
  const result: string[] = [];
  for (const rule of filter.rules ?? []) {
    const text = rule.condition?.text?.trim();
    if (text) {
      result.push(text);
    }
  }
  return result;
}

function appendUniqueChips(existing: readonly string[], extras: readonly string[]): string[] {
  const merged = [...existing];
  for (const part of extras) {
    if (!merged.some((chip) => chip.toLowerCase() === part.toLowerCase())) {
      merged.push(part);
    }
  }
  return merged;
}

/** Returns `[...savedChips, pendingText]` deduplicated case-insensitively for live previews and titles. */
export function effectiveSimpleChips(filter: Filter, pendingText: string): string[] {
  return appendUniqueChips(extractSimpleChips(filter), splitChipInput(pendingText));
}

/** Splits comma-separated user input into trimmed non-empty phrases. */
export function splitChipInput(raw: string): string[] {
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function makeSimpleRule(target: string, text?: string): Rule {
  const base = newRule(target);
  return text === undefined ? base : { ...base, condition: { ...base.condition, text } };
}

/** Replaces a Simple filter's rules with one literal `contains` rule per chip under `match: 'ANY'`. */
export function withSimpleChips(filter: Filter, target: string, chips: readonly string[]): Filter {
  const rules =
    chips.length > 0 ? chips.map((word) => makeSimpleRule(target, word)) : [makeSimpleRule(target)];
  return {
    ...filter,
    match: 'ANY',
    rules,
  };
}

/** Commits any uncommitted comma-separated text from the chip input into `filter.rules`. */
export function commitPendingText(
  filter: Filter,
  pendingText: string,
  target: string,
  schema?: FilterSchema,
): Filter {
  const rawExtras = splitChipInput(pendingText);
  if (rawExtras.length === 0) {
    return filter;
  }
  const extras = schema ? normalizeChipsForTarget(rawExtras, target, schema) : rawExtras;
  if (extras.length === 0) {
    return filter;
  }
  const existing = extractSimpleChips(filter);
  const merged = appendUniqueChips(existing, extras);
  return merged.length > existing.length ? withSimpleChips(filter, target, merged) : filter;
}

/** Returns the active Simple target value for `filter`, falling back to `schema`'s first Simple target. */
export function activeSimpleTarget(filter: Filter, schema: FilterSchema): string {
  const simpleTargets = getSimpleTargets(schema);
  const current = filter.rules?.[0]?.target;
  if (current && simpleTargets.some((opt) => opt.value === current)) {
    return current;
  }
  return simpleTargets[0]?.value ?? 'any';
}

export interface SmartTargetSuggestion {
  readonly targetId: string;
  readonly label: string;
}

/**
 * Gently detects `#hashtag`, `@account`, or domain/URL text typed while matching
 * `'any'` so the UI can offer a non-intrusive 1-click target switch.
 */
export function detectSmartTarget(
  text: string,
  currentTarget: string,
  schema: FilterSchema,
): SmartTargetSuggestion | null {
  if (currentTarget !== 'any') {
    return null;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  const simpleTargets = getSimpleTargets(schema);
  const findSimple = (id: string) => simpleTargets.find((t) => t.value === id);

  if (trimmed.startsWith('#')) {
    const opt = findSimple('hashtag');
    if (opt) {
      return { targetId: opt.value, label: opt.simpleLabel ?? opt.label };
    }
  }
  if (trimmed.startsWith('@')) {
    const opt = findSimple('author') ?? findSimple('sender');
    if (opt) {
      return { targetId: opt.value, label: opt.simpleLabel ?? opt.label };
    }
  }
  if (DOMAIN_OR_URL.test(trimmed)) {
    const opt = findSimple('link_url');
    if (opt) {
      return { targetId: opt.value, label: opt.simpleLabel ?? opt.label };
    }
  }
  return null;
}

/** Finds the `HighlightPreset` matching a `css` action (defaults to the first preset). */
export function highlightPresetForAction(action: Action | undefined): HighlightPreset {
  const found = HIGHLIGHT_PRESETS.find((preset) => preset.css === action?.content);
  return found ?? (HIGHLIGHT_PRESETS[0] as HighlightPreset);
}

/**
 * Normalizes a single chip value for `target` on `schema`: strips leading `#`
 * for `hashtag` when the site's extractor omits `#` (e.g. Facebook), and strips
 * leading `@` for `author` when the site's extractor omits `@` (e.g. Instagram,
 * Facebook).
 */
export function normalizeChipForTarget(chip: string, target: string, schema: FilterSchema): string {
  const trimmed = chip.trim();
  if (!trimmed) {
    return '';
  }
  if (target === 'hashtag') {
    const sampleTag = schema.sampleItem?.hashtag ?? '';
    if (sampleTag.length > 0 && !sampleTag.startsWith('#') && trimmed.startsWith('#')) {
      return trimmed.slice(1).trim();
    }
  }
  if (target === 'author') {
    const sampleAuthor = schema.sampleItem?.author ?? '';
    if (sampleAuthor.length > 0 && !sampleAuthor.includes('@') && trimmed.startsWith('@')) {
      return trimmed.slice(1).trim();
    }
  }
  return trimmed;
}

/** Normalizes and deduplicates chips for `target` on `schema`. */
export function normalizeChipsForTarget(
  chips: readonly string[],
  target: string,
  schema: FilterSchema,
): string[] {
  const normalized = chips
    .map((chip) => normalizeChipForTarget(chip, target, schema))
    .filter((chip) => chip.length > 0);
  return appendUniqueChips([], normalized);
}

/**
 * Builds a safe, reversible (`show_note: true`) filter directly from the list
 * view's 1-line Quick Hide bar, supporting comma-separated terms and smart
 * `#tag` / `@account` / URL detection.
 */
export function createQuickHideFilter(rawText: string, schema: FilterSchema): Filter | null {
  const parts = splitChipInput(rawText);
  if (parts.length === 0) {
    return null;
  }
  const first = parts[0] as string;
  let target = getSimpleTargets(schema)[0]?.value ?? 'any';
  if (parts.length === 1) {
    const detected = detectSmartTarget(first, target, schema);
    if (detected) {
      target = detected.targetId;
    }
  }
  const cleaned = normalizeChipsForTarget(parts, target, schema);
  if (cleaned.length === 0) {
    return null;
  }
  return withSimpleChips(newSimpleFilter(schema), target, cleaned);
}
