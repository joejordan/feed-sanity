// The Facebook pages the code runs on. The extension manifest and the
// userscript header are both written from these lists.

import { isHttpsOnDomains, matchesGlobPattern } from '../core/urls.ts';

// TODO(clean): the fb-dom unit chooses these values (spec-fb-dom.md section 8).
export const MATCHES: string[] = [];

/** Pages under MATCHES to stay out of. */
export const EXCLUDE_MATCHES: string[] = [];

/** As EXCLUDE_MATCHES, for hosts a match pattern cannot express. */
export const EXCLUDE_GLOBS: string[] = [];

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
