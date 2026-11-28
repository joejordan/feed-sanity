// Filter editor vocabulary for Reddit (Shreddit) feed posts.

import type { FilterSchema } from '../../ui/filters/schema';
import { newAction, newCondition, newFilter } from '../../core/filter-types';
import {
  HIGHLIGHT_CSS,
  standardFilterActions,
  WEEKDAY_TARGET_OPTION,
} from '../../ui/filters/schema';

export const REDDIT_FILTER_SCHEMA: FilterSchema = {
  siteName: 'Reddit',
  itemSingular: 'post',
  itemPlural: 'posts',
  targetLabel: 'Part of the post',
  selectorPlaceholder: 'e.g. shreddit-player, [slot="post-media-container"]',
  targets: [
    {
      value: 'text',
      label: 'Any post content',
      simpleLabel: 'Anything',
      primary: true,
      elementTest: true,
      group: 'Post content',
      placeholder: 'e.g. spoilers, politics, crypto',
    },
    {
      value: 'subreddit',
      label: 'Subreddit',
      simpleLabel: 'Subreddit',
      primary: true,
      group: 'People & sources',
      placeholder: 'e.g. r/gaming, r/news',
    },
    {
      value: 'author',
      label: 'Author (u/username)',
      simpleLabel: 'Author',
      primary: true,
      group: 'People & sources',
      placeholder: 'e.g. AutoModerator, u/name',
    },
    {
      value: 'title',
      label: 'Post title',
      simpleLabel: 'Title',
      primary: true,
      group: 'Post content',
      placeholder: 'Words inside the post title',
    },
    {
      value: 'domain',
      label: 'Link domain',
      simpleLabel: 'Domain',
      primary: true,
      group: 'Media & links',
      placeholder: 'e.g. youtube.com, x.com',
    },
    {
      value: 'link_urls',
      label: 'Link address',
      list: true,
      group: 'Media & links',
      placeholder: 'e.g. youtube.com/watch',
    },
    {
      value: 'flair',
      label: 'Post flair',
      group: 'Post content',
      placeholder: 'e.g. Meme, Discussion, Spoiler',
    },
    {
      value: 'suggested',
      label: 'Recommended / popular signal',
      group: 'Feed signals',
      placeholder: 'suggested',
    },
    {
      value: 'sponsored',
      label: 'Promoted / Ad signal',
      group: 'Feed signals',
      placeholder: 'sponsored',
    },
    WEEKDAY_TARGET_OPTION,
  ],
  actions: standardFilterActions('post'),
  recipes: [
    {
      id: 'reddit-mute-subreddit',
      title: 'Mute a subreddit',
      description: 'Hide all posts from a specific community in your Home or Popular feed.',
      badge: 'Hide',
      tone: 'hide',
      create: () => newFilter({ name: 'Mute subreddit', conditions: [newCondition('subreddit')] }),
    },
    {
      id: 'reddit-mute-keyword',
      title: 'Hide posts by keyword',
      description: 'Collapse posts whose title or body mentions a muted topic.',
      badge: 'Hide',
      tone: 'hide',
      create: () => newFilter({ name: 'Mute keyword', conditions: [newCondition('text')] }),
    },
    {
      id: 'reddit-highlight-subreddit',
      title: 'Highlight a favorite subreddit',
      description: 'Outline posts from communities you never want to miss.',
      badge: 'Style',
      tone: 'style',
      create: () =>
        newFilter({
          name: 'Highlight subreddit',
          conditions: [newCondition('subreddit')],
          actions: [{ ...newAction('style'), css: HIGHLIGHT_CSS.accent }],
        }),
    },
    {
      id: 'reddit-allowlist-subreddit',
      title: 'Always keep a subreddit visible',
      description: 'Allowlist a subreddit so later mute filters never hide its posts.',
      badge: 'Keep',
      tone: 'keep',
      create: () =>
        newFilter({
          name: 'Keep subreddit visible',
          stopAfter: true,
          conditions: [newCondition('subreddit')],
          actions: [newAction('keep')],
        }),
    },
  ],
  sampleItem: {
    title: 'Show HN: Building a shadow-piercing DOM engine in TypeScript',
    subreddit: 'r/programming',
    author: 'u/devbuilder',
    domain: 'github.com',
    flair: 'Project',
  },
};
