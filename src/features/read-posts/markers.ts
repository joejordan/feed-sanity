/**
 * The marks read posts leave on Facebook's page. Kept apart from the feature,
 * which imports its CSS through Vite, so the end-to-end tests can import them.
 */

/**
 * On a read post: `hidden` while it is hidden, `shown` while it is revealed,
 * and `kept` where this kind of page does not hide read posts.
 */
export const READ_ATTR = 'data-feed-sanity-read';
/** On `<html>` while read posts are being hidden, that is, while "Show read" is off. */
export const HIDE_READ_ATTR = 'data-feed-sanity-hide-read';
/** Class of the bar left at the top of a hidden or revealed read post. */
export const READ_NOTE_CLASS = 'feed-sanity-read-note';
