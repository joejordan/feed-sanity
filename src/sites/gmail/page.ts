import { scrubCommonPii } from '../../core/pii';

/**
 * Reads Gmail's multi-account slot index (`u0`, `u1`, ...) from `/mail/u/<n>/`
 * without ever reading or storing the user's email address.
 */
export function gmailAccountId(pathname: string = location.pathname): string {
  const match = /\/mail\/u\/(\d+)(?:\/|$)/i.exec(pathname);
  return match?.[1] ? `u${match[1]}` : 'anonymous';
}

export type GmailPageType =
  | 'all'
  | 'category'
  | 'drafts'
  | 'inbox'
  | 'label'
  | 'other'
  | 'scheduled'
  | 'search'
  | 'sent'
  | 'settings'
  | 'snoozed'
  | 'spam'
  | 'starred'
  | 'thread'
  | 'trash';

const HASH_BUCKETS: Readonly<Record<string, GmailPageType>> = {
  inbox: 'inbox',
  starred: 'starred',
  snoozed: 'snoozed',
  sent: 'sent',
  drafts: 'drafts',
  all: 'all',
  spam: 'spam',
  trash: 'trash',
  scheduled: 'scheduled',
  settings: 'settings',
};

/**
 * Classifies a Gmail hash route without exposing personal label names, search
 * queries, or thread tokens. Safe for Diagnostics bug reports.
 */
export function gmailPageType(loc: Pick<Location, 'hash' | 'pathname'> = location): GmailPageType {
  const raw = loc.hash.replace(/^#\/?/, '').split('?')[0] ?? '';
  if (!raw) {
    return /\/mail\/u\/\d+/i.test(loc.pathname) ? 'inbox' : 'other';
  }
  const parts = raw.split('/').filter(Boolean);
  const first = (parts[0] ?? '').toLowerCase();
  if (first === 'search' || first === 'advanced-search') {
    return parts.length >= 3 ? 'thread' : 'search';
  }
  if (first === 'label') {
    return parts.length >= 3 ? 'thread' : 'label';
  }
  if (first === 'category') {
    return parts.length >= 3 ? 'thread' : 'category';
  }
  if (first === 'settings') {
    return 'settings';
  }
  if (Object.hasOwn(HASH_BUCKETS, first)) {
    return parts.length >= 2 ? 'thread' : HASH_BUCKETS[first]!;
  }
  return 'other';
}

/**
 * Strips Gmail URLs, thread/message tokens (`FMfcg...`, `thread-f:...`,
 * `msg-f:...`), `#label/...`, `#search/...`, and common PII (emails, numbers)
 * from error messages before copying a bug report.
 */
export const scrubGmailPii = (message: string): string =>
  scrubCommonPii(
    message
      .replaceAll(/\S*\bmail\.google\.com\S*/gi, '<address>')
      .replaceAll(/#?(?:thread|msg)-[a-z]+:[A-Za-z0-9_-]+/gi, '<thread>')
      .replaceAll(/\bFMfcg[A-Za-z0-9_-]{8,}\b/g, '<thread>')
      .replaceAll(/#\/?(?:label|search|advanced-search)\/[^\s),;'"\]]+/gi, '#<redacted>')
      .replaceAll(
        /#\/?(?:inbox|starred|snoozed|sent|drafts|all|spam|trash|scheduled|category\/[^/\s]+)\/[A-Za-z0-9_-]{8,}/gi,
        '#<redacted>',
      ),
  );
