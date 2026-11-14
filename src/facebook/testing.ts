// Helpers for tests. Nothing in the extension imports this file.

import type { AtomTranslator } from './atoms';
import type { Post } from './posts';

/** A class-name translator that leaves every name as it is. */
export const fakeAtoms: AtomTranslator = {
  translate: (text) => text,
  onChange: () => () => true,
  start: () => Promise.resolve(),
};

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
