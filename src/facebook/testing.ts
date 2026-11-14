// Helpers for tests. Nothing in the extension imports this file.

import type { AtomTranslator } from './atoms';
import type { Post } from './posts';
import { Locators } from '../core/locator';

/**
 * A class-name translator that leaves every name as it is, so a test's
 * markup can use `S2F_` names as its classes.
 */
export const fakeAtoms: AtomTranslator = {
  translate: (text) => text,
  resolve: (selector) => selector,
  onChange: () => () => true,
  start: () => Promise.resolve(),
};

/** Locators that read `S2F_` names as they are, through `fakeAtoms`. */
export const fakeLocate = new Locators(fakeAtoms).locate;

let nextNumber = 1;

/** Adds a post with this content to the page, as `Posts` would announce it. */
export function makePost(html: string, changes: Partial<Post> = {}): Post {
  const element = document.createElement('div');
  const number = nextNumber++;
  element.setAttribute('sfx_post', String(number));
  element.innerHTML = html;
  document.body.append(element);
  return { element, content: element, number, id: null, permalink: false, ...changes };
}
