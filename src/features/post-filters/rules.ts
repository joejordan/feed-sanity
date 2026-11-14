import type { Locate } from '../../core/locator';
import type { AtomTranslator } from '../../facebook/atoms';
import type { PostFields } from '../../facebook/post-fields';
import type { Filter, Rule } from './types';
import { postTime } from '../../facebook/post-fields';
import { postElements, postText } from '../../facebook/post-text';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** What rules are tested against. */
export interface RuleContext {
  post: Element;
  fields: PostFields;
  /** Translates `S2F_` names in the selectors of `contains_selector` rules. */
  atoms: AtomTranslator;
  locate: Locate;
  /** The current time. Tests set it. */
  now: () => Date;
  /** Says why a rule could not be tested, such as a broken regular expression. */
  report: (message: string, error?: unknown) => void;
}

/**
 * Whether a rule matched, and what its regular expression caught. `caught` is
 * missing for a rule that has no expression, which leaves what an earlier
 * rule caught in place for `$1`.
 */
interface Tested {
  matched: boolean;
  caught?: RegExpExecArray | null;
}

/** Makes a regular expression that finds exactly `literal`. */
export const escapeRegExp = (literal: string): string =>
  literal.replaceAll(/[\\^$*+?.()|[\]{}]/g, String.raw`\$&`);

/**
 * A leading, trailing or doubled `|` would make the expression match
 * everything. An escaped `\|` is a pipe to look for and stays.
 */
const fixPipes = (source: string): string =>
  source
    .replaceAll(/\\.|\|{2,}/gs, (found) => (found.startsWith('\\') ? found : '|'))
    .replace(/^\s*\|/, '')
    .replace(/(?<=(?:^|[^\\])(?:\\\\)*)\|\s*$/, '');

const unquote = (value: string): string => value.replace(/^(["'`])(.*)\1$/, '$2');

/** The text of `element` that is not inside something with `display: none`. */
function visibleText(element: Element): string {
  if (getComputedStyle(element).display === 'none') {
    return '';
  }
  let result = '';
  for (const child of element.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      result += child.nodeValue ?? '';
    } else if (child instanceof Element) {
      result += visibleText(child);
    }
  }
  return result;
}

/**
 * A rule that looks for elements. The selector may end in one of Social
 * Fixer's extras: `:contains(regex)` tests the element's text,
 * `:has-visible-text(regex)` its visible text, and `:hidden-within(selector)`
 * whether something between it and `selector` is hidden.
 */
function testSelector(rule: Rule, { post, atoms, locate }: RuleContext): Tested {
  let contains: string | undefined;
  let visible: string | undefined;
  let hiddenWithin: string | undefined;
  const selector = (rule.condition?.text ?? '')
    .replace(/:contains\((.+?)\)\s*$/, (_all, inner: string) => {
      contains = unquote(inner);
      return '';
    })
    .replace(/:has-visible-text\((.+?)\)\s*$/, (_all, inner: string) => {
      visible = unquote(inner);
      return '';
    })
    .replace(/:hidden-within\((.+?)\)\s*$/, (_all, inner: string) => {
      hiddenWithin = `${unquote(inner)} *`;
      return '';
    });

  // Throws for a selector that is not valid. The rule is then reported and
  // does not match, NOT or no NOT, as for any rule that cannot be tested.
  const elements = postElements(post, atoms.translate(selector), locate);

  const pattern = contains ?? visible;
  if (pattern !== undefined) {
    const regex = new RegExp(pattern);
    for (const element of elements) {
      const caught = regex.exec(
        contains === undefined ? visibleText(element) : postText(element, locate),
      );
      if (caught) {
        return { matched: true, caught };
      }
    }
    return { matched: false, caught: null };
  }
  if (hiddenWithin !== undefined) {
    const within = atoms.translate(hiddenWithin);
    const isHidden = (element: Element): boolean => {
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (parent.matches(within) && getComputedStyle(parent).display === 'none') {
          return true;
        }
      }
      return false;
    };
    return { matched: elements.some(isHidden) };
  }
  return { matched: elements.length > 0 };
}

/** A rule that is true on the chosen days of the week. */
function testDay(rule: Rule, { now }: RuleContext): Tested {
  return { matched: rule.condition?.[`day_${now().getDay()}`] === true };
}

/** A rule on how old the post is. Posts whose time cannot be read never match. */
function testAge(rule: Rule, { post, now, locate }: RuleContext): Tested {
  const time = postTime(post, locate);
  if (!time) {
    return { matched: false };
  }
  const unit = rule.condition?.units === 'h' ? HOUR_MS : DAY_MS;
  const limit = Number(rule.condition?.value) * unit;
  const age = now().getTime() - time.getTime();
  return { matched: rule.operator === 'gt' ? age > limit : rule.operator === 'lt' && age < limit };
}

/**
 * The regular expression a text rule stands for. Null when its operator is
 * unknown, or when it has nothing to look for: an empty expression would
 * match every post.
 */
function compilePattern(rule: Rule, operator: string): RegExp | null {
  const typed = rule.condition?.text ?? '';
  // `matches` is always a regular expression. The editor offers no other reading for it.
  const literal = rule.matcher === 'str' && operator !== 'matches';
  const source = literal ? `(${escapeRegExp(typed)})` : fixPipes(typed);
  if (typed === '' || source === '') {
    return null;
  }
  // Ignoring case is the default.
  const flags = rule.condition?.modifier === 'I' ? '' : 'i';
  switch (operator) {
    case 'equals':
      return new RegExp(`^(?:${source})$`, flags);
    case 'contains':
      return rule.match_partial_words
        ? new RegExp(source, flags)
        : new RegExp(String.raw`(?:^|\b|\W)(?:${source})(?:\W|\b|$)`, flags);
    case 'startswith':
      return new RegExp(`^(?:${source})`, flags);
    case 'endswith':
      return new RegExp(`(?:${source})$`, flags);
    case 'matches':
      // The user writes the flags, and none is the default.
      return new RegExp(source, (rule.condition?.modifier ?? '').replace('I', ''));
    default:
      return null;
  }
}

/**
 * The compiled expression of each rule. Posts are filtered many times over
 * with the same rules, and a rule object is replaced when the user edits it.
 */
const patterns = new WeakMap<Rule, RegExp | null>();

function textPattern(rule: Rule, operator: string): RegExp | null {
  let pattern = patterns.get(rule);
  if (pattern === undefined) {
    pattern = compilePattern(rule, operator);
    patterns.set(rule, pattern);
  }
  return pattern;
}

/** A rule on the text of one part of the post. */
function testText(rule: Rule, operator: string, not: boolean, { fields }: RuleContext): Tested {
  const target =
    rule.target === 'any' || rule.target === 'any+image'
      ? [fields.get('all_content'), rule.target === 'any+image' ? fields.get('image') : null]
          .flat()
          .filter((part) => part !== null)
          .join(' ')
      : fields.get(rule.target ?? '');
  const pattern = target === null ? null : textPattern(rule, operator);
  if (target === null || pattern === null) {
    // The post has no such part, or the rule has no usable pattern. Not even a NOT rule matches.
    return { matched: false };
  }
  let caught: RegExpExecArray | null = null;
  for (const item of Array.isArray(target) ? target : [target]) {
    // A user's `g` or `y` flag would make the shared expression remember where it stopped.
    pattern.lastIndex = 0;
    caught = pattern.exec(item);
    if (caught) {
      break;
    }
  }
  return { matched: not ? caught === null : caught !== null, caught };
}

function testRule(rule: Rule, context: RuleContext): Tested {
  const not = /^not_/.test(rule.operator ?? '') || rule.not === true;
  const operator = (rule.operator ?? '').replace('not_', '');
  if (operator === 'contains_selector') {
    const tested = testSelector(rule, context);
    return { ...tested, matched: tested.matched !== not };
  }
  if (rule.target === 'day') {
    return testDay(rule, context);
  }
  if (rule.target === 'age') {
    return testAge(rule, context);
  }
  return testText(rule, operator, not, context);
}

/**
 * Tests a filter's rules against a post. Returns null when the filter does
 * not match. Otherwise returns what the last tested rule's regular
 * expression caught, for `$1` in notes and tab names, which may be nothing.
 */
export function matchFilter(
  filter: Filter,
  context: RuleContext,
): { caught: RegExpExecArray | null } | null {
  let matched = false;
  let lastCaught: RegExpExecArray | null = null;

  for (const rule of filter.rules ?? []) {
    if (!rule?.condition) {
      continue;
    }
    let tested: Tested = { matched: false };
    try {
      tested = testRule(rule, context);
    } catch (error) {
      context.report(`a rule of '${filter.title ?? ''}' could not be tested`, error);
    }
    if (tested.caught !== undefined) {
      lastCaught = tested.caught;
    }
    // One match settles an ANY filter, and one miss an ALL filter.
    if (tested.matched) {
      matched = true;
      if (filter.match === 'ANY') {
        break;
      }
    } else if (filter.match === 'ALL') {
      return null;
    }
  }
  return matched ? { caught: lastCaught } : null;
}
