// The parts of a filter outcome besides hiding: classes, inline styles and
// text replacements on one post.

import type { FilterOutcome } from '../../core/filter-engine';
import type { Locate } from '../../core/locator';
import type { Scope } from '../../core/scope';
import type { PostFields } from '../../facebook/post-fields';
import type { Post } from '../../facebook/posts';
import { postElements, textSkip, walkText } from '../../facebook/post-text';

/** `post.element`, or the matches of `selector` in the post's own content. A bad selector finds nothing. */
function targetsOf(
  post: Post,
  selector: string | undefined,
  locate: Locate,
  cache: Map<string, Element[]>,
): readonly Element[] {
  if (!selector) {
    return [post.element];
  }
  let targets = cache.get(selector);
  if (!targets) {
    targets = postElements(post.content, selector, locate);
    cache.set(selector, targets);
  }
  return targets;
}

/**
 * Adds the outcome's classes and inline styles to the post until `scope` is
 * disposed. A class already there is left alone and not removed later. A
 * style is put back exactly as it was, value and priority.
 */
export function applyStyling(
  scope: Scope,
  post: Post,
  outcome: Pick<FilterOutcome, 'classes' | 'styles'>,
  locate: Locate,
): void {
  if (outcome.classes.length === 0 && outcome.styles.length === 0) {
    return;
  }
  const cache = new Map<string, Element[]>();
  for (const { name, selector } of outcome.classes) {
    const tokens = name.split(/\s+/).filter((token) => token !== '');
    for (const target of targetsOf(post, selector, locate, cache)) {
      const added = tokens.filter((token) => !target.classList.contains(token));
      if (added.length > 0) {
        target.classList.add(...added);
        scope.add(() => target.classList.remove(...added));
      }
    }
  }
  for (const { property, value, important, selector } of outcome.styles) {
    for (const target of targetsOf(post, selector, locate, cache)) {
      if (!(target instanceof HTMLElement || target instanceof SVGElement)) {
        continue;
      }
      const { style } = target;
      const before = style.getPropertyValue(property);
      const beforePriority = style.getPropertyPriority(property);
      style.setProperty(property, value, important ? 'important' : '');
      scope.add(() => {
        if (before) {
          style.setProperty(property, before, beforePriority);
        } else {
          style.removeProperty(property);
        }
      });
    }
  }
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
