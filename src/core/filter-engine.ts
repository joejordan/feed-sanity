// Runs a filter list against one item. A site describes the item through
// `FilterFields` (its parts by name) and, optionally, the item's element and
// a hook for the conditions it handles itself. The result is a
// `FilterOutcome`: whether to hide or keep the item, plus the classes, inline
// styles, text replacements and read state that matching filters asked for.

import type {
  Action,
  Condition,
  ElementCondition,
  Filter,
  HideAction,
  TextCondition,
} from './filter-types';
import { queryDeepFirst } from './dom';
import { isRunnable } from './filter-types';
import { OWN_ATTR } from './page-watcher';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A part's value: text, a list of texts, or null when the item has no such part. */
export type FilterFieldValue = string | readonly string[] | null;

/** An item's parts, read by name (see the shared part vocabulary). */
export interface FilterFields {
  readonly get: (name: string) => FilterFieldValue;
  /** Lets a replace action's result feed later filters. */
  readonly set?: (name: string, value: FilterFieldValue) => void;
  /** Parts a replace action rewrites (default: `['text']`). */
  readonly textParts?: readonly string[];
}

/** A list part's value: its distinct non-empty texts, or null when there are none. */
export function listPart(values: Iterable<string>): readonly string[] | null {
  const distinct = new Set<string>();
  for (const value of values) {
    if (value.length > 0) {
      distinct.add(value);
    }
  }
  return distinct.size > 0 ? [...distinct] : null;
}

export interface ConditionResult {
  readonly matched: boolean;
  /** The text that matched, for `{match}` in notes. */
  readonly caught?: string;
}

export interface FilterContext {
  readonly fields: FilterFields;
  /** Root for element conditions; searched through open shadow roots. */
  readonly element?: Element;
  /** Clock for weekday and age conditions (default: `new Date()`). */
  readonly now?: () => Date;
  /** What an item is called in default note text (`'post'`, `'thread'`, ...). */
  readonly itemNoun?: string;
  /** Site hook for conditions it handles itself. Return `undefined` to leave one to the core. */
  readonly testCondition?: (
    condition: Condition,
    context: FilterContext,
  ) => ConditionResult | undefined;
  /** Called once for each filter that matched, before its actions run. */
  readonly onFilterMatch?: (filter: Filter) => void;
  /** Debug log for conditions that could not be tested (bad regex, bad selector). */
  readonly report?: (message: string, error?: unknown) => void;
}

export interface FilterHiding {
  /** Note text while the item is hidden. */
  readonly label: string;
  /** False when the hide action turned the note off. Combine with the site's note setting. */
  readonly showNote: boolean;
  /** True when the hide action asked for a note even if the site's note setting is off. */
  readonly forceNote: boolean;
}

export interface FilterClass {
  readonly name: string;
  readonly selector?: string;
}

export interface FilterStyle {
  readonly property: string;
  readonly value: string;
  readonly important: boolean;
  readonly selector?: string;
}

export interface FilterReplacement {
  /** Global, case-insensitive pattern. */
  readonly find: RegExp;
  readonly replaceWith: string;
}

export interface FilterOutcome {
  readonly hiding: FilterHiding | null;
  /** A keep action ran last: the item stays visible, whatever the site's quick switches say. */
  readonly kept: boolean;
  readonly classes: readonly FilterClass[];
  readonly styles: readonly FilterStyle[];
  readonly replacements: readonly FilterReplacement[];
  readonly read?: 'read' | 'unread';
}

/** The outcome when no filter matched. */
export const EMPTY_OUTCOME: FilterOutcome = Object.freeze({
  hiding: null,
  kept: false,
  classes: Object.freeze([]),
  styles: Object.freeze([]),
  replacements: Object.freeze([]),
});

// ---------------------------------------------------------------------------
// Text conditions
// ---------------------------------------------------------------------------

// Syntax characters only: Unicode mode rejects escapes of anything else (such as `-`).
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\/]/g;
/** Regex flags a user may add. `i` comes from `matchCase`; `g` and `y` make `test` stateful. */
export const USER_REGEX_FLAGS = 'dmsuv';
const WORD_CHAR = String.raw`[\p{L}\p{N}_]`;

/** `text` with every regex syntax character escaped; valid with or without the `u` flag. */
export function escapeRegex(text: string): string {
  return text.replace(REGEX_SPECIALS, String.raw`\$&`);
}

/** The pattern a replace action's `find` compiles to: global, ignoring case. Throws when invalid. */
export function compileReplacePattern(find: string): RegExp {
  return new RegExp(find, 'gi');
}

/**
 * Drops empty top-level alternatives (`|a`, `a|`, `a||b`) that would make a
 * pattern match everywhere. Escaped pipes, pipes in character classes and
 * alternatives inside groups are left alone.
 */
export function dropEmptyAlternatives(pattern: string): string {
  const alternatives: string[] = [];
  let depth = 0;
  let inClass = false;
  let start = 0;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') {
      i++;
    } else if (inClass) {
      inClass = ch !== ']';
    } else if (ch === '[') {
      inClass = true;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
    } else if (ch === '|' && depth === 0) {
      alternatives.push(pattern.slice(start, i));
      start = i + 1;
    }
  }
  alternatives.push(pattern.slice(start));
  return alternatives.filter((alternative) => alternative.length > 0).join('|');
}

function regexFlagsOf(condition: TextCondition, literal: boolean): string {
  const flags = new Set<string>();
  if (!condition.matchCase) {
    flags.add('i');
  }
  if (literal) {
    // Unicode mode for the `\p{...}` word-boundary classes.
    flags.add('u');
  } else {
    for (const flag of condition.regexFlags ?? '') {
      if (USER_REGEX_FLAGS.includes(flag)) {
        flags.add(flag);
      }
    }
  }
  return [...flags].join('');
}

/**
 * Builds the pattern a text condition tests with. Returns `null` when there
 * is nothing to look for (no non-empty value), and throws when a regex value
 * or the flags do not compile.
 */
export function compileTextCondition(condition: TextCondition): RegExp | null {
  const literal = condition.test !== 'regex';
  const sources: string[] = [];
  for (const value of condition.values) {
    if (value.trim().length === 0) {
      continue;
    }
    const source = literal ? escapeRegex(value) : dropEmptyAlternatives(value);
    if (source.length > 0) {
      sources.push(source);
    }
  }
  if (sources.length === 0) {
    return null;
  }
  const flags = regexFlagsOf(condition, literal);
  // Compile each regex value alone first: a value such as `a)(b` must fail
  // rather than turn valid once wrapped in a group.
  const checked = literal ? sources : sources.map((source) => new RegExp(source, flags).source);
  const body = checked.map((source) => `(?:${source})`).join('|');
  switch (condition.test) {
    case 'is':
      return new RegExp(String.raw`^\s*(?:${body})\s*$`, flags);
    case 'starts':
      return new RegExp(String.raw`^\s*(?:${body})`, flags);
    case 'ends':
      return new RegExp(String.raw`(?:${body})\s*$`, flags);
    case 'contains':
      return condition.wholeWords
        ? new RegExp(`(?<!${WORD_CHAR})(?:${body})(?!${WORD_CHAR})`, flags)
        : new RegExp(body, flags);
    default:
      return new RegExp(body, flags);
  }
}

type Compiled = { readonly pattern: RegExp | null } | { readonly error: unknown };
const compiledTexts = new WeakMap<TextCondition, Compiled>();

function compiledText(condition: TextCondition, context: FilterContext): RegExp | null {
  let compiled = compiledTexts.get(condition);
  if (!compiled) {
    try {
      compiled = { pattern: compileTextCondition(condition) };
    } catch (error) {
      compiled = { error };
      // Reported once per condition object, not once per item.
      context.report?.(`Filter regex does not compile: ${condition.values.join(' | ')}`, error);
    }
    compiledTexts.set(condition, compiled);
  }
  return 'pattern' in compiled ? compiled.pattern : null;
}

const NO_MATCH: ConditionResult = Object.freeze({ matched: false });
const MATCH: ConditionResult = Object.freeze({ matched: true });

function testText(condition: TextCondition, context: FilterContext): ConditionResult {
  const pattern = compiledText(condition, context);
  if (!pattern) {
    return NO_MATCH;
  }
  const value = context.fields.get(condition.part);
  if (value === null || value === undefined) {
    return NO_MATCH;
  }
  const items: readonly string[] = typeof value === 'string' ? [value] : value;
  for (const item of items) {
    const found = pattern.exec(item);
    if (found) {
      return condition.negate ? NO_MATCH : { matched: true, caught: found[0] };
    }
  }
  return condition.negate ? MATCH : NO_MATCH;
}

// ---------------------------------------------------------------------------
// Other conditions
// ---------------------------------------------------------------------------

const badSelectors = new WeakSet<ElementCondition>();

function testElement(condition: ElementCondition, context: FilterContext): ConditionResult {
  const selector = condition.selector.trim();
  if (!selector || !context.element || badSelectors.has(condition)) {
    return NO_MATCH;
  }
  let found: boolean;
  try {
    found = queryDeepFirst(context.element, selector, OWN_ATTR) !== null;
  } catch (error) {
    badSelectors.add(condition);
    context.report?.(`Filter selector does not parse: ${selector}`, error);
    return NO_MATCH;
  }
  return found === (condition.negate === true) ? NO_MATCH : MATCH;
}

/** Tests one condition with the core rules only, skipping the site hook. */
function testCoreCondition(condition: Condition, context: FilterContext): ConditionResult {
  switch (condition.kind) {
    case 'text':
      return testText(condition, context);
    case 'element':
      return testElement(condition, context);
    case 'weekday': {
      const day = (context.now?.() ?? new Date()).getDay();
      return condition.days.includes(day) ? MATCH : NO_MATCH;
    }
    default:
      // `age` needs the item's time, which only a site hook knows; unknown kinds are inert.
      return NO_MATCH;
  }
}

/** Tests one condition: the site hook first, then the core rules. */
export function testCondition(condition: Condition, context: FilterContext): ConditionResult {
  return context.testCondition?.(condition, context) ?? testCoreCondition(condition, context);
}

/** Whether `filter`'s conditions hold, and the text that decided it. */
function testFilter(filter: Filter, context: FilterContext): ConditionResult {
  if (filter.join === 'any') {
    for (const condition of filter.conditions) {
      const result = testCondition(condition, context);
      if (result.matched) {
        return result;
      }
    }
    return NO_MATCH;
  }
  let caught: string | undefined;
  for (const condition of filter.conditions) {
    const result = testCondition(condition, context);
    if (!result.matched) {
      return NO_MATCH;
    }
    caught ??= result.caught;
  }
  return caught === undefined ? MATCH : { matched: true, caught };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function hidingFor(
  action: HideAction,
  filter: Filter,
  caught: string | undefined,
  itemNoun: string | undefined,
): FilterHiding {
  let label: string;
  if (action.noteText?.trim()) {
    label = action.noteText
      .replaceAll('{match}', caught ?? '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  } else {
    const subject = itemNoun ? `${capitalize(itemNoun)} hidden` : 'Hidden';
    const name = filter.name.trim();
    label = name ? `${subject} by your “${name}” filter` : `${subject} by one of your filters`;
  }
  return { label, showNote: action.note !== false, forceNote: action.note === true };
}

const PROPERTY_NAME = /^(?:--[\w-]+|-?[a-z][a-z0-9-]*)$/i;
const IMPORTANT = /\s*!\s*important\s*$/i;

/** Splits `css` on top-level `;` (not inside quotes or parentheses). */
function splitDeclarations(css: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '\\') {
      i++;
    } else if (quote) {
      if (ch === quote) {
        quote = null;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
    } else if (ch === ';' && depth === 0) {
      parts.push(css.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(css.slice(start));
  return parts;
}

/**
 * Parses inline CSS declarations. The property ends at the first `:`, so
 * values such as URLs keep their colons. A trailing `!important` sets
 * `important`. Empty or malformed declarations are skipped.
 */
export function parseStyleDeclarations(css: string, selector?: string): FilterStyle[] {
  const styles: FilterStyle[] = [];
  for (const declaration of splitDeclarations(css)) {
    const colon = declaration.indexOf(':');
    if (colon === -1) {
      continue;
    }
    const property = declaration.slice(0, colon).trim();
    let value = declaration.slice(colon + 1).trim();
    const important = IMPORTANT.test(value);
    if (important) {
      value = value.replace(IMPORTANT, '').trim();
    }
    if (!PROPERTY_NAME.test(property) || !value) {
      continue;
    }
    styles.push(
      selector ? { property, value, important, selector } : { property, value, important },
    );
  }
  return styles;
}

const parsedStyles = new WeakMap<Action, readonly FilterStyle[]>();
const compiledReplacements = new WeakMap<Action, FilterReplacement | null>();

function replacementFor(
  action: Extract<Action, { kind: 'replace' }>,
  context: FilterContext,
): FilterReplacement | null {
  let replacement = compiledReplacements.get(action);
  if (replacement === undefined) {
    replacement = null;
    if (action.find) {
      try {
        replacement = { find: compileReplacePattern(action.find), replaceWith: action.replaceWith };
      } catch (error) {
        context.report?.(`Filter replace pattern does not compile: ${action.find}`, error);
      }
    }
    compiledReplacements.set(action, replacement);
  }
  return replacement;
}

function replaceIn(value: FilterFieldValue, replacement: FilterReplacement): FilterFieldValue {
  if (value === null) {
    return null;
  }
  const { find, replaceWith } = replacement;
  return typeof value === 'string'
    ? value.replace(find, replaceWith)
    : value.map((item) => item.replace(find, replaceWith));
}

/**
 * Fields as later filters see them after replace actions. Sites with `set`
 * receive the rewritten parts; others get an overlay so the rewrite is still
 * visible to later conditions.
 */
class RewritableFields implements FilterFields {
  readonly #base: FilterFields;
  readonly #parts: ReadonlySet<string>;
  readonly #overlay = new Map<string, FilterFieldValue>();
  readonly textParts: readonly string[];

  constructor(base: FilterFields) {
    this.#base = base;
    this.textParts = base.textParts ?? ['text'];
    this.#parts = new Set(this.textParts);
  }

  get(name: string): FilterFieldValue {
    return this.#overlay.has(name)
      ? (this.#overlay.get(name) ?? null)
      : (this.#base.get(name) ?? null);
  }

  set(name: string, value: FilterFieldValue): void {
    if (this.#base.set) {
      this.#base.set(name, value);
    } else {
      this.#overlay.set(name, value);
    }
  }

  apply(replacement: FilterReplacement): void {
    for (const part of this.#parts) {
      const before = this.get(part);
      const after = replaceIn(before, replacement);
      if (after !== before) {
        this.set(part, after);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Running a list
// ---------------------------------------------------------------------------

/**
 * Runs `filters` in order against one item. Filters that are not runnable
 * are skipped; a matching filter with `stopAfter` ends the run.
 */
export function runFilters(filters: readonly Filter[], context: FilterContext): FilterOutcome {
  let hiding: FilterHiding | null = null;
  let kept = false;
  let read: 'read' | 'unread' | undefined;
  let classes: FilterClass[] | undefined;
  let styles: FilterStyle[] | undefined;
  let replacements: FilterReplacement[] | undefined;
  let rewritable: RewritableFields | undefined;
  let ctx = context;

  for (const filter of filters) {
    if (!isRunnable(filter)) {
      continue;
    }
    const result = testFilter(filter, ctx);
    if (!result.matched) {
      continue;
    }
    ctx.onFilterMatch?.(filter);
    for (const action of filter.actions) {
      switch (action.kind) {
        case 'hide':
          hiding ??= hidingFor(action, filter, result.caught, ctx.itemNoun);
          kept = false;
          break;
        case 'keep':
          hiding = null;
          kept = true;
          break;
        case 'add_class': {
          const name = action.className.trim();
          if (name) {
            classes ??= [];
            classes.push(action.selector ? { name, selector: action.selector } : { name });
          }
          break;
        }
        case 'style': {
          let parsed = parsedStyles.get(action);
          if (!parsed) {
            parsed = parseStyleDeclarations(action.css, action.selector);
            parsedStyles.set(action, parsed);
          }
          if (parsed.length > 0) {
            styles ??= [];
            styles.push(...parsed);
          }
          break;
        }
        case 'replace': {
          const replacement = replacementFor(action, ctx);
          if (replacement) {
            replacements ??= [];
            replacements.push(replacement);
            if (!rewritable) {
              rewritable = new RewritableFields(context.fields);
              ctx = { ...context, fields: rewritable };
            }
            rewritable.apply(replacement);
          }
          break;
        }
        case 'set_read':
          read = 'read';
          break;
        case 'set_unread':
          read = 'unread';
          break;
        default:
          break;
      }
    }
    if (filter.stopAfter) {
      break;
    }
  }

  if (!hiding && !kept && !classes && !styles && !replacements && !read) {
    return EMPTY_OUTCOME;
  }
  const outcome: FilterOutcome = {
    hiding,
    kept,
    classes: classes ?? EMPTY_OUTCOME.classes,
    styles: styles ?? EMPTY_OUTCOME.styles,
    replacements: replacements ?? EMPTY_OUTCOME.replacements,
  };
  return read ? { ...outcome, read } : outcome;
}
