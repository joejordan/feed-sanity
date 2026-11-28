// The Facebook pages the code runs on. The extension manifest and the
// userscript header are both written from these lists.

import { isHttpsOnDomains, matchesGlobPattern } from '../core/urls.ts';

/** Every page on Facebook's site and its subdomains (www, web, m and the rest). */
export const MATCHES: string[] = ['https://*.facebook.com/*'];

/**
 * Pages under MATCHES to stay out of. None of them shows Facebook's user
 * interface, except `/saved/`, which is kept free on purpose.
 */
export const EXCLUDE_MATCHES: string[] = [
  // The background channel (long polling for chat and notifications).
  'https://*.channel.facebook.com/*',
  // Endpoints that answer the page's own requests with data, not pages.
  'https://*.facebook.com/ajax/*',
  // Login connection frames for other sites (`connect/ping`, the cross-domain arbiter).
  'https://*.facebook.com/connect/*',
  // The ad click and impression beacon.
  'https://*.facebook.com/ai.php*',
  // Left alone so the live-check harness in .claude/skills/live-facebook-check can load its
  // own copy there without an installed extension's marks getting in the way.
  'https://www.facebook.com/saved/*',
];

/** As EXCLUDE_MATCHES, for hosts a match pattern cannot express. */
export const EXCLUDE_GLOBS: string[] = [
  // Static file hosts such as static.xx.facebook.com: scripts, styles and images only.
  'https://static.*.facebook.com/*',
];

/**
 * True when `address` matches `EXCLUDE_GLOBS`. Safari ignores `exclude_globs`
 * in the manifest, so Facebook's content and page-world scripts check this
 * before starting.
 */
export function isExcludedByGlob(address: string): boolean {
  return EXCLUDE_GLOBS.some((glob) => matchesGlobPattern(address, glob));
}

/** Facebook's own domains: its site and its file servers. Each one's subdomains count too. */
const OWN_DOMAINS = ['facebook.com', 'fbcdn.net'];

/** True when `hostname` is one of Facebook's own domains or a subdomain of one. */
export const isOwnHost = (hostname: string): boolean =>
  OWN_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));

/** The address of a link as the page wrote it, read against Facebook's site, or null when it is not one. */
export function facebookUrl(href: string | null): URL | null {
  const base = 'https://www.facebook.com/';
  return href && URL.canParse(href, base) ? new URL(href, base) : null;
}

/** True when `hostname` belongs to Facebook. */
export const isFacebookHost = (hostname: string): boolean =>
  /(?:^|\.)facebook\.com$/i.test(hostname);

/**
 * True when `address` is an `https:` address on one of Facebook's own
 * domains, with no user name, password or port. Addresses read from the
 * page are checked with this before anything uses them.
 */
export function isFacebookAddress(address: string): boolean {
  return isHttpsOnDomains(address, OWN_DOMAINS);
}
