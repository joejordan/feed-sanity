/**
 * The logged-in Facebook user's ID, read from the `c_user` cookie, or
 * 'anonymous' when nobody is logged in. Settings are stored per user so that
 * several accounts can share one browser.
 */
export function currentUserId(cookie: string = document.cookie): string {
  return /(?:^|;\s*)c_user=(\d+)/.exec(cookie)?.[1] ?? 'anonymous';
}
