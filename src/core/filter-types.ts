// Feed Sanity's cross-site filter model: a saved list of filters, each a set of
// conditions joined by "all" or "any" plus the actions to run when they hold.
// This file holds the types, the constructors, the tolerant reader used for
// storage, backups and pasted JSON, and the saved-value accessor.

import type { FeatureData, SavedValue } from './saved';

/** Saved-data name of a site's filter list (`v2/<siteId>/<accountId>/custom_filters`). */
export const CUSTOM_FILTERS_KEY = 'custom_filters';

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

/** How a text condition compares its values with an item's part. */
export const TEXT_TESTS = ['contains', 'is', 'starts', 'ends', 'regex'] as const;
export type TextTest = (typeof TEXT_TESTS)[number];

/** Holds when the item's `part` passes `test` for at least one of `values`. */
export interface TextCondition {
  readonly kind: 'text';
  /** Part name from the shared vocabulary (`text`, `body`, `author`, ...). */
  readonly part: string;
  readonly test: TextTest;
  /** Literal text, or regular expressions when `test` is `'regex'`. Empty values never match. */
  readonly values: readonly string[];
  readonly negate?: boolean;
  readonly matchCase?: boolean;
  /** `contains` only: match at word boundaries instead of inside longer words. */
  readonly wholeWords?: boolean;
  /** `regex` only: extra flags such as `s`, `m` or `u`. Case is set by `matchCase`. */
  readonly regexFlags?: string;
}

/** Holds when the item contains an element matching `selector`. */
export interface ElementCondition {
  readonly kind: 'element';
  readonly selector: string;
  readonly negate?: boolean;
}

/** Holds when today (local time) is one of `days` (0 = Sunday ... 6 = Saturday). */
export interface WeekdayCondition {
  readonly kind: 'weekday';
  readonly days: readonly number[];
}

/** Compares the item's age with `amount` `unit`s. Only sites that know item times handle it. */
export interface AgeCondition {
  readonly kind: 'age';
  /** True: holds for items older than the amount. False: for items newer than it. */
  readonly olderThan: boolean;
  readonly amount: number;
  readonly unit: AgeUnit;
}

export const AGE_UNITS = ['hours', 'days'] as const;
export type AgeUnit = (typeof AGE_UNITS)[number];

/**
 * A saved condition this version does not understand (an unknown kind, or a
 * known kind with an unusable test). It never holds, and `original` keeps the
 * saved object so it survives a save.
 */
export interface UnknownCondition {
  readonly kind: 'unknown';
  readonly original: Readonly<Record<string, unknown>>;
}

export type Condition =
  | TextCondition
  | ElementCondition
  | WeekdayCondition
  | AgeCondition
  | UnknownCondition;
export type ConditionKind = Exclude<Condition['kind'], 'unknown'>;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Hides the item. */
export interface HideAction {
  readonly kind: 'hide';
  /** Show a note in place of the item. Unset follows the site's note setting; true forces one. */
  readonly note?: boolean;
  /** Note text. `{match}` is replaced by the text that matched. */
  readonly noteText?: string;
}

/** Keeps the item visible, undoing hiding by earlier filters and the site's quick switches. */
export interface KeepAction {
  readonly kind: 'keep';
}

/** Inline CSS declarations (`color: red; opacity: .5`) on the item or on matches inside it. */
export interface StyleAction {
  readonly kind: 'style';
  readonly css: string;
  readonly selector?: string;
}

/** Adds space-separated class names to the item or to matches inside it. */
export interface AddClassAction {
  readonly kind: 'add_class';
  readonly className: string;
  readonly selector?: string;
}

/** Replaces text in the item: `find` is a regex, applied globally and ignoring case. */
export interface ReplaceAction {
  readonly kind: 'replace';
  readonly find: string;
  readonly replaceWith: string;
}

/** Marks the item read (sites that keep a read history). */
export interface SetReadAction {
  readonly kind: 'set_read';
}

/** Marks the item unread (sites that keep a read history). */
export interface SetUnreadAction {
  readonly kind: 'set_unread';
}

/** A saved action this version does not understand. It does nothing. */
export interface UnknownAction {
  readonly kind: 'unknown';
  readonly original: Readonly<Record<string, unknown>>;
}

export type Action =
  | HideAction
  | KeepAction
  | StyleAction
  | AddClassAction
  | ReplaceAction
  | SetReadAction
  | SetUnreadAction
  | UnknownAction;
export type ActionKind = Exclude<Action['kind'], 'unknown'>;

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/** `all`: every condition must hold. `any`: at least one must. */
export type FilterJoin = 'all' | 'any';

export interface Filter {
  /** Stable random id: identity for hit counts and list keys. */
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly enabled: boolean;
  readonly join: FilterJoin;
  /** When this filter matches, later filters are not run. */
  readonly stopAfter: boolean;
  readonly conditions: readonly Condition[];
  readonly actions: readonly Action[];
}

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

/** A fresh random filter id. Works outside secure contexts (no `randomUUID`). */
export function newFilterId(): string {
  const bytes = new Uint8Array(9);
  globalThis.crypto.getRandomValues(bytes);
  let id = 'f';
  for (const byte of bytes) {
    id += byte.toString(16).padStart(2, '0');
  }
  return id;
}

/** A text condition: contains, ignoring case, inside words allowed, one empty value. */
export function newCondition(part = 'text'): TextCondition {
  return { kind: 'text', part, test: 'contains', values: [''] };
}

/** A blank condition of the given kind. */
export function conditionOfKind<K extends ConditionKind>(
  kind: K,
  part = 'text',
): Extract<Condition, { kind: K }> {
  let condition: Condition;
  switch (kind as ConditionKind) {
    case 'element':
      condition = { kind: 'element', selector: '' };
      break;
    case 'weekday':
      condition = { kind: 'weekday', days: [] };
      break;
    case 'age':
      condition = { kind: 'age', olderThan: true, amount: 1, unit: 'days' };
      break;
    default:
      condition = newCondition(part);
  }
  return condition as Extract<Condition, { kind: K }>;
}

/** A blank action of the given kind. */
export function newAction<K extends ActionKind = 'hide'>(
  kind: K = 'hide' as K,
): Extract<Action, { kind: K }> {
  let action: Action;
  switch (kind as ActionKind) {
    case 'style':
      action = { kind: 'style', css: '' };
      break;
    case 'add_class':
      action = { kind: 'add_class', className: '' };
      break;
    case 'replace':
      action = { kind: 'replace', find: '', replaceWith: '' };
      break;
    default:
      action = { kind } as Action;
  }
  return action as Extract<Action, { kind: K }>;
}

/** A new enabled filter with one blank condition and a hide action, plus `overrides`. */
export function newFilter(overrides: Partial<Filter> = {}): Filter {
  const filter: Filter = {
    id: newFilterId(),
    name: '',
    enabled: true,
    join: 'any',
    stopAfter: false,
    conditions: [newCondition()],
    actions: [newAction()],
  };
  const defined = Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined),
  ) as Partial<Filter>;
  return { ...filter, ...defined };
}

/** True when `filter` is enabled and has at least one condition and one action. */
export function isRunnable(filter: Filter): boolean {
  return filter.enabled && filter.conditions.length > 0 && filter.actions.length > 0;
}

// ---------------------------------------------------------------------------
// Tolerant reader
// ---------------------------------------------------------------------------

type Raw = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function optionalStr(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return allowed.find((item) => item === value);
}

function unknownOf(raw: Raw): UnknownCondition & UnknownAction {
  // An entry already wrapped by an earlier read keeps its first original.
  if (raw.kind === 'unknown' && isRecord(raw.original)) {
    return { kind: 'unknown', original: raw.original };
  }
  return { kind: 'unknown', original: { ...raw } };
}

/** Adds `key: true` to `target` only when `value` is true, keeping saved data small. */
function flag<T extends object, K extends string>(target: T, key: K, value: unknown): T {
  return value === true ? { ...target, [key]: true } : target;
}

function readTextCondition(raw: Raw): Condition {
  const test = oneOf(raw.test ?? 'contains', TEXT_TESTS);
  if (!test) {
    return unknownOf(raw);
  }
  let values: string[] = [];
  if (Array.isArray(raw.values)) {
    values = raw.values.filter((value): value is string => typeof value === 'string');
  } else if (typeof raw.values === 'string') {
    values = [raw.values];
  }
  let condition: TextCondition = { kind: 'text', part: str(raw.part) || 'text', test, values };
  condition = flag(condition, 'negate', raw.negate);
  condition = flag(condition, 'matchCase', raw.matchCase);
  condition = flag(condition, 'wholeWords', raw.wholeWords);
  const regexFlags = optionalStr(raw.regexFlags);
  return regexFlags ? { ...condition, regexFlags } : condition;
}

function readCondition(raw: Raw): Condition {
  switch (raw.kind) {
    case 'text':
      return readTextCondition(raw);
    case 'element':
      return flag({ kind: 'element', selector: str(raw.selector) }, 'negate', raw.negate);
    case 'weekday': {
      const days = Array.isArray(raw.days)
        ? raw.days.filter(
            (day, index, all): day is number =>
              Number.isInteger(day) && day >= 0 && day <= 6 && all.indexOf(day) === index,
          )
        : [];
      return { kind: 'weekday', days };
    }
    case 'age': {
      const amount = typeof raw.amount === 'number' && raw.amount >= 0 ? raw.amount : 0;
      return {
        kind: 'age',
        olderThan: raw.olderThan !== false,
        amount,
        unit: oneOf(raw.unit, AGE_UNITS) ?? 'days',
      };
    }
    default:
      return unknownOf(raw);
  }
}

function withSelector<T extends object>(target: T, raw: Raw): T {
  const selector = optionalStr(raw.selector)?.trim();
  return selector ? { ...target, selector } : target;
}

function readAction(raw: Raw): Action {
  switch (raw.kind) {
    case 'hide': {
      let action: HideAction = { kind: 'hide' };
      if (typeof raw.note === 'boolean') {
        action = { ...action, note: raw.note };
      }
      const noteText = optionalStr(raw.noteText);
      return noteText ? { ...action, noteText } : action;
    }
    case 'keep':
    case 'set_read':
    case 'set_unread':
      return { kind: raw.kind };
    case 'style':
      return withSelector({ kind: 'style', css: str(raw.css) }, raw);
    case 'add_class':
      return withSelector({ kind: 'add_class', className: str(raw.className) }, raw);
    case 'replace':
      return { kind: 'replace', find: str(raw.find), replaceWith: str(raw.replaceWith) };
    default:
      return unknownOf(raw);
  }
}

function readList<T>(value: unknown, read: (raw: Raw) => T): T[] {
  return Array.isArray(value) ? value.filter(isRecord).map(read) : [];
}

function readFilter(raw: Raw): Filter {
  const filter: Filter = {
    id: optionalStr(raw.id) ?? newFilterId(),
    name: str(raw.name),
    enabled: raw.enabled !== false,
    join: raw.join === 'all' ? 'all' : 'any',
    stopAfter: raw.stopAfter === true,
    conditions: readList(raw.conditions, readCondition),
    actions: readList(raw.actions, readAction),
  };
  const description = optionalStr(raw.description);
  return description ? { ...filter, description } : filter;
}

/**
 * Reads a saved, imported or pasted filter list. Never throws: anything that
 * is not an array gives `[]`, entries that are not objects are dropped,
 * missing lists become empty, unknown kinds are kept but inert, and a filter
 * without an id gets a fresh one. Duplicate ids are renewed so ids stay unique.
 */
export function readFilters(stored: unknown): Filter[] {
  return Array.isArray(stored) ? withUniqueIds(stored.filter(isRecord).map(readFilter)) : [];
}

/** `list` with every id that repeats, or is already used in `taken`, renewed. */
export function withUniqueIds(list: readonly Filter[], taken: readonly Filter[] = []): Filter[] {
  const seen = new Set(taken.map((filter) => filter.id));
  return list.map((filter) => {
    const unique = seen.has(filter.id) ? { ...filter, id: newFilterId() } : filter;
    seen.add(unique.id);
    return unique;
  });
}

/** The site's saved filter list. Every caller with the same `SavedData` gets the same object. */
export function savedFilters(data: FeatureData): SavedValue<Filter[]> {
  return data.value(CUSTOM_FILTERS_KEY, readFilters);
}
