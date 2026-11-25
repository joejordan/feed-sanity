// Static site host registry shared by vite.userscript.config.ts, site settings,
// and the Sites options panel. Keep this file free of DOM or browser-API
// imports so Node build configs can import it directly.

import {
  EXCLUDE_GLOBS as FACEBOOK_EXCLUDE_GLOBS,
  EXCLUDE_MATCHES as FACEBOOK_EXCLUDE_MATCHES,
  MATCHES as FACEBOOK_MATCHES,
} from '../facebook/urls.ts';
import { GMAIL_EXCLUDE_MATCHES, GMAIL_MATCHES } from './gmail/urls.ts';
import { INSTAGRAM_EXCLUDE_MATCHES, INSTAGRAM_MATCHES } from './instagram/urls.ts';
import { REDDIT_EXCLUDE_MATCHES, REDDIT_MATCHES } from './reddit/urls.ts';
import { X_EXCLUDE_MATCHES, X_MATCHES } from './x/urls.ts';

export interface SiteManifestEntry {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  /** Sites still in early development stay hidden behind the Sites experimental toggle and disabled by default. */
  readonly experimental?: boolean;
  readonly matches: readonly string[];
  readonly excludeMatches: readonly string[];
  readonly excludeGlobs: readonly string[];
}

export const SITE_MANIFEST: readonly SiteManifestEntry[] = [
  {
    id: 'facebook',
    displayName: 'Facebook',
    description:
      'Filter Sponsored/Suggested posts and custom rules, pick Home feeds, stop auto-refresh, responsive rails, video scrubber/click-to-pause/download, and live Theme Studio.',
    matches: FACEBOOK_MATCHES,
    excludeMatches: FACEBOOK_EXCLUDE_MATCHES,
    excludeGlobs: FACEBOOK_EXCLUDE_GLOBS,
  },
  {
    id: 'instagram',
    displayName: 'Instagram',
    description:
      'Hide Sponsored/Suggested posts and custom rules, default to Following, hide Reels/Explore/Threads links, video scrubber & download, and live Theme Studio.',
    experimental: true,
    matches: INSTAGRAM_MATCHES,
    excludeMatches: INSTAGRAM_EXCLUDE_MATCHES,
    excludeGlobs: [],
  },
  {
    id: 'x',
    displayName: 'X (Twitter)',
    description:
      'Strip Promoted ads before render, filter Suggested/custom rules, default to Following, hide Grok/Premium/clutter, video scrubber & custom speed, and live Theme Studio.',
    matches: X_MATCHES,
    excludeMatches: X_EXCLUDE_MATCHES,
    excludeGlobs: [],
  },
  {
    id: 'gmail',
    displayName: 'Gmail',
    description:
      'Hide Promotions/Social inbox ads and custom thread filter rules, hide side panel/Chat/Meet/Gemini/category tabs, and live iframe-aware Theme Studio.',
    experimental: true,
    matches: GMAIL_MATCHES,
    excludeMatches: GMAIL_EXCLUDE_MATCHES,
    excludeGlobs: [],
  },
  {
    id: 'reddit',
    displayName: 'Reddit',
    description:
      'Hide Promoted/Recommended posts and custom Shadow DOM filter rules, hide sidebar/promo/games clutter, video scrubber & click-to-pause, and live Shadow DOM Theme Studio.',
    experimental: true,
    matches: REDDIT_MATCHES,
    excludeMatches: REDDIT_EXCLUDE_MATCHES,
    excludeGlobs: [],
  },
];

export const ALL_USERSCRIPT_MATCHES: string[] = SITE_MANIFEST.flatMap((site) => [...site.matches]);

export const ALL_USERSCRIPT_EXCLUDES: string[] = SITE_MANIFEST.flatMap((site) => [
  ...site.excludeMatches,
  ...site.excludeGlobs,
]);
