import { anyOf } from '../../core/locator';

/** Feed post cards on Instagram's Home, Following, and Favorites timelines. */
export const IG_FEED_POST = anyOf('ig-feed-post', [{ selector: 'article', seen: '2026-11-22' }]);

/** Video elements across Instagram feed posts, Reels, and Stories. */
export const IG_VIDEO = anyOf('ig-video', [{ selector: 'video', seen: '2026-11-22' }]);

/** Interactive controls overlaying an Instagram video player. */
export const IG_VIDEO_CONTROL = anyOf('ig-video-control', [
  { selector: 'button, [role=button], [role=slider], a[href]', seen: '2026-11-22' },
]);

/** Left navigation link to Reels. */
export const IG_NAV_REELS = anyOf('ig-nav-reels', [
  { selector: 'a[href="/reels/"]', seen: '2026-11-22' },
]);

/** Left navigation link to Explore. */
export const IG_NAV_EXPLORE = anyOf('ig-nav-explore', [
  { selector: 'a[href="/explore/"]', seen: '2026-11-22' },
]);

/** Left navigation link to Threads. */
export const IG_NAV_THREADS = anyOf('ig-nav-threads', [
  { selector: 'a[href^="https://www.threads.com"]', seen: '2026-11-22' },
  { selector: 'a[href^="https://www.threads.net"]', seen: '2026-11-22' },
]);

/** Top-level Home link in Instagram's navigation chrome. */
export const IG_NAV_HOME = anyOf('ig-nav-home', [{ selector: 'a[href="/"]', seen: '2026-11-22' }]);
