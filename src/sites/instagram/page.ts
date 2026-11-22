import { scrubCommonPii } from '../../core/site';

/** Reads Instagram's signed-in numeric user ID from `ds_user_id`, or `'anonymous'`. */
export function instagramAccountId(cookies: string = document.cookie): string {
  const match = /(?:^|;\s*)ds_user_id=(\d+)(?:;|$)/.exec(cookies);
  return match?.[1] ?? 'anonymous';
}

export type InstagramPageType =
  | 'direct'
  | 'explore'
  | 'favorites'
  | 'following'
  | 'home'
  | 'other'
  | 'post'
  | 'profile'
  | 'reels'
  | 'stories';

/**
 * Classifies an Instagram URL without returning personal usernames or slugs.
 * Safe to include directly in Diagnostics bug reports.
 */
export function instagramPageType(
  loc: Pick<Location, 'pathname' | 'search'> = location,
): InstagramPageType {
  const path = loc.pathname.replace(/\/+$/, '') || '/';
  if (path === '/') {
    const variant = new URLSearchParams(loc.search).get('variant');
    if (variant === 'following') {
      return 'following';
    }
    if (variant === 'favorites') {
      return 'favorites';
    }
    return 'home';
  }
  if (path === '/reels' || path.startsWith('/reels/')) {
    return 'reels';
  }
  if (path === '/explore' || path.startsWith('/explore/')) {
    return 'explore';
  }
  if (path === '/direct' || path.startsWith('/direct/')) {
    return 'direct';
  }
  if (path.startsWith('/stories/')) {
    return 'stories';
  }
  if (path.startsWith('/p/') || path.startsWith('/reel/')) {
    return 'post';
  }
  if (/^\/[A-Za-z0-9._]+$/.test(path)) {
    return 'profile';
  }
  return 'other';
}

/**
 * Strips Instagram URLs, post/reel shortcodes, `@handles`, and common PII
 * from error messages before they appear in bug reports.
 */
export const scrubInstagramPii = (message: string): string =>
  scrubCommonPii(
    message
      .replaceAll(/\S*\binstagram\.com\S*/gi, '<address>')
      .replaceAll(/\/(?:p|reel|reels)\/[A-Za-z0-9_-]+/g, '/<shortcode>')
      .replaceAll(/(^|[\s(])@[A-Za-z0-9._]{2,}/g, '$1<handle>'),
  );
