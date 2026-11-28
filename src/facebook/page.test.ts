import { afterEach, describe, expect, it } from 'vitest';
import { mayBeName, pageContext } from './page';

const at = (address: string) => {
  const { hostname, pathname, search } = new URL(address, 'https://www.facebook.com');
  return pageContext({ hostname, pathname, search });
};

const typeAt = (address: string) => at(address).type;

describe('pageContext', () => {
  afterEach(() => {
    history.replaceState({}, '', '/');
  });

  it('reads the news feed, the Feeds pages and home.php as the news feed', () => {
    for (const address of [
      '/',
      '/home.php',
      '/?sk=h_chr',
      '/?sk=h_nor',
      '/?filter=friends&sk=h_chr',
      '/?filter=all&sk=h_chr',
    ]) {
      expect(at(address), address).toEqual({
        type: 'newsfeed',
        singlePost: false,
        permalink: false,
      });
    }
  });

  it('reads everything under /groups/ as groups', () => {
    expect(typeAt('/groups/feed/')).toBe('groups');
    expect(typeAt('/groups/knitting.circle/')).toBe('groups');
    expect(at('/groups/knitting.circle/posts/100000000000010/')).toEqual({
      type: 'groups',
      singlePost: true,
      permalink: true,
    });
    expect(at('/groups/123456789/permalink/100000000000011/').singlePost).toBe(true);
    expect(at('/groups/knitting.circle/members/').singlePost).toBe(false);
  });

  it("reads a person's or page's timeline as a profile, and its post pages as a post", () => {
    expect(typeAt('/avery.quill')).toBe('profile');
    expect(typeAt('/avery.quill/photos')).toBe('profile');
    expect(typeAt('/profile.php?id=100000000000042')).toBe('profile');
    expect(at('/profile.php?id=100000000000042').singlePost).toBe(false);
    expect(at('/avery.quill/posts/100000000000001/')).toEqual({
      type: 'post',
      singlePost: true,
      permalink: true,
    });
    expect(at('/avery.quill/posts/pfbid02Ab3Cd4Ef5Gh6Jk7Lm8Np9Qr1St2Uv3Wx4Yz5l').singlePost).toBe(
      true,
    );
  });

  it('reads permalink.php and story.php as single posts', () => {
    expect(at('/permalink.php?story_fbid=100000000000001&id=100000000000042')).toEqual({
      type: 'post',
      singlePost: true,
      permalink: true,
    });
    expect(at('/story.php?story_fbid=100000000000001&id=7').singlePost).toBe(true);
  });

  it('reads stories, reels and the fixed sections', () => {
    expect(typeAt('/stories/')).toBe('stories');
    expect(typeAt('/stories/100000000000077/UzpfSTE/')).toBe('stories');
    expect(typeAt('/reel/1234567890')).toBe('reel');
    expect(typeAt('/reels/')).toBe('reels');
    expect(typeAt('/marketplace/')).toBe('marketplace');
    expect(typeAt('/marketplace/item/1234567890/')).toBe('marketplace');
    expect(typeAt('/watch/?v=1234567890')).toBe('watch');
    expect(typeAt('/photo/?fbid=1234567890')).toBe('photo');
    expect(typeAt('/photo.php?fbid=1234567890')).toBe('photo');
    expect(typeAt('/events/1234567890/')).toBe('events');
    expect(typeAt('/search/top/?q=bread')).toBe('search');
    expect(typeAt('/saved/')).toBe('saved');
  });

  it('marks addresses that focus one post as permalinks without making them single posts', () => {
    for (const address of [
      '/reel/1234567890',
      '/watch/?v=1234567890',
      '/photo/?fbid=1234567890',
      '/marketplace/item/1234567890/',
      '/avery.quill/videos/1234567890/',
    ]) {
      expect(at(address), address).toMatchObject({ singlePost: false, permalink: true });
    }
    expect(at('/watch/').permalink).toBe(false);
  });

  it('reads the current page by default', () => {
    history.replaceState({}, '', '/groups/feed/');

    expect(pageContext().type).toBe('groups');
  });

  it('gives only types that cannot be a name', () => {
    for (const address of [
      '/',
      '/groups/feed/',
      '/someone',
      '/someone/posts/1234567890',
      '/stories/',
      '/reel/1234567890',
      '/reels/',
      '/gaming/',
      '/friends/',
      '/videos/1234567890',
    ]) {
      expect(mayBeName(typeAt(address)), address).toBe(false);
    }
  });
});

describe('mayBeName', () => {
  it('is true for anything that is not a fixed page type', () => {
    expect(mayBeName('zuck')).toBe(true);
    expect(mayBeName('jane.doe.42')).toBe(true);
    expect(mayBeName('marketplace')).toBe(false);
    expect(mayBeName('profile')).toBe(false);
  });
});
