import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Locate } from '../core/locator';
import type { AtomTranslator } from './atoms';
import type { Post } from './posts';
import { Locators } from '../core/locator';
import { sleep } from '../core/timing';
import { Posts } from './posts';

const POST_HTML = '<div role="article"><a aria-label="Author"></a>Some text</div>';

function addHtml(html: string, parent: Element = document.body): HTMLElement {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  const element = holder.firstElementChild as HTMLElement;
  parent.append(element);
  return element;
}

describe('posts', () => {
  let translate: (text: string) => string;
  let atomsChanged: () => void;
  let atoms: AtomTranslator;
  let locate: Locate;
  let findId: ReturnType<typeof vi.fn<(post: Element) => Promise<string | null>>>;
  let posts: Posts;
  let added: Post[];

  /** Subscribes and waits until `count` posts have been announced. */
  async function watch(count: number): Promise<void> {
    posts.onAdd((post) => added.push(post));
    await vi.waitFor(() => expect(added).toHaveLength(count));
  }

  beforeEach(() => {
    history.replaceState({}, '', '/');
    document.body.innerHTML = '';
    translate = (text) => text;
    atoms = {
      translate: (text) => translate(text),
      resolve: (selector) => translate(selector),
      onChange: (listener) => {
        atomsChanged = listener;
        return () => true;
      },
      start: () => Promise.resolve(),
    };
    findId = vi.fn(() => Promise.resolve('1234567890'));
    locate = new Locators(atoms).locate;
    posts = new Posts(atoms, locate, findId);
    added = [];
  });

  afterEach(() => {
    posts.stop();
  });

  it('announces the posts already on the page', async () => {
    const first = addHtml(POST_HTML);
    const second = addHtml(POST_HTML);
    second.id = 'kept';
    await watch(2);

    expect(added).toEqual([
      { element: first, content: first, number: 1, id: '1234567890', permalink: false },
      { element: second, content: second, number: 2, id: '1234567890', permalink: false },
    ]);
    expect(first.id).toBe('sfx_post_1');
    expect(first.getAttribute('sfx_post')).toBe('1');
    expect(first.getAttribute('sfx_id')).toBe('1234567890');
    expect(second.id).toBe('kept');
  });

  it('announces posts added later', async () => {
    await watch(0);

    const post = addHtml(POST_HTML);

    await vi.waitFor(() => expect(added).toHaveLength(1));
    expect(added[0]?.element).toBe(post);
  });

  it('marks a post whose ID cannot be found', async () => {
    findId.mockResolvedValue(null);
    const post = addHtml(POST_HTML);
    await watch(1);

    expect(added[0]?.id).toBeNull();
    expect(post.getAttribute('sfx_id')).toBe('no-ID');
  });

  it('tells posts from comments, placeholders and other look-alikes', async () => {
    const post = addHtml(POST_HTML);
    addHtml(POST_HTML, post);
    addHtml('<div role="article"><div role="progressbar"></div></div>');
    addHtml('<div role="article">No author link</div>');
    const positioned = addHtml('<div aria-posinset="3">No author link either</div>');
    await watch(2);

    expect(added.map((found) => found.element)).toEqual([post, positioned]);
  });

  it('ignores content added inside a form', async () => {
    const post = addHtml(`<div role="article"><a aria-label="Author"></a><form></form></div>`);
    await watch(1);

    addHtml('<div aria-posinset="1">A comment</div>', post.querySelector('form') as Element);
    addHtml(POST_HTML);

    await vi.waitFor(() => expect(added).toHaveLength(2));
    expect(document.querySelectorAll('[sfx_post]')).toHaveLength(2);
  });

  it('tells a late subscriber about the posts found so far', async () => {
    addHtml(POST_HTML);
    await watch(1);
    const late: Post[] = [];

    posts.onAdd((post) => late.push(post));

    expect(late).toEqual(added);
  });

  it('keeps going when a listener throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    addHtml(POST_HTML);
    posts.onAdd(() => {
      throw new Error('broken listener');
    });

    await watch(1);
  });

  it('reports a post that leaves the page', async () => {
    const removed: Post[] = [];
    posts.onRemove((post) => removed.push(post));
    const post = addHtml(POST_HTML);
    await watch(1);

    post.remove();

    await vi.waitFor(() => expect(removed).toEqual(added));
    expect(post.classList.contains('sfx_removing')).toBe(true);
  });

  it('keeps a post that only moves to another place in the page', async () => {
    const removed = vi.fn();
    posts.onRemove(removed);
    const post = addHtml(POST_HTML);
    const elsewhere = addHtml('<section></section>');
    await watch(1);

    elsewhere.append(post);
    await sleep(20);
    expect(removed).not.toHaveBeenCalled();
    expect(post.classList.contains('sfx_removing')).toBe(false);

    post.remove();
    await vi.waitFor(() => expect(removed).toHaveBeenCalledExactlyOnceWith(added[0]));
  });

  it('says nothing about a post that leaves before its ID is known', async () => {
    const lookup = Promise.withResolvers<string | null>();
    findId.mockReturnValue(lookup.promise);
    const removed = vi.fn();
    posts.onRemove(removed);
    const post = addHtml(POST_HTML);
    await watch(0);
    await vi.waitFor(() => expect(findId).toHaveBeenCalled());

    post.remove();
    await vi.waitFor(() => expect(post.classList.contains('sfx_removing')).toBe(true));
    lookup.resolve('1234567890');
    await Promise.resolve();

    expect(added).toEqual([]);
    expect(removed).not.toHaveBeenCalled();
  });

  it('starts counting again once a navigation has cleared the old posts', async () => {
    const reset = vi.fn();
    posts.onReset(reset);
    const old = addHtml(POST_HTML);
    await watch(1);

    history.pushState({}, '', '/groups/gardening/');
    old.remove();
    addHtml(POST_HTML);

    await vi.waitFor(() => expect(added).toHaveLength(2));
    expect(reset).toHaveBeenCalledTimes(2);
    expect(added[1]?.number).toBe(1);
  });

  it('keeps counting when the old posts are still there after a navigation', async () => {
    const reset = vi.fn();
    posts.onReset(reset);
    addHtml(POST_HTML);
    await watch(1);

    history.pushState({}, '', '/groups/gardening/');
    addHtml(POST_HTML);

    await vi.waitFor(() => expect(added).toHaveLength(2));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(added[1]?.number).toBe(2);
  });

  it('signals a reset before the first post, and at once to a late subscriber', async () => {
    const order: string[] = [];
    posts.onReset(() => order.push('reset'));
    posts.onAdd(() => order.push('post'));
    addHtml(POST_HTML);
    await vi.waitFor(() => expect(order).toEqual(['reset', 'post']));
    const late = vi.fn();

    posts.onReset(late);

    expect(late).toHaveBeenCalledTimes(1);
  });

  it('waits for an empty feed slot to fill', async () => {
    const slot = addHtml('<div aria-posinset="4"></div>');
    await watch(0);
    expect(slot.hasAttribute('sfx_post')).toBe(false);

    addHtml('<div><a aria-label="Author"></a>Some text</div>', slot);

    await vi.waitFor(() => expect(added).toHaveLength(1));
    expect(added[0]?.element).toBe(slot);
  });

  it('reports content added to a post once, and not what this project adds', async () => {
    const updated = vi.fn();
    posts.onUpdate(updated);
    const post = addHtml(POST_HTML);
    await watch(1);

    addHtml('<button data-feed-sanity="note">A note</button>', post);
    await sleep(150);
    expect(updated).not.toHaveBeenCalled();

    addHtml('<p>More text</p>', post);
    addHtml('<p>And more</p>', post);

    await vi.waitFor(() => expect(updated).toHaveBeenCalledExactlyOnceWith(added[0]));
  });

  it('looks for listings on Marketplace pages', async () => {
    history.replaceState({}, '', '/marketplace/');
    addHtml(POST_HTML);
    const grid = addHtml(
      '<div class="S2F_alinc_flst S2F_fldr_row S2F_just_flst S2F_flex_wrap"></div>',
    );
    const listing = addHtml(
      '<div class="S2F_vis_vis S2F_flex_shr1 S2F_flex_0px" style="width: 200px"><a role="link"></a></div>',
      grid,
    );
    await watch(1);

    expect(added[0]?.element).toBe(listing);
    expect(findId).toHaveBeenCalledWith(listing, locate);
  });

  it('flags the post the page address points at', async () => {
    history.replaceState({}, '', '/some.user/posts/1234567890');
    addHtml(POST_HTML);
    await watch(1);

    expect(added[0]?.permalink).toBe(true);
  });

  it('tracks a post in the comments popup by the popup container', async () => {
    const mode = addHtml('<div class="__fb-light-mode S2F_pos_rel"></div>');
    const popup = addHtml('<div aria-labelledby="title"><div></div></div>', mode);
    const inside = addHtml(POST_HTML, popup.firstElementChild as Element);
    await watch(1);

    expect(added[0]?.element).toBe(popup);
    // The post's own content is read from the post inside the popup.
    expect(added[0]?.content).toBe(inside);
    expect(popup.classList.contains('sfx_popup_post')).toBe(true);
  });

  it('scans again when the class names change', async () => {
    addHtml('<div aria-describedby="x" class="xoutl001"><a aria-label="Author"></a></div>');
    await watch(0);

    translate = (text) => text.replaceAll('S2F_outl_none', 'xoutl001');
    atomsChanged();

    await vi.waitFor(() => expect(added).toHaveLength(1));
  });

  describe('before the class names are known', () => {
    let known: Map<string, string>;
    let scanned: PromiseWithResolvers<void>;

    beforeEach(() => {
      known = new Map();
      scanned = Promise.withResolvers();
      atoms = {
        translate: (text) => text,
        resolve: (selector) => {
          let all = true;
          const resolved = selector.replaceAll(/S2F_(\w+)/g, (token, name: string) => {
            const atom = known.get(name);
            all &&= atom !== undefined;
            return atom ?? token;
          });
          return all ? resolved : null;
        },
        onChange: (listener) => {
          atomsChanged = listener;
          return () => true;
        },
        start: () => scanned.promise,
      };
      locate = new Locators(atoms).locate;
      posts = new Posts(atoms, locate, findId);
    });

    it('marks the posts it can tell apart at once, and never takes a comment for one', async () => {
      const slot = addHtml('<div aria-posinset="1"><a aria-label="Author"></a>A post</div>');
      // A comment carries the `pos_rel` class, which keeps it out once the class is known.
      const comment = addHtml(
        '<div role="article" class="xrel"><a aria-label="Author"></a>A comment</div>',
      );
      posts.onAdd((post) => added.push(post));

      await vi.waitFor(() => expect(slot.getAttribute('sfx_post')).toBe('1'));
      expect(comment.hasAttribute('sfx_post')).toBe(false);
    });

    it('finds the rest once the classes are known, without counting a post twice', async () => {
      const slot = addHtml('<div aria-posinset="1"><a aria-label="Author"></a>A post</div>');
      const comment = addHtml(
        '<div role="article" class="xrel"><a aria-label="Author"></a>A comment</div>',
      );
      const article = addHtml(POST_HTML);
      posts.onAdd((post) => added.push(post));
      await vi.waitFor(() => expect(slot.hasAttribute('sfx_post')).toBe(true));
      expect(article.hasAttribute('sfx_post')).toBe(false);
      // The ID lookups wait for the first scan.
      expect(findId).not.toHaveBeenCalled();

      known.set('pos_rel', 'xrel');
      atomsChanged();
      scanned.resolve();

      await vi.waitFor(() => expect(added).toHaveLength(2));
      expect(added.map(({ element, number }) => [element, number])).toEqual([
        [slot, 1],
        [article, 2],
      ]);
      expect(comment.hasAttribute('sfx_post')).toBe(false);
      expect(findId).toHaveBeenCalledTimes(2);
    });

    it('announces the posts even when the scan fails', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      addHtml('<div aria-posinset="1"><a aria-label="Author"></a>A post</div>');
      scanned.reject(new Error('no stylesheets'));

      await watch(1);
    });
  });

  it('scans again when the user replaces a locator', async () => {
    const locators = new Locators(atoms);
    posts = new Posts(atoms, locators.locate, findId);
    const card = addHtml('<section><a aria-label="Author"></a>A card</section>');
    await watch(0);

    locators.override({ post: ['section'] });

    await vi.waitFor(() => expect(added).toHaveLength(1));
    expect(added[0]?.element).toBe(card);
  });

  it('finds nothing more after stop', async () => {
    await watch(0);
    posts.stop();

    addHtml(POST_HTML);
    await sleep(20);

    expect(added).toEqual([]);
  });

  it('stops for good when it was stopped and started again while starting', async () => {
    const listener = (post: Post) => added.push(post);
    posts.onAdd(listener);
    posts.stop();
    posts.onAdd(listener);
    await sleep(20);
    posts.stop();

    addHtml(POST_HTML);
    await sleep(20);

    expect(added).toEqual([]);
  });
});
