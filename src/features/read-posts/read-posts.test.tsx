import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { Feature } from '../../core/feature';
import type { FacebookPage, PageServices } from '../../facebook/feature';
import type { Post } from '../../facebook/posts';
import { FeatureRunner } from '../../core/app';
import { newAction, newCondition, newFilter, savedFilters } from '../../core/filter-types';
import { Options } from '../../core/options';
import { SavedData } from '../../core/saved';
import { bindPage } from '../../facebook/feature';
import { savedReadHistory } from '../../facebook/read-history';
import { FakePosts, fakeLocate, makePost, postHeader, videoPage } from '../../facebook/testing';
import { extensionStore } from '../../platform/extension-store';
import postFilters from '../post-filters';
import readPosts from './index';
import { HIDE_READ_ATTR, READ_ATTR, READ_NOTE_CLASS } from './markers';

const DAY = 24 * 60 * 60 * 1000;

/** A post's markup: a header with the author and Facebook's menu button in a row, and some text. */
const postHtml = (author: string, text: string): string => `
  <div>
    ${postHeader(author)}
    <div style="display: flex">
      <div>When</div>
      <div><div role="button" aria-haspopup="menu" aria-label="Actions for this post"></div></div>
    </div>
  </div>
  <div data-ad-rendering-role="story_message"><div dir="auto">${text}</div></div>`;

const buttonOf = (post: Post): HTMLButtonElement => {
  const button = post.element.querySelector<HTMLButtonElement>('.feed-sanity-read-button');
  if (!button) {
    throw new Error('the post has no read button');
  }
  return button;
};

const noteOf = (post: Post): HTMLElement | null =>
  post.element.querySelector<HTMLElement>(`.${READ_NOTE_CLASS}`);

const click = (element: Element, init: MouseEventInit = {}): void => {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
};

const readState = (post: Post): string | null => post.element.getAttribute(READ_ATTR);

/** The floating bar's buttons, by their text. */
function barButton(text: RegExp): HTMLButtonElement | undefined {
  const host = document.querySelector('#feed_sanity_read_bar');
  return [...(host?.shadowRoot?.querySelectorAll('button') ?? [])].find((button) =>
    text.test(button.textContent ?? ''),
  );
}

describe('read_posts', () => {
  let options: Options;
  let data: SavedData;
  let posts: FakePosts;
  let runner: FeatureRunner<FacebookPage> | undefined;

  beforeEach(() => {
    fakeBrowser.reset();
    history.replaceState({}, '', '/');
    document.head.replaceChildren();
    document.body.replaceChildren();
    options = new Options(extensionStore, 'u/options');
    data = new SavedData(extensionStore, 'u');
    posts = new FakePosts();
  });

  afterEach(() => {
    runner?.stop();
    runner = undefined;
    options.dispose();
    data.dispose();
    document.head.replaceChildren();
    document.body.replaceChildren();
    document.documentElement.removeAttribute(HIDE_READ_ATTR);
  });

  const start = async (
    initial: Record<string, boolean | number | string> = {},
    features: Feature<FacebookPage>[] = [readPosts],
  ): Promise<void> => {
    const page: PageServices = { ...videoPage(), locate: fakeLocate, posts: posts.services };
    runner = new FeatureRunner(features, options, bindPage(page), data);
    expect(await runner.start()).toEqual([]);
    for (const [key, value] of Object.entries(initial)) {
      await options.set(key, value);
    }
    await savedReadHistory(data).ready;
  };

  /** Saves `history` as the read history, as an earlier visit would have left it. */
  const seed = async (history: Record<string, number>): Promise<void> => {
    const saved = savedReadHistory(data);
    await saved.ready;
    await saved.set(history);
  };

  const addPost = (id: string | null, changes: Partial<Post> = {}, author = 'Alice'): Post =>
    posts.add(makePost(postHtml(author, `Post ${id ?? 'without ID'}`), { id, ...changes }));

  const savedIds = (): string[] => Object.keys(savedReadHistory(data).get()).sort();

  it('puts the button before the menu button and marks a post read', async () => {
    await start();
    const post = addPost('111111');
    const button = buttonOf(post);
    const menuCell = post.element.querySelector('[aria-haspopup=menu]')?.parentElement;
    expect(button.nextElementSibling).toBe(menuCell);
    expect(button.getAttribute('aria-label')).toBe('Mark as read');
    expect(button.title).toContain('Shift+Click');

    click(button);
    await vi.waitFor(() => expect(savedIds()).toEqual(['111111']));
    expect(readState(post)).toBe('hidden');
    expect(noteOf(post)?.textContent).toContain('Read post by Alice');
    expect(button.getAttribute('aria-label')).toBe('Mark as unread');
    expect(button.dataset.read).toBe('true');
    expect(post.element.firstElementChild).toBe(noteOf(post));
  });

  it('hides a post with no ID only until the feed resets', async () => {
    await start();
    const post = addPost(null);
    const button = buttonOf(post);
    expect(button.getAttribute('aria-label')).toBe('Hide until reload');
    expect(button.dataset.temp).toBe('true');

    click(button);
    expect(readState(post)).toBe('hidden');
    expect(savedIds()).toEqual([]);

    posts.reset();
    const again = addPost(null);
    expect(readState(again)).toBeNull();
    expect(buttonOf(again).getAttribute('aria-label')).toBe('Hide until reload');
  });

  it('saves the mark in a group without hiding the post until the groups option is on', async () => {
    history.replaceState({}, '', '/groups/cats/');
    await start({ read_posts_hide_in_groups: false });
    const post = addPost('222222');

    click(buttonOf(post));
    await vi.waitFor(() => expect(savedIds()).toEqual(['222222']));
    expect(readState(post)).toBe('kept');
    expect(noteOf(post)).toBeNull();

    await options.set('read_posts_hide_in_groups', true);
    expect(readState(post)).toBe('hidden');
    expect(noteOf(post)).not.toBeNull();
  });

  it('shows a read post the page is about at once, with a note even when notes are off', async () => {
    await seed({ '333333': Date.now() });
    await start({ read_posts_note: false });
    const pagePost = addPost('333333', { permalink: true });
    const other = addPost('444444');
    await seed({ '333333': Date.now(), '444444': Date.now() });

    expect(readState(pagePost)).toBe('shown');
    const note = noteOf(pagePost);
    expect(note).not.toBeNull();
    const toggle = [...(note?.querySelectorAll('button') ?? [])].find(
      (button) => button.textContent === 'Hide',
    );
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    // Any other read post is hidden without a trace.
    expect(readState(other)).toBe('hidden');
    expect(noteOf(other)).toBeNull();

    if (toggle) {
      click(toggle);
    }
    expect(readState(pagePost)).toBe('hidden');
    expect(toggle?.textContent).toBe('Show');
  });

  it('puts the button and note back when Facebook refills a post', async () => {
    await seed({ '555555': Date.now() });
    await start();
    const post = addPost('555555');
    expect(noteOf(post)).not.toBeNull();

    const refill = document.createElement('div');
    refill.innerHTML = postHtml('Alice', 'Post 555');
    post.element.replaceChildren(...refill.childNodes);
    expect(noteOf(post)).toBeNull();
    posts.update(post);

    expect(noteOf(post)).not.toBeNull();
    expect(post.element.firstElementChild).toBe(noteOf(post));
    expect(buttonOf(post).isConnected).toBe(true);
    expect(readState(post)).toBe('hidden');
  });

  it('removes everything it added when switched off', async () => {
    await seed({ '666666': Date.now() });
    await start();
    const read = addPost('666666');
    const unread = addPost('777777');
    await vi.waitFor(() => expect(document.querySelector('#feed_sanity_read_bar')).not.toBeNull());
    expect(document.querySelector('#feed_sanity_read_posts')).not.toBeNull();
    expect(document.querySelector('#feed_sanity_read_posts_reveal')).not.toBeNull();

    await options.set('read_posts', false);
    for (const post of [read, unread]) {
      expect(post.element.querySelector('[data-feed-sanity]')).toBeNull();
      expect(readState(post)).toBeNull();
    }
    expect(document.documentElement.hasAttribute(HIDE_READ_ATTR)).toBe(false);
    expect(document.querySelector('#feed_sanity_read_posts')).toBeNull();
    expect(document.querySelector('#feed_sanity_read_posts_reveal')).toBeNull();
    expect(document.querySelector('#feed_sanity_read_bar')).toBeNull();
    // The marks stay saved.
    expect(savedIds()).toEqual(['666666']);
  });

  it('marks a post read from a post filter set_read action', async () => {
    const condition = { ...newCondition('text'), values: ['mark me'] };
    const filters = savedFilters(data);
    await filters.ready;
    await filters.set([newFilter({ conditions: [condition], actions: [newAction('set_read')] })]);
    await start({}, [postFilters, readPosts]);
    posts.add(makePost(postHtml('Bob', 'Please mark me'), { id: '888888' }));

    await vi.waitFor(() => expect(savedIds()).toEqual(['888888']));
    await vi.waitFor(() => expect(readState(posts.posts[0] as Post)).toBe('hidden'));
  });

  it('marks every unread post above on Shift+Click, and undoes it', async () => {
    await start();
    const first = addPost('100100');
    const pagePost = addPost('100200', { permalink: true });
    const third = addPost(null);
    const last = addPost('100400');
    const below = addPost('100500');
    getSelection()?.selectAllChildren(document.body);

    click(buttonOf(last), { shiftKey: true });
    await vi.waitFor(() => expect(savedIds()).toEqual(['100100', '100400']));
    expect(getSelection()?.rangeCount).toBe(0);
    expect(readState(first)).toBe('hidden');
    expect(readState(pagePost)).toBeNull();
    expect(readState(third)).toBe('hidden');
    expect(readState(below)).toBeNull();

    await vi.waitFor(() => expect(barButton(/^Undo \(3\)$/)).toBeDefined());
    const undo = barButton(/^Undo/);
    if (undo) {
      click(undo);
    }
    await vi.waitFor(() => expect(savedIds()).toEqual([]));
    for (const post of [first, third, last]) {
      expect(readState(post)).toBeNull();
    }
    await vi.waitFor(() => expect(document.querySelector('#feed_sanity_read_bar')).toBeNull());
  });

  it('toggles the page attribute with Show read and Hide read', async () => {
    await seed({ '200100': Date.now() });
    await start();
    const post = addPost('200100');
    const html = document.documentElement;
    expect(html.hasAttribute(HIDE_READ_ATTR)).toBe(true);
    expect(readState(post)).toBe('hidden');

    await vi.waitFor(() => expect(barButton(/^Show read$/)).toBeDefined());
    const show = barButton(/^Show read$/);
    if (show) {
      click(show);
    }
    expect(html.hasAttribute(HIDE_READ_ATTR)).toBe(false);
    expect(readState(post)).toBe('shown');

    await vi.waitFor(() => expect(barButton(/^Hide read$/)).toBeDefined());
    const hide = barButton(/^Hide read$/);
    if (hide) {
      click(hide);
    }
    expect(html.hasAttribute(HIDE_READ_ATTR)).toBe(true);
    expect(readState(post)).toBe('hidden');
  });

  it("hides a post from its note's Hide while Show read is on", async () => {
    await seed({ '200200': Date.now() });
    await start();
    const post = addPost('200200');
    await vi.waitFor(() => expect(barButton(/^Show read$/)).toBeDefined());
    const show = barButton(/^Show read$/);
    if (show) {
      click(show);
    }
    expect(readState(post)).toBe('shown');

    const hide = [...(noteOf(post)?.querySelectorAll('button') ?? [])].find(
      (button) => button.textContent === 'Hide',
    );
    if (hide) {
      click(hide);
    }
    // The page is not hiding read posts, so read-posts.css must go by the post's mark alone.
    expect(readState(post)).toBe('hidden');
    expect(document.documentElement.hasAttribute(HIDE_READ_ATTR)).toBe(false);
  });

  it('offers Mark all read, which skips page posts', async () => {
    await start({ read_posts_mark_all: true });
    const pagePost = addPost('300100', { permalink: true });
    const post = addPost('300200');

    await vi.waitFor(() => expect(barButton(/^Mark all read$/)?.disabled).toBe(false));
    const markAll = barButton(/^Mark all read$/);
    if (markAll) {
      click(markAll);
    }
    await vi.waitFor(() => expect(savedIds()).toEqual(['300200']));
    expect(readState(pagePost)).toBeNull();
    expect(readState(post)).toBe('hidden');
    await vi.waitFor(() => expect(barButton(/^Mark all read$/)?.disabled).toBe(true));
  });

  it('follows changes made elsewhere and forgets old marks', async () => {
    const old = Date.now() - 40 * DAY;
    await seed({ '400100': old, '400200': Date.now() });
    await start();
    await vi.waitFor(() => expect(savedIds()).toEqual(['400200']));
    const copy = addPost('400200');
    const twin = addPost('400200');
    expect(readState(copy)).toBe('hidden');
    expect(readState(twin)).toBe('hidden');

    // Unmarking one copy updates the other.
    const unread = [...(noteOf(copy)?.querySelectorAll('button') ?? [])].find(
      (button) => button.textContent === 'Mark unread',
    );
    if (unread) {
      click(unread);
    }
    await vi.waitFor(() => expect(savedIds()).toEqual([]));
    expect(readState(twin)).toBeNull();

    // As "Clear read history" or another tab would.
    await seed({ '400200': Date.now() });
    expect(readState(twin)).toBe('hidden');
    await seed({});
    expect(readState(twin)).toBeNull();
  });
});
