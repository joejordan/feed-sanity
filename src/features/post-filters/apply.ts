// The parts of a filter outcome besides hiding: classes, inline styles and
// text replacements on one post.

import type { FilterOutcome } from '../../core/filter-engine';
import type { Locate } from '../../core/locator';
import type { Scope } from '../../core/scope';
import type { PostFields } from '../../facebook/post-fields';
import type { Post } from '../../facebook/posts';
import { postElements, textSkip, walkText } from '../../facebook/post-text';
import { applyClassesAndStyles } from '../shared/apply-filter-outcome';

/**
 * Adds the outcome's classes and inline styles to `post.element`, or to the
 * matches of their selector in the post's own content, until `scope` is
 * disposed. A selector that does not parse finds nothing.
 */
export function applyStyling(
  scope: Scope,
  post: Post,
  outcome: Pick<FilterOutcome, 'classes' | 'styles'>,
  locate: Locate,
): void {
  applyClassesAndStyles(scope, outcome, (selector) =>
    selector ? postElements(post.content, selector, locate) : [post.element],
  );
}

/** What each text node held right after this project last rewrote it. */
const rewritten = new WeakMap<Text, string>();

/**
 * Rewrites the text of the post's text parts with `replacements`. It is not
 * undone: the text stays until Facebook draws the post again. A text node
 * that still holds what was written into it is not rewritten again, so
 * filtering a post twice does not apply a replacement twice.
 */
export function replaceText(
  fields: Pick<PostFields, 'elements' | 'textParts'>,
  replacements: FilterOutcome['replacements'],
  locate: Locate,
): void {
  if (replacements.length === 0) {
    return;
  }
  const skip = textSkip(locate);
  const seen = new Set<Text>();
  for (const part of fields.textParts) {
    for (const root of fields.elements(part)) {
      walkText(root, skip, (text) => {
        if (seen.has(text) || rewritten.get(text) === text.data) {
          return false;
        }
        seen.add(text);
        let after = text.data;
        for (const { find, replaceWith } of replacements) {
          after = after.replace(find, replaceWith);
        }
        if (after !== text.data) {
          text.data = after;
          rewritten.set(text, after);
        }
        return false;
      });
    }
  }
}
