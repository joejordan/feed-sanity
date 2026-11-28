// The conditions Facebook answers itself, through the engine's
// `testCondition` hook. Everything else goes to the core engine.

import type { ConditionResult, FilterContext } from '../../core/filter-engine';
import type { Condition } from '../../core/filter-types';
import type { Locate } from '../../core/locator';
import { postTime } from '../../facebook/post-fields';
import { postElements } from '../../facebook/post-text';

const HOUR_MS = 60 * 60 * 1000;
const UNIT_MS = { hours: HOUR_MS, days: 24 * HOUR_MS } as const;

const MATCH: ConditionResult = Object.freeze({ matched: true });
const NO_MATCH: ConditionResult = Object.freeze({ matched: false });

const parses = new Map<string, boolean>();

/** True when `selector` is a selector the browser understands. */
function isValidSelector(selector: string): boolean {
  let valid = parses.get(selector);
  if (valid === undefined) {
    try {
      document.createDocumentFragment().querySelector(selector);
      valid = true;
    } catch {
      valid = false;
    }
    parses.set(selector, valid);
  }
  return valid;
}

/**
 * The hook for the post whose content is `content`:
 *
 * - an `element` condition looks for its selector inside the post only, so
 *   comments, the comment form and this project's elements do not count. A
 *   selector that does not parse never matches, negated or not.
 * - an `age` condition compares the post's time with the clock. A post with
 *   no readable time never matches.
 */
export function postConditions(
  content: Element,
  locate: Locate,
): NonNullable<FilterContext['testCondition']> {
  return (condition: Condition, context: FilterContext): ConditionResult | undefined => {
    switch (condition.kind) {
      case 'element': {
        const selector = condition.selector.trim();
        if (!selector || !isValidSelector(selector)) {
          return NO_MATCH;
        }
        const found = postElements(content, selector, locate).length > 0;
        return found === (condition.negate === true) ? NO_MATCH : MATCH;
      }
      case 'age': {
        const time = postTime(content, locate);
        if (!time) {
          return NO_MATCH;
        }
        const age = (context.now?.() ?? new Date()).getTime() - time.getTime();
        const limit = condition.amount * UNIT_MS[condition.unit];
        return (condition.olderThan ? age > limit : age < limit) ? MATCH : NO_MATCH;
      }
      default:
        return undefined;
    }
  };
}
