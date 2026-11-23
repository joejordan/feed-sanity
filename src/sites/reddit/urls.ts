// Reddit host and URL matchers shared by WXT entrypoints, `siteRegistry`,
// and `vite.userscript.config.ts` via `src/sites/manifest.ts`.

export const REDDIT_MATCHES: readonly string[] = [
  'https://www.reddit.com/*',
  'https://reddit.com/*',
  'https://sh.reddit.com/*',
];

export const REDDIT_EXCLUDE_MATCHES: readonly string[] = [
  'https://www.reddit.com/login*',
  'https://www.reddit.com/register*',
  'https://www.reddit.com/account/login*',
  'https://www.reddit.com/media*',
  'https://www.reddit.com/svc/*',
  'https://reddit.com/login*',
  'https://reddit.com/register*',
  'https://sh.reddit.com/login*',
  'https://sh.reddit.com/register*',
];

/** True for modern Reddit (Shreddit) web hosts (`reddit.com`, `www.reddit.com`, `sh.reddit.com`). */
export function isRedditHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'reddit.com' || host === 'www.reddit.com' || host === 'sh.reddit.com';
}
