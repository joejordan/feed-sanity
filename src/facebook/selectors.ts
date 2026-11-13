/**
 * Every selector that depends on Facebook's markup, and the marks this
 * project leaves on Facebook's elements. When Facebook changes its pages,
 * this is the file to fix.
 *
 * `S2F_` names stand for Facebook's generated classes. Pass a selector
 * through `atoms.translate` before using it. Most selectors were last checked
 * against Facebook in 2023 (Social Fixer 31.1.0). `docs/porting.md` lists
 * what has been checked on the live site since.
 */

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
} as const;

/** The comments column beside a photo or video shown in theater mode. */
export const THEATER_COMMENTS =
  '.S2F_fldr_col [role=main] ~ [role=complementary].S2F_bg_surf > .S2F_just_spbt';

/** Attribute holding a post's position in the news feed. An element that has it is a post once it has content. */
export const FEED_POSITION = 'aria-posinset';

/** Elements that may be the top of a post. `POST_VERIFIER` confirms them. */
export const POST = [
  '[role=article]:not(.S2F_pos_rel)',
  // News feed posts with a position in the feed
  `[${FEED_POSITION}]`,
  // News feed posts without one
  'div[aria-describedby].S2F_outl_none:not(.S2F_disp_infl):not(.S2F_zi_0):not(.S2F_pos_rel)',
  // A reel on its own page
  'div.S2F_disp_flex.S2F_fldr_row.S2F_pos_rel.S2F_hei_100.S2F_alini_cent.S2F_just_cent',
  THEATER_COMMENTS,
].join(',');

/** Something every real post contains. */
export const POST_VERIFIER = 'a[aria-label]';

/** Marketplace listings, which stand in for posts on Marketplace pages. */
export const MARKETPLACE_POST = [
  '[data-pagelet*=Marketplace] .S2F_disp_cont .S2F_vis_vis.S2F_flex_shr1.S2F_flex_0px[style*=width]',
  '.S2F_alinc_flst.S2F_fldr_row.S2F_just_flst.S2F_flex_wrap > .S2F_vis_vis.S2F_flex_shr1.S2F_flex_0px[style*=width]',
].join(',');

export const MARKETPLACE_POST_VERIFIER = 'a[role=link]';

/** The link in a Marketplace listing whose address holds the listing's ID. */
export const MARKETPLACE_ID_LINK = 'a[role=link]';

/** A post shown inside the comments popup. Its top element is the nearest `POPUP_POST_CONTAINER`. */
export const POPUP_CONTAINED_POST = '[class*="-mode"].S2F_pos_rel [aria-labelledby] *';

export const POPUP_POST_CONTAINER = '[aria-labelledby]';

/** A post's ancestors that mean it is a comment or an embedded post. */
export const POST_ANCESTOR = `[${MARK.post}],[${FEED_POSITION}],[role=article]`;

/** Where a post keeps its reactions and comments. Content added inside it never starts a new post. */
export const POST_REACTIONS = 'form';

/** The placeholder Facebook shows in the feed while posts load. */
export const LOADING_POST = '[role=progressbar]';

/** The time link in a post's header, which leads to the post's own page. */
export const TIMESTAMP = [
  // Seen on 2026-11-13. The address is already the post's own, with no hover needed.
  'a[role=link][aria-labelledby][aria-describedby]',
  // Social Fixer 31.1.0 (2023). These links showed `#` until hovered.
  'span[id] a.S2F_font_400[role=link][tabindex="0"]:not([href*="/user/"])',
  'span[id] a.S2F_col_tx2[role=link][tabindex="0"]:not([href*="/user/"])',
].join(',');

/**
 * Links inside a post whose address may hold the post's ID, most reliable
 * first.
 */
export const POST_ID_LINKS = [
  // Events: "Person is interested in [event]"
  'a[href*="/events/"]:not([href*="/create/"])',
  // Fundraisers: "Person is collecting donations for [fundraiser]"
  'a[href*="/donate/"]',
  // The insights link group admins see
  'a[href*="/post_insights/"].S2F_alini_stre.S2F_bb_dark.S2F_fldr_row',
  // Links to comments on the post
  `[${MARK.post}] ul a[href*="comment_id="]:not([aria-hidden=true])`,
  // Media in posts that have no other link: some ads, some posts without text, some profile picture changes
  'a.S2F_trans_n,.S2F_alini_stre > a.S2F_disp_inlb',
];
