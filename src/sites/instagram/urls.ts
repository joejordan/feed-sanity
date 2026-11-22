// The Instagram pages Feed Sanity runs on, and validation for Instagram media URLs.

import { isHttpsOnDomains } from '../../core/urls.ts';

export const INSTAGRAM_MATCHES = ['https://www.instagram.com/*'];

/** Pages under INSTAGRAM_MATCHES to stay out of. */
export const INSTAGRAM_EXCLUDE_MATCHES = [
  'https://www.instagram.com/accounts/login*',
  'https://www.instagram.com/api/*',
  'https://www.instagram.com/graphql/*',
];

/** Instagram's own site and media CDN domains. */
const OWN_DOMAINS = ['instagram.com', 'cdninstagram.com', 'fbcdn.net'];

/** True when `hostname` belongs to Instagram. */
export const isInstagramHost = (hostname: string): boolean =>
  /(?:^|\.)instagram\.com$/i.test(hostname);

/**
 * True when `address` is an `https:` address on Instagram's own site or media
 * CDNs, with no user name, password or port.
 */
export function isInstagramMediaAddress(address: string): boolean {
  return isHttpsOnDomains(address, OWN_DOMAINS);
}
