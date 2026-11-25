// Semantic `LocatorSpec` definitions for Reddit's Shreddit Web Components
// (`shreddit-post`, `shreddit-ad-post`, nested open Shadow DOM cards, and
// `shreddit-player` videos). Every selector can be overridden live from the
// Diagnostics panel without a rebuild.

import { anyOf } from '../../core/locator';

/** Feed post cards across light DOM and nested Shreddit open Shadow Roots. */
export const REDDIT_POST = anyOf('reddit-post', [
  { selector: 'shreddit-post', seen: '2026-11-23' },
  { selector: 'shreddit-ad-post', seen: '2026-11-23' },
  { selector: 'shreddit-dynamic-ad-link', seen: '2026-11-23' },
  { selector: 'article[data-testid="post-container"]', seen: '2026-11-23' },
]);

/** Native `<video>` elements inside Shreddit media players (including Shadow Roots). */
export const REDDIT_VIDEO = anyOf(
  'reddit-video',
  [
    { selector: 'shreddit-player video', seen: '2026-11-23' },
    { selector: 'shreddit-player-2 video', seen: '2026-11-23' },
    { selector: 'video', seen: '2026-11-23' },
  ],
  { optional: true },
);

/** Interactive controls inside a Shreddit video player container. */
export const REDDIT_VIDEO_CONTROL = anyOf('reddit-video-control', [
  { selector: 'button[aria-label], [role="slider"], shreddit-media-controls', seen: '2026-11-23' },
]);

/** Right sidebar column ("Popular Communities", "Recent Posts", community info). */
export const REDDIT_RIGHT_RAIL = anyOf('reddit-right-rail', [
  { selector: '#right-sidebar-container', seen: '2026-11-23' },
  { selector: 'aside[aria-label="Popular Communities"]', seen: '2026-11-23' },
  { selector: 'reddit-pdp-right-rail-carousel', seen: '2026-11-23' },
]);

/** "Recent Posts" module in the right sidebar or Shadow DOM rail. */
export const REDDIT_RECENT_POSTS = anyOf('reddit-recent-posts', [
  { selector: 'recent-posts', seen: '2026-11-23' },
  { selector: '[data-testid="recent-posts"]', seen: '2026-11-23' },
]);

/** Left navigation Games section and links. */
export const REDDIT_GAMES_NAV = anyOf('reddit-games-nav', [
  { selector: 'left-nav-games-section', seen: '2026-11-23' },
  { selector: 'a[href*="/games"]', seen: '2026-11-23' },
  { selector: '[data-testid="games-nav"]', seen: '2026-11-23' },
]);

/** Promo banners, app-install nags, and signup drawers (light DOM & Shadow Roots). */
export const REDDIT_PROMO_BANNER = anyOf('reddit-promo-banner', [
  { selector: 'shreddit-signup-drawer', seen: '2026-11-23' },
  { selector: 'shreddit-experience-tree [slot="promo"]', seen: '2026-11-23' },
  { selector: 'faceplate-banner[data-testid="promo"]', seen: '2026-11-23' },
  { selector: '[data-testid="shreddit-promo"]', seen: '2026-11-23' },
]);
