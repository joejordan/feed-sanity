/** The account ID used when no one is logged in. `src/core/site-storage.ts` uses the same word. */
const ANONYMOUS = 'anonymous';

/** The cookie Facebook keeps the logged-in account's numeric ID in. */
const USER_COOKIE = 'c_user';

/**
 * The numeric ID of the logged-in Facebook account, read from `cookie`, or
 * `'anonymous'` when no one is logged in. It keys per-account storage.
 */
export function currentUserId(cookie: string = document.cookie): string {
  for (const pair of cookie.split(';')) {
    const split = pair.indexOf('=');
    if (split > 0 && pair.slice(0, split).trim() === USER_COOKIE) {
      const value = pair.slice(split + 1).trim();
      return /^\d+$/.test(value) ? value : ANONYMOUS;
    }
  }
  return ANONYMOUS;
}
