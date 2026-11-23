// Declarative FilterSchema for Gmail inbox threads.

import type { FilterSchema } from '../../ui/filters/schema';
import { newAction, newFilter, newRule } from '../../core/filter-types';
import { HIGHLIGHT_CSS, standardFilterActions } from '../../ui/filters/schema';

export const GMAIL_FILTER_SCHEMA: FilterSchema = {
  siteName: 'Gmail',
  itemSingular: 'thread',
  itemPlural: 'threads',
  targetLabel: 'Part of the thread',
  previewLayout: 'thread',
  selectorTargets: ['any'],
  selectorPlaceholder: 'e.g. [data-unread="true"], .zE',
  targets: [
    {
      value: 'any',
      label: 'Any thread text',
      simpleLabel: 'Anything',
      primary: true,
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
      group: 'Inbox metadata',
      placeholder: 'e.g. Promotions, Updates',
    },
    {
      value: 'sponsored',
      label: 'Inbox ad signal',
      group: 'Inbox metadata',
      placeholder: 'sponsored',
    },
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
          title: 'Hide sender',
          rules: [newRule('sender')],
          actions: [newAction('hide')],
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
          title: 'Highlight important subject',
          rules: [newRule('subject')],
          actions: [{ action: 'css', content: HIGHLIGHT_CSS.gold }],
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
          title: 'Dim newsletters',
          rules: [newRule('any')],
          actions: [{ action: 'css', content: HIGHLIGHT_CSS.dim }],
        }),
    },
    {
      id: 'gmail-allowlist',
      title: 'Always keep a VIP sender visible',
      description: 'Prevent lower hide rules from hiding messages from a key contact.',
      badge: 'Keep',
      tone: 'unhide',
      create: () =>
        newFilter({
          title: 'Keep VIP visible',
          stop_on_match: true,
          rules: [newRule('sender')],
          actions: [newAction('unhide')],
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
