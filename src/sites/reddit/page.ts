import { scrubCommonPii } from '../../core/pii';

/**
 * Reads an opaque Reddit account bucket ID from the `loid=` cookie (available
 * synchronously at `document_start` and identically during late auto-attach),
 * defaulting to `'anonymous'`. Avoids DOM-dependent IDs (`shreddit-app[user-id]`)
 * so settings never split across `anonymous` and `t2_*` buckets between boot
 * and auto-attach. Never stores raw session tokens or usernames.
 */
export function redditAccountId(cookies: string = document.cookie): string {
  const cookieMatch = /(?:^|;\s*)loid=([a-z0-9]{12,32})(?:[.;]|$)/i.exec(cookies);
  if (cookieMatch?.[1]) {
    // Keep the full first segment (12..32 chars): Reddit left-zero-pads `loid`,
    // so truncating from the left would discard the varying low-order digits.
    return `loid-${cookieMatch[1].toLowerCase()}`;
  }
  return 'anonymous';
}

export type RedditPageType =
  | 'all'
  | 'home'
  | 'other'
  | 'popular'
  | 'post'
  | 'profile'
  | 'search'
  | 'subreddit';

/**
 * Classifies a Reddit URL without returning usernames, post IDs, or private
 * subreddit slugs. Safe to include directly in Diagnostics bug reports.
 */
export function redditPageType(loc: Pick<Location, 'pathname'> = location): RedditPageType {
  const path = loc.pathname.replace(/\/+$/, '') || '/';
  if (path === '/' || path === '/best' || path === '/hot' || path === '/new') {
    return 'home';
  }
  if (path === '/r/popular' || path.startsWith('/r/popular/')) {
    return 'popular';
  }
  if (path === '/r/all' || path.startsWith('/r/all/')) {
    return 'all';
  }
  if (/^\/r\/[^/]+\/comments\/[^/]+/.test(path)) {
    return 'post';
  }
  if (/^\/r\/[^/]+(?:\/|$)/.test(path)) {
    return 'subreddit';
  }
  if (/^\/u(?:ser)?\/[^/]+(?:\/|$)/.test(path)) {
    return 'profile';
  }
  if (path === '/search' || path.startsWith('/search/')) {
    return 'search';
  }
  return 'other';
}

/**
 * Strips Reddit URLs, `u/<user>` handles, `/user/<user>` paths, `t2_<id>`
 * account IDs, and common PII from error messages before bug reports.
 */
export const scrubRedditPii = (message: string): string =>
  scrubCommonPii(
    message
      .replaceAll(/\S*\b(?:www\.|sh\.)?reddit\.com\S*/gi, '<address>')
      .replaceAll(/\/u(?:ser)?\/[A-Za-z0-9_-]+/gi, '/u/<user>')
      .replaceAll(/\bt2_[a-z0-9]+\b/gi, '<account>')
      .replaceAll(/(^|[^A-Za-z0-9_])u\/[A-Za-z0-9_-]+/gi, '$1u/<user>'),
  );
