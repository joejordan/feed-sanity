// Filter editor vocabulary for Facebook posts: the post parts a condition can
// test (see `src/facebook/post-fields.ts`), the actions, starter recipes and
// sample values for the tester.

import type { FilterActionOption, FilterSchema } from '../../ui/filters/schema';
import { newAction, newCondition, newFilter } from '../../core/filter-types';
import {
  AGE_TARGET_OPTION,
  HIGHLIGHT_CSS,
  standardFilterActions,
  WEEKDAY_TARGET_OPTION,
} from '../../ui/filters/schema';

const TEXT = 'Text';
const PEOPLE = 'People and places';
const LINKS = 'Links and media';
const SIGNALS = 'Signals';

/** Facebook keeps a read history, so filters can mark posts read or unread. */
const READ_STATE_ACTIONS: readonly FilterActionOption[] = [
  {
    value: 'set_read',
    label: 'Mark as read',
    group: 'Read state',
    badge: 'Read',
    tone: 'read',
    hint: 'Marks the post as read.',
  },
  {
    value: 'set_unread',
    label: 'Mark as unread',
    group: 'Read state',
    badge: 'Unread',
    tone: 'read',
    hint: 'Marks the post as unread.',
  },
];

export const FACEBOOK_FILTER_SCHEMA: FilterSchema = {
  siteName: 'Facebook',
  itemSingular: 'post',
  itemPlural: 'posts',
  targetLabel: 'Part of the post',
  selectorPlaceholder: 'e.g. video, a[href*="youtube.com"]',
  targets: [
    {
      value: 'text',
      label: 'Anything in the post',
      simpleLabel: 'Anything',
      primary: true,
      elementTest: true,
      group: TEXT,
      placeholder: 'e.g. giveaway, spoilers, election',
    },
    {
      value: 'text_with_images',
      label: 'Post text and image descriptions',
      group: TEXT,
      placeholder: 'Words in the post or in what its pictures show',
    },
    {
      value: 'body',
      label: "The author's message",
      group: TEXT,
      placeholder: 'Words in the message itself',
    },
    {
      value: 'header',
      label: 'Header line (who posted what)',
      group: TEXT,
      placeholder: 'e.g. shared a memory, is with',
    },
    {
      value: 'author',
      label: 'Author',
      simpleLabel: 'Author',
      primary: true,
      group: PEOPLE,
      placeholder: 'e.g. a friend, page or group member',
    },
    {
      value: 'group',
      label: 'Group',
      simpleLabel: 'Group',
      primary: true,
      group: PEOPLE,
      placeholder: 'e.g. the name of a group',
    },
    {
      value: 'hashtags',
      label: 'Hashtag',
      simpleLabel: 'Hashtag',
      primary: true,
      list: true,
      group: LINKS,
      placeholder: 'e.g. ad, giveaway (without #)',
    },
    {
      value: 'link_urls',
      label: 'Link address',
      list: true,
      group: LINKS,
      placeholder: 'e.g. youtube.com, tiktok.com',
    },
    {
      value: 'link_texts',
      label: 'Link text',
      list: true,
      group: LINKS,
      placeholder: 'Words shown on a shared link',
    },
    {
      value: 'image_text',
      label: 'Image description',
      list: true,
      group: LINKS,
      placeholder: 'e.g. may be an image of text',
    },
    {
      value: 'suggested',
      label: 'Suggested to you (Follow or Join button)',
      group: SIGNALS,
      placeholder: 'e.g. Follow, Join',
    },
    {
      value: 'sponsored',
      label: 'Sponsored (an ad)',
      group: SIGNALS,
      placeholder: 'sponsored',
    },
    WEEKDAY_TARGET_OPTION,
    AGE_TARGET_OPTION,
  ],
  actions: [...standardFilterActions('post'), ...READ_STATE_ACTIONS],
  recipes: [
    {
      id: 'fb-hide-word',
      title: 'Hide posts that mention a word',
      description: 'Collapse posts about a topic you are tired of, with a note to peek.',
      badge: 'Hide',
      tone: 'hide',
      create: () => newFilter({ name: 'Hide a topic', conditions: [newCondition('text')] }),
    },
    {
      id: 'fb-highlight-friend',
      title: "Highlight a friend's posts",
      description: 'Give posts by someone you never want to miss a coloured accent.',
      badge: 'Style',
      tone: 'style',
      create: () =>
        newFilter({
          name: 'Highlight a friend',
          conditions: [newCondition('author')],
          actions: [{ ...newAction('style'), css: HIGHLIGHT_CSS.gold }],
        }),
    },
    {
      id: 'fb-keep-group',
      title: 'Always show posts from a group',
      description: 'Keep one group visible, whatever the filters below it say.',
      badge: 'Keep',
      tone: 'keep',
      create: () =>
        newFilter({
          name: 'Keep a group visible',
          stopAfter: true,
          conditions: [newCondition('group')],
          actions: [newAction('keep')],
        }),
    },
    {
      id: 'fb-read-keyword',
      title: 'Mark posts read by keyword',
      description: 'Treat posts that mention a word as already read.',
      badge: 'Read',
      tone: 'read',
      create: () =>
        newFilter({
          name: 'Mark read by keyword',
          conditions: [newCondition('text')],
          actions: [newAction('set_read')],
        }),
    },
  ],
  sampleItem: {
    author: 'Jamie Chen',
    group: 'Neighbourhood Cat Club',
    body: 'Our cat learned to open the fridge today. Send help! #cats',
    hashtags: 'cats',
    link_urls: 'https://example.com/cat-proof-fridge',
    image_text: 'May be an image of a cat and a fridge',
  },
};
