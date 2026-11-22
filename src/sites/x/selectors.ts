import { anyOf } from '../../core/locator';

/** Tweet cards in X's virtualized timeline and detail threads. */
export const X_TWEET = anyOf('x-tweet', [
  { selector: 'article[data-testid="tweet"]', seen: '2026-11-22' },
]);

/** Video elements inside X timeline posts and media viewers. */
export const X_VIDEO = anyOf('x-video', [{ selector: 'video', seen: '2026-11-22' }]);

/** Interactive controls overlaying an X video player. */
export const X_VIDEO_CONTROL = anyOf('x-video-control', [
  { selector: 'button, [role=button], [role=slider], a[href]', seen: '2026-11-22' },
]);

/** Right sidebar column ("What's happening", "Who to follow", News/Scores). */
export const X_SIDEBAR = anyOf('x-sidebar', [
  { selector: '[data-testid="sidebarColumn"]', seen: '2026-11-22' },
]);

/** Grok left-nav link and floating Grok drawer. */
export const X_NAV_GROK = anyOf('x-nav-grok', [
  { selector: 'a[href="/i/grok"]', seen: '2026-11-22' },
  { selector: '[data-testid="GrokDrawer"]', seen: '2026-11-22' },
]);

/** Premium subscription tab in left navigation. */
export const X_NAV_PREMIUM = anyOf('x-nav-premium', [
  { selector: '[data-testid="premium-hub-tab"]', seen: '2026-11-22' },
  { selector: 'a[href="/i/premium_sign_up"]', seen: '2026-11-22' },
]);

/** Explore tab in left navigation. */
export const X_NAV_EXPLORE = anyOf('x-nav-explore', [
  { selector: '[data-testid="AppTabBar_Explore_Link"]', seen: '2026-11-22' },
]);

/** Timeline tab buttons ("For you", "Following", pinned Lists) on `/home`. */
export const X_TIMELINE_TAB = anyOf('x-timeline-tab', [
  { selector: '[data-testid="primaryColumn"] [role="tab"]', seen: '2026-11-22' },
]);
