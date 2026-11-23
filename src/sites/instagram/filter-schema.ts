// Declarative FilterSchema for Instagram feed posts.

import type { FilterSchema } from '../../ui/filters/schema';
import { newAction, newFilter, newRule } from '../../core/filter-types';
import { HIGHLIGHT_CSS, standardFilterActions } from '../../ui/filters/schema';

export const INSTAGRAM_FILTER_SCHEMA: FilterSchema = {
  siteName: 'Instagram',
  itemSingular: 'post',
  itemPlural: 'posts',
  targetLabel: 'Part of the post',
  selectorTargets: ['any'],
  selectorPlaceholder: 'e.g. a[href*="/reels/"], video',
  targets: [
    {
      value: 'any',
      label: 'Any post content',
      group: 'Post content',
      placeholder: 'e.g. giveaway, affiliate, spoilers',
    },
    {
      value: 'content',
      label: 'Caption',
      group: 'Post content',
      placeholder: 'Words in the caption text',
    },
    {
      value: 'author',
      label: 'Account',
      group: 'People & sources',
      placeholder: 'e.g. username',
    },
    {
      value: 'hashtag',
      label: 'Hashtag',
      group: 'Media & links',
      placeholder: 'e.g. #sponsored, #giveaway',
    },
    {
      value: 'image',
      label: 'Photo description',
      group: 'Media & links',
      placeholder: 'Matches image alt text',
    },
    {
      value: 'suggested',
      label: 'Suggested post signal',
      group: 'Feed signals',
      placeholder: 'suggested',
    },
    {
      value: 'sponsored',
      label: 'Sponsored ad signal',
      group: 'Feed signals',
      placeholder: 'sponsored',
    },
  ],
  actions: standardFilterActions('post'),
  recipes: [
    {
      id: 'ig-mute-keyword',
      title: 'Hide posts by keyword',
      description: 'Hide posts whose caption or text mentions a muted topic.',
      badge: 'Hide',
      tone: 'hide',
      create: () =>
        newFilter({
          title: 'Hide keyword',
          rules: [newRule('any')],
          actions: [{ action: 'hide', show_note: true }],
        }),
    },
    {
      id: 'ig-mute-hashtag',
      title: 'Hide posts by hashtag',
      description: 'Filter out hashtags like #giveaway or #ad from your feed.',
      badge: 'Hide',
      tone: 'hide',
      create: () =>
        newFilter({
          title: 'Hide hashtag',
          rules: [newRule('hashtag')],
          actions: [newAction('hide')],
        }),
    },
    {
      id: 'ig-highlight-account',
      title: 'Highlight a favorite account',
      description: 'Frame posts from close friends or favorite creators.',
      badge: 'Style',
      tone: 'style',
      create: () =>
        newFilter({
          title: 'Highlight account',
          rules: [newRule('author')],
          actions: [{ action: 'css', content: HIGHLIGHT_CSS.accent }],
        }),
    },
    {
      id: 'ig-allowlist',
      title: 'Always keep an account visible',
      description: 'Ensure posts from a specific account bypass lower hide rules.',
      badge: 'Keep',
      tone: 'unhide',
      create: () =>
        newFilter({
          title: 'Keep account visible',
          stop_on_match: true,
          rules: [newRule('author')],
          actions: [newAction('unhide')],
        }),
    },
  ],
  sampleItem: {
    content: 'Weekend espresso pour #coffee',
    author: 'barista_daily',
    hashtag: '#coffee',
  },
};
