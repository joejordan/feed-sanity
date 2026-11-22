import { describe, expect, it } from 'vitest';
import { instagramAccountId, instagramPageType, scrubInstagramPii } from './page';
import { isInstagramMediaAddress } from './urls';

describe('instagram page context and PII scrubbing', () => {
  it('reads ds_user_id from cookies or falls back to anonymous', () => {
    expect(instagramAccountId('csrftoken=abc; ds_user_id=987654321; wd=1280x720')).toBe(
      '987654321',
    );
    expect(instagramAccountId('csrftoken=abc')).toBe('anonymous');
  });

  it('classifies Instagram routes without exposing usernames', () => {
    expect(instagramPageType({ pathname: '/', search: '' })).toBe('home');
    expect(instagramPageType({ pathname: '/', search: '?variant=following' })).toBe('following');
    expect(instagramPageType({ pathname: '/', search: '?variant=favorites' })).toBe('favorites');
    expect(instagramPageType({ pathname: '/reels/abc123/', search: '' })).toBe('reels');
    expect(instagramPageType({ pathname: '/explore/', search: '' })).toBe('explore');
    expect(instagramPageType({ pathname: '/direct/inbox/', search: '' })).toBe('direct');
    expect(instagramPageType({ pathname: '/stories/someuser/123/', search: '' })).toBe('stories');
    expect(instagramPageType({ pathname: '/p/DgA3DrtHI4V/', search: '' })).toBe('post');
    expect(instagramPageType({ pathname: '/private_person/', search: '' })).toBe('profile');
  });

  it('scrubs Instagram URLs, shortcodes, handles, and numeric IDs', () => {
    expect(
      scrubInstagramPii(
        'failed on https://www.instagram.com/p/DgA3DrtHI4V/ for @jane.doe (id 123456789)',
      ),
    ).toBe('failed on <address> for <handle> (id <number>)');
    expect(scrubInstagramPii('could not load /reel/AbC123_xy from www.instagram.com/foo')).toBe(
      'could not load /<shortcode> from <address>',
    );
  });

  it('validates Instagram media CDN addresses strictly', () => {
    expect(isInstagramMediaAddress('https://scontent.cdninstagram.com/v/t50/video.mp4')).toBe(true);
    expect(isInstagramMediaAddress('https://video.fbcdn.net/v/video.mp4')).toBe(true);
    expect(isInstagramMediaAddress('http://scontent.cdninstagram.com/v/video.mp4')).toBe(false);
    expect(isInstagramMediaAddress('https://user:pass@scontent.cdninstagram.com/v.mp4')).toBe(
      false,
    );
    expect(isInstagramMediaAddress('https://evil.example/video.mp4')).toBe(false);
  });
});
