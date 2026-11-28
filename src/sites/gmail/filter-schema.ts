// Filter editor vocabulary for Gmail inbox threads.

import type { FilterSchema } from '../../ui/filters/schema';
import { newAction, newCondition, newFilter } from '../../core/filter-types';
import {
  HIGHLIGHT_CSS,
  standardFilterActions,
  WEEKDAY_TARGET_OPTION,
} from '../../ui/filters/schema';

export const GMAIL_FILTER_SCHEMA: FilterSchema = {
  siteName: 'Gmail',
  itemSingular: 'thread',
  itemPlural: 'threads',
  targetLabel: 'Part of the thread',
  previewLayout: 'thread',
  selectorPlaceholder: 'e.g. [data-unread="true"], .zE',
  targets: [
    {
      value: 'text',
      label: 'Any thread text',
      simpleLabel: 'Anything',
      primary: true,
      elementTest: true,
      group: 'Message content',
      placeholder: 'Matches sender, subject, or snippet',
    },
    {
      value: 'sender',
      label: 'Sender name or email',
      simpleLabel: 'Sender',
      primary: true,
      group: 'Message content',
      placeholder: 'e.g. newsletter@, noreply@',
    },
    {
      value: 'subject',
      label: 'Subject',
      simpleLabel: 'Subject',
      primary: true,
      group: 'Message content',
      placeholder: 'e.g. Weekly digest, Receipt',
    },
    {
      value: 'snippet',
      label: 'Preview snippet',
      group: 'Message content',
      placeholder: 'Words in the preview line',
    },
    {
      value: 'label',
      label: 'Label',
      simpleLabel: 'Label',
      primary: true,
      list: true,
      group: 'Inbox metadata',
      placeholder: 'e.g. Promotions, Updates',
    },
    {
      value: 'sponsored',
      label: 'Inbox ad signal',
      group: 'Inbox metadata',
      placeholder: 'sponsored',
    },
    WEEKDAY_TARGET_OPTION,
  ],
  actions: standardFilterActions('thread'),
  recipes: [
    {
      id: 'gmail-hide-sender',
      title: 'Hide threads from a sender',
      description: 'Declutter your inbox view by hiding noisy automated senders.',
      badge: 'Hide',
      tone: 'hide',
      create: () =>
        newFilter({
          name: 'Hide sender',
          conditions: [newCondition('sender')],
          actions: [{ ...newAction('hide'), note: false }],
        }),
    },
    {
      id: 'gmail-highlight-urgent',
      title: 'Highlight urgent subjects',
      description: 'Add a warm highlight to invoices, flight alerts, or urgent subjects.',
      badge: 'Style',
      tone: 'style',
      create: () =>
        newFilter({
          name: 'Highlight important subject',
          conditions: [newCondition('subject')],
          actions: [{ ...newAction('style'), css: HIGHLIGHT_CSS.gold }],
        }),
    },
    {
      id: 'gmail-dim-newsletters',
      title: 'Dim newsletter digests',
      description: 'Keep digests visible at reduced opacity so real messages stand out.',
      badge: 'Style',
      tone: 'style',
      create: () =>
        newFilter({
          name: 'Dim newsletters',
          conditions: [newCondition('text')],
          actions: [{ ...newAction('style'), css: HIGHLIGHT_CSS.dim }],
        }),
    },
    {
      id: 'gmail-allowlist',
      title: 'Always keep a VIP sender visible',
      description: 'Stop later hide filters from hiding messages from a key contact.',
      badge: 'Keep',
      tone: 'keep',
      create: () =>
        newFilter({
          name: 'Keep VIP visible',
          stopAfter: true,
          conditions: [newCondition('sender')],
          actions: [newAction('keep')],
        }),
    },
  ],
  sampleItem: {
    sender: 'Billing Team <billing@example.com>',
    subject: 'Your April invoice is ready',
    snippet: 'Thank you for your payment. Download your PDF receipt.',
    label: 'Finance',
  },
};
