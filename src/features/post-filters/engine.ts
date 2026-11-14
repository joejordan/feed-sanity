import type { RuleContext } from './rules';
import type { Action, Filter } from './types';
import { TEXT_FIELDS } from '../../facebook/post-fields';
import { matchFilter } from './rules';
import { isRunnable } from './types';
import { expandVariables, hasVariables } from './variables';

/** The tab for posts no filter moved elsewhere. */
export const FILTERED_FEED = 'Filtered Feed';

/** How a note on a hidden post ends, while the post is hidden and while the user has it shown. */
export const REVEAL = ' -- Click to reveal post';
export const REHIDE = ' -- Click to rehide post';

/** How a hidden post is presented. */
export interface Hiding {
  /** The note's text while the post is hidden, and while the user has it shown. */
  reveal: string;
  rehide: string;
  /** False to hide the post without a trace. */
  showNote: boolean;
  /** Inline style for the note. */
  css?: string | undefined;
}

/** What the filters decided for one post. Nothing in the page has changed yet. */
export interface Outcome {
  /** Null when the post stays visible. */
  hiding: Hiding | null;
  /** Classes to add, to the post or to the elements inside it matching `selector`. */
  classes: { name: string; selector?: string | undefined }[];
  /** Inline styles to set, likewise. */
  styles: { property: string; value: string; selector?: string | undefined }[];
  /** Text to rewrite in the post's author, header and message. */
  replacements: { find: RegExp; replace: string }[];
  /** The tabs the post is in, besides the one that holds every post. */
  tabs: string[];
}

/** The outcome for a post no filter touched. */
export const untouched = (): Outcome => ({
  hiding: null,
  classes: [],
  styles: [],
  replacements: [],
  tabs: [FILTERED_FEED],
});

/** True for a tab name that is the same for every post, with no variables in it. */
export const isFixedTabName = (name: string | undefined): name is string =>
  typeof name === 'string' && name !== '' && !hasVariables(name);

function act(
  action: Action,
  filter: Filter,
  caught: RegExpExecArray | null,
  outcome: Outcome,
  { fields, report }: RuleContext,
): void {
  const selector = action.selector || undefined;
  const fill = (template: string): string => expandVariables(template, caught, fields.get);
  // A tab always has a name.
  const tab = (): string => fill(action.tab ?? '') || '[nameless]';

  switch (action.action) {
    case 'class':
      if (action.content) {
        outcome.classes.push({ name: action.content, selector });
      }
      break;
    case 'css':
      for (const declaration of (action.content ?? '').split(/\s*;\s*/)) {
        // Only the first colon divides. A value such as `url(https://...)` has its own.
        const colon = declaration.indexOf(':');
        const property = declaration.slice(0, colon).trim();
        if (colon !== -1 && property) {
          outcome.styles.push({ property, value: declaration.slice(colon + 1).trim(), selector });
        }
      }
      break;
    case 'replace': {
      if (!action.find) {
        // An empty expression matches between every two characters.
        break;
      }
      const find = new RegExp(action.find, 'gi');
      const replace = action.replace ?? '';
      // Later filters test the rewritten text.
      for (const name of [...TEXT_FIELDS, 'all_content']) {
        const value = fields.get(name);
        if (typeof value === 'string' && value) {
          fields.set(name, value.replace(find, replace));
        }
      }
      outcome.replacements.push({ find, replace });
      break;
    }
    case 'hide':
      // The first filter to hide a post writes its note.
      outcome.hiding ??= {
        reveal: action.custom_note
          ? fill(action.custom_note)
          : `Post hidden by filter "${filter.title ?? ''}"${REVEAL}`,
        rehide: action.custom_nyet
          ? fill(action.custom_nyet)
          : `Post was hidden by filter "${filter.title ?? ''}"${REHIDE}`,
        showNote: action.show_note === true,
        css: action.css || undefined,
      };
      break;
    case 'unhide':
      outcome.hiding = null;
      break;
    case 'move-to-tab':
      outcome.tabs = [tab()];
      break;
    case 'copy-to-tab':
      // The post stays where it was, which is the filtered feed unless a filter moved it.
      outcome.tabs.push(tab());
      break;
    case 'read':
    case 'unread':
      report(`the '${action.action}' action needs "mark as read", which is not ported yet`);
      break;
    default:
      break;
  }
}

/**
 * Tests the filters against a post in order and collects what their actions
 * ask for. A filter that cannot run is skipped, and a matching filter with
 * "stop on match" ends the run.
 */
export function runFilters(filters: readonly Filter[], context: RuleContext): Outcome {
  const outcome = untouched();
  for (const filter of filters) {
    if (!isRunnable(filter)) {
      continue;
    }
    const match = matchFilter(filter, context);
    if (!match) {
      continue;
    }
    for (const action of filter.actions) {
      try {
        act(action, filter, match.caught, outcome, context);
      } catch (error) {
        context.report(`an action of '${filter.title ?? ''}' failed`, error);
      }
    }
    if (filter.stop_on_match) {
      break;
    }
  }
  return outcome;
}
