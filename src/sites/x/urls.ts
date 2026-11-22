// The X.com / Twitter pages Feed Sanity runs on, and validation for X media URLs.

import { isHttpsOnDomains } from '../../core/urls.ts';

export const X_MATCHES = ['https://x.com/*', 'https://twitter.com/*'];

/** Authentication and API paths under X_MATCHES to stay out of. */
export const X_EXCLUDE_MATCHES = [
  'https://x.com/i/flow/login*',
  'https://twitter.com/i/flow/login*',
  'https://x.com/i/oauth*',
  'https://twitter.com/i/oauth*',
  'https://x.com/i/api/*',
  'https://twitter.com/i/api/*',
];

/** X's own site and media CDN domains. */
const OWN_DOMAINS = ['x.com', 'twitter.com', 'twimg.com'];

/** True when `hostname` belongs to X.com or legacy Twitter. */
export const isXHost = (hostname: string): boolean =>
  /^(?:www\.)?(?:x|twitter)\.com$/i.test(hostname);

/**
 * True when `address` is an `https:` address on X's own site or `twimg.com`
 * media CDNs, with no embedded credentials or custom port.
 */
export function isXMediaAddress(address: string): boolean {
  return isHttpsOnDomains(address, OWN_DOMAINS);
}
