import { describe, expect, it } from 'vitest';
import { isExcludedUrl, matchesGlobPattern, matchesMatchPattern } from '../core/urls';
import { EXCLUDE_GLOBS, EXCLUDE_MATCHES, isExcludedByGlob, isFacebookAddress } from './urls';

describe('isExcludedByGlob', () => {
  it('matches static.<region>.facebook.com pages that Safari cannot exclude in the manifest', () => {
    expect(isExcludedByGlob('https://static.xx.facebook.com/rsrc.php/foo.js')).toBe(true);
    expect(isExcludedByGlob('https://static.ak.facebook.com/connect/xd_arbiter.php')).toBe(true);
    expect(isExcludedByGlob('https://static.a.b.facebook.com/')).toBe(true);
  });

  it('leaves normal Facebook pages alone', () => {
    expect(isExcludedByGlob('https://www.facebook.com/')).toBe(false);
    expect(isExcludedByGlob('https://web.facebook.com/groups/feed/')).toBe(false);
    expect(isExcludedByGlob('https://static.facebook.com/')).toBe(false);
    expect(isExcludedByGlob('https://www.facebook.com/?ref=static.xx.facebook.com')).toBe(false);
  });
});

describe('matchesMatchPattern & isExcludedUrl', () => {
  it('matches WebExtension host and path patterns including subdomains', () => {
    expect(
      matchesMatchPattern(
        'https://edge.channel.facebook.com/pull',
        'https://*.channel.facebook.com/*',
      ),
    ).toBe(true);
    expect(
      matchesMatchPattern('https://channel.facebook.com/pull', 'https://*.channel.facebook.com/*'),
    ).toBe(true);
    expect(
      matchesMatchPattern('https://x.com/i/flow/login?foo=1', 'https://x.com/i/flow/login*'),
    ).toBe(true);
    expect(matchesMatchPattern('https://x.com/home', 'https://x.com/i/flow/login*')).toBe(false);
    expect(matchesGlobPattern('https://a.com/x1', 'https://a.com/x?')).toBe(true);
  });

  it('combines excludeMatches and excludeGlobs for Safari runtime guards', () => {
    expect(isExcludedUrl('https://www.facebook.com/saved/', EXCLUDE_MATCHES, EXCLUDE_GLOBS)).toBe(
      true,
    );
    expect(
      isExcludedUrl('https://static.xx.facebook.com/rsrc.php', EXCLUDE_MATCHES, EXCLUDE_GLOBS),
    ).toBe(true);
    expect(isExcludedUrl('https://www.facebook.com/', EXCLUDE_MATCHES, EXCLUDE_GLOBS)).toBe(false);
  });
});

describe('isFacebookAddress', () => {
  it('accepts https addresses on Facebook and its CDN only', () => {
    expect(isFacebookAddress('https://video.fbcdn.net/v/clip.mp4')).toBe(true);
    expect(isFacebookAddress('https://www.facebook.com/watch')).toBe(true);
    expect(isFacebookAddress('http://video.fbcdn.net/v/clip.mp4')).toBe(false);
    expect(isFacebookAddress('https://evil-facebook.com/clip.mp4')).toBe(false);
    expect(isFacebookAddress('https://user@www.facebook.com/')).toBe(false);
    expect(isFacebookAddress('https://www.facebook.com:8443/')).toBe(false);
  });
});
