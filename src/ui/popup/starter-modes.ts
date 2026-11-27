import type { Filter } from '../../core/filter-types';
import type { OptionValue } from '../../core/options';
import { newFilter, newRule } from '../../core/filter-types';

export type StarterModeId = 'clean' | 'focus' | 'minimal';

export interface StarterModeSpec {
  readonly id: StarterModeId;
  readonly label: string;
  readonly summary: string;
  readonly patch: Readonly<Record<string, OptionValue>>;
}

export interface QuickToggleSpec {
  readonly key: string;
  readonly label: string;
  readonly defaultValue: boolean;
}

export interface SiteQuickConfig {
  readonly siteId: string;
  readonly launchUrl: string;
  readonly filterSection: string;
  readonly quickMutePlaceholder: string;
  readonly supportsVideoSpeed?: boolean;
  readonly toggles: readonly QuickToggleSpec[];
  /** Default values for every option key referenced by `modes[].patch`. */
  readonly modeDefaults: Readonly<Record<string, OptionValue>>;
  readonly modes: readonly StarterModeSpec[];
}

export const QUICK_THEME_PRESET_IDS = [
  'prism-aurora',
  'pastel-prism',
  'cyber-neon',
  'sunset-vapor',
  'catppuccin-mocha',
  'warm-paper',
  'crimson-velvet',
] as const;

export const SITE_QUICK_CONFIGS: Readonly<Record<string, SiteQuickConfig>> = {
  facebook: {
    siteId: 'facebook',
    launchUrl: 'https://www.facebook.com/',
    filterSection: 'Filtering',
    quickMutePlaceholder: 'Mute a word or phrase…',
    toggles: [
      { key: 'hide_sponsored_posts', label: 'Hide ads', defaultValue: false },
      { key: 'hide_suggested_posts', label: 'Hide suggested posts', defaultValue: true },
      { key: 'stop_feed_refresh', label: 'Stop auto-refresh', defaultValue: true },
      { key: 'read_posts', label: 'Mark posts as read', defaultValue: true },
    ],
    modeDefaults: {
      post_filters: true,
      hide_sponsored_posts: false,
      hide_suggested_posts: true,
      stop_feed_refresh: true,
      home_feed: 'home',
      read_posts: true,
      post_filters_notes: true,
    },
    modes: [
      {
        id: 'clean',
        label: 'Clean',
        summary: 'Hides ads & suggested posts, stops feed refresh',
        patch: {
          post_filters: true,
          hide_sponsored_posts: true,
          hide_suggested_posts: true,
          stop_feed_refresh: true,
        },
      },
      {
        id: 'focus',
        label: 'Focus',
        summary: 'Friends feed + ads & suggestions hidden',
        patch: {
          post_filters: true,
          hide_sponsored_posts: true,
          hide_suggested_posts: true,
          stop_feed_refresh: true,
          home_feed: 'friends',
          read_posts: true,
        },
      },
      {
        id: 'minimal',
        label: 'Minimal',
        summary: 'Most recent feed, silent hiding without notes',
        patch: {
          post_filters: true,
          hide_sponsored_posts: true,
          hide_suggested_posts: true,
          stop_feed_refresh: true,
          home_feed: 'all',
          post_filters_notes: false,
        },
      },
    ],
  },
  x: {
    siteId: 'x',
    launchUrl: 'https://x.com/',
    filterSection: 'Filtering',
    quickMutePlaceholder: 'Mute a word or @handle…',
    supportsVideoSpeed: true,
    toggles: [
      { key: 'x_hide_sponsored', label: 'Hide Promoted posts', defaultValue: true },
      { key: 'x_hide_suggested', label: 'Hide Suggested posts', defaultValue: true },
      { key: 'x_default_following', label: 'Default to Following', defaultValue: false },
      { key: 'x_hide_grok', label: 'Hide Grok & drawer', defaultValue: false },
    ],
    modeDefaults: {
      x_hide_sponsored: true,
      x_hide_suggested: true,
      x_default_following: false,
      x_hide_grok: false,
      x_hide_premium: false,
      x_hide_sidebar: false,
      x_hide_explore: false,
    },
    modes: [
      {
        id: 'clean',
        label: 'Clean',
        summary: 'Hides Promoted & Suggested posts',
        patch: {
          x_hide_sponsored: true,
          x_hide_suggested: true,
          x_hide_grok: false,
          x_hide_sidebar: false,
        },
      },
      {
        id: 'focus',
        label: 'Focus',
        summary: 'Following timeline, hides Grok & Premium',
        patch: {
          x_hide_sponsored: true,
          x_hide_suggested: true,
          x_default_following: true,
          x_hide_grok: true,
          x_hide_premium: true,
          x_hide_sidebar: false,
        },
      },
      {
        id: 'minimal',
        label: 'Minimal',
        summary: 'Distraction-free timeline without sidebar or Explore',
        patch: {
          x_hide_sponsored: true,
          x_hide_suggested: true,
          x_default_following: true,
          x_hide_grok: true,
          x_hide_premium: true,
          x_hide_sidebar: true,
          x_hide_explore: true,
        },
      },
    ],
  },
  instagram: {
    siteId: 'instagram',
    launchUrl: 'https://www.instagram.com/',
    filterSection: 'Filtering',
    quickMutePlaceholder: 'Mute a word or @account…',
    toggles: [
      { key: 'ig_hide_sponsored', label: 'Hide Sponsored posts', defaultValue: true },
      { key: 'ig_hide_suggested', label: 'Hide Suggested posts', defaultValue: true },
      { key: 'ig_default_following', label: 'Default to Following', defaultValue: false },
      { key: 'ig_hide_reels_nav', label: 'Hide Reels link', defaultValue: false },
    ],
    modeDefaults: {
      ig_hide_sponsored: true,
      ig_hide_suggested: true,
      ig_default_following: false,
      ig_hide_reels_nav: false,
      ig_hide_explore_nav: false,
      ig_hide_threads_nav: false,
    },
    modes: [
      {
        id: 'clean',
        label: 'Clean',
        summary: 'Hides Sponsored & Suggested posts',
        patch: {
          ig_hide_sponsored: true,
          ig_hide_suggested: true,
          ig_hide_reels_nav: false,
          ig_hide_explore_nav: false,
        },
      },
      {
        id: 'focus',
        label: 'Focus',
        summary: 'Following feed + hides Threads link',
        patch: {
          ig_hide_sponsored: true,
          ig_hide_suggested: true,
          ig_default_following: true,
          ig_hide_threads_nav: true,
        },
      },
      {
        id: 'minimal',
        label: 'Minimal',
        summary: 'Following feed, hides Reels, Explore & Threads',
        patch: {
          ig_hide_sponsored: true,
          ig_hide_suggested: true,
          ig_default_following: true,
          ig_hide_reels_nav: true,
          ig_hide_explore_nav: true,
          ig_hide_threads_nav: true,
        },
      },
    ],
  },
  reddit: {
    siteId: 'reddit',
    launchUrl: 'https://www.reddit.com/',
    filterSection: 'Filtering',
    quickMutePlaceholder: 'Mute a word or r/subreddit…',
    toggles: [
      { key: 'reddit_hide_sponsored', label: 'Hide Promoted posts', defaultValue: true },
      { key: 'reddit_hide_suggested', label: 'Hide Recommended posts', defaultValue: true },
      { key: 'reddit_hide_sidebar', label: 'Hide right sidebar', defaultValue: false },
      { key: 'reddit_hide_promos', label: 'Hide promo banners', defaultValue: false },
    ],
    modeDefaults: {
      reddit_hide_sponsored: true,
      reddit_hide_suggested: true,
      reddit_hide_promos: false,
      reddit_hide_games: false,
      reddit_hide_recent: false,
      reddit_hide_sidebar: false,
    },
    modes: [
      {
        id: 'clean',
        label: 'Clean',
        summary: 'Hides Promoted, Recommended & promo banners',
        patch: {
          reddit_hide_sponsored: true,
          reddit_hide_suggested: true,
          reddit_hide_promos: true,
          reddit_hide_sidebar: false,
        },
      },
      {
        id: 'focus',
        label: 'Focus',
        summary: 'Also hides Games nav & Recent Posts panel',
        patch: {
          reddit_hide_sponsored: true,
          reddit_hide_suggested: true,
          reddit_hide_promos: true,
          reddit_hide_games: true,
          reddit_hide_recent: true,
        },
      },
      {
        id: 'minimal',
        label: 'Minimal',
        summary: 'Full distraction-free feed without right sidebar',
        patch: {
          reddit_hide_sponsored: true,
          reddit_hide_suggested: true,
          reddit_hide_promos: true,
          reddit_hide_games: true,
          reddit_hide_recent: true,
          reddit_hide_sidebar: true,
        },
      },
    ],
  },
  gmail: {
    siteId: 'gmail',
    launchUrl: 'https://mail.google.com/',
    filterSection: 'Inbox Filtering',
    quickMutePlaceholder: 'Mute a sender or subject…',
    toggles: [
      { key: 'gmail_hide_ads', label: 'Hide inbox ads', defaultValue: true },
      { key: 'gmail_hide_gemini', label: 'Hide Gemini buttons', defaultValue: false },
      { key: 'gmail_hide_side_panel', label: 'Hide side panel', defaultValue: false },
      { key: 'gmail_hide_chat_meet', label: 'Hide Chat & Meet', defaultValue: false },
    ],
    modeDefaults: {
      gmail_hide_ads: true,
      gmail_hide_gemini: false,
      gmail_hide_side_panel: false,
      gmail_hide_chat_meet: false,
      gmail_hide_category_tabs: false,
    },
    modes: [
      {
        id: 'clean',
        label: 'Clean',
        summary: 'Hides Promotions & Social inbox ads',
        patch: {
          gmail_hide_ads: true,
          gmail_hide_gemini: false,
          gmail_hide_side_panel: false,
          gmail_hide_chat_meet: false,
        },
      },
      {
        id: 'focus',
        label: 'Focus',
        summary: 'Hides inbox ads, Gemini & Chat/Meet rail',
        patch: {
          gmail_hide_ads: true,
          gmail_hide_gemini: true,
          gmail_hide_chat_meet: true,
        },
      },
      {
        id: 'minimal',
        label: 'Minimal',
        summary: 'Pure inbox without sidebars, Gemini or tabs',
        patch: {
          gmail_hide_ads: true,
          gmail_hide_gemini: true,
          gmail_hide_chat_meet: true,
          gmail_hide_side_panel: true,
          gmail_hide_category_tabs: true,
        },
      },
    ],
  },
};

export function getSiteQuickConfig(siteId: string): SiteQuickConfig | undefined {
  return SITE_QUICK_CONFIGS[siteId];
}

export function detectActiveMode(
  modes: readonly StarterModeSpec[],
  saved: Readonly<Record<string, OptionValue>>,
  defaults: Readonly<Record<string, OptionValue>>,
): StarterModeId | null {
  const keys = Object.keys(defaults);
  for (let i = modes.length - 1; i >= 0; i--) {
    const mode = modes[i];
    if (!mode) {
      continue;
    }
    const checkKeys = keys.length > 0 ? keys : Object.keys(mode.patch);
    const matches = checkKeys.every((key) => {
      const expected = Object.hasOwn(mode.patch, key) ? mode.patch[key] : defaults[key];
      const actual = saved[key] === undefined ? defaults[key] : saved[key];
      return actual === expected;
    });
    if (matches) {
      return mode.id;
    }
  }
  return null;
}

/**
 * True when the user has explicitly customized settings away from both
 * factory defaults and every Starter Mode preset (so fresh installs on
 * sites where `Clean` differs from defaults still start un-collapsed).
 */
export function isCustomizedSetup(
  modes: readonly StarterModeSpec[],
  saved: Readonly<Record<string, OptionValue>>,
  defaults: Readonly<Record<string, OptionValue>>,
): boolean {
  if (detectActiveMode(modes, saved, defaults) !== null) {
    return false;
  }
  return Object.keys(defaults).some(
    (key) => saved[key] !== undefined && saved[key] !== defaults[key],
  );
}

export interface StarterModeDiff {
  readonly totalChanges: number;
  readonly hiddenChanges: number;
}

/** Counts how many settings applying `mode` would modify (and how many aren't visible toggles). */
export function diffStarterMode(
  mode: StarterModeSpec,
  saved: Readonly<Record<string, OptionValue>>,
  defaults: Readonly<Record<string, OptionValue>>,
  visibleToggleKeys: ReadonlySet<string>,
): StarterModeDiff {
  let totalChanges = 0;
  let hiddenChanges = 0;
  const target: Record<string, OptionValue> = { ...defaults, ...mode.patch };
  for (const [key, expected] of Object.entries(target)) {
    const actual = saved[key] === undefined ? defaults[key] : saved[key];
    if (actual !== expected) {
      totalChanges++;
      if (!visibleToggleKeys.has(key)) {
        hiddenChanges++;
      }
    }
  }
  return { totalChanges, hiddenChanges };
}

const QUICK_MUTE_DOMAIN_OR_URL =
  /^(?:https?:\/\/|www\.)|[a-z0-9-]+\.(?:com|org|net|io|co|gov|edu|app|dev|tv|news)(?:\/|$)/i;

function detectQuickMuteTarget(term: string, siteId: string): string {
  if (term.startsWith('@')) {
    if (siteId === 'gmail') {
      return 'sender';
    }
    if (siteId === 'facebook' || siteId === 'x' || siteId === 'instagram') {
      return 'author';
    }
  }
  if (term.startsWith('#') && (siteId === 'facebook' || siteId === 'x' || siteId === 'instagram')) {
    return 'hashtag';
  }
  if (siteId === 'reddit') {
    if (/^r\/[a-z0-9_]+$/i.test(term)) {
      return 'subreddit';
    }
    if (/^u\/[a-z0-9_-]+$/i.test(term)) {
      return 'author';
    }
  }
  if (QUICK_MUTE_DOMAIN_OR_URL.test(term)) {
    if (siteId === 'facebook' || siteId === 'x') {
      return 'link_url';
    }
    if (siteId === 'reddit') {
      return 'domain';
    }
  }
  return 'any';
}

/**
 * Builds a safe, reversible (`show_note: true`) filter for the Quick Popup's
 * 1-line Quick Mute bar, mirroring `createQuickHideFilter` without pulling full
 * site adapters into `popup.html`. Supports comma-separated phrases plus smart
 * `@account`, `#hashtag`, `r/subreddit`, and URL normalization per site.
 */
export function createQuickMuteFilter(rawTerm: string, siteId: string): Filter | null {
  const rawParts = rawTerm
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const first = rawParts[0];
  if (!first) {
    return null;
  }

  const target = rawParts.length === 1 ? detectQuickMuteTarget(first, siteId) : 'any';

  const normalize = (part: string): string => {
    if (
      target === 'author' &&
      (siteId === 'instagram' || siteId === 'facebook') &&
      part.startsWith('@')
    ) {
      return part.slice(1).trim();
    }
    if (target === 'hashtag' && siteId === 'facebook' && part.startsWith('#')) {
      return part.slice(1).trim();
    }
    if (target === 'domain' && (part.includes('://') || part.includes('/'))) {
      try {
        const parsed = new URL(part.includes('://') ? part : `https://${part}`);
        return parsed.hostname.replace(/^www\./i, '');
      } catch {
        return part;
      }
    }
    return part;
  };

  const terms: string[] = [];
  for (const part of rawParts) {
    const cleaned = normalize(part);
    if (cleaned && !terms.some((existing) => existing.toLowerCase() === cleaned.toLowerCase())) {
      terms.push(cleaned);
    }
  }
  if (terms.length === 0) {
    return null;
  }

  return newFilter({
    title: `Hide "${terms.join(', ')}"`,
    match: 'ANY',
    enabled: true,
    rules: terms.map((text) => {
      const base = newRule(target);
      return { ...base, condition: { ...base.condition, text } };
    }),
    actions: [{ action: 'hide', show_note: true }],
  });
}
