/**
 * The marks post filters leave on Facebook's posts, for other features that
 * need to know what a filter did.
 */

import type { Post } from '../../facebook/posts';
import { MARK } from '../../facebook/selectors';

/**
 * Attribute on a post a filter hides: `hidden` while it is hidden, `shown`
 * while its note has revealed it.
 */
export const FILTERED_ATTR = 'data-feed-sanity-filtered';

/** The value of `FILTERED_ATTR` while the post is hidden. */
export const FILTERED_HIDDEN = 'hidden';

/** The value of `FILTERED_ATTR` while the post's note has revealed it. */
export const FILTERED_SHOWN = 'shown';

/** Class of the note left where a filter hid a post. */
export const FILTER_NOTE_CLASS = 'feed-sanity-filter-note';

/** True when the page is about this post, or it is the post in the comments popup. */
export function isPagePost(post: Post): boolean {
  return post.permalink || post.element.hasAttribute(MARK.popupPost);
}

/** True while a filter hides `element`, whether or not its note has revealed it. */
export function isFilterHidden(element: Element): boolean {
  return element.hasAttribute(FILTERED_ATTR);
}
