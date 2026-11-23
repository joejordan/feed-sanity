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
  readonly matches: readonly string[];
  readonly excludeMatches: readonly string[];
  readonly excludeGlobs: readonly string[];
}

export const SITE_MANIFEST: readonly SiteManifestEntry[] = [
  {
    id: 'facebook',
    displayName: 'Facebook',
    description:
      'News Feed filters, Home feeds, responsive rails, video scrubber, click-to-pause, download, and theming.',
    matches: FACEBOOK_MATCHES,
    excludeMatches: FACEBOOK_EXCLUDE_MATCHES,
    excludeGlobs: FACEBOOK_EXCLUDE_GLOBS,
  },
  {
    id: 'instagram',
    displayName: 'Instagram',
    description:
      'Hide Sponsored ads and Suggested posts, default to the Following feed, hide Reels/Explore/Threads links, video scrubber, theming, and External CSS.',
    matches: INSTAGRAM_MATCHES,
    excludeMatches: INSTAGRAM_EXCLUDE_MATCHES,
    excludeGlobs: [],
  },
  {
    id: 'x',
    displayName: 'X (Twitter)',
    description:
      'Strip Promoted ads before timeline render, hide Suggested/keyword posts, default to Following tab, hide Grok/Premium/Sidebar clutter, video scrubber, theming, and External CSS.',
    matches: X_MATCHES,
    excludeMatches: X_EXCLUDE_MATCHES,
    excludeGlobs: [],
  },
  {
    id: 'gmail',
    displayName: 'Gmail',
    description:
      'Hide Promotions/Social inbox ads and keyword-matched threads, hide Workspace side panel/Chat/Meet/Gemini clutter, live iframe-aware theming, and External CSS.',
    matches: GMAIL_MATCHES,
    excludeMatches: GMAIL_EXCLUDE_MATCHES,
    excludeGlobs: [],
  },
  {
    id: 'reddit',
    displayName: 'Reddit',
    description:
      'Hide Promoted ads, Recommended posts, and custom Shadow DOM filter rules, hide sidebar/promo clutter, video scrubber and click-to-pause, live Shadow DOM theming, and External CSS.',
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
