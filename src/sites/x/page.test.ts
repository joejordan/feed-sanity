import { describe, expect, it } from 'vitest';
import { isXDisplaySettingsPath, scrubXPii, xAccountId, xPageType } from './page';
import { isXHost, isXMediaAddress } from './urls';

describe('x page context, URLs, and PII scrubbing', () => {
  it('reads numeric user ID from twid cookie or falls back to anonymous', () => {
    expect(xAccountId('ct0=abc; twid=u%3D123456789; lang=en')).toBe('123456789');
    expect(xAccountId('twid="u=987654321"')).toBe('987654321');
    expect(xAccountId('ct0=abc')).toBe('anonymous');
  });

  it('classifies X routes without exposing personal handles or tweet IDs', () => {
    expect(xPageType({ pathname: '/' })).toBe('home');
    expect(xPageType({ pathname: '/home' })).toBe('home');
    expect(xPageType({ pathname: '/explore/tabs/for-you' })).toBe('explore');
    expect(xPageType({ pathname: '/notifications' })).toBe('notifications');
    expect(xPageType({ pathname: '/i/chat' })).toBe('messages');
    expect(xPageType({ pathname: '/i/grok' })).toBe('grok');
    expect(xPageType({ pathname: '/i/bookmarks' })).toBe('bookmarks');
    expect(xPageType({ pathname: '/search' })).toBe('search');
    expect(xPageType({ pathname: '/settings/display' })).toBe('settings');
    expect(xPageType({ pathname: '/someuser/status/2124521710376423470' })).toBe('status');
    expect(xPageType({ pathname: '/someuser' })).toBe('profile');

    expect(isXDisplaySettingsPath({ pathname: '/settings/display' })).toBe(true);
    expect(isXDisplaySettingsPath({ pathname: '/settings/display/' })).toBe(true);
    expect(isXDisplaySettingsPath({ pathname: '/settings/account' })).toBe(false);
    expect(isXDisplaySettingsPath({ pathname: '/home' })).toBe(false);
  });

  it('scrubs X URLs, status paths, handles, and numeric IDs', () => {
    expect(
      scrubXPii('failed on https://x.com/alice/status/2124521710376423470 for @alice_dev (987654)'),
    ).toBe('failed on <address> for <handle> (<number>)');
    expect(scrubXPii('bad tweet /bob/status/1234567890 on twitter.com/bob')).toBe(
      'bad tweet /<status> on <address>',
    );
    expect(scrubXPii('quoted "@alice", [@x], user=@bob_1, single=@a')).toBe(
      'quoted "<handle>", [<handle>], user=<handle>, single=<handle>',
    );
  });

  it('validates X hosts and media CDN addresses strictly', () => {
    expect(isXHost('x.com')).toBe(true);
    expect(isXHost('www.twitter.com')).toBe(true);
    expect(isXHost('evilx.com')).toBe(false);
    expect(isXMediaAddress('https://video.twimg.com/ext_tw_video/123/vid.mp4')).toBe(true);
    expect(isXMediaAddress('http://video.twimg.com/vid.mp4')).toBe(false);
    expect(isXMediaAddress('https://evil.example/vid.mp4')).toBe(false);
  });
});
