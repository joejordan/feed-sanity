// Declarative FilterSchema for X (Twitter) timeline posts.

import type { FilterSchema } from '../../ui/filters/schema';
import { newAction, newFilter, newRule } from '../../core/filter-types';
import { HIGHLIGHT_CSS, standardFilterActions } from '../../ui/filters/schema';

export const X_FILTER_SCHEMA: FilterSchema = {
  siteName: 'X',
  itemSingular: 'post',
  itemPlural: 'posts',
  targetLabel: 'Part of the post',
  selectorTargets: ['any'],
  selectorPlaceholder: 'e.g. [data-testid="card.wrapper"], video',
  targets: [
    {
      value: 'any',
      label: 'Any post content',
      simpleLabel: 'Anything',
      primary: true,
      group: 'Post content',
      placeholder: 'e.g. giveaway, crypto, spoilers',
    },
    {
      value: 'content',
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
      value: 'hashtag',
      label: 'Hashtag',
      simpleLabel: 'Hashtag',
      primary: true,
      group: 'Media & links',
      placeholder: 'e.g. #ad, #promo',
    },
    {
      value: 'link_url',
      label: 'Link address',
      simpleLabel: 'Link',
      primary: true,
      group: 'Media & links',
      placeholder: 'e.g. youtube.com, substack.com',
    },
    {
      value: 'image',
      label: 'Media alt text',
      group: 'Media & links',
      placeholder: 'Matches attached image descriptions',
    },
    {
      value: 'suggested',
      label: 'Suggested / recommended signal',
      group: 'Feed signals',
      placeholder: 'suggested',
    },
    {
      value: 'sponsored',
      label: 'Promoted / Ad signal',
      group: 'Feed signals',
      placeholder: 'sponsored',
    },
  ],
  actions: standardFilterActions('post'),
  recipes: [
    {
      id: 'x-mute-keyword',
      title: 'Mute posts by keyword',
      description: 'Collapse timeline posts containing a muted phrase or topic.',
      badge: 'Hide',
      tone: 'hide',
      create: () =>
        newFilter({
          title: 'Mute keyword',
          rules: [newRule('content')],
          actions: [{ action: 'hide', show_note: true }],
        }),
    },
    {
      id: 'x-mute-domain',
      title: 'Hide posts linking to a domain',
      description: 'Filter out posts sharing links from specific websites.',
      badge: 'Hide',
      tone: 'hide',
      create: () =>
        newFilter({
          title: 'Hide domain links',
          rules: [newRule('link_url')],
          actions: [newAction('hide')],
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
          title: 'Highlight account',
          rules: [newRule('author')],
          actions: [{ action: 'css', content: HIGHLIGHT_CSS.accent }],
        }),
    },
    {
      id: 'x-allowlist',
      title: 'Always keep an account visible',
      description: 'Allowlist an author so lower mute rules never hide their posts.',
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
    content: 'Shipping v2.0 today with faster builds! #dev',
    author: 'Alex Rivera @alexdev',
    hashtag: '#dev',
    link_url: 'https://example.com/release',
  },
};
