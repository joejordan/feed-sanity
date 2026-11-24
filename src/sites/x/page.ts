import { scrubCommonPii } from '../../core/pii';

/** Reads X's signed-in numeric user ID from `twid=u%3D<id>` (or `twid=u=<id>`), or `'anonymous'`. */
export function xAccountId(cookies: string = document.cookie): string {
  const match = /(?:^|;\s*)twid=(?:"?u(?:%3D|=)(\d+)"?)(?:;|$)/i.exec(cookies);
  return match?.[1] ?? 'anonymous';
}

export type XPageType =
  | 'bookmarks'
  | 'explore'
  | 'grok'
  | 'home'
  | 'lists'
  | 'messages'
  | 'notifications'
  | 'other'
  | 'profile'
  | 'search'
  | 'settings'
  | 'status';

/**
 * Classifies an X.com URL without returning personal handles or tweet IDs.
 * Safe to include directly in Diagnostics bug reports.
 */
export function xPageType(loc: Pick<Location, 'pathname'> = location): XPageType {
  const path = loc.pathname.replace(/\/+$/, '') || '/';
  if (path === '/' || path === '/home') {
    return 'home';
  }
  if (path === '/explore' || path.startsWith('/explore/')) {
    return 'explore';
  }
  if (path === '/notifications' || path.startsWith('/notifications/')) {
    return 'notifications';
  }
  if (path === '/messages' || path.startsWith('/messages/') || path.startsWith('/i/chat')) {
    return 'messages';
  }
  if (path === '/i/grok' || path.startsWith('/i/grok/')) {
    return 'grok';
  }
  if (path === '/i/bookmarks' || path.startsWith('/i/bookmarks/')) {
    return 'bookmarks';
  }
  if (path.startsWith('/i/lists') || /^\/[^/]+\/lists(?:\/|$)/.test(path)) {
    return 'lists';
  }
  if (path === '/search') {
    return 'search';
  }
  if (path === '/settings' || path.startsWith('/settings/')) {
    return 'settings';
  }
  if (/^\/[^/]+\/status\/\d+/.test(path)) {
    return 'status';
  }
  if (/^\/[A-Za-z0-9_]{1,15}$/.test(path)) {
    return 'profile';
  }
  return 'other';
}

/** True when `loc` is X's Display settings route (`/settings/display`). */
export function isXDisplaySettingsPath(loc: Pick<Location, 'pathname'> = location): boolean {
  return /^\/settings\/display(?:\/|$)/i.test(loc.pathname);
}

/**
 * Strips X/Twitter URLs, `/status/<id>` paths, `@handles`, and common PII from
 * error messages before they appear in bug reports.
 */
export const scrubXPii = (message: string): string =>
  scrubCommonPii(
    message
      .replaceAll(/\S*\b(?:x|twitter)\.com\S*/gi, '<address>')
      .replaceAll(/\/[A-Za-z0-9_]+\/status\/\d+/g, '/<status>'),
  ).replaceAll(/(^|[^A-Za-z0-9_])@[A-Za-z0-9_]{1,15}\b/g, '$1<handle>');
