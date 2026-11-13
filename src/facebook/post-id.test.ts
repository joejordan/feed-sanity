import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractPostId, findPostId } from './post-id';

const BASE = 'https://www.facebook.com/';
const PFBID = `pfbid0${'2'.repeat(30)}l`;

describe('extractPostId', () => {
  it.each([
    ['/some.user/posts/1234567890', '1234567890'],
    ['/some.user/posts/1234567890/', '1234567890'],
    ['/some.user/posts/1234567890:12', '1234567890'],
    ['/groups/111111111/posts/2222222222/', '2222222222'],
    ['/groups/111111111/permalink/2222222222/', '2222222222'],
    ['/groups/gardening/?multi_permalinks=2222222222', '2222222222'],
    ['/permalink.php?story_fbid=2222222222&id=333333333', '2222222222'],
    ['/photo/?fbid=123456789&set=a.987654321', '123456789'],
    ['/media/set/?set=a.987654321', '987654321'],
    ['/watch/?v=123456789', '123456789'],
    ['/marketplace/item/123456789/', '123456789'],
    ['/events/123456789012/', '123456789012'],
    ['/photo.php?set=pcb.123456789', '123456789'],
    [`/some.user/posts/${PFBID}`, PFBID],
    [`/story.php?comment_id=${btoa('comment:1234567890_987654321')}`, '1234567890'],
  ])('reads %s as %s', (address, id) => {
    expect(extractPostId(address, BASE)).toBe(id);
  });

  it.each([
    '/',
    '#',
    '/some.user',
    '/some.user/posts/12345',
    '/groups/111111111/',
    '/profile.php?id=100000123456',
    '/groups/gardening/user/123456789/',
    '/donate/123456789/?fundraiser_source=feed',
    'http://[bad',
  ])('finds no ID in %s', (address) => {
    expect(extractPostId(address, BASE)).toBeNull();
  });
});

describe('findPostId', () => {
  const context = { atoms: { translate: (text: string) => text }, marketplace: false };
  let post: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div sfx_post="1"></div>';
    post = document.body.firstElementChild as HTMLElement;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the ID from a link inside the post', async () => {
    post.innerHTML = '<a href="/events/123456789012/">An event</a>';

    await expect(findPostId(post, context)).resolves.toBe('123456789012');
  });

  it('reads a Marketplace listing from its own link', async () => {
    post.innerHTML = '<a role="link" href="/marketplace/item/123456789/">A chair</a>';

    await expect(findPostId(post, { ...context, marketplace: true })).resolves.toBe('123456789');
  });

  it('hovers the time link until it shows the real address', async () => {
    post.innerHTML =
      '<span id="s"><a class="S2F_font_400" role="link" tabindex="0" href="#">2 h</a></span>';
    const timestamp = post.querySelector('a') as HTMLAnchorElement;
    let hovers = 0;
    timestamp.addEventListener('pointerover', (event) => {
      expect((event as PointerEvent).clientX).toBeGreaterThan(0);
      hovers += 1;
      if (hovers === 2) {
        timestamp.setAttribute('href', '/some.user/posts/1234567890');
      }
    });

    const found = findPostId(post, context);
    expect(post.classList.contains('sfx_touch')).toBe(true);
    await vi.advanceTimersByTimeAsync(400);

    await expect(found).resolves.toBe('1234567890');
    expect(hovers).toBe(2);
    expect(post.classList.contains('sfx_touch')).toBe(false);
  });

  it('gives up after a second when the post has no time link', async () => {
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const found = findPostId(post, context);
    let settled = false;
    found.finally(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(900);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(100);

    await expect(found).resolves.toBeNull();
  });

  it('stops hovering once the post has left the page', async () => {
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    post.innerHTML =
      '<span id="s"><a class="S2F_font_400" role="link" tabindex="0" href="#">2 h</a></span>';
    const hover = vi.fn();
    post.querySelector('a')?.addEventListener('pointerover', hover);
    const found = findPostId(post, context);

    post.remove();
    await vi.advanceTimersByTimeAsync(200);

    await expect(found).resolves.toBeNull();
    expect(hover).toHaveBeenCalledTimes(1);
  });
});
