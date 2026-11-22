// Static site host registry shared by wxt.config.ts, vite.userscript.config.ts,
// the extension background script, and the Sites options panel. Keep this file
// free of DOM or browser-API imports so Node build configs can import it directly.

import {
  EXCLUDE_GLOBS as FACEBOOK_EXCLUDE_GLOBS,
  EXCLUDE_MATCHES as FACEBOOK_EXCLUDE_MATCHES,
  MATCHES as FACEBOOK_MATCHES,
} from '../facebook/urls.ts';
import { INSTAGRAM_EXCLUDE_MATCHES, INSTAGRAM_MATCHES } from './instagram/urls.ts';
import { X_EXCLUDE_MATCHES, X_MATCHES } from './x/urls.ts';

export interface SiteManifestEntry {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  /** True for sites statically matched in the manifest; false for optional host permissions. */
  readonly required: boolean;
  readonly matches: readonly string[];
  readonly excludeMatches: readonly string[];
  readonly excludeGlobs: readonly string[];
  /** Compiled runtime content script path (relative to extension root) for optional sites. */
  readonly contentScript?: string;
  /** Compiled MAIN-world runtime script path (relative to extension root) for optional sites. */
  readonly pageWorldScript?: string;
}

export const SITE_MANIFEST: readonly SiteManifestEntry[] = [
  {
    id: 'facebook',
    displayName: 'Facebook',
    description:
      'News Feed filters, Home feeds, responsive rails, video scrubber, click-to-pause, and download.',
    required: true,
    matches: FACEBOOK_MATCHES,
    excludeMatches: FACEBOOK_EXCLUDE_MATCHES,
    excludeGlobs: FACEBOOK_EXCLUDE_GLOBS,
  },
  {
    id: 'instagram',
    displayName: 'Instagram',
    description:
      'Hide Sponsored ads and Suggested posts, default to the Following feed, hide Reels/Explore/Threads links, video scrubber, and External CSS.',
    required: false,
    matches: INSTAGRAM_MATCHES,
    excludeMatches: INSTAGRAM_EXCLUDE_MATCHES,
    excludeGlobs: [],
    contentScript: 'instagram.js',
    pageWorldScript: 'instagram-page-world.js',
  },
  {
    id: 'x',
    displayName: 'X (Twitter)',
    description:
      'Strip Promoted ads before timeline render, hide Suggested/keyword posts, default to Following tab, hide Grok/Premium/Sidebar clutter, video scrubber, and External CSS.',
    required: false,
    matches: X_MATCHES,
    excludeMatches: X_EXCLUDE_MATCHES,
    excludeGlobs: [],
    contentScript: 'x.js',
    pageWorldScript: 'x-page-world.js',
  },
];

export const OPTIONAL_SITES: readonly SiteManifestEntry[] = SITE_MANIFEST.filter(
  (site) => !site.required,
);

export const OPTIONAL_SITE_MATCHES: string[] = OPTIONAL_SITES.flatMap((site) => [...site.matches]);

export const ALL_USERSCRIPT_MATCHES: string[] = SITE_MANIFEST.flatMap((site) => [...site.matches]);

export const ALL_USERSCRIPT_EXCLUDES: string[] = SITE_MANIFEST.flatMap((site) => [
  ...site.excludeMatches,
  ...site.excludeGlobs,
]);

const escapeRegex = (literal: string): string => literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Matches a WebExtension match pattern or glob (scheme, optional `*.` host
 * wildcard, and `*` wildcards in the path/query) against `url`.
 */
export function matchesUrlPattern(url: string, pattern: string): boolean {
  if (!URL.canParse(url)) {
    return false;
  }
  const match = /^(https?):\/\/([^/]+)(\/.*)$/.exec(pattern);
  if (!match) {
    return false;
  }
  const [, scheme, rawHost, rawPath] = match;
  const parsed = new URL(url);
  if (parsed.protocol !== `${scheme}:`) {
    return false;
  }
  const targetHost = parsed.hostname.toLowerCase();
  const hostPattern = (rawHost ?? '').toLowerCase();
  let hostMatches: boolean;
  if (hostPattern.startsWith('*.')) {
    const base = hostPattern.slice(2);
    hostMatches = targetHost === base || targetHost.endsWith(`.${base}`);
  } else if (hostPattern.includes('*')) {
    const regex = new RegExp(`^${hostPattern.split('*').map(escapeRegex).join('.*')}$`);
    hostMatches = regex.test(targetHost);
  } else {
    hostMatches = targetHost === hostPattern;
  }
  if (!hostMatches) {
    return false;
  }
  const pathPattern = rawPath ?? '/*';
  const pathRegex = new RegExp(`^${pathPattern.split('*').map(escapeRegex).join('.*')}$`);
  return pathRegex.test(`${parsed.pathname}${parsed.search}`);
}

/** Matches an origin pattern (`https://host/*` or `https://*.host/*`) against `url`. */
export const matchesOriginPattern = matchesUrlPattern;

/**
 * Finds an optional site whose `matches` cover `url` and whose `excludeMatches`
 * / `excludeGlobs` do not exclude `url` (keeping login and API pages untouched).
 */
export function optionalSiteForUrl(url: string): SiteManifestEntry | undefined {
  return OPTIONAL_SITES.find(
    (site) =>
      site.matches.some((pattern) => matchesUrlPattern(url, pattern)) &&
      !site.excludeMatches.some((pattern) => matchesUrlPattern(url, pattern)) &&
      !site.excludeGlobs.some((pattern) => matchesUrlPattern(url, pattern)),
  );
}
