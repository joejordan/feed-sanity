// Filter editor vocabulary for X (Twitter) timeline posts.

import type { FilterSchema } from '../../ui/filters/schema';
import { newAction, newCondition, newFilter } from '../../core/filter-types';
import {
  HIGHLIGHT_CSS,
  standardFilterActions,
  WEEKDAY_TARGET_OPTION,
} from '../../ui/filters/schema';

export const X_FILTER_SCHEMA: FilterSchema = {
  siteName: 'X',
  itemSingular: 'post',
  itemPlural: 'posts',
  targetLabel: 'Part of the post',
  selectorPlaceholder: 'e.g. [data-testid="card.wrapper"], video',
  targets: [
    {
      value: 'text',
      label: 'Any post content',
      simpleLabel: 'Anything',
      primary: true,
      elementTest: true,
      group: 'Post content',
      placeholder: 'e.g. giveaway, crypto, spoilers',
    },
    {
      value: 'body',
      label: 'Post text',
      simpleLabel: 'Post text',
      primary: true,
      group: 'Post content',
      placeholder: 'Words inside the post body',
    },
    {
      value: 'author',
      label: 'Author or @handle',
      simpleLabel: '@Handle',
      primary: true,
      group: 'People & sources',
      placeholder: 'e.g. @handle or display name',
    },
    {
      value: 'hashtags',
      label: 'Hashtag',
      simpleLabel: 'Hashtag',
      primary: true,
      list: true,
      group: 'Media & links',
      placeholder: 'e.g. ad, promo (without #)',
    },
    {
      value: 'link_urls',
      label: 'Link address',
      simpleLabel: 'Link',
      primary: true,
      list: true,
      group: 'Media & links',
      placeholder: 'e.g. youtube.com, substack.com',
    },
    {
      value: 'image_text',
      label: 'Media alt text',
      list: true,
      group: 'Media & links',
      placeholder: 'Matches attached image descriptions',
    },
    {
      value: 'suggested',
      label: 'Suggested / recommended signal',
      group: 'Feed signals',
      placeholder: 'e.g. Follow',
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
      id: 'x-mute-keyword',
      title: 'Mute posts by keyword',
      description: 'Collapse timeline posts containing a muted phrase or topic.',
      badge: 'Hide',
      tone: 'hide',
      create: () => newFilter({ name: 'Mute keyword', conditions: [newCondition('body')] }),
    },
    {
      id: 'x-mute-domain',
      title: 'Hide posts linking to a domain',
      description: 'Filter out posts sharing links from specific websites.',
      badge: 'Hide',
      tone: 'hide',
      create: () =>
        newFilter({
          name: 'Hide domain links',
          conditions: [newCondition('link_urls')],
          actions: [{ ...newAction('hide'), note: false }],
        }),
    },
    {
      id: 'x-highlight-author',
      title: 'Highlight a favorite @handle',
      description: 'Give posts from people you never want to miss a crisp outline.',
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
      id: 'x-allowlist',
      title: 'Always keep an account visible',
      description: 'Allowlist an author so later mute filters never hide their posts.',
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
    body: 'Shipping v2.0 today with faster builds! #dev',
    author: 'Alex Rivera @alexdev',
    hashtags: 'dev',
    link_urls: 'https://example.com/release',
  },
};
