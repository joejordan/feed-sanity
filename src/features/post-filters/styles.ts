import { FEED_FILTERING, FEED_POSITION, POST_CHECKED } from '../../facebook/selectors';
import { FILTER_NOTE_CLASS, FILTERED_ATTR, FILTERED_HIDDEN, FILTERED_SHOWN } from './markers';
import { NOTE_LABEL_CLASS, NOTE_TOGGLE_CLASS } from './notes';

/** Id of post filters' style sheet. */
export const STYLE_ID = 'feed_sanity_post_filters';

/** How long a feed slot may stay invisible while it waits to be checked. */
const NO_FLASH_FAILSAFE_MS = 300;

const HIDDEN = `[${FILTERED_ATTR}="${FILTERED_HIDDEN}"]`;
const SHOWN = `[${FILTERED_ATTR}="${FILTERED_SHOWN}"]`;
const NOTE = `.${FILTER_NOTE_CLASS}`;

/** Post filters' style sheet. */
export const POST_FILTERS_CSS = `
/* A hidden post shows only its note, with nothing of its own box around it. */
${HIDDEN} {
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  outline: 0 !important;
  background: none !important;
  box-shadow: none !important;
  min-height: 0 !important;
}
${HIDDEN} > :not(${NOTE}) {
  display: none !important;
}
${NOTE} {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  box-sizing: border-box;
  margin: 4px 0;
  padding: 8px 12px;
  border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, currentColor 5%, transparent);
  color: var(--secondary-text, inherit);
  font: inherit;
  font-size: 13px;
  line-height: 1.3;
  text-align: start;
  cursor: pointer;
  opacity: 0.85;
}
${NOTE}:hover,
${NOTE}:focus-visible {
  opacity: 1;
  background: color-mix(in srgb, currentColor 9%, transparent);
}
${SHOWN} > ${NOTE} {
  margin-bottom: 8px;
}
.${NOTE_LABEL_CLASS} {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.${NOTE_TOGGLE_CLASS} {
  flex-shrink: 0;
  padding: 2px 8px;
  border: 1px solid color-mix(in srgb, currentColor 24%, transparent);
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 600;
}
/*
 * No flash: a feed slot stays invisible until it has been checked. The
 * animation is the fail-safe that shows it after a moment anyway.
 */
html[${FEED_FILTERING}] [${FEED_POSITION}]:not([${POST_CHECKED}]):not([${FILTERED_ATTR}]) {
  animation: feed-sanity-unchecked ${NO_FLASH_FAILSAFE_MS}ms step-end both;
}
@keyframes feed-sanity-unchecked {
  from { visibility: hidden; }
  to { visibility: visible; }
}
`;
