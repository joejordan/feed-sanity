// Maps Simple mode (a goal tile, a target pill and word chips) to filters and
// back. `isSimpleCompatible` lets Simple mode open a filter only when it can
// show and rewrite the filter without losing anything.

import type { Action, Filter, StyleAction, TextCondition } from '../../core/filter-types';
import type { FilterSchema, HighlightPreset } from './schema';
import { newAction, newCondition, newFilter } from '../../core/filter-types';
import { defaultTextPart, getSimpleActions, getSimpleTargets, HIGHLIGHT_PRESETS } from './schema';

export type SimpleCompatibility =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

const DOMAIN_OR_URL =
  /^(?:https?:\/\/|www\.)|[a-z0-9-]+\.(?:com|org|net|io|co|gov|edu|app|dev|tv|news)(?:\/|$)/i;

const OK: SimpleCompatibility = { ok: true };
const no = (reason: string): SimpleCompatibility => ({ ok: false, reason });

function checkCondition(condition: TextCondition): SimpleCompatibility {
  if (condition.negate) {
    return no('Uses "does not" logic');
  }
  if (condition.test !== 'contains') {
    return no(condition.test === 'regex' ? 'Uses a regular expression' : 'Uses an exact test');
  }
  if (condition.matchCase) {
    return no('Uses case-sensitive matching');
  }
  if (condition.wholeWords) {
    return no('Uses whole-word matching');
  }
  return OK;
}

function checkAction(action: Action, filter: Filter, schema: FilterSchema): SimpleCompatibility {
  if (!getSimpleActions(schema).some((option) => option.value === action.kind)) {
    return no('Uses an advanced action');
  }
  if (action.kind === 'hide' && action.noteText) {
    return no('Uses custom note text');
  }
  if (action.kind === 'style') {
    if (action.selector) {
      return no('Styles elements inside the item');
    }
    if (!HIGHLIGHT_PRESETS.some((preset) => preset.css === action.css)) {
      return no(action.css.trim() ? 'Uses custom CSS' : 'Has no CSS yet');
    }
  }
  if (filter.stopAfter && action.kind !== 'keep') {
    return no('Stops later filters');
  }
  return OK;
}

/** Whether Simple mode can show and rewrite `filter` without losing anything. */
export function isSimpleCompatible(filter: Filter, schema: FilterSchema): SimpleCompatibility {
  const { conditions, actions } = filter;
  if (conditions.length === 0) {
    return no('Has no conditions');
  }
  if (conditions.length > 1 && filter.join === 'all') {
    return no('Needs all conditions to hold');
  }
  const first = conditions[0];
  const part = first?.kind === 'text' ? first.part : undefined;
  if (part === undefined || !getSimpleTargets(schema).some((target) => target.value === part)) {
    return no('Uses an advanced part or condition');
  }
  for (const condition of conditions) {
    if (condition.kind !== 'text' || condition.part !== part) {
      return no('Tests more than one part');
    }
    const check = checkCondition(condition);
    if (!check.ok) {
      return check;
    }
  }
  const action = actions[0];
  if (!action) {
    return no('Has no actions');
  }
  if (actions.length > 1) {
    return no('Has more than one action');
  }
  return checkAction(action, filter, schema);
}

/** The action a Simple goal tile starts with. */
export function simpleActionOf(kind: string, previous?: Action): Action {
  if (kind === 'style') {
    const style: StyleAction = { kind: 'style', css: highlightPresetForAction(previous).css };
    return style;
  }
  return kind === 'keep' ? newAction('keep') : newAction('hide');
}

/** A new filter for Simple mode: the first Simple target and goal, no words yet. */
export function newSimpleFilter(schema: FilterSchema): Filter {
  const part = getSimpleTargets(schema)[0]?.value ?? defaultTextPart(schema);
  const goal = getSimpleActions(schema)[0]?.value ?? 'hide';
  return newFilter({
    stopAfter: goal === 'keep',
    conditions: [newCondition(part)],
    actions: [simpleActionOf(goal)],
  });
}

/** The trimmed, non-empty values of a Simple-compatible filter's conditions. */
export function extractSimpleChips(filter: Filter): string[] {
  const chips: string[] = [];
  for (const condition of filter.conditions) {
    if (condition.kind === 'text') {
      for (const value of condition.values) {
        const trimmed = value.trim();
        if (trimmed) {
          chips.push(trimmed);
        }
      }
    }
  }
  return chips;
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

/** The saved chips plus the text still being typed, without case-insensitive repeats. */
export function effectiveSimpleChips(filter: Filter, pendingText: string): string[] {
  return appendUniqueChips(extractSimpleChips(filter), splitChipInput(pendingText));
}

/** Splits comma-separated input into trimmed non-empty phrases. */
export function splitChipInput(raw: string): string[] {
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** Rewrites a Simple filter as one "contains" condition on `part` whose values are `chips`. */
export function withSimpleChips(filter: Filter, part: string, chips: readonly string[]): Filter {
  const condition: TextCondition = {
    ...newCondition(part),
    values: chips.length > 0 ? [...chips] : [''],
  };
  return { ...filter, join: 'any', conditions: [condition] };
}

/** Adds the comma-separated text still in the chip input to `filter`'s chips. */
export function commitPendingText(
  filter: Filter,
  pendingText: string,
  part: string,
  schema: FilterSchema,
): Filter {
  const extras = normalizeChipsForTarget(splitChipInput(pendingText), part, schema);
  if (extras.length === 0) {
    return filter;
  }
  const existing = extractSimpleChips(filter);
  const merged = appendUniqueChips(existing, extras);
  return merged.length > existing.length ? withSimpleChips(filter, part, merged) : filter;
}

/** The Simple target `filter` uses, or `schema`'s first Simple target. */
export function activeSimpleTarget(filter: Filter, schema: FilterSchema): string {
  const simpleTargets = getSimpleTargets(schema);
  const first = filter.conditions[0];
  const current = first?.kind === 'text' ? first.part : undefined;
  if (current && simpleTargets.some((option) => option.value === current)) {
    return current;
  }
  return simpleTargets[0]?.value ?? defaultTextPart(schema);
}

export interface SmartTargetSuggestion {
  readonly targetId: string;
  readonly label: string;
}

/**
 * Notices `#hashtag`, `@account` or a web address typed while matching the
 * whole item, so the UI can offer a one-click switch to the fitting part.
 */
export function detectSmartTarget(
  text: string,
  currentTarget: string,
  schema: FilterSchema,
): SmartTargetSuggestion | null {
  if (currentTarget !== 'text') {
    return null;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  const simpleTargets = getSimpleTargets(schema);
  const pick = (...ids: string[]): SmartTargetSuggestion | null => {
    for (const id of ids) {
      const option = simpleTargets.find((target) => target.value === id);
      if (option) {
        return { targetId: option.value, label: option.simpleLabel ?? option.label };
      }
    }
    return null;
  };
  if (trimmed.startsWith('#')) {
    return pick('hashtags');
  }
  if (trimmed.startsWith('@')) {
    return pick('author', 'sender');
  }
  return DOMAIN_OR_URL.test(trimmed) ? pick('link_urls', 'domain') : null;
}

/** The highlight preset a style action uses (the first preset when it uses none). */
export function highlightPresetForAction(action: Action | undefined): HighlightPreset {
  const css = action?.kind === 'style' ? action.css : undefined;
  return (
    HIGHLIGHT_PRESETS.find((preset) => preset.css === css) ??
    (HIGHLIGHT_PRESETS[0] as HighlightPreset)
  );
}

/**
 * Normalises one chip for `part`: hashtags are stored without `#`, and a
 * leading `@` is dropped for `author` when the site's sample author has none.
 */
export function normalizeChipForTarget(chip: string, part: string, schema: FilterSchema): string {
  const trimmed = chip.trim();
  if (part === 'hashtags' && trimmed.startsWith('#')) {
    return trimmed.slice(1).trim();
  }
  if (part === 'domain' && trimmed.includes('/')) {
    // Domain parts hold a bare host name, so a pasted address keeps only its host.
    try {
      const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
      return url.hostname.replace(/^www\./i, '');
    } catch {
      return trimmed;
    }
  }
  if (part === 'author' && trimmed.startsWith('@')) {
    const sampleAuthor = schema.sampleItem?.author ?? '';
    if (sampleAuthor.length > 0 && !sampleAuthor.includes('@')) {
      return trimmed.slice(1).trim();
    }
  }
  return trimmed;
}

/** Normalises chips for `part` and drops empty ones and repeats. */
export function normalizeChipsForTarget(
  chips: readonly string[],
  part: string,
  schema: FilterSchema,
): string[] {
  const normalized = chips
    .map((chip) => normalizeChipForTarget(chip, part, schema))
    .filter((chip) => chip.length > 0);
  return appendUniqueChips([], normalized);
}

/**
 * The Quick Hide bar's filter: hide items whose whole text contains any of
 * the comma-separated terms. Null when there is nothing to look for.
 */
export function createQuickHideFilter(rawText: string, schema: FilterSchema): Filter | null {
  // A bare `#` or `@` would hide every item that contains one.
  const terms = appendUniqueChips(
    [],
    splitChipInput(rawText).filter((term) => term.replace(/^[#@]+/, '').trim().length > 0),
  );
  if (terms.length === 0) {
    return null;
  }
  return withSimpleChips(newFilter(), defaultTextPart(schema), terms);
}
