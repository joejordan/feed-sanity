import { scrubCommonPii } from '../../core/pii';

/**
 * Reads an opaque Reddit account bucket ID from the `loid=` cookie (available
 * synchronously at `document_start`) or falls back to `t2_<id>` on
 * `shreddit-app[user-id]` / `meta[name="user-id"]`, defaulting to `'anonymous'`.
 * Never stores raw session tokens or usernames.
 */
export function redditAccountId(
  cookies: string = document.cookie,
  doc: Document = document,
): string {
  const cookieMatch = /(?:^|;\s*)loid=([a-z0-9]{12,32})(?:[.;]|$)/i.exec(cookies);
  if (cookieMatch?.[1]) {
    return `loid-${cookieMatch[1].slice(0, 12).toLowerCase()}`;
  }
  const attrId =
    doc.querySelector('shreddit-app[user-id]')?.getAttribute('user-id')?.trim() ??
    doc.querySelector('meta[name="user-id"]')?.getAttribute('content')?.trim();
  if (attrId && /^t2_[a-z0-9_-]+$/i.test(attrId)) {
    return attrId.toLowerCase();
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
