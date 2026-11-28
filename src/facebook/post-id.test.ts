import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addressNames, findPostId, isPostId, postAddress, postIdFromLink } from './post-id';
import { fakeLocate, postHeader } from './testing';

/** A story token of the shape Facebook uses. Invented. */
const TOKEN = 'pfbid02Ab3Cd4Ef5Gh6Jk7Lm8Np9Qr1St2Uv3Wx4Yz5l';

const idOf = (address: string) => postAddress(new URL(address, 'https://www.facebook.com')).id;

describe('isPostId', () => {
  it('takes numeric IDs of six digits or more and story tokens', () => {
    expect(isPostId('100000000000001')).toBe(true);
    expect(isPostId('123456')).toBe(true);
    expect(isPostId(TOKEN)).toBe(true);
  });

  it('refuses everything else', () => {
    for (const value of ['', '0', '12345', '0123456', 'none', 'abc123456', 'pfbid0', `${TOKEN}x`]) {
      expect(isPostId(value), value).toBe(false);
    }
    // Base58 has no 0, O, I or lower-case l.
    expect(isPostId('pfbid02Ab3Cd4Ef5Gh6Jk7Lm8Np9Qr1St2Uv3Wx4Y0zl')).toBe(false);
  });
});

describe('postAddress', () => {
  it('reads every address shape seen on Facebook', () => {
    expect(idOf('/avery.quill/posts/100000000000001/')).toBe('100000000000001');
    expect(idOf(`/avery.quill/posts/${TOKEN}`)).toBe(TOKEN);
    expect(idOf('/groups/knitting.circle/posts/100000000000010/')).toBe('100000000000010');
    expect(idOf('/groups/123456789/permalink/100000000000011/')).toBe('100000000000011');
    expect(idOf('/permalink.php?story_fbid=100000000000012&id=100000000000042')).toBe(
      '100000000000012',
    );
    expect(idOf(`/story.php?story_fbid=${TOKEN}&id=100000000000042`)).toBe(TOKEN);
    expect(idOf('/photo/?fbid=100000000000013&set=a.1')).toBe('100000000000013');
    expect(idOf('/photo.php?fbid=100000000000014')).toBe('100000000000014');
    expect(idOf('/watch/?v=100000000000015')).toBe('100000000000015');
    expect(idOf('/reel/100000000000016')).toBe('100000000000016');
    expect(idOf('/videos/100000000000017/')).toBe('100000000000017');
    expect(idOf('/avery.quill/videos/100000000000018/')).toBe('100000000000018');
    expect(idOf('/marketplace/item/100000000000019/')).toBe('100000000000019');
  });

  it('keeps only the part of a path segment before a colon', () => {
    expect(idOf('/avery.quill/posts/100000000000001:4/')).toBe('100000000000001');
    expect(idOf('/groups/knitting.circle/posts/100000000000010:0')).toBe('100000000000010');
  });

  it("never takes a group's, a profile's or a user's own ID", () => {
    expect(idOf('/groups/123456789012/')).toBeNull();
    expect(idOf('/profile.php?id=100000000000042')).toBeNull();
    expect(idOf('/permalink.php?id=100000000000042')).toBeNull();
    expect(idOf('/100000000000042')).toBeNull();
    expect(idOf('/people/Avery-Quill/100000000000042/')).toBeNull();
  });

  it('tells single posts from pages that only show one', () => {
    const at = (address: string) => postAddress(new URL(address, 'https://www.facebook.com'));

    expect(at('/avery.quill/posts/100000000000001').singlePost).toBe(true);
    expect(at('/avery.quill/posts/not-an-id').singlePost).toBe(true);
    expect(at('/avery.quill/posts/not-an-id').id).toBeNull();
    expect(at('/reel/100000000000016').singlePost).toBe(false);
    expect(at('/').singlePost).toBe(false);
  });
});

describe('postIdFromLink', () => {
  it("reads relative and absolute addresses on Facebook's own site", () => {
    expect(postIdFromLink('/avery.quill/posts/100000000000001/?__cft__[0]=x&__tn__=%2CO')).toBe(
      '100000000000001',
    );
    expect(postIdFromLink('https://web.facebook.com/avery.quill/posts/100000000000001')).toBe(
      '100000000000001',
    );
  });

  it('gives null for placeholders and other sites', () => {
    expect(postIdFromLink(null)).toBeNull();
    expect(postIdFromLink('#')).toBeNull();
    expect(postIdFromLink('https://example.com/avery/posts/100000000000001')).toBeNull();
    expect(postIdFromLink('http://www.facebook.com/avery/posts/100000000000001')).toBeNull();
  });
});

describe('addressNames', () => {
  const address = (text: string) => {
    const { pathname, search } = new URL(text, 'https://www.facebook.com');
    return { pathname, search };
  };

  it('finds the ID as a whole token in the decoded address', () => {
    expect(addressNames('100000000000001', address('/avery/posts/100000000000001/'))).toBe(true);
    expect(
      addressNames('100000000000001', address('/x?next=%2Favery%2Fposts%2F100000000000001')),
    ).toBe(true);
    expect(addressNames(TOKEN, address(`/avery/posts/${TOKEN}`))).toBe(true);
  });

  it('does not find it inside a longer number', () => {
    expect(addressNames('100000000000001', address('/avery/posts/1000000000000012/'))).toBe(false);
    expect(addressNames('100000000000001', address('/avery/posts/9100000000000001/'))).toBe(false);
    expect(addressNames('none', address('/none'))).toBe(false);
  });
});

describe('findPostId', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    history.replaceState({}, '', '/');
  });

  const add = (html: string, slot = true) => {
    const post = document.createElement('div');
    if (slot) {
      post.setAttribute('aria-posinset', '1');
    }
    post.setAttribute('role', 'article');
    post.innerHTML = html;
    document.body.append(post);
    return post;
  };

  const timeLink = (href: string) =>
    `<span id="d1"><a role="link" aria-labelledby="l1" aria-describedby="d1" href="${href}">3 h</a></span>`;

  it("reads the ID from the post's time link", async () => {
    const post = add(
      `${postHeader('Avery Quill')}${timeLink('/avery.quill/posts/100000000000001/')}`,
    );

    expect(await findPostId(post, fakeLocate)).toBe('100000000000001');
  });

  it('skips a time link whose address is still a placeholder', async () => {
    const post = add(
      `${postHeader('Avery Quill')}${timeLink('#')}${timeLink(`/avery.quill/posts/${TOKEN}`)}`,
    );

    expect(await findPostId(post, fakeLocate)).toBe(TOKEN);
  });

  it('gives null for an ad, which has no time link, and ignores links in comments', async () => {
    const post = add(
      `${postHeader('Sourdough School')}<form><div role="article" aria-label="Comment by Juno Park">${timeLink(
        '/sourdough.school/posts/100000000000099/?comment_id=5',
      )}</div></form>`,
    );

    expect(await findPostId(post, fakeLocate)).toBeNull();
  });

  it("falls back to the page's address for a post outside the feed on a single post's page", async () => {
    history.replaceState({}, '', '/avery.quill/posts/100000000000001/');
    const standalone = add(postHeader('Avery Quill'), false);
    const inFeed = add(postHeader('Bram Okafor'));

    expect(await findPostId(standalone, fakeLocate)).toBe('100000000000001');
    expect(await findPostId(inFeed, fakeLocate)).toBeNull();
  });

  it("does not use the page's address anywhere else", async () => {
    history.replaceState({}, '', '/reel/100000000000016');
    const standalone = add(postHeader('Avery Quill'), false);

    expect(await findPostId(standalone, fakeLocate)).toBeNull();
  });
});
