import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Post } from './posts';
import { sleep } from '../core/timing';
import { findPostId } from './post-id';
import { Posts } from './posts';
import { MARK, NO_POST_ID } from './selectors';
import { fakeLocate, postHeader } from './testing';

const timeLink = (href: string) =>
  `<span><a role="link" aria-labelledby="l" aria-describedby="d" href="${href}">3 h</a></span>`;

const message = (text: string) =>
  `<div data-ad-rendering-role="story_message"><div dir="auto">${text}</div></div>`;

/** The inside of a feed post, as the end-to-end feed page draws one. */
const content = (name: string, id?: string) =>
  `<div>${postHeader(name)}${id ? timeLink(`/someone/posts/${id}/`) : ''}${message(`${name} says hello`)}<form><div role="textbox" contenteditable="true"></div></form></div>`;

const slot = (position: number, html = '') => {
  const element = document.createElement('div');
  element.setAttribute('aria-posinset', String(position));
  element.setAttribute('aria-setsize', '-1');
  element.innerHTML = html;
  return element;
};

/** Adds `elements` to a feed in the page. */
const feed = document.createElement('div');
const add = <E extends Element>(element: E): E => {
  feed.append(element);
  return element;
};

describe('Posts', () => {
  let posts: Posts;
  let tracked: Post[];
  let addedPosts: Post[];
  let stops: (() => void)[];

  /** Subscribes to `onTrack` and `onAdd`, which starts detection. */
  const follow = () => {
    stops.push(
      posts.onTrack((post) => tracked.push(post)),
      posts.onAdd((post) => addedPosts.push(post)),
    );
  };

  beforeEach(() => {
    document.body.replaceChildren(feed);
    feed.replaceChildren();
    feed.setAttribute('role', 'feed');
    posts = new Posts(fakeLocate);
    tracked = [];
    addedPosts = [];
    stops = [];
  });

  afterEach(() => {
    for (const stop of stops) {
      stop();
    }
    posts.dispose();
    history.replaceState({}, '', '/');
  });

  it('does nothing until something subscribes', async () => {
    const element = add(slot(1, content('Avery Quill', '100000000000001')));
    await sleep(80);

    expect(element.hasAttribute(MARK.post)).toBe(false);
    expect(posts.stats().started).toBe(false);
  });

  it('tracks the posts on the page and those added later, then gives their IDs', async () => {
    const first = add(slot(1, content('Avery Quill', '100000000000001')));
    follow();

    expect(tracked).toEqual([
      { element: first, content: first, number: 1, id: null, permalink: false },
    ]);
    expect(first.getAttribute(MARK.post)).toBe('1');

    const second = add(slot(2, content('Bram Okafor', '100000000000002')));
    await vi.waitFor(() => expect(tracked).toHaveLength(2));
    expect(tracked[1]).toMatchObject({ element: second, number: 2, id: null });

    await vi.waitFor(() => expect(addedPosts).toHaveLength(2));
    expect(addedPosts.map(({ id }) => id)).toEqual(['100000000000001', '100000000000002']);
    expect(first.getAttribute(MARK.postId)).toBe('100000000000001');
    expect(second.getAttribute(MARK.postId)).toBe('100000000000002');
  });

  it('tracks a post in the same mutation callback, before its ID, so it can be hidden before paint', async () => {
    follow();
    const seen: { marked: boolean; id: string | null; hasId: boolean }[] = [];
    stops.push(
      posts.onTrack((post) =>
        seen.push({
          marked: post.element.hasAttribute(MARK.post),
          id: post.id,
          hasId: post.element.hasAttribute(MARK.postId),
        }),
      ),
    );
    add(slot(1, content('Instant Friend', '100000000000003')));

    // A mutation observer's callback runs as a microtask, before any timer.
    await Promise.resolve();
    expect(seen).toEqual([{ marked: true, id: null, hasId: false }]);
    expect(addedPosts).toEqual([]);
  });

  it(`marks a post with no ID as ${NO_POST_ID}`, async () => {
    const ad = add(slot(1, content('Sourdough School')));
    follow();

    await vi.waitFor(() => expect(addedPosts).toHaveLength(1));
    expect(addedPosts[0]?.id).toBeNull();
    expect(ad.getAttribute(MARK.postId)).toBe(NO_POST_ID);
  });

  it('waits for an empty slot to be filled, and keeps a refilled slot as the same post', async () => {
    const element = add(slot(1));
    const updated: Post[] = [];
    stops.push(posts.onUpdate((post) => updated.push(post)));
    follow();
    expect(tracked).toEqual([]);
    expect(posts.stats().unrecognised).toBe(0);

    element.innerHTML = content('Ines Harrow', '100000000000005');
    await vi.waitFor(() => expect(addedPosts).toHaveLength(1));

    element.replaceChildren();
    await sleep(10);
    element.innerHTML = content('Ines Harrow', '100000000000005');
    await vi.waitFor(() => expect(updated).toHaveLength(1));

    expect(tracked).toHaveLength(1);
    expect(updated[0]?.element).toBe(element);
    expect(posts.stats()).toMatchObject({ tracked: 1, withId: 1 });
  });

  it('identifies a slot emptied before its ID lookup once it is refilled', async () => {
    const element = add(slot(1, content('Ines Harrow', '100000000000005')));
    follow();
    expect(tracked).toHaveLength(1);

    // Emptied before the lookup runs, as Facebook does with a slot that scrolls away.
    element.replaceChildren();
    await sleep(80);
    expect(addedPosts).toEqual([]);
    expect(element.hasAttribute(MARK.postId)).toBe(false);
    expect(posts.stats()).toMatchObject({ tracked: 1, identifying: 1 });

    element.innerHTML = content('Ines Harrow', '100000000000005');
    await vi.waitFor(() => expect(addedPosts).toHaveLength(1));
    expect(addedPosts[0]?.id).toBe('100000000000005');
    expect(element.getAttribute(MARK.postId)).toBe('100000000000005');
    expect(tracked).toHaveLength(1);
    expect(posts.stats()).toMatchObject({ tracked: 1, withId: 1 });
  });

  it('identifies a slot refilled while the lookup of its emptied content is still running', async () => {
    // Reads the post at once and answers a little later, as a slower lookup would.
    posts = new Posts(fakeLocate, async (post, locate) => {
      const id = await findPostId(post, locate);
      await sleep(30);
      return id;
    });
    const element = add(slot(1, content('Ines Harrow', '100000000000005')));
    follow();
    element.replaceChildren();

    // The lookup starts on the empty slot, and the slot is refilled before it answers.
    await sleep(60);
    element.innerHTML = content('Ines Harrow', '100000000000005');
    await vi.waitFor(() => expect(addedPosts).toHaveLength(1));
    expect(addedPosts[0]?.id).toBe('100000000000005');
    expect(element.getAttribute(MARK.postId)).toBe('100000000000005');
  });

  it('reports content added inside a post once per post, without this project’s own elements', async () => {
    const element = add(slot(1, content('Avery Quill', '100000000000001')));
    const updated: Post[] = [];
    stops.push(posts.onUpdate((post) => updated.push(post)));
    follow();
    await vi.waitFor(() => expect(addedPosts).toHaveLength(1));

    const own = document.createElement('div');
    own.setAttribute('data-feed-sanity', '');
    element.append(own);
    own.append(document.createElement('span'));
    element.querySelector('form')?.append(document.createElement('div'));
    await sleep(60);
    expect(updated).toEqual([]);

    element.firstElementChild?.append(document.createElement('span'));
    element.firstElementChild?.append(document.createElement('span'));
    await sleep(60);
    expect(updated).toHaveLength(1);
  });

  it('takes an article outside the feed as a post, but not comments or shared posts in it', async () => {
    const article = document.createElement('div');
    article.setAttribute('role', 'article');
    article.innerHTML = `${content('Avery Quill', '100000000000001')}
      <div role="article">${content('Fennel Farm', '100000000000009')}</div>
      <form><div role="article" aria-label="Comment by Juno Park">${postHeader('Juno Park')}A comment</div></form>`;
    add(article);
    follow();

    expect(tracked.map(({ element }) => element)).toEqual([article]);

    // A comment arriving later is not a post either.
    const comment = document.createElement('div');
    comment.setAttribute('role', 'article');
    comment.innerHTML = `${postHeader('Cleo Marsh')}Another comment`;
    article.querySelector('form')?.append(comment);
    await sleep(10);
    expect(tracked).toHaveLength(1);
  });

  it('leaves out loading placeholders and anything with no header link or time link', async () => {
    add(slot(1, '<div role="progressbar" aria-label="Loading"></div>'));
    const bare = add(slot(2, '<div><span>Text but no header</span></div>'));
    follow();

    expect(tracked).toEqual([]);
    expect(posts.stats().unrecognised).toBe(1);

    const header = document.createElement('div');
    header.innerHTML = postHeader('Late Header');
    bare.firstElementChild?.prepend(...header.childNodes);
    await vi.waitFor(() => expect(tracked).toHaveLength(1));
    expect(tracked[0]?.element).toBe(bare);
  });

  it('tracks the comments popup as a post, with the post inside it as its content', async () => {
    history.replaceState({}, '', '/avery.quill/posts/100000000000001/');
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.innerHTML = `<div><div role="article" id="post">${content('Avery Quill', '100000000000001')}</div>
      <div role="article" aria-label="Comment by Juno Park">${postHeader('Juno Park')}Nice</div></div>`;
    document.body.append(dialog);
    follow();

    const inner = dialog.querySelector('#post');
    expect(tracked).toEqual([
      { element: dialog, content: inner, number: 1, id: null, permalink: false },
    ]);
    expect(dialog.hasAttribute(MARK.popupPost)).toBe(true);
    await vi.waitFor(() => expect(addedPosts).toHaveLength(1));
    expect(addedPosts[0]).toMatchObject({ id: '100000000000001', permalink: true });
  });

  it('says a post is the one the page is about when the address names its ID as a whole', async () => {
    history.replaceState({}, '', '/someone/posts/1000000000000012/');
    add(slot(1, content('Avery Quill', '100000000000001')));
    add(slot(2, content('Bram Okafor', '1000000000000012')));
    follow();

    await vi.waitFor(() => expect(addedPosts).toHaveLength(2));
    expect(addedPosts.map(({ permalink }) => permalink)).toEqual([false, true]);
  });

  it("takes the first post outside the feed on a single post's page as the page's post", async () => {
    history.replaceState({}, '', '/permalink.php?story_fbid=100000000000001&id=100000000000042');
    const article = document.createElement('div');
    article.setAttribute('role', 'article');
    article.innerHTML = content('Avery Quill');
    add(article);
    follow();

    await vi.waitFor(() => expect(addedPosts).toHaveLength(1));
    expect(addedPosts[0]).toMatchObject({ id: '100000000000001', permalink: true });
  });

  it("gives the page's ID to only one post outside the feed without a time link", async () => {
    history.replaceState({}, '', '/permalink.php?story_fbid=100000000000001&id=100000000000042');
    for (const name of ['Avery Quill', 'Bram Okafor']) {
      const article = document.createElement('div');
      article.setAttribute('role', 'article');
      article.innerHTML = content(name);
      add(article);
    }
    follow();

    await vi.waitFor(() => expect(addedPosts).toHaveLength(2));
    expect(addedPosts.map(({ id, permalink }) => [id, permalink])).toEqual([
      ['100000000000001', true],
      [null, false],
    ]);
  });

  it('stops cleanly when a listener told of a post leaving stops detection', async () => {
    const first = add(slot(1, content('Avery Quill', '100000000000001')));
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.innerHTML = `<div role="article" id="old">${content('Bram Okafor', '100000000000002')}</div>`;
    document.body.append(dialog);
    follow();
    await vi.waitFor(() => expect(addedPosts).toHaveLength(2));
    stops.push(
      posts.onUntrack(() => {
        for (const stop of stops.splice(0)) {
          stop();
        }
      }),
    );
    // The popup swaps its post for another while the feed post leaves.
    const next = document.createElement('div');
    next.setAttribute('role', 'article');
    next.innerHTML = content('Juno Park', '100000000000003');
    dialog.querySelector('#old')?.replaceWith(next);
    first.remove();
    await sleep(80);

    expect(posts.stats().started).toBe(false);
    expect(document.querySelectorAll(`[${MARK.post}]`)).toHaveLength(0);
  });

  it('tells when a post leaves the page, but not when it only moves', async () => {
    const first = add(slot(1, content('Avery Quill', '100000000000001')));
    const second = add(slot(2, content('Bram Okafor', '100000000000002')));
    const untracked: Post[] = [];
    const removed: Post[] = [];
    stops.push(
      posts.onUntrack((post) => untracked.push(post)),
      posts.onRemove((post) => removed.push(post)),
    );
    follow();
    await vi.waitFor(() => expect(addedPosts).toHaveLength(2));

    feed.prepend(second);
    await sleep(10);
    expect(untracked).toEqual([]);

    first.remove();
    await vi.waitFor(() => expect(untracked).toHaveLength(1));
    expect(removed).toEqual(untracked);
    expect(untracked[0]).toMatchObject({ element: first, id: '100000000000001' });
    expect(first.hasAttribute(MARK.post)).toBe(false);
    expect(posts.stats().tracked).toBe(1);
  });

  it('tells only onUntrack for a post that leaves before its ID lookup finishes', async () => {
    const lookups: (() => void)[] = [];
    posts = new Posts(
      fakeLocate,
      () =>
        new Promise((resolve) => {
          lookups.push(() => resolve('100000000000001'));
        }),
    );
    const element = add(slot(1, content('Avery Quill')));
    const untracked: Post[] = [];
    const removed: Post[] = [];
    stops.push(
      posts.onUntrack((post) => untracked.push(post)),
      posts.onRemove((post) => removed.push(post)),
    );
    follow();
    await vi.waitFor(() => expect(lookups).toHaveLength(1));
    expect(posts.stats()).toMatchObject({ tracked: 1, identifying: 1, withId: 0, withoutId: 0 });

    element.remove();
    await vi.waitFor(() => expect(untracked).toHaveLength(1));
    lookups[0]?.();
    await sleep(10);

    expect(removed).toEqual([]);
    expect(addedPosts).toEqual([]);
    expect(element.hasAttribute(MARK.postId)).toBe(false);
  });

  it('numbers posts from 1 again after an in-page move once the old posts are gone', async () => {
    add(slot(1, content('Avery Quill', '100000000000001')));
    add(slot(2, content('Bram Okafor', '100000000000002')));
    const resets = vi.fn();
    stops.push(posts.onReset(resets));
    follow();
    expect(tracked.map(({ number }) => number)).toEqual([1, 2]);

    history.pushState({}, '', '/?sk=h_chr');
    feed.replaceChildren(slot(1, content('Elio Brandt', '100000000000007')));
    await vi.waitFor(() => expect(tracked).toHaveLength(3));

    expect(tracked[2]?.number).toBe(1);
    expect(resets).toHaveBeenCalledTimes(1);
    expect(posts.stats().tracked).toBe(1);

    // A subscriber that arrives after a reset is called at once.
    const late = vi.fn();
    stops.push(posts.onReset(late));
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('keeps numbering when a move leaves the old posts in place', async () => {
    add(slot(1, content('Avery Quill', '100000000000001')));
    const resets = vi.fn();
    stops.push(posts.onReset(resets));
    follow();

    history.pushState({}, '', '/avery.quill/posts/100000000000001/');
    add(slot(2, content('Bram Okafor', '100000000000002')));
    await vi.waitFor(() => expect(tracked).toHaveLength(2));

    expect(tracked[1]?.number).toBe(2);
    expect(resets).not.toHaveBeenCalled();
  });

  it('tells a late subscriber about the posts already found', async () => {
    add(slot(1, content('Avery Quill', '100000000000001')));
    follow();
    await vi.waitFor(() => expect(addedPosts).toHaveLength(1));

    const lateTracked: Post[] = [];
    const lateAdded: Post[] = [];
    stops.push(
      posts.onTrack((post) => lateTracked.push(post)),
      posts.onAdd((post) => lateAdded.push(post)),
    );

    expect(lateTracked).toEqual(addedPosts);
    expect(lateAdded).toEqual(addedPosts);
  });

  it('stops and takes its marks off when the last listener goes, and starts again later', async () => {
    const element = add(slot(1, content('Avery Quill', '100000000000001')));
    follow();
    await vi.waitFor(() => expect(addedPosts).toHaveLength(1));

    for (const stop of stops.splice(0)) {
      stop();
    }
    expect(posts.stats().started).toBe(false);
    expect(element.hasAttribute(MARK.post)).toBe(false);
    expect(element.hasAttribute(MARK.postId)).toBe(false);

    add(slot(2, content('Bram Okafor', '100000000000002')));
    await sleep(80);
    expect(tracked).toHaveLength(1);

    follow();
    expect(tracked.slice(1).map(({ number }) => number)).toEqual([1, 2]);
  });

  it('leaves a post another copy of this project marked to that copy', () => {
    const element = add(slot(1, content('Avery Quill', '100000000000001')));
    element.setAttribute(MARK.post, '7');
    follow();

    expect(tracked).toEqual([]);
  });

  it('removes its marks when disposed', async () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.innerHTML = `<div role="article">${content('Avery Quill', '100000000000001')}</div>`;
    document.body.append(dialog);
    follow();
    await vi.waitFor(() => expect(addedPosts).toHaveLength(1));

    posts.dispose();

    expect(
      document.querySelector(`[${MARK.post}],[${MARK.postId}],[${MARK.popupPost}]`),
    ).toBeNull();
  });
});
