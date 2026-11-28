// Filter editor vocabulary for Instagram feed posts.

import type { FilterSchema } from '../../ui/filters/schema';
import { newAction, newCondition, newFilter } from '../../core/filter-types';
import {
  HIGHLIGHT_CSS,
  standardFilterActions,
  WEEKDAY_TARGET_OPTION,
} from '../../ui/filters/schema';

export const INSTAGRAM_FILTER_SCHEMA: FilterSchema = {
  siteName: 'Instagram',
  itemSingular: 'post',
  itemPlural: 'posts',
  targetLabel: 'Part of the post',
  selectorPlaceholder: 'e.g. a[href*="/reels/"], video',
  targets: [
    {
      value: 'text',
      label: 'Any post content',
      simpleLabel: 'Anything',
      primary: true,
      elementTest: true,
      group: 'Post content',
      placeholder: 'e.g. giveaway, affiliate, spoilers',
    },
    {
      value: 'body',
      label: 'Caption',
      simpleLabel: 'Caption',
      primary: true,
      group: 'Post content',
      placeholder: 'Words in the caption text',
    },
    {
      value: 'author',
      label: 'Account',
      simpleLabel: 'Account',
      primary: true,
      group: 'People & sources',
      placeholder: 'e.g. username',
    },
    {
      value: 'hashtags',
      label: 'Hashtag',
      simpleLabel: 'Hashtag',
      primary: true,
      list: true,
      group: 'Media & links',
      placeholder: 'e.g. sponsored, giveaway (without #)',
    },
    {
      value: 'image_text',
      label: 'Photo description',
      list: true,
      group: 'Media & links',
      placeholder: 'Matches image alt text',
    },
    {
      value: 'suggested',
      label: 'Suggested post signal',
      group: 'Feed signals',
      placeholder: 'e.g. Follow',
    },
    {
      value: 'sponsored',
      label: 'Sponsored ad signal',
      group: 'Feed signals',
      placeholder: 'sponsored',
    },
    WEEKDAY_TARGET_OPTION,
  ],
  actions: standardFilterActions('post'),
  recipes: [
    {
      id: 'ig-mute-keyword',
      title: 'Hide posts by keyword',
      description: 'Hide posts whose caption or text mentions a muted topic.',
      badge: 'Hide',
      tone: 'hide',
      create: () => newFilter({ name: 'Hide keyword', conditions: [newCondition('text')] }),
    },
    {
      id: 'ig-mute-hashtag',
      title: 'Hide posts by hashtag',
      description: 'Filter out hashtags like #giveaway or #ad from your feed.',
      badge: 'Hide',
      tone: 'hide',
      create: () =>
        newFilter({
          name: 'Hide hashtag',
          conditions: [newCondition('hashtags')],
          actions: [{ ...newAction('hide'), note: false }],
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
          name: 'Highlight account',
          conditions: [newCondition('author')],
          actions: [{ ...newAction('style'), css: HIGHLIGHT_CSS.accent }],
        }),
    },
    {
      id: 'ig-allowlist',
      title: 'Always keep an account visible',
      description: 'Make sure posts from one account get past later hide filters.',
      badge: 'Keep',
      tone: 'keep',
      create: () =>
        newFilter({
          name: 'Keep account visible',
          stopAfter: true,
          conditions: [newCondition('author')],
          actions: [newAction('keep')],
        }),
    },
  ],
  sampleItem: {
    body: 'Weekend espresso pour #coffee',
    author: 'barista_daily',
    hashtags: 'coffee',
  },
};
