import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { FacebookPage } from '../../facebook/feature';
import type { Post } from '../../facebook/posts';
import type { Action, Filter } from './types';
import { FeatureRunner, startFeatures } from '../../core/app';
import { Options } from '../../core/options';
import { pageWatcher } from '../../core/page-watcher';
import { SavedData } from '../../core/saved';
import { bindPage } from '../../facebook/feature';
import { fakeAtoms, fakeLocate, makePost } from '../../facebook/testing';
import { Videos } from '../../facebook/videos';
import { extensionStore } from '../../platform/extension-store';
import postFilters from '.';
import { savedFilters } from './types';

type PostListener = (post: Post) => void;

/** A page whose posts the test announces by hand. */
function fakePage() {
  const listeners = {
    add: [] as PostListener[],
    remove: [] as PostListener[],
    update: [] as PostListener[],
    reset: [] as (() => void)[],
  };
  const subscribe =
    <L>(list: L[]) =>
    (listener: L) => {
      list.push(listener);
      return () => list.splice(list.indexOf(listener), 1).length > 0;
    };
  const page: FacebookPage = {
    atoms: fakeAtoms,
    locate: fakeLocate,
    posts: {
      onAdd: subscribe(listeners.add),
      onRemove: subscribe(listeners.remove),
      onUpdate: subscribe(listeners.update),
      onReset: subscribe(listeners.reset),
    },
    videos: new Videos(fakeLocate),
    watch: (selector, handlers, options) => pageWatcher.watch(selector, handlers, options),
  };
  return { page, listeners };
}

const noteOf = (post: Post) => post.element.querySelector<HTMLElement>('.sfx_filter_hidden_note');
const isHidden = (post: Post) => post.element.classList.contains('sfx_filter_hidden');
const isShown = (post: Post) => post.element.classList.contains('sfx_filter_hidden_show');

describe('post_filters: Hide Posts keywords', () => {
  let options: Options;
  let data: SavedData;
  let listeners: ReturnType<typeof fakePage>['listeners'];

  const announce = (post: Post): Post => {
    for (const listener of listeners.add) {
      listener(post);
    }
    return post;
  };

  beforeEach(async () => {
    fakeBrowser.reset();
    history.replaceState({}, '', '/');
    document.body.innerHTML = '';
    options = new Options(extensionStore, 'u/options');
    const fake = fakePage();
    listeners = fake.listeners;
    data = new SavedData(extensionStore, 'u');
    expect(await startFeatures([postFilters], options, bindPage(fake.page), data)).toEqual([]);
    await options.set('hide_posts_text', 'crypto\n\n  giveaway  ');
  });

  it('hides a post that contains a keyword and says which one', () => {
    const spam = announce(makePost('<p>Huge Crypto opportunity</p>'));
    const fine = announce(makePost('<p>Photos from the weekend</p>'));

    expect(isHidden(spam)).toBe(true);
    expect(noteOf(spam)?.textContent).toContain('Post Hidden by keyword: Crypto');
    expect(isHidden(fine)).toBe(false);
    expect(noteOf(fine)).toBeNull();
  });

  it('shows and hides the post again when the note is clicked', () => {
    const post = announce(makePost('<p>A giveaway</p>'));

    noteOf(post)?.click();
    expect(isShown(post)).toBe(true);

    noteOf(post)?.click();
    expect(isShown(post)).toBe(false);
    expect(isHidden(post)).toBe(true);
  });

  it('leaves no note when notes are turned off', async () => {
    await options.set('hide_posts_show_hidden_message', false);
    const post = announce(makePost('<p>A giveaway</p>'));

    expect(isHidden(post)).toBe(true);
    expect(noteOf(post)).toBeNull();
  });

  it('hides a revealed post again when notes are turned off', async () => {
    const post = announce(makePost('<p>A giveaway</p>'));
    noteOf(post)?.click();
    expect(isShown(post)).toBe(true);

    await options.set('hide_posts_show_hidden_message', false);

    expect(isShown(post)).toBe(false);
    expect(isHidden(post)).toBe(true);
    expect(noteOf(post)).toBeNull();
  });

  it('keeps the matching word out of the note when asked to', async () => {
    await options.set('hide_posts_show_match', false);
    const post = announce(makePost('<p>A giveaway</p>'));

    expect(noteOf(post)?.textContent).toContain('Post Hidden by keyword --');
  });

  it('applies changed settings to the posts already on the page', async () => {
    const post = announce(makePost('<p>A giveaway and some kittens</p>'));

    await options.set('hide_posts_text', 'kittens');
    expect(noteOf(post)?.textContent).toContain('keyword: kittens');
    expect(post.element.querySelectorAll('.sfx_filter_hidden_note')).toHaveLength(1);

    await options.set('hide_posts_text', '');
    expect(isHidden(post)).toBe(false);
    expect(noteOf(post)).toBeNull();
  });

  it('looks in photo descriptions only when that is on', async () => {
    const post = announce(makePost('<p>Look at this</p><img alt="A crypto chart">'));
    expect(isHidden(post)).toBe(true);

    await options.set('hide_posts_caption', false);
    expect(isHidden(post)).toBe(false);
  });

  it('ignores the comments on a post', () => {
    const post = announce(
      makePost(
        '<p>Photos from the weekend</p><div role="article" aria-label="Comment by Bob">Is this a giveaway?</div>',
      ),
    );

    expect(isHidden(post)).toBe(false);
  });

  it('reads a post in the comments popup from the post inside the popup', () => {
    const popup = makePost(
      '<h2>A crypto title</h2><div role="article"><p>A giveaway</p><div role="article">crypto</div></div>',
    );
    popup.element.classList.add('sfx_popup_post');
    const content = popup.element.querySelector<HTMLElement>('[role=article]') ?? popup.element;

    const post = announce({ ...popup, content });

    expect(noteOf(post)?.textContent).toContain('keyword: giveaway');
    // A post in the popup is what the reader asked to see, so it starts out shown.
    expect(isShown(post)).toBe(true);
  });

  it('puts the note back after Facebook refills the post', () => {
    const post = announce(makePost('<p>A giveaway</p>'));

    post.element.innerHTML = '<p>A giveaway</p>';
    for (const listener of listeners.update) {
      listener(post);
    }

    expect(noteOf(post)?.textContent).toContain('keyword: giveaway');
    expect(isHidden(post)).toBe(true);
  });

  it('leaves a hidden post as it is while Facebook has it emptied', () => {
    const post = announce(makePost('<p>A giveaway</p>'));
    noteOf(post)?.click();

    post.element.innerHTML = '<div style="height: 400px"></div>';
    for (const listener of listeners.update) {
      listener(post);
    }

    expect(isHidden(post)).toBe(true);
    expect(isShown(post)).toBe(true);
  });

  it('keeps judging a post by the page it arrived on after the address changes', () => {
    const post = announce(makePost('<p>A giveaway</p>'));

    // A photo opened from the feed changes the address and leaves the feed in place.
    history.replaceState({}, '', '/photo/?fbid=1');
    for (const listener of listeners.update) {
      listener(post);
    }

    expect(isHidden(post)).toBe(true);
  });

  it('keeps a post the page is about visible, with the note above it', async () => {
    await options.set('hide_posts_show_hidden_message', false);
    const post = announce(makePost('<p>A giveaway</p>', { permalink: true }));

    expect(isHidden(post)).toBe(true);
    expect(isShown(post)).toBe(true);
    expect(noteOf(post)).not.toBeNull();
  });

  it.each([
    ['/some.user', 'filters_enabled_pages'],
    ['/groups/gardening/', 'filters_enabled_groups'],
  ] as const)('leaves posts on %s alone until %s is on', async (address, key) => {
    history.replaceState({}, '', address);
    const post = announce(makePost('<p>A giveaway</p>'));
    expect(isHidden(post)).toBe(false);

    await options.set(key, true);
    expect(isHidden(post)).toBe(true);
  });

  it('watches posts only while there is something to hide', async () => {
    expect(listeners.add).toHaveLength(1);

    await options.set('hide_posts_text', '');
    expect(listeners.add).toHaveLength(0);
    expect(listeners.update).toHaveLength(0);

    await options.set('hide_posts_text', 'kittens');
    expect(listeners.add).toHaveLength(1);
  });

  it('hides nothing when filtering is turned off', async () => {
    const post = announce(makePost('<p>A giveaway</p>'));

    await options.set('filters_enabled', false);

    expect(isHidden(post)).toBe(false);
  });

  it('forgets posts that leave the page', async () => {
    const post = announce(makePost('<p>A giveaway</p>'));
    for (const listener of listeners.remove) {
      listener(post);
    }
    post.element.className = '';

    await options.set('hide_posts_show_match', false);

    expect(isHidden(post)).toBe(false);
  });
});

describe('post_filters: the toolbar badge', () => {
  let options: Options;
  let runner: FeatureRunner<FacebookPage>;
  let listeners: ReturnType<typeof fakePage>['listeners'];

  const announce = (post: Post): Post => {
    for (const listener of listeners.add) {
      listener(post);
    }
    return post;
  };
  const count = () => runner.badge().count;

  beforeEach(async () => {
    fakeBrowser.reset();
    history.replaceState({}, '', '/');
    document.body.innerHTML = '';
    options = new Options(extensionStore, 'u/options');
    const fake = fakePage();
    listeners = fake.listeners;
    runner = new FeatureRunner(
      [postFilters],
      options,
      bindPage(fake.page),
      new SavedData(extensionStore, 'u'),
    );
    expect(await runner.start()).toEqual([]);
    await options.set('hide_posts_text', 'crypto');
  });

  it('counts the posts that are hidden, revealed or not', () => {
    const spam = announce(makePost('<p>Crypto news</p>'));
    announce(makePost('<p>More crypto</p>'));
    announce(makePost('<p>Photos from the weekend</p>'));
    expect(count()).toBe(2);

    noteOf(spam)?.click();
    expect(count()).toBe(2);
  });

  it('follows a change of keyword, and goes to nothing when it is cleared', async () => {
    announce(makePost('<p>Crypto news</p>'));
    announce(makePost('<p>A giveaway</p>'));
    announce(makePost('<p>A crypto giveaway</p>'));
    expect(count()).toBe(2);

    await options.set('hide_posts_text', 'giveaway');
    expect(count()).toBe(2);

    await options.set('hide_posts_text', 'weekend');
    expect(count()).toBe(0);

    await options.set('hide_posts_text', 'crypto');
    expect(count()).toBe(2);

    await options.set('hide_posts_text', '');
    expect(count()).toBe(0);
  });

  it('drops posts that leave the page, and every post on a move to another page', () => {
    const first = announce(makePost('<p>Crypto news</p>'));
    announce(makePost('<p>More crypto</p>'));

    for (const listener of listeners.remove) {
      listener(first);
    }
    expect(count()).toBe(1);

    for (const listener of listeners.reset) {
      listener();
    }
    expect(count()).toBe(0);
  });

  it('shows nothing once filtering is turned off', async () => {
    announce(makePost('<p>Crypto news</p>'));

    await options.set('filters_enabled', false);

    expect(runner.badge()).toEqual({ count: 0, failed: false });
  });
});

describe('post_filters: saved filters', () => {
  let options: Options;
  let data: SavedData;
  let listeners: ReturnType<typeof fakePage>['listeners'];

  const announce = (post: Post): Post => {
    for (const listener of listeners.add) {
      listener(post);
    }
    return post;
  };
  const saveFilters = (filters: Filter[]) => savedFilters(data).set(filters);
  const filter = (text: string, actions: Action[], changes: Filter = {}): Filter => ({
    title: text,
    match: 'ALL',
    enabled: true,
    stop_on_match: true,
    rules: [{ target: 'any', operator: 'contains', condition: { text } }],
    actions,
    ...changes,
  });
  const panel = () => document.querySelector('feed-sanity-ui#feed_sanity_filter_tabs')?.shadowRoot;
  const tabButtons = () =>
    [...(panel()?.querySelectorAll('button') ?? [])].map((button) => button.textContent);
  const inTab = (post: Post, number: number) =>
    post.element.classList.contains(`sfx_filter_tab_${number}`);

  beforeEach(async () => {
    fakeBrowser.reset();
    history.replaceState({}, '', '/');
    document.body.innerHTML = '';
    for (const style of document.querySelectorAll('#sfx_filter_tabselect')) {
      style.remove();
    }
    options = new Options(extensionStore, 'u/options');
    const fake = fakePage();
    listeners = fake.listeners;
    data = new SavedData(extensionStore, 'u');
    await browser.storage.local.set({
      'u/filters': [filter('kittens', [{ action: 'hide', show_note: true }])],
    });
    expect(await startFeatures([postFilters], options, bindPage(fake.page), data)).toEqual([]);
  });

  it('runs the filters that were saved, without any keywords', () => {
    const post = announce(makePost('<p>So many kittens</p>'));

    expect(listeners.add).toHaveLength(1);
    expect(isHidden(post)).toBe(true);
    expect(noteOf(post)?.textContent).toContain('Post hidden by filter "kittens"');
  });

  it('runs the keywords ahead of the saved filters', async () => {
    await options.set('hide_posts_text', 'kittens');
    const post = announce(makePost('<p>So many kittens</p>'));

    expect(noteOf(post)?.textContent).toContain('Post Hidden by keyword: kittens');
  });

  it('filters the posts on the page again when the filters change', async () => {
    const post = announce(makePost('<h4>Heading</h4><p>So many kittens</p>'));

    await saveFilters([
      filter('kittens', [
        { action: 'class', content: 'cute' },
        { action: 'css', content: 'opacity: 0.5', selector: 'h4' },
      ]),
    ]);
    expect(isHidden(post)).toBe(false);
    expect(post.element.classList.contains('cute')).toBe(true);
    expect(post.element.querySelector('h4')?.style.opacity).toBe('0.5');

    await saveFilters([]);
    expect(post.element.classList.contains('cute')).toBe(false);
    expect(post.element.querySelector('h4')?.style.opacity).toBe('');
    expect(listeners.add).toHaveLength(0);
  });

  it('sorts posts into tabs and lists the tabs once there is one', async () => {
    await saveFilters([filter('kittens', [{ action: 'move-to-tab', tab: 'Cats' }])]);
    const plain = announce(makePost('<p>Weekend photos</p>'));
    expect(panel()?.querySelector('nav')).toBeNull();

    const cat = announce(makePost('<p>So many kittens</p>'));
    await Promise.resolve();

    expect([inTab(plain, 0), inTab(plain, 1), inTab(plain, 2)]).toEqual([true, true, false]);
    expect([inTab(cat, 0), inTab(cat, 1), inTab(cat, 2)]).toEqual([true, false, true]);
    await vi.waitFor(() => expect(tabButtons()).toEqual(['All Posts2', 'Filtered Feed1', 'Cats1']));
    expect(document.querySelector('#sfx_filter_tabselect')?.textContent).toContain(
      ':not(.sfx_filter_tab_1)',
    );
  });

  it('never sorts the post the page is about out of view', async () => {
    await saveFilters([filter('kittens', [{ action: 'move-to-tab', tab: 'Cats' }])]);

    const post = announce(makePost('<p>So many kittens</p>', { permalink: true }));

    expect(
      [...post.element.classList].filter((name) => name.startsWith('sfx_filter_tab_')),
    ).toEqual([]);
  });

  it('shows the posts of the tab that is clicked', async () => {
    await saveFilters([filter('kittens', [{ action: 'move-to-tab', tab: 'Cats' }])]);
    announce(makePost('<p>So many kittens</p>'));
    await vi.waitFor(() => expect(tabButtons()).toHaveLength(3));

    panel()?.querySelectorAll('button')[2]?.click();

    await vi.waitFor(() =>
      expect(panel()?.querySelector('[aria-current]')?.textContent).toBe('Cats1'),
    );
    expect(document.querySelector('#sfx_filter_tabselect')?.textContent).toContain(
      ':not(.sfx_filter_tab_2)',
    );
  });

  it('can list the tabs before any post is in them', async () => {
    await saveFilters([
      filter('kittens', [{ action: 'move-to-tab', tab: 'Cats' }]),
      filter('x', [{ action: 'copy-to-tab', tab: ['By $', '{author}'].join('') }]),
    ]);

    await options.set('always_show_tabs', true);

    await vi.waitFor(() => expect(tabButtons()).toEqual(['All Posts0', 'Filtered Feed0', 'Cats0']));
  });

  it('starts the tabs over when Facebook moves to another page', async () => {
    await saveFilters([filter('kittens', [{ action: 'move-to-tab', tab: 'Cats' }])]);
    announce(makePost('<p>So many kittens</p>'));
    await vi.waitFor(() => expect(tabButtons()).toHaveLength(3));

    for (const listener of listeners.reset) {
      listener();
    }

    await vi.waitFor(() => expect(panel()?.querySelector('nav')).toBeNull());
  });

  it('removes every trace when filtering is turned off', async () => {
    await saveFilters([
      filter('kittens', [
        { action: 'move-to-tab', tab: 'Cats' },
        { action: 'hide', show_note: true },
      ]),
    ]);
    const post = announce(makePost('<p>So many kittens</p>'));
    expect(isHidden(post)).toBe(true);

    await options.set('filters_enabled', false);

    expect(post.element.className).toBe('');
    expect(noteOf(post)).toBeNull();
    expect(document.querySelector('#sfx_filter_tabselect')).toBeNull();
    expect(document.querySelector('feed-sanity-ui#feed_sanity_filter_tabs')).toBeNull();
  });

  it('follows filters saved in another tab', async () => {
    const post = announce(makePost('<p>Puppies everywhere</p>'));

    await browser.storage.local.set({
      'u/filters': [filter('puppies', [{ action: 'hide', show_note: true }])],
    });

    expect(isHidden(post)).toBe(true);
  });
});
