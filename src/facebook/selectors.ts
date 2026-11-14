/**
 * Every locator that depends on Facebook's markup, and the marks this
 * project leaves on Facebook's elements. When Facebook changes its pages,
 * this is the file to fix.
 *
 * Each locator lists its strategies with the date each one was last seen
 * working on the live site. `SFX` stands for Social Fixer 31.1.0 (2023),
 * where most of them come from. `docs/porting.md` lists what has been
 * checked on the live site since.
 *
 * `S2F_` names stand for Facebook's generated classes. A strategy that uses
 * one is skipped until `Atoms` knows the class. Look elements up with
 * `page.locate`, which also counts what each strategy finds and applies the
 * user's replacement selectors.
 */

import { anyOf, firstOf } from '../core/locator';

/** Social Fixer 31.1.0. The selectors it shipped worked on Facebook in 2023. */
const SFX = '2023';

/** The live check described in `docs/porting.md`. */
const CHECKED = '2026-11-13';

/**
 * Marks left on Facebook's elements. They keep Social Fixer's names, so CSS
 * and filters written for Social Fixer still match.
 */
export const MARK = {
  /** Attribute on a post's top element, holding the post's number on this page. */
  post: 'sfx_post',
  /** Attribute holding Facebook's ID for the post, or `noPostId`. */
  postId: 'sfx_id',
  /** Value of the `postId` attribute when no ID could be found. */
  noPostId: 'no-ID',
  /** Prefix of the element ID given to a post that has none. */
  postElementId: 'sfx_post_',
  /** Class on a post that has left the page. */
  removing: 'sfx_removing',
  /** Class on the container of a post shown in the comments popup. */
  popupPost: 'sfx_popup_post',
  /** Class on a post while its time link is being hovered to reveal the address. */
  touch: 'sfx_touch',
  /** Class on a post a filter has hidden. */
  hidden: 'sfx_filter_hidden',
  /** Class on a hidden post the user has chosen to look at. */
  hiddenShown: 'sfx_filter_hidden_show',
  /** Class on the note that stands in for a hidden post. */
  hiddenNote: 'sfx_filter_hidden_note',
  /** Class on the note's text while the post is hidden. */
  hiddenNoteReveal: 'sfx_filter_hider_note',
  /** Class on the note's text while the post is shown. */
  hiddenNoteRehide: 'sfx_filter_hider_nyet',
  /** Prefix of the class that puts a post in a filter tab. The tab's number follows. */
  tab: 'sfx_filter_tab_',
} as const;

/** Attribute on every element this project adds inside one of Facebook's. */
export const OWN = 'data-feed-sanity';

/** Selects the elements this project added. Their text is not the post's, and they do not count as new content. */
export const OWN_ELEMENT = `[${OWN}]`;

/**
 * Attribute on one of Facebook's elements that this project's UI stands in
 * for, such as the reel viewer's position bar under the video scrubber. A
 * style sheet of the feature's hides it meanwhile.
 */
export const STOOD_IN_FOR = 'data-feed-sanity-hidden';

/** Attribute holding a post's position in the news feed. An element that has it is a post once it has content. */
export const FEED_POSITION = 'aria-posinset';

/** The comments column beside a photo or video shown in theater mode. */
export const THEATER_COMMENTS = anyOf('theater-comments', [
  {
    selector: '.S2F_fldr_col [role=main] ~ [role=complementary].S2F_bg_surf > .S2F_just_spbt',
    seen: SFX,
  },
]);

/** Elements that may be the top of a post. `POST_VERIFIER` confirms them. */
export const POST = anyOf('post', [
  { selector: '[role=article]:not(.S2F_pos_rel)', seen: SFX },
  {
    selector: `[${FEED_POSITION}]`,
    seen: CHECKED,
    note: 'News feed posts with a position in the feed',
  },
  {
    selector:
      'div[aria-describedby].S2F_outl_none:not(.S2F_disp_infl):not(.S2F_zi_0):not(.S2F_pos_rel)',
    seen: SFX,
    note: 'News feed posts without a position',
  },
  {
    selector: 'div.S2F_disp_flex.S2F_fldr_row.S2F_pos_rel.S2F_hei_100.S2F_alini_cent.S2F_just_cent',
    seen: SFX,
    note: 'A reel on its own page',
  },
  ...THEATER_COMMENTS.strategies,
]);

/** Something every real post contains. */
export const POST_VERIFIER = anyOf('post-verifier', [{ selector: 'a[aria-label]', seen: SFX }]);

/** Marketplace listings, which stand in for posts on Marketplace pages. */
export const MARKETPLACE_POST = anyOf('marketplace-post', [
  {
    selector:
      '[data-pagelet*=Marketplace] .S2F_disp_cont .S2F_vis_vis.S2F_flex_shr1.S2F_flex_0px[style*=width]',
    seen: SFX,
  },
  {
    selector:
      '.S2F_alinc_flst.S2F_fldr_row.S2F_just_flst.S2F_flex_wrap > .S2F_vis_vis.S2F_flex_shr1.S2F_flex_0px[style*=width]',
    seen: SFX,
  },
]);

export const MARKETPLACE_POST_VERIFIER = anyOf('marketplace-post-verifier', [
  { selector: 'a[role=link]', seen: SFX },
]);

/** The link in a Marketplace listing whose address holds the listing's ID. */
export const MARKETPLACE_ID_LINK = firstOf('marketplace-id-link', [
  { selector: 'a[role=link]', seen: SFX },
]);

/** A post shown inside the comments popup. Its top element is the nearest `POPUP_POST_CONTAINER`. */
export const POPUP_CONTAINED_POST = anyOf('popup-contained-post', [
  { selector: '[class*="-mode"].S2F_pos_rel [aria-labelledby] *', seen: SFX },
]);

export const POPUP_POST_CONTAINER = anyOf('popup-post-container', [
  { selector: '[aria-labelledby]', seen: SFX },
]);

/**
 * A post's ancestors that mean it is a comment or an embedded post. A post
 * inside a post this project has marked is one too.
 */
export const POST_ANCESTOR = anyOf('post-ancestor', [
  { selector: `[${FEED_POSITION}]`, seen: CHECKED },
  { selector: '[role=article]', seen: CHECKED },
]);

/** Where a post keeps its reactions and comments. Content added inside it never starts a new post. */
export const POST_REACTIONS = anyOf('post-reactions', [
  { selector: 'form', seen: SFX, note: `No feed post had a form on ${CHECKED}` },
]);

/**
 * A comment. Below a post's `content` element, which in the comments popup
 * is the post inside the popup, every match is a comment.
 */
export const COMMENT = anyOf('comment', [{ selector: '[role=article]', seen: CHECKED }]);

/** Photos with a description. */
export const CAPTIONED_IMAGE = anyOf('captioned-image', [{ selector: 'img[alt]', seen: SFX }]);

/** The placeholder Facebook shows in the feed while posts load. */
export const LOADING_POST = anyOf('loading-post', [{ selector: '[role=progressbar]', seen: SFX }]);

/** The time link in a post's header, which leads to the post's own page. */
export const TIMESTAMP = anyOf('timestamp', [
  {
    selector: 'a[role=link][aria-labelledby][aria-describedby]',
    seen: CHECKED,
    note: "The address is already the post's own, with no hover needed",
  },
  {
    selector: 'span[id] a.S2F_font_400[role=link][tabindex="0"]:not([href*="/user/"])',
    seen: SFX,
    note: 'Showed # until hovered',
  },
  {
    selector: 'span[id] a.S2F_col_tx2[role=link][tabindex="0"]:not([href*="/user/"])',
    seen: SFX,
    note: 'Showed # until hovered',
  },
]);

/**
 * Links inside a post whose address may hold the post's ID, most reliable
 * first.
 */
export const POST_ID_LINKS = firstOf('post-id-links', [
  {
    selector: 'a[href*="/events/"]:not([href*="/create/"])',
    seen: SFX,
    note: 'Events: "Person is interested in [event]"',
  },
  {
    selector: 'a[href*="/donate/"]',
    seen: SFX,
    note: 'Fundraisers: "Person is collecting donations for [fundraiser]"',
  },
  {
    selector: 'a[href*="/post_insights/"].S2F_alini_stre.S2F_bb_dark.S2F_fldr_row',
    seen: SFX,
    note: 'The insights link group admins see',
  },
  {
    selector: `[${MARK.post}] ul a[href*="comment_id="]:not([aria-hidden=true])`,
    seen: SFX,
    note: 'Links to comments on the post',
  },
  {
    selector: 'a.S2F_trans_n,.S2F_alini_stre > a.S2F_disp_inlb',
    seen: SFX,
    note: 'Media in posts that have no other link: some ads, some posts without text, some profile picture changes',
  },
]);

// The parts of a post that filters can test.

/** Headings that may hold the author's name. */
export const AUTHOR_HEADING = anyOf('author-heading', [
  { selector: 'h4', seen: CHECKED, note: 'Every feed post has one' },
  { selector: 'h2', seen: SFX },
  { selector: 'h3', seen: SFX },
]);

/** The author's name inside an `AUTHOR_HEADING`. */
export const AUTHOR_NAME = anyOf('author-name', [{ selector: 'b,strong', seen: SFX }]);

/** Fallback for the author: the post's links in order, up to its first image. */
export const AUTHOR_LINK_OR_IMAGE = anyOf('author-link-or-image', [
  { selector: 'a.S2F_disp_inl:not([aria-hidden]),img', seen: SFX },
]);

/** Link addresses that are never an author's. */
export const NOT_AUTHOR_ADDRESS =
  /\/(?:help|reel|media|photo|album|video|posts|hashtag|marketplace)\//;

/** The header line of a post: who did what. */
export const POST_HEADER = anyOf('post-header', [
  { selector: '[data-ad-rendering-role=profile_name]', seen: CHECKED },
]);

/** What the author wrote, most reliable first. */
export const POST_MESSAGE = firstOf('post-message', [
  { selector: '[data-ad-rendering-role=story_message]', seen: CHECKED },
  { selector: '.S2F_font_400.S2F_col_tx1 > .S2F_mb_0.S2F_ow_bw', seen: SFX },
  { selector: '[style*="text-align"]', seen: SFX },
]);

/** On a group's own pages, the group's name in the page heading. */
export const PAGE_GROUP_NAME = anyOf('page-group-name', [
  {
    selector: '[role=main] h1 a.S2F_font_700[href*="/groups/"]:not([href*="/user/"])',
    seen: SFX,
  },
  {
    selector: '[role=main] h2 a.S2F_font_700[href*="/groups/"]:not([href*="/user/"])',
    seen: SFX,
  },
]);

/** A group link in a post whose `aria-label` is the group's name. */
export const POST_GROUP_LABELLED = anyOf('post-group-labelled', [
  { selector: 'a.S2F_col_tx1[aria-label][href*="/groups/"]:not([href*="/user/"])', seen: SFX },
]);

/** A divider above a shared post. A group link inside it belongs to the shared post. */
export const SHARED_POST_DIVIDER = anyOf('shared-post-divider', [
  { selector: '.S2F_bb_1pxdiv', seen: SFX },
]);

/** A group link in a post whose text is the group's name. */
export const POST_GROUP_NAMED = anyOf('post-group-named', [
  { selector: 'h3 a.S2F_col_tx1.S2F_font_600[href*="/groups/"]:not([href*="/user/"])', seen: SFX },
  { selector: 'h4 a.S2F_col_tx1.S2F_font_600[href*="/groups/"]:not([href*="/user/"])', seen: SFX },
]);

/** A link that names the app or game a post came from. */
export const APP_NAMED = anyOf('app-named', [{ selector: 'a[data-appname]', seen: SFX }]);

export const APP_LINK = anyOf('app-link', [
  { selector: 'a.S2F_col_tx2.S2F_font_400[href*="/games/"]', seen: SFX },
  { selector: '.S2F_ch1_none ~ a.S2F_col_tx2', seen: SFX },
]);

/** A link out of Facebook. The real address is in its `u` parameter. */
export const EXTERNAL_LINK = anyOf('external-link', [
  {
    selector: 'a[href*="facebook.com/l.php?u="]',
    seen: SFX,
    note: `None on the feed on ${CHECKED}`,
  },
]);

export const HASHTAG_LINK = anyOf('hashtag-link', [
  { selector: 'a[href*="/hashtag/"]', seen: SFX },
]);

/** The post's time, as seconds since 1970 in `data-utime`. */
export const POST_TIME = anyOf('post-time', [
  { selector: 'abbr[data-utime]', seen: SFX, note: `None on the feed on ${CHECKED}` },
]);

// Videos. Facebook draws each one as a plain <video> element in the page,
// with no iframe and no shadow root, so the element itself is the anchor.

/** The look at videos described in `docs/porting.md`. */
const VIDEOS_CHECKED = '2026-11-14';

export const VIDEO = anyOf('video', [{ selector: 'video', seen: VIDEOS_CHECKED }]);

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

/**
 * The post a video is in, looked for from the video up: the same elements
 * that mark a comment's post. A feed video was inside one on 2026-11-14.
 */
export const VIDEO_POST = anyOf('video-post', POST_ANCESTOR.strategies);

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
