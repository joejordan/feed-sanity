import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { FacebookPage, PageServices, PageWorld } from '../../facebook/feature';
import type { Post } from '../../facebook/posts';
import type { Action, Filter } from './types';
import { FeatureRunner, startFeatures } from '../../core/app';
import { PageBridge } from '../../core/bridge';
import { Options } from '../../core/options';
import { pageWatcher } from '../../core/page-watcher';
import { SavedData } from '../../core/saved';
import { bindPage } from '../../facebook/feature';
import { POST_SPONSORED, readPostSponsored } from '../../facebook/react-readers';
import {
  fakeAtoms,
  fakeLocate,
  giveFeedUnit,
  postHeader as header,
  makePost,
  testBridge,
} from '../../facebook/testing';
import { Videos } from '../../facebook/videos';
import { extensionStore } from '../../platform/extension-store';
import postFilters from '.';
import { SPONSORED_NOTE, SUGGESTED_NOTE } from './built-in-filters';
import { savedFilters } from './types';

type PostListener = (post: Post) => void;

/** A page whose posts the test announces by hand. */
function fakePage(bridge: PageWorld = testBridge()) {
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
  const page: PageServices = {
    atoms: fakeAtoms,
    locate: fakeLocate,
    posts: {
      onAdd: subscribe(listeners.add),
      onRemove: subscribe(listeners.remove),
      onUpdate: subscribe(listeners.update),
      onReset: subscribe(listeners.reset),
    },
    videos: new Videos(fakeLocate),
    bridge,
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
    // Hiding suggested posts is on by default, and is something to hide.
    await options.set('hide_posts_suggested', false);
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
    // Hiding suggested posts is on by default, and would keep the posts watched.
    await options.set('hide_posts_suggested', false);
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
    // The list is not in the page at all yet.
    expect(panel()?.querySelector('nav') ?? null).toBeNull();

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

  it('keeps the tab list off stories pages', async () => {
    await saveFilters([filter('kittens', [{ action: 'move-to-tab', tab: 'Cats' }])]);
    announce(makePost('<p>So many kittens</p>'));
    await vi.waitFor(() => expect(tabButtons()).toHaveLength(3));
    const go = (address: string): void => {
      history.pushState({}, '', address);
      dispatchEvent(new PopStateEvent('popstate'));
    };

    // The post stays in the page, as feed posts can under the stories viewer.
    go('/stories/');
    await vi.waitFor(() => expect(panel()?.querySelector('nav')).toBeNull());
    go('/stories/123456789/UzpfSVNDOjE/');
    await Promise.resolve();
    expect(panel()?.querySelector('nav')).toBeNull();

    go('/');
    await vi.waitFor(() => expect(tabButtons()).toHaveLength(3));
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

/** Gives `post` React data that says whether it is an ad. */
function withFeedUnit(post: Post, sponsored: boolean): Post {
  giveFeedUnit(post.element, {
    __typename: 'Story',
    sponsored_data: sponsored ? { ad_id: '1' } : null,
  });
  return post;
}

describe('post_filters: suggested posts and ads', () => {
  let options: Options;
  let runner: FeatureRunner<FacebookPage>;
  let listeners: ReturnType<typeof fakePage>['listeners'];
  const reader = vi.fn(readPostSponsored);

  const announce = (post: Post): Post => {
    for (const listener of listeners.add) {
      listener(post);
    }
    return post;
  };
  const update = (post: Post): void => {
    for (const listener of listeners.update) {
      listener(post);
    }
  };

  const start = async (bridge: PageWorld) => {
    const fake = fakePage(bridge);
    listeners = fake.listeners;
    runner = new FeatureRunner(
      [postFilters],
      options,
      bindPage(fake.page),
      new SavedData(extensionStore, 'u'),
    );
    expect(await runner.start()).toEqual([]);
  };

  beforeEach(async () => {
    fakeBrowser.reset();
    reader.mockClear();
    history.replaceState({}, '', '/');
    document.body.innerHTML = '';
    options = new Options(extensionStore, 'u/options');
    await start(testBridge({ [POST_SPONSORED]: reader }));
  });

  describe('suggested posts', () => {
    it('hides posts with a Follow or Join button by the name, and says why', () => {
      const page = announce(makePost(`${header('Garden Page', 'Follow')}<p>Tomatoes</p>`));
      const group = announce(makePost(`${header('Garden Group', 'Join')}<p>Beans</p>`));
      const friend = announce(makePost(`${header('Ann Author')}<p>Hello</p>`));

      expect(isHidden(page)).toBe(true);
      expect(isHidden(group)).toBe(true);
      expect(isHidden(friend)).toBe(false);
      expect(noteOf(page)?.textContent).toContain(`${SUGGESTED_NOTE} -- Click to reveal post`);
      expect(runner.badge().count).toBe(2);
    });

    it("tells a verified page's badge from a Follow button", () => {
      const followed = announce(makePost(`${header('Garden Page', '', true)}<p>Tomatoes</p>`));
      const suggested = announce(makePost(`${header('Seed Shop', 'Follow', true)}<p>Seeds</p>`));

      expect(isHidden(followed)).toBe(false);
      expect(isHidden(suggested)).toBe(true);
    });

    it('leaves a post alone when only a shared post inside it is suggested', () => {
      const post = announce(
        makePost(`${header('Ann Author')}<div>${header('Garden Page', 'Follow')}</div>`),
      );

      expect(isHidden(post)).toBe(false);
    });

    it('hides a post whose header arrives after the rest of it', () => {
      const post = announce(makePost('<p>Tomatoes</p>'));
      expect(isHidden(post)).toBe(false);

      post.element.insertAdjacentHTML('afterbegin', header('Garden Page', 'Follow'));
      update(post);

      expect(isHidden(post)).toBe(true);
      expect(runner.badge().count).toBe(1);
    });

    it('follows the switch and the note setting without a reload', async () => {
      const post = announce(makePost(`${header('Garden Page', 'Follow')}<p>Tomatoes</p>`));

      await options.set('hide_posts_show_hidden_message', false);
      expect(isHidden(post)).toBe(true);
      expect(noteOf(post)).toBeNull();

      await options.set('hide_posts_suggested', false);
      expect(isHidden(post)).toBe(false);
      expect(runner.badge().count).toBe(0);
    });

    it('never hides the post the page is about', () => {
      const post = announce(
        makePost(`${header('Garden Page', 'Follow')}<p>Tomatoes</p>`, { permalink: true }),
      );
      const popup = makePost(`${header('Garden Group', 'Join')}<p>Beans</p>`);
      popup.element.classList.add('sfx_popup_post');
      announce(popup);

      expect(isHidden(post)).toBe(false);
      expect(isHidden(popup)).toBe(false);
      expect(noteOf(post)).toBeNull();
    });

    it.each([
      ['/some.page', 'filters_enabled_pages'],
      ['/groups/feed/', 'filters_enabled_groups'],
    ] as const)('leaves posts on %s alone until %s is on', async (address, key) => {
      history.replaceState({}, '', address);
      const post = announce(makePost(`${header('Garden Group', 'Join')}<p>Beans</p>`));
      expect(isHidden(post)).toBe(false);

      await options.set(key, true);
      expect(isHidden(post)).toBe(true);
    });

    it('lets a filter of the user test the button', async () => {
      await options.set('hide_posts_suggested', false);
      await savedFilters(new SavedData(extensionStore, 'u')).set([
        {
          title: 'Groups only',
          enabled: true,
          match: 'ALL',
          rules: [{ target: 'suggested', operator: 'contains', condition: { text: 'Join' } }],
          actions: [{ action: 'hide', show_note: true }],
        },
      ]);

      const group = announce(makePost(`${header('Garden Group', 'Join')}<p>Beans</p>`));
      const page = announce(makePost(`${header('Garden Page', 'Follow')}<p>Tomatoes</p>`));

      expect(isHidden(group)).toBe(true);
      expect(isHidden(page)).toBe(false);
    });
  });

  describe('ads', () => {
    beforeEach(async () => {
      await options.set('hide_posts_sponsored', true);
    });

    const adAndOthers = () => ({
      ad: announce(withFeedUnit(makePost(`${header('Shop')}<p>Buy now</p>`), true)),
      friend: announce(withFeedUnit(makePost(`${header('Ann Author')}<p>Hello</p>`), false)),
      unknown: announce(makePost(`${header('Bob')}<p>No data</p>`)),
    });

    it('hides an ad once the page has said it is one, and says why', async () => {
      const { ad, friend, unknown } = adAndOthers();

      await vi.waitFor(() => expect(isHidden(ad)).toBe(true));
      expect(noteOf(ad)?.textContent).toContain(`${SPONSORED_NOTE} -- Click to reveal post`);
      expect(isHidden(friend)).toBe(false);
      expect(isHidden(unknown)).toBe(false);
      expect(runner.badge().count).toBe(1);
    });

    it('asks about each post once, however often it changes', async () => {
      const { ad, friend } = adAndOthers();
      await vi.waitFor(() => expect(isHidden(ad)).toBe(true));
      expect(reader).toHaveBeenCalledTimes(3);

      update(ad);
      update(friend);
      await options.set('hide_posts_show_match', false);

      expect(isHidden(ad)).toBe(true);
      expect(reader).toHaveBeenCalledTimes(3);
    });

    it('lets the other filters act on a post while its answer is awaited', async () => {
      await options.set('hide_posts_text', 'Buy');
      const ad = announce(withFeedUnit(makePost(`${header('Shop')}<p>Buy now</p>`), true));

      expect(noteOf(ad)?.textContent).toContain('Post Hidden by keyword: Buy');
    });

    it('never asks about the post the page is about', async () => {
      const ad = announce(
        withFeedUnit(makePost(`${header('Shop')}<p>Buy now</p>`, { permalink: true }), true),
      );
      await Promise.resolve();

      expect(reader).not.toHaveBeenCalled();
      expect(isHidden(ad)).toBe(false);
    });

    it('shows the ads again when the switch goes off', async () => {
      const { ad } = adAndOthers();
      await vi.waitFor(() => expect(isHidden(ad)).toBe(true));

      await options.set('hide_posts_sponsored', false);

      expect(isHidden(ad)).toBe(false);
      expect(runner.badge().count).toBe(0);
    });

    it('does nothing when the bridge is unavailable, and asks only once', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      options = new Options(extensionStore, 'other/options');
      // A page-world side that cannot be put in the page.
      await start(testBridge());
      await options.set('hide_posts_sponsored', true);
      const ask = vi.spyOn(PageBridge.prototype, 'ask');

      const ad = announce(withFeedUnit(makePost(`${header('Shop')}<p>Buy now</p>`), true));
      await expect(ask.mock.results[0]?.value).rejects.toMatchObject({ failure: 'unavailable' });
      await Promise.resolve();
      update(ad);

      expect(ask).toHaveBeenCalledTimes(1);
      expect(isHidden(ad)).toBe(false);
      ask.mockRestore();
    });
  });

  it('asks the page nothing while ads are not hidden', async () => {
    announce(withFeedUnit(makePost(`${header('Shop')}<p>Buy now</p>`), true));
    await Promise.resolve();

    expect(reader).not.toHaveBeenCalled();
  });
});
