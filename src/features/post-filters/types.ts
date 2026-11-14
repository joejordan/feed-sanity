import type { Saved, SavedData } from '../../core/saved';
import { isRecord } from '../../core/storage';

// The shape of a saved filter. It is Social Fixer's, so filters written for
// it can be pasted in unchanged, and every part may be missing.

export interface RuleCondition {
  /** The words, regular expression or CSS selector to look for. */
  text?: string;
  /** `I` to match case and `i` to ignore it. For a `matches` rule, the regular expression's flags. */
  modifier?: string;
  /** For an `age` rule: how many hours or days. */
  value?: number | string;
  units?: string;
  /** For a `day` rule: `day_0` is Sunday. */
  [day: `day_${number}`]: boolean | undefined;
}

export interface Rule {
  /** The part of the post to test, or `day` or `age`. */
  target?: string;
  /** `contains`, `equals`, `startswith`, `endswith`, `matches` or `contains_selector`. A `not_` prefix inverts it. */
  operator?: string;
  not?: boolean;
  /** `str` to take the text literally. Anything else reads it as a regular expression. */
  matcher?: string;
  /** For `contains`: also match inside longer words. */
  match_partial_words?: boolean;
  condition?: RuleCondition;
}

export interface Action {
  /** `hide`, `unhide`, `css`, `class`, `replace`, `move-to-tab`, `copy-to-tab`, `read` or `unread`. */
  action?: string;
  /** For `hide`: leave a note in the post's place. */
  show_note?: boolean;
  /** For `hide`: the note's text while the post is hidden, and while it is shown. */
  custom_note?: string;
  custom_nyet?: string;
  /** For `hide`: inline style for the note. */
  css?: string;
  /** For `css`: the declarations. For `class`: the class name. */
  content?: string;
  /** For `css` and `class`: the elements inside the post to change. Empty means the post itself. */
  selector?: string;
  /** For `replace`: a regular expression, and what to put in its place. */
  find?: string;
  replace?: string;
  /** For the tab actions: the tab's name. It may hold `$1` and `${field}` variables. */
  tab?: string;
}

export interface Filter {
  title?: string;
  description?: string;
  enabled?: boolean;
  /** When this filter matches, the filters after it are not tried. */
  stop_on_match?: boolean;
  /** `ALL` when every rule must match and `ANY` when one is enough. */
  match?: string;
  rules?: Rule[];
  actions?: Action[];
}

/** A filter that can run: it is switched on and has rules and actions. */
export const isRunnable = (
  filter: Filter,
): filter is Filter & { rules: Rule[]; actions: Action[] } =>
  filter.enabled !== false && !!filter.rules?.length && !!filter.actions;

/** True for the two actions that put a post in a tab. */
export const isTabAction = (action: Action | null | undefined): boolean =>
  action?.action === 'move-to-tab' || action?.action === 'copy-to-tab';

/** The objects in a saved list: an array, or an object with numbered keys, either with holes. */
function records(stored: unknown): Record<string, unknown>[] {
  if (Array.isArray(stored)) {
    return stored.filter(isRecord);
  }
  return isRecord(stored) ? Object.values(stored).filter(isRecord) : [];
}

/**
 * The saved filter list. Social Fixer saved it as an array, or as an object
 * with numbered keys, and either could have holes. The rules and actions of
 * each filter are read the same way, so the engine and the editor can count
 * on lists of objects whatever was stored or pasted in.
 */
export function readFilters(stored: unknown): Filter[] {
  return records(stored).map((filter) => ({
    ...filter,
    ...('rules' in filter ? { rules: records(filter.rules) } : {}),
    ...('actions' in filter ? { actions: records(filter.actions) } : {}),
  }));
}

/** The user's filters, saved under Social Fixer's name for them. */
export const savedFilters = (data: SavedData): Saved<Filter[]> =>
  data.value('filters', readFilters);

/** A new filter as the editor starts it. */
export function newFilter(): Filter {
  return {
    match: 'ALL',
    enabled: true,
    stop_on_match: true,
    rules: [newRule()],
    actions: [newAction()],
  };
}

export const newAction = (): Action => ({ action: 'hide' });

export function newRule(): Rule {
  return { target: 'any', operator: 'contains', matcher: 're', condition: { modifier: 'i' } };
}
