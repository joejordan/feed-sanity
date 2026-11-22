import { describe, expect, it } from 'vitest';
import { gmailAccountId, gmailPageType, scrubGmailPii } from './page';
import { isGmailHost } from './urls';

describe('gmail page context, URLs, and PII scrubbing', () => {
  it('reads numeric account slot from /mail/u/<n>/ without exposing email addresses', () => {
    expect(gmailAccountId('/mail/u/0/')).toBe('u0');
    expect(gmailAccountId('/mail/u/2')).toBe('u2');
    expect(gmailAccountId('/other')).toBe('anonymous');
  });

  it('classifies Gmail hash routes without exposing label names, search queries, or thread IDs', () => {
    expect(gmailPageType({ pathname: '/mail/u/0/', hash: '' })).toBe('inbox');
    expect(gmailPageType({ pathname: '/mail/u/0/', hash: '#inbox' })).toBe('inbox');
    expect(gmailPageType({ pathname: '/mail/u/0/', hash: '#inbox/FMfcgzQXJKabc123' })).toBe(
      'thread',
    );
    expect(gmailPageType({ pathname: '/mail/u/0/', hash: '#starred' })).toBe('starred');
    expect(gmailPageType({ pathname: '/mail/u/0/', hash: '#sent' })).toBe('sent');
    expect(gmailPageType({ pathname: '/mail/u/0/', hash: '#category/promotions' })).toBe(
      'category',
    );
    expect(
      gmailPageType({ pathname: '/mail/u/0/', hash: '#category/promotions/FMfcgzQXJKabc123' }),
    ).toBe('thread');
    expect(gmailPageType({ pathname: '/mail/u/0/', hash: '#label/Private+Taxes' })).toBe('label');
    expect(gmailPageType({ pathname: '/mail/u/0/', hash: '#search/secret+query' })).toBe('search');
    expect(
      gmailPageType({ pathname: '/mail/u/0/', hash: '#advanced-search/subset=all&has=secret' }),
    ).toBe('search');
    expect(gmailPageType({ pathname: '/mail/u/0/', hash: '#settings/general' })).toBe('settings');
  });

  it('scrubs Gmail URLs, thread/message tokens, label/search hashes, emails, and numbers', () => {
    expect(
      scrubGmailPii(
        'failed on https://mail.google.com/mail/u/0/#inbox/FMfcgzQXJK12345678 for alice@example.com (#label/Taxes, thread-f:123456789)',
      ),
    ).toBe('failed on <address> for <email> (#<redacted>, <thread>)');
    expect(
      scrubGmailPii(
        'token FMfcgzQXJK99887766 msg-a:r123456 in #search/confidential and #advanced-search/has=private and #/label/Personal and #inbox/KtbxL12345678 id 987654321',
      ),
    ).toBe(
      'token <thread> <thread> in #<redacted> and #<redacted> and #<redacted> and #<redacted> id <number>',
    );
  });

  it('matches only mail.google.com', () => {
    expect(isGmailHost('mail.google.com')).toBe(true);
    expect(isGmailHost('evilmail.google.com')).toBe(false);
    expect(isGmailHost('gmail.com')).toBe(false);
  });
});
