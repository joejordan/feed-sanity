// Static site host registry shared by wxt.config.ts, vite.userscript.config.ts,
// auto-attach, Safari page-world registration, site settings, and the Sites
// options panel. Keep this file free of DOM or browser-API imports so Node build
// configs can import it directly.

import {
  EXCLUDE_GLOBS as FACEBOOK_EXCLUDE_GLOBS,
  EXCLUDE_MATCHES as FACEBOOK_EXCLUDE_MATCHES,
  MATCHES as FACEBOOK_MATCHES,
} from '../facebook/urls.ts';
import { GMAIL_EXCLUDE_MATCHES, GMAIL_MATCHES } from './gmail/urls.ts';
import { INSTAGRAM_EXCLUDE_MATCHES, INSTAGRAM_MATCHES } from './instagram/urls.ts';
import { REDDIT_EXCLUDE_MATCHES, REDDIT_MATCHES } from './reddit/urls.ts';
import { X_EXCLUDE_MATCHES, X_MATCHES } from './x/urls.ts';

export type SiteId = 'facebook' | 'instagram' | 'x' | 'gmail' | 'reddit';
export type PageWorldSiteId = Exclude<SiteId, 'gmail'>;

interface SiteManifestBase {
  readonly displayName: string;
  readonly description: string;
  /** Sites still in early development stay hidden behind the Sites experimental toggle and disabled by default. */
  readonly experimental?: boolean;
  readonly matches: readonly string[];
  readonly excludeMatches: readonly string[];
  readonly excludeGlobs: readonly string[];
}

export type SiteManifestEntry =
  | (SiteManifestBase & {
      readonly id: PageWorldSiteId;
      /** True when the site installs a companion MAIN-world `PageBridge` script. */
      readonly hasPageWorld: true;
    })
  | (SiteManifestBase & {
      readonly id: Exclude<SiteId, PageWorldSiteId>;
      readonly hasPageWorld?: false;
    });

export const SITE_MANIFEST: readonly SiteManifestEntry[] = [
  {
    id: 'facebook',
    displayName: 'Facebook',
    description:
      'Filters ads and suggested posts, locks your Home feed, stops surprise refreshes, and adds video controls and themes.',
    hasPageWorld: true,
    matches: FACEBOOK_MATCHES,
    excludeMatches: FACEBOOK_EXCLUDE_MATCHES,
    excludeGlobs: FACEBOOK_EXCLUDE_GLOBS,
  },
  {
    id: 'x',
    displayName: 'X (Twitter)',
    description:
      'Drops promoted posts before render, opens to Following, clears Grok and sidebar clutter, and adds custom video speeds and themes.',
    hasPageWorld: true,
    matches: X_MATCHES,
    excludeMatches: X_EXCLUDE_MATCHES,
    excludeGlobs: [],
  },
  {
    id: 'instagram',
    displayName: 'Instagram',
    description:
      'Hides sponsored and suggested posts, defaults to Following, trims sidebar clutter, and adds video saves and themes.',
    experimental: true,
    hasPageWorld: true,
    matches: INSTAGRAM_MATCHES,
    excludeMatches: INSTAGRAM_EXCLUDE_MATCHES,
    excludeGlobs: [],
  },
  {
    id: 'reddit',
    displayName: 'Reddit',
    description:
      'Filters promoted and recommended posts, clears sidebars and app promos, and adds video controls and full theming.',
    experimental: true,
    hasPageWorld: true,
    matches: REDDIT_MATCHES,
    excludeMatches: REDDIT_EXCLUDE_MATCHES,
    excludeGlobs: [],
  },
  {
    id: 'gmail',
    displayName: 'Gmail',
    description:
      'Blocks inbox ad rows, filters noisy threads, hides Gemini and workspace clutter, and themes Gmail including message frames.',
    experimental: true,
    matches: GMAIL_MATCHES,
    excludeMatches: GMAIL_EXCLUDE_MATCHES,
    excludeGlobs: [],
  },
];

export const ALL_SITE_HOST_PERMISSIONS: string[] = /* @__PURE__ */ (() =>
  SITE_MANIFEST.flatMap((site) => [...site.matches]))();

export const ALL_USERSCRIPT_MATCHES: string[] = /* @__PURE__ */ (() => [
  ...ALL_SITE_HOST_PERMISSIONS,
])();

export const ALL_USERSCRIPT_EXCLUDES: string[] = /* @__PURE__ */ (() =>
  SITE_MANIFEST.flatMap((site) => [...site.excludeMatches, ...site.excludeGlobs]))();
