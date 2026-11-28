import type { FeatureOptions, OptionSpecs } from '../../core/options';

const SECTION = 'Filtering';
const SHIELDS = 'Quick Shields';
const KEYWORDS = 'Bulk Keyword Blocklist';
const SCOPE = 'Filter Scope';

/** Post filters' options, in the order the options dialog lists them. */
export const POST_FILTER_OPTIONS = {
  post_filters: {
    section: SECTION,
    group: SHIELDS,
    title: 'Filter posts',
    description:
      'Run the switches below, your keyword list and your own filters on Facebook. Turn this off to see every post as Facebook sends it.',
    keywords: ['filters', 'hide posts', 'rules'],
    default: true,
  },
  hide_suggested_posts: {
    section: SECTION,
    group: SHIELDS,
    dependsOn: 'post_filters',
    title: 'Hide suggested posts',
    description:
      'Hide the posts Facebook recommends from pages and groups you do not follow, the ones with a Follow or Join button.',
    keywords: ['recommended', 'follow', 'join'],
    default: true,
  },
  hide_sponsored_posts: {
    section: SECTION,
    group: SHIELDS,
    dependsOn: 'post_filters',
    title: 'Hide ads',
    description: 'Hide sponsored posts in the feed and the Sponsored cards in the Home right rail.',
    keywords: ['sponsored', 'advert', 'promoted'],
    default: false,
  },
  post_filters_notes: {
    section: SECTION,
    group: SHIELDS,
    dependsOn: 'post_filters',
    title: 'Leave a note where a post was hidden',
    description:
      'Show a one-line note in place of each hidden post. Click it to see the post. Turn this off to hide posts without a trace.',
    keywords: ['placeholder', 'message', 'reveal'],
    default: true,
  },
  post_filters_prevent_flash: {
    section: SECTION,
    group: SHIELDS,
    dependsOn: 'post_filters',
    title: 'Check new posts before they appear',
    description:
      'Keep new feed posts invisible for a moment until the filters have looked at them, so hidden posts never flash on screen.',
    keywords: ['flicker', 'flash'],
    default: true,
  },
  hidden_keywords: {
    section: SECTION,
    group: KEYWORDS,
    advanced: true,
    dependsOn: 'post_filters',
    title: 'Hide posts that mention',
    description: 'One word or phrase per line. Posts that mention any of them are hidden.',
    keywords: ['mute', 'block', 'words', 'blocklist'],
    multiline: true,
    default: '',
  },
  hidden_keywords_show_match: {
    section: SECTION,
    group: KEYWORDS,
    advanced: true,
    dependsOn: 'post_filters_notes',
    title: 'Name the word in the note',
    description: 'The note says which word or phrase from your list the post mentioned.',
    default: true,
  },
  hidden_keywords_partial: {
    section: SECTION,
    group: KEYWORDS,
    advanced: true,
    dependsOn: 'post_filters',
    title: 'Match inside longer words',
    description: 'When off, a word only matches on its own, so "cat" does not hide "category".',
    default: true,
  },
  hidden_keywords_match_case: {
    section: SECTION,
    group: KEYWORDS,
    advanced: true,
    dependsOn: 'post_filters',
    title: 'Match upper and lower case exactly',
    description: 'When on, "Apple" in your list does not hide a post that says "apple".',
    default: false,
  },
  hidden_keywords_in_captions: {
    section: SECTION,
    group: KEYWORDS,
    advanced: true,
    dependsOn: 'post_filters',
    title: 'Also check image descriptions',
    description: 'Look for the words in the descriptions of the pictures in a post too.',
    default: true,
  },
  post_filters_on_profiles: {
    section: SECTION,
    group: SCOPE,
    advanced: true,
    dependsOn: 'post_filters',
    title: 'Filter on timelines',
    description: "Also filter the posts on people's and pages' timelines.",
    keywords: ['profile', 'page', 'timeline'],
    default: false,
  },
  post_filters_in_groups: {
    section: SECTION,
    group: SCOPE,
    advanced: true,
    dependsOn: 'post_filters',
    title: 'Filter inside groups',
    description: 'Also filter the posts on group pages and in the groups feed.',
    keywords: ['group'],
    default: false,
  },
} satisfies OptionSpecs;

export type PostFilterOptions = typeof POST_FILTER_OPTIONS;

/** The options as the feature uses them. */
export interface FilterSettings {
  readonly enabled: boolean;
  readonly suggested: boolean;
  readonly sponsored: boolean;
  readonly notes: boolean;
  readonly preventFlash: boolean;
  readonly keywords: string;
  readonly showMatch: boolean;
  readonly partial: boolean;
  readonly matchCase: boolean;
  readonly captions: boolean;
  readonly onProfiles: boolean;
  readonly inGroups: boolean;
}

export function readSettings(options: FeatureOptions<PostFilterOptions>): FilterSettings {
  return {
    enabled: options.get('post_filters'),
    suggested: options.get('hide_suggested_posts'),
    sponsored: options.get('hide_sponsored_posts'),
    notes: options.get('post_filters_notes'),
    preventFlash: options.get('post_filters_prevent_flash'),
    keywords: options.get('hidden_keywords'),
    showMatch: options.get('hidden_keywords_show_match'),
    partial: options.get('hidden_keywords_partial'),
    matchCase: options.get('hidden_keywords_match_case'),
    captions: options.get('hidden_keywords_in_captions'),
    onProfiles: options.get('post_filters_on_profiles'),
    inGroups: options.get('post_filters_in_groups'),
  };
}

/** True when filtering runs on pages of `type` (a `pageContext().type`). */
export function filtersPageType(settings: FilterSettings, type: string): boolean {
  if (type === 'profile') {
    return settings.onProfiles;
  }
  if (type === 'groups') {
    return settings.inGroups;
  }
  return true;
}
