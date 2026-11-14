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

/**
 * Parts of a post whose text is not the post's own: its comment area, the
 * comments themselves, and anything this project added. This holds below a
 * post's `content` element, which in the comments popup is the post inside
 * the popup and not the popup. Seen on 2026-11-13.
 */
export const NOT_POST_TEXT = `${POST_REACTIONS},[role=article],${OWN_ELEMENT}`;

/** Photos with a description. */
export const CAPTIONED_IMAGE = 'img[alt]';

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

// The parts of a post that filters can test. Unless noted, the selectors are
// Social Fixer 31.1.0's (2023).

/** Headings that may hold the author's name. Seen on 2026-11-13: every feed post has an `h4`. */
export const AUTHOR_HEADING = 'h2,h3,h4';

/** The author's name inside an `AUTHOR_HEADING`. */
export const AUTHOR_NAME = 'b,strong';

/** Fallback for the author: the post's links in order, up to its first image. */
export const AUTHOR_LINK_OR_IMAGE = 'a.S2F_disp_inl:not([aria-hidden]),img';

/** Link addresses that are never an author's. */
export const NOT_AUTHOR_ADDRESS =
  /\/(?:help|reel|media|photo|album|video|posts|hashtag|marketplace)\//;

/** The header line of a post: who did what. Seen on 2026-11-13. */
export const POST_HEADER = '[data-ad-rendering-role=profile_name]';

/** What the author wrote, most reliable first. The first one that matches anything is used. */
export const POST_MESSAGE = [
  // Seen on 2026-11-13.
  '[data-ad-rendering-role=story_message]',
  '.S2F_font_400.S2F_col_tx1 > .S2F_mb_0.S2F_ow_bw',
  '[style*="text-align"]',
];

/** On a group's own pages, the group's name in the page heading. */
export const PAGE_GROUP_NAME = [
  '[role=main] h1 a.S2F_font_700[href*="/groups/"]:not([href*="/user/"])',
  '[role=main] h2 a.S2F_font_700[href*="/groups/"]:not([href*="/user/"])',
].join(',');

/** A group link in a post whose `aria-label` is the group's name. */
export const POST_GROUP_LABELLED =
  'a.S2F_col_tx1[aria-label][href*="/groups/"]:not([href*="/user/"])';

/** A divider above a shared post. A group link inside it belongs to the shared post. */
export const SHARED_POST_DIVIDER = '.S2F_bb_1pxdiv';

/** A group link in a post whose text is the group's name. */
export const POST_GROUP_NAMED = [
  'h3 a.S2F_col_tx1.S2F_font_600[href*="/groups/"]:not([href*="/user/"])',
  'h4 a.S2F_col_tx1.S2F_font_600[href*="/groups/"]:not([href*="/user/"])',
].join(',');

/** A link that names the app or game a post came from. */
export const APP_NAMED = 'a[data-appname]';

export const APP_LINK = 'a.S2F_col_tx2.S2F_font_400[href*="/games/"],.S2F_ch1_none ~ a.S2F_col_tx2';

/** A link out of Facebook. The real address is in its `u` parameter. */
export const EXTERNAL_LINK = 'a[href*="facebook.com/l.php?u="]';

export const HASHTAG_LINK = 'a[href*="/hashtag/"]';

/** The post's time, as seconds since 1970 in `data-utime`. Not seen on 2026-11-13. */
export const POST_TIME = 'abbr[data-utime]';
