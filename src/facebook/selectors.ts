/**
 * Every locator that depends on Facebook's markup, and the marks this
 * project leaves on Facebook's elements. When Facebook changes its pages,
 * this is the file to fix.
 *
 * Each locator lists its strategies with the date each one was last seen
 * working on the live site. Look elements up with `page.locate`, which also
 * counts what each strategy finds and applies the user's replacement
 * selectors.
 *
 * TODO(clean): the fb-dom unit adds the post-related locators and `MARK` here.
 */

import { anyOf, firstOf } from '../core/locator';
import { HIDDEN_ATTR, OWN_ATTR } from '../core/surface';

/** The first live check of post markup. */
const CHECKED = '2026-11-13';

/** Attribute on every element this project adds inside one of Facebook's. */
export const OWN = OWN_ATTR;

/** Selects the elements this project added. Their text is not the post's, and they do not count as new content. */
export const OWN_ELEMENT = `[${OWN}]`;

/**
 * Attribute on one of Facebook's elements that this project's UI stands in
 * for, such as the reel viewer's position bar under the video scrubber. A
 * style sheet of the feature's hides it meanwhile.
 */
export const STOOD_IN_FOR = HIDDEN_ATTR;

/** Attribute on `<html>` while post filters are actively filtering the current feed. */
export const FEED_FILTERING = 'data-feed-sanity-filtering';

/** Attribute on a post once post filters have finished their initial check on it. */
export const POST_CHECKED = 'data-feed-sanity-checked';

/** Attribute on the alternate-feed layout shell while Feed Sanity replaces its rails responsively. */
export const HOME_LAYOUT = 'data-feed-sanity-home-layout';

/** Attribute on the top-bar Home link while an alternate Home feed is active. */
export const HOME_ACTIVE = 'data-feed-sanity-home-active';

/** Attribute holding a post's position in the news feed. An element that has it is a post once it has content. */
export const FEED_POSITION = 'aria-posinset';

/** The header line of a post: who did what. */
export const POST_HEADER = anyOf('post-header', [
  { selector: '[data-ad-rendering-role=profile_name]', seen: CHECKED },
]);

/** The "..." actions menu button in a post's header row. */
export const POST_MENU_BUTTON = firstOf('post-menu-button', [
  { selector: '[role=button][aria-haspopup=menu]', seen: '2026-11-22' },
]);

/**
 * The "All stories" list down the left of the stories viewer, at
 * /stories/. Its entries are `div[role=button][id]`. Only look for it on
 * that page.
 */
export const STORIES_LIST = anyOf('stories-list', [
  {
    selector: 'div[role=navigation]:not([aria-label])',
    seen: '2026-11-14',
    note: 'The two navigation elements in the top bar have a label',
  },
]);

// Suggested posts and the top bar, looked at on the news feed on 2026-11-14.

const FEEDS_CHECKED = '2026-11-14';

/**
 * The Follow or Join button Facebook puts in the name heading of a post it
 * suggests from a page, person or group the person does not follow. Looked
 * for inside the post's own header, the first `POST_HEADER` in it, since a
 * shared post has a header of its own further down. Its text is
 * translated, so it is told apart by its structure. The verified badge
 * beside a page's name is a `div[role=button]` there too, with an
 * `aria-label` and an svg inside, and the Follow or Join button has
 * neither.
 */
export const SUGGESTION_BUTTON = anyOf('suggestion-button', [
  {
    selector: 'h4 div[role=button]:not([aria-label]):not(:has(svg))',
    seen: FEEDS_CHECKED,
    note: 'div[role=button] < span < span < span < h4. None in the h4 of posts from friends, followed pages or ads. The Feeds pages use h3, with no suggestions',
  },
]);

/** The Home link in the top bar. Its label is translated, so it is found by its address. */
export const TOP_BAR_HOME = anyOf('top-bar-home', [
  {
    selector:
      '[role=navigation] li > span > div > a[role=link][href="/"],[role=navigation] li > span > div > a[role=link][href="https://www.facebook.com/"]',
    seen: FEEDS_CHECKED,
    note: 'The first of five 130 x 56 cells. The div around the link is positioned',
  },
]);

/**
 * The row of circular buttons at the right of Facebook's top bar (Menu,
 * Messenger, Notifications and Account). Its label is translated, so it is
 * told apart from the middle tab bar by having buttons and no list.
 */
export const TOP_BAR_ACTIONS = anyOf('top-bar-actions', [
  {
    selector: '[role=banner] [role=navigation]:not(:has(ul)):has([role=button])',
    seen: '2026-11-22',
    note: 'Four 40 x 40 buttons with 8 px gaps inside a fixed container on the right, visible at every width including <= 700 px',
  },
]);

/** The signed-in user's profile picture inside the right-side top bar Account button. */
export const TOP_BAR_AVATAR = anyOf('top-bar-avatar', [
  {
    selector: '[role=banner] [role=navigation]:not(:has(ul)) [role=button] image',
    seen: '2026-11-22',
    note: 'SVG <image> inside the circular Account button at the right end of the top bar',
  },
  {
    selector: '[role=banner] [role=navigation]:not(:has(ul)) [role=button] img',
    seen: '2026-11-22',
  },
]);

/** The feed container inside `[role=main]`. On Feeds pages it sits at the top of the 680 px feed column. */
export const FEED_CONTAINER = anyOf('feed-container', [
  {
    selector: '[role=main] [role=feed]',
    seen: '2026-11-22',
    note: '680 px wide feed column on Home and on all five Feeds pages',
  },
]);

/** Facebook's own inline post composer card on the Home feed, checked so we never draw a duplicate. */
export const FEED_COMPOSER = anyOf('feed-composer', [
  {
    selector: '[role=main] [role=region][aria-label="Create a post"]',
    seen: '2026-11-22',
    note: 'Present on Home (/?sk=h_nor and /), absent on Feeds pages (/?filter=...&sk=h_chr)',
  },
]);

/** The top banner bar (`[role=banner]`) holding Facebook's global navigation. */
export const TOP_BAR_BANNER = firstOf('top-bar-banner', [
  { selector: '[role=banner]', seen: '2026-11-22' },
]);

/** The main content column of a Facebook page. */
export const FEED_MAIN = firstOf('feed-main', [{ selector: '[role=main]', seen: '2026-11-22' }]);

/** Facebook's fixed Feeds left-rail `[role=navigation]` sidebar on alternate feeds. */
export const FEEDS_LEFT_RAIL = anyOf('feeds-left-rail', [
  { selector: '[role=navigation]', seen: '2026-11-22' },
]);

/** The Home right rail pagelet (Birthdays, Sponsored ads, and other sidebar units). */
export const RIGHT_RAIL = anyOf('right-rail', [
  { selector: '[data-pagelet=RightRail]', seen: '2026-11-22' },
]);

const SHELVES_CHECKED = '2026-11-27';
const NON_INTERACTIVE_SHELF =
  ':not(a, button, svg, img, i, span, [role=link], [role=button], [role=tab], [role=img], [role=menuitem])';

/** The Stories tray shown in Facebook feeds (never the `/stories/` viewer). */
export const STORIES_BAR = anyOf(
  'stories-bar',
  [
    {
      selector: '[data-pagelet=Stories]',
      seen: SHELVES_CHECKED,
      note: 'Primary Stories tray pagelet above the feed',
    },
    {
      selector: `[aria-label="Stories" i]${NON_INTERACTIVE_SHELF}`,
      seen: SHELVES_CHECKED,
      note: 'Stories tray container fallback when data-pagelet is absent',
    },
    {
      selector: '[role=region][aria-label^="Stories" i]',
      seen: SHELVES_CHECKED,
      note: 'Labeled Stories carousel region inside main feed',
    },
  ],
  { optional: true },
);

/** Dedicated Reels shelf/carousel containers inside Facebook feeds (never `/reel/` or `/reels/`). */
export const REELS_BAR = anyOf(
  'reels-bar',
  [
    {
      selector: '[data-pagelet*="Reels" i]',
      seen: SHELVES_CHECKED,
      note: 'Dedicated Reels tray pagelet inside feeds',
    },
    {
      selector: `[aria-label="Reels" i]${NON_INTERACTIVE_SHELF}`,
      seen: SHELVES_CHECKED,
      note: 'Labeled Reels carousel container inside feeds',
    },
    {
      selector: `[aria-label="Reels and short videos" i]${NON_INTERACTIVE_SHELF}`,
      seen: SHELVES_CHECKED,
      note: 'Labeled Reels and short videos carousel container inside feeds',
    },
    {
      selector: '[role=region][aria-label^="Reels" i]',
      seen: SHELVES_CHECKED,
      note: 'Reels carousel region inside main feed',
    },
  ],
  { optional: true },
);

/** Reel links used to detect unlabeled inline Reels carousel units inside `[role=main]`. */
export const REELS_LINK = anyOf(
  'reels-link',
  [
    {
      selector: 'a[href*="/reel/"], a[href*="/reels/"]',
      seen: SHELVES_CHECKED,
      note: 'Links inside inline Reels carousels across Home, Feeds, Groups, and Profile feeds',
    },
  ],
  { optional: true },
);

/** Floating tooltips Facebook renders on hover (e.g. "Home" under the top-bar tab). */
export const TOOLTIP = anyOf('tooltip', [{ selector: '[role=tooltip]', seen: '2026-11-22' }]);

// Videos. Facebook draws each one as a plain <video> element in the page,
// with no iframe and no shadow root, so the element itself is the anchor.

/** The look at videos described in `docs/facebook-notes.md`. */
const VIDEOS_CHECKED = '2026-11-14';

export const VIDEO = anyOf('video', [{ selector: 'video', seen: VIDEOS_CHECKED }], {
  optional: true,
});

/** The wrapper a few levels above a video. Looked for from the video up. */
export const VIDEO_CONTAINER = anyOf('video-container', [
  { selector: '[data-video-id]', seen: VIDEOS_CHECKED, note: 'Sometimes with data-video-length' },
]);

/** One reel in the reel viewer. Looked for from the video up. */
export const REEL_CARD = anyOf('reel-card', [
  {
    selector: '[data-video-id][data-index]',
    seen: VIDEOS_CHECKED,
    note: 'The viewer moves between cards with its Next Card and Previous Card buttons',
  },
]);

/** The post a video is in, looked for from the video up. */
// TODO(clean): the fb-dom unit gives this its own strategies.
export const VIDEO_POST = anyOf('video-post', []);

/**
 * Facebook's own position and volume sliders. It draws them only on the
 * video that is playing.
 */
export const VIDEO_SLIDER = anyOf('video-slider', [
  { selector: '[role=slider]', seen: VIDEOS_CHECKED },
]);

/**
 * What a click over a video can be meant for other than the video itself:
 * the player's buttons and sliders, links and form controls. Their labels
 * are translated, so they are told apart by role.
 */
export const VIDEO_CONTROL = anyOf('video-control', [
  { selector: '[role=button],[role=slider]', seen: VIDEOS_CHECKED, note: "The player's controls" },
  {
    selector: 'a[href],[role=link],button,input,select,textarea,[contenteditable=true]',
    seen: VIDEOS_CHECKED,
    note: 'A feed video was not inside a link',
  },
]);

// The stories viewer, at /stories/. See "The stories viewer" in docs/facebook-notes.md.

/**
 * One story in the stories viewer, video or photo: the nearest element
 * with `data-id` above the story's picture. Looked for from the picture up,
 * on a stories page only. Facebook's layers over the picture and the
 * story's header links are inside it; the header's buttons on the right
 * are not.
 */
export const STORY_CARD = anyOf('story-card', [
  {
    selector: '[data-id]:has(> [data-pagelet])',
    seen: VIDEOS_CHECKED,
    note: 'Seven levels above the video; its first child, the layer with the picture, has data-pagelet',
  },
]);

/**
 * The empty children of a story card. One of them is an invisible strip
 * over the bottom 12 pixels that takes the pointer there, above what this
 * project puts in the card. `storyBottomStrip` in `src/facebook/stories.ts`
 * tells it from the others by where it lies.
 */
export const STORY_STRIP = anyOf('story-strip', [
  {
    selector: '[data-id] > div:empty',
    seen: VIDEOS_CHECKED,
    note: 'A 12 pixel strip along the bottom edge, with z-index 1',
  },
]);

/** Attribute on a story card holding the story's ID. A press that ends on another story counts for nothing. */
export const STORY_ID = 'data-id';

/**
 * The menu button at the right end of a story's header, outside the card.
 * The story's pause and play button is the one just to its left.
 */
export const STORY_MENU = anyOf('story-menu', [
  { selector: '[role=button][aria-haspopup=menu]', seen: VIDEOS_CHECKED },
]);
