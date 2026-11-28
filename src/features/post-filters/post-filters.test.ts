import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { Filter } from '../../core/filter-types';
import type { FacebookPage, PageServices, PageWorld } from '../../facebook/feature';
import type { Post } from '../../facebook/posts';
import { FeatureRunner } from '../../core/app';
import { BridgeError } from '../../core/bridge';
import { getFilterHitTracker } from '../../core/filter-hits';
import { newFilter, savedFilters } from '../../core/filter-types';
import { Options } from '../../core/options';
import { pageWatcher } from '../../core/page-watcher';
import { SavedData } from '../../core/saved';
import { HIDDEN_ATTR, OWN_ATTR } from '../../core/surface';
import { bindPage } from '../../facebook/feature';
import { savedReadHistory } from '../../facebook/read-history';
import { FEED_FILTERING, MARK, POST_CHECKED } from '../../facebook/selectors';
import { FakePosts, fakeLocate, makePost, postHeader, testBridge } from '../../facebook/testing';
import { Videos } from '../../facebook/videos';
import { extensionStore } from '../../platform/extension-store';
import { BUILT_IN_IDS, BUILT_IN_NOTES } from './built-ins';
import postFilters from './index';
import { FILTER_NOTE_CLASS, FILTERED_ATTR, isFilterHidden, isPagePost } from './markers';
import { NOTE_HIDE, NOTE_SHOW } from './notes';
import { STYLE_ID } from './styles';

/** A page-world bridge whose questions `ask` answers, for the ad paths. */
function askingBridge(ask: PageWorld['ask']): PageWorld {
  return {
    ask,
    status: () => ({
      state: 'connected',
      problem: null,
      readers: [],
      toggles: [],
      actions: [],
      mounts: [],
    }),
    onStatus: () => () => undefined,
    set: () => Promise.resolve(null),
    run: () => Promise.resolve(null),
    mount: () => Promise.resolve(null),
  };
}

const note = (post: Post): HTMLButtonElement | null =>
  post.element.querySelector<HTMLButtonElement>(`:scope > .${FILTER_NOTE_CLASS}`);
const filtered = (post: Post): string | null => post.element.getAttribute(FILTERED_ATTR);
const silentlyHidden = (post: Post): boolean =>
  post.element.getAttribute(HIDDEN_ATTR) === 'none' && note(post) === null;

const keepFilter = (overrides: Partial<Filter>): Filter =>
  newFilter({ name: 'Test', conditions: [], actions: [], ...overrides });

describe('post_filters', () => {
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
    document.documentElement.removeAttribute(FEED_FILTERING);
    document.head.replaceChildren();
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  const start = async (
    saved: Record<string, boolean | string> = {},
    bridge: PageWorld = testBridge(),
  ): Promise<FeatureRunner<FacebookPage>> => {
    await fakeBrowser.storage.local.set({ 'u/options': saved });
    const page: PageServices = {
      locate: fakeLocate,
      posts: posts.services,
      videos: new Videos(fakeLocate),
      bridge,
      watch: (selector, handlers, watchOptions) =>
        pageWatcher.watch(selector, handlers, watchOptions),
    };
    runner = new FeatureRunner([postFilters], options, bindPage(page), data);
    expect(await runner.start()).toEqual([]);
    await savedFilters(data).ready;
    return runner;
  };

  const setFilters = (filters: Filter[]): Promise<void> => savedFilters(data).set(filters);

  describe('keywords', () => {
    it('hides a post that mentions a keyword behind a note that shows and hides it', async () => {
      await start({ hidden_keywords: 'cats\n\n  dogs  ' });
      const kept = posts.add(makePost('<p>Nothing to see</p>'));
      const post = posts.add(makePost('<p>I love Dogs so much</p>'));

      expect(filtered(kept)).toBeNull();
      expect(filtered(post)).toBe('hidden');
      expect(isFilterHidden(post.element)).toBe(true);
      const button = note(post);
      expect(button?.textContent).toBe(`Hidden: mentions “Dogs”${NOTE_SHOW}`);
      expect(button?.getAttribute('aria-expanded')).toBe('false');
      expect(button?.hasAttribute(OWN_ATTR)).toBe(true);
      expect(post.element.firstChild).toBe(button);

      button?.click();
      expect(filtered(post)).toBe('shown');
      expect(isFilterHidden(post.element)).toBe(true);
      expect(button?.getAttribute('aria-expanded')).toBe('true');
      expect(button?.textContent).toContain(NOTE_HIDE);

      button?.click();
      expect(filtered(post)).toBe('hidden');
      expect(button?.textContent).toContain(NOTE_SHOW);
    });

    it('names no word when show-match is off', async () => {
      await start({ hidden_keywords: 'cats', hidden_keywords_show_match: false });
      const post = posts.add(makePost('<p>cats</p>'));
      expect(note(post)?.textContent).toBe(`${BUILT_IN_NOTES.keyword}${NOTE_SHOW}`);
    });

    it('honours whole words, case and captions', async () => {
      await start({
        hidden_keywords: 'Cat',
        hidden_keywords_partial: false,
        hidden_keywords_match_case: true,
        hidden_keywords_in_captions: false,
      });
      const longer = posts.add(makePost('<p>Category news</p>'));
      const lower = posts.add(makePost('<p>my cat</p>'));
      const exact = posts.add(makePost('<p>my Cat!</p>'));
      const caption = posts.add(makePost('<p>photo</p><img alt="A Cat sleeping">'));
      expect([longer, lower, exact, caption].map(filtered)).toEqual([null, null, 'hidden', null]);

      await options.set('hidden_keywords_in_captions', true);
      expect(filtered(caption)).toBe('hidden');
    });

    it('treats punctuation literally', async () => {
      await start({ hidden_keywords: 'c++ (beta)' });
      const plain = posts.add(makePost('<p>c beta</p>'));
      const literal = posts.add(makePost('<p>Learning c++ (beta) today</p>'));
      expect(filtered(plain)).toBeNull();
      expect(filtered(literal)).toBe('hidden');
    });
  });

  it('hides suggested posts but never the post the page is about', async () => {
    await start();
    const suggested = posts.add(makePost(`${postHeader('Some Page', 'Follow')}<p>Hello</p>`));
    const friend = posts.add(makePost(`${postHeader('A Friend')}<p>Hello</p>`));
    const permalink = posts.add(
      makePost(`${postHeader('Some Page', 'Follow')}<p>Hello</p>`, { permalink: true }),
    );
    expect(note(suggested)?.textContent).toBe(`${BUILT_IN_NOTES.suggested}${NOTE_SHOW}`);
    expect(filtered(friend)).toBeNull();
    expect(filtered(permalink)).toBeNull();

    await options.set('hide_suggested_posts', false);
    expect(filtered(suggested)).toBeNull();
    expect(note(suggested)).toBeNull();
  });

  describe('notes', () => {
    it('hides without a trace when notes are off, and hides a revealed post again', async () => {
      await start({ hidden_keywords: 'cats' });
      const post = posts.add(makePost('<p>cats</p>'));
      note(post)?.click();
      expect(filtered(post)).toBe('shown');

      await options.set('post_filters_notes', false);
      expect(note(post)).toBeNull();
      expect(filtered(post)).toBe('hidden');
      expect(silentlyHidden(post)).toBe(true);

      await options.set('post_filters_notes', true);
      expect(filtered(post)).toBe('hidden');
      expect(post.element.hasAttribute(HIDDEN_ATTR)).toBe(false);
    });

    it('gives a filter that forces a note one even with notes off', async () => {
      await start({ post_filters_notes: false });
      await setFilters([
        keepFilter({
          conditions: [{ kind: 'text', part: 'text', test: 'contains', values: ['spoiler'] }],
          actions: [{ kind: 'hide', note: true, noteText: 'Spoiler: {match}' }],
        }),
      ]);
      const post = posts.add(makePost('<p>big SPOILER here</p>'));
      expect(note(post)?.textContent).toBe(`Spoiler: SPOILER${NOTE_SHOW}`);
    });

    it('puts the note back when Facebook refills the post, and reuses it', async () => {
      await start({ hidden_keywords: 'cats' });
      const post = posts.add(makePost('<p>cats</p>'));
      const first = note(post);
      first?.click();
      post.element.replaceChildren();
      const refill = document.createElement('p');
      refill.textContent = 'cats again';
      post.element.append(refill);
      posts.update(post);
      expect(note(post)).toBe(first);
      expect(post.element.firstChild).toBe(first);
      expect(filtered(post)).toBe('shown');
    });

    it('gives the page post a note that starts revealed, even with notes off', async () => {
      await start({ hidden_keywords: 'cats', post_filters_notes: false });
      const permalink = posts.add(makePost('<p>cats</p>', { permalink: true }));
      const popup = makePost('<p>cats</p>');
      popup.element.setAttribute(MARK.popupPost, '');
      posts.add(popup);
      for (const post of [permalink, popup]) {
        expect(isPagePost(post)).toBe(true);
        expect(filtered(post)).toBe('shown');
        expect(note(post)?.getAttribute('aria-expanded')).toBe('true');
      }
      note(popup)?.click();
      expect(filtered(popup)).toBe('hidden');
    });

    it('leaves an empty post alone until it is filled', async () => {
      await start({ hidden_keywords: 'cats' });
      const post = posts.add(makePost('<img src="x.png">'));
      expect(filtered(post)).toBeNull();
      expect(post.element.hasAttribute(POST_CHECKED)).toBe(false);
      const text = document.createElement('p');
      text.textContent = 'cats';
      post.element.append(text);
      posts.update(post);
      expect(filtered(post)).toBe('hidden');
    });
  });

  describe('scope', () => {
    it('filters profiles and groups only when asked to', async () => {
      history.replaceState({}, '', '/someone');
      await start({ hidden_keywords: 'cats' });
      const onProfile = posts.add(makePost('<p>cats</p>'));
      history.replaceState({}, '', '/groups/123/');
      const inGroup = posts.add(makePost('<p>cats</p>'));
      expect(filtered(onProfile)).toBeNull();
      expect(filtered(inGroup)).toBeNull();
      expect(onProfile.element.hasAttribute(POST_CHECKED)).toBe(true);

      await options.set('post_filters_on_profiles', true);
      expect(filtered(onProfile)).toBe('hidden');
      expect(filtered(inGroup)).toBeNull();

      await options.set('post_filters_in_groups', true);
      expect(filtered(inGroup)).toBe('hidden');
    });

    it('keeps the page type a post was first seen on', async () => {
      await start({ hidden_keywords: 'cats' });
      const post = posts.add(makePost('<p>cats</p>'));
      history.replaceState({}, '', '/someone');
      posts.update(post);
      expect(filtered(post)).toBe('hidden');
    });
  });

  describe('live changes', () => {
    it('filters again when an option, a saved filter or the master switch changes', async () => {
      await start();
      const post = posts.add(makePost('<p>Rainy weather today</p>'));
      expect(filtered(post)).toBeNull();

      await options.set('hidden_keywords', 'weather');
      expect(filtered(post)).toBe('hidden');
      await options.set('hidden_keywords', '');
      expect(filtered(post)).toBeNull();

      const filter = keepFilter({
        name: 'Rain',
        conditions: [{ kind: 'text', part: 'text', test: 'contains', values: ['rain'] }],
        actions: [{ kind: 'hide' }],
      });
      await setFilters([filter]);
      expect(note(post)?.textContent).toBe(`Post hidden by your “Rain” filter${NOTE_SHOW}`);

      await setFilters([{ ...filter, enabled: false }]);
      expect(filtered(post)).toBeNull();
      await setFilters([filter]);
      await options.set('post_filters', false);
      expect(filtered(post)).toBeNull();
      expect(document.querySelector(`#${STYLE_ID}`)).toBeNull();
    });

    it('lets a keep filter after a hiding one win', async () => {
      await start();
      await setFilters([
        keepFilter({
          conditions: [{ kind: 'text', part: 'text', test: 'contains', values: ['news'] }],
          actions: [{ kind: 'hide' }],
        }),
        keepFilter({
          conditions: [{ kind: 'text', part: 'text', test: 'contains', values: ['good'] }],
          actions: [{ kind: 'keep' }],
        }),
      ]);
      const bad = posts.add(makePost('<p>bad news</p>'));
      const good = posts.add(makePost('<p>good news</p>'));
      expect(filtered(bad)).toBe('hidden');
      expect(filtered(good)).toBeNull();
    });
  });

  it('undoes everything when it stops', async () => {
    await start({ hidden_keywords: 'cats' });
    await setFilters([
      keepFilter({
        conditions: [{ kind: 'text', part: 'text', test: 'contains', values: ['dogs'] }],
        actions: [
          { kind: 'add_class', className: 'marked' },
          { kind: 'style', css: 'color: red !important' },
        ],
      }),
    ]);
    const cats = posts.add(makePost('<p>cats</p>'));
    const dogs = posts.add(makePost('<p>dogs</p>'));
    expect(dogs.element.classList.contains('marked')).toBe(true);
    expect(document.querySelector(`#${STYLE_ID}`)).not.toBeNull();
    expect(document.documentElement.hasAttribute(FEED_FILTERING)).toBe(true);

    runner?.stop();
    expect(filtered(cats)).toBeNull();
    expect(note(cats)).toBeNull();
    expect(cats.element.hasAttribute(POST_CHECKED)).toBe(false);
    expect(dogs.element.classList.contains('marked')).toBe(false);
    expect(dogs.element.style.getPropertyValue('color')).toBe('');
    expect(document.querySelector(`#${STYLE_ID}`)).toBeNull();
    expect(document.documentElement.hasAttribute(FEED_FILTERING)).toBe(false);
  });

  it('counts the hidden posts on the badge, revealed ones included', async () => {
    const started = await start({ hidden_keywords: 'cats' });
    const one = posts.add(makePost('<p>cats</p>'));
    const two = posts.add(makePost('<p>more cats</p>'));
    posts.add(makePost('<p>dogs</p>'));
    expect(started.badge().count).toBe(2);
    note(one)?.click();
    expect(started.badge().count).toBe(2);
    posts.remove(two);
    expect(started.badge().count).toBe(1);
    posts.remove(one);
    posts.reset();
    expect(started.badge().count).toBe(0);
    posts.add(makePost('<p>cats</p>'));
    await options.set('post_filters', false);
    expect(started.badge().count).toBe(0);
  });

  it('reports the filters each post matched to the hit tracker', async () => {
    await start();
    const filter = keepFilter({
      conditions: [{ kind: 'text', part: 'text', test: 'contains', values: ['cats'] }],
      actions: [{ kind: 'hide' }],
    });
    await setFilters([filter]);
    const tracker = getFilterHitTracker(data);
    const post = posts.add(makePost('<p>cats</p>'));
    posts.add(makePost('<p>cats too</p>'));
    expect(tracker.countFor(filter)).toBe(2);
    posts.remove(post);
    expect(tracker.countFor(filter)).toBe(1);
    await options.set('post_filters', false);
    expect(tracker.countFor(filter)).toBe(0);
  });

  describe('outcome parts', () => {
    it('adds classes and styles to the post or to matches inside it, and undoes them exactly', async () => {
      await start();
      const filter = keepFilter({
        conditions: [{ kind: 'text', part: 'text', test: 'contains', values: ['hello'] }],
        actions: [
          { kind: 'add_class', className: 'own existing' },
          { kind: 'add_class', className: 'inner', selector: 'p' },
          { kind: 'add_class', className: 'never', selector: 'p[' },
          { kind: 'style', css: 'opacity: 0.5', selector: 'p' },
        ],
      });
      await setFilters([filter]);
      const post = makePost('<p style="opacity: 0.9">hello</p><form><p>a comment</p></form>');
      post.element.classList.add('existing');
      posts.add(post);
      const [message, comment] = post.element.querySelectorAll('p');
      expect(post.element.className).toBe('existing own');
      expect(message?.classList.contains('inner')).toBe(true);
      expect(comment?.classList.contains('inner')).toBe(false);
      expect(message?.style.getPropertyValue('opacity')).toBe('0.5');

      await setFilters([]);
      expect(post.element.className).toBe('existing');
      expect(message?.className).toBe('');
      expect(message?.style.getPropertyValue('opacity')).toBe('0.9');
    });

    it('replaces text without compounding when the post is filtered again', async () => {
      await start();
      await setFilters([
        keepFilter({
          conditions: [{ kind: 'text', part: 'text', test: 'contains', values: ['cat'] }],
          actions: [{ kind: 'replace', find: 'cat', replaceWith: 'cat cat' }],
        }),
      ]);
      const post = posts.add(
        makePost('<div data-ad-rendering-role="story_message"><span>a cat</span></div>'),
      );
      expect(post.element.textContent).toBe('a cat cat');
      posts.update(post);
      await options.set('hidden_keywords', 'nothing');
      expect(post.element.textContent).toBe('a cat cat');
    });

    it('tests element conditions inside the post only, and never matches a bad selector', async () => {
      await start();
      await setFilters([
        keepFilter({
          conditions: [{ kind: 'element', selector: 'video' }],
          actions: [{ kind: 'hide', noteText: 'video' }],
        }),
        keepFilter({
          conditions: [{ kind: 'element', selector: 'a[', negate: true }],
          actions: [{ kind: 'hide', noteText: 'bad' }],
        }),
      ]);
      const own = posts.add(makePost('<p>clip</p><video></video>'));
      const inComment = posts.add(makePost('<p>text</p><form><video></video></form>'));
      expect(note(own)?.textContent).toBe(`video${NOTE_SHOW}`);
      expect(filtered(inComment)).toBeNull();
    });

    it('tests age conditions against the post time, and never matches without one', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-27T12:00:00Z'));
      await start();
      await setFilters([
        keepFilter({
          conditions: [{ kind: 'age', olderThan: true, amount: 2, unit: 'days' }],
          actions: [{ kind: 'hide' }],
        }),
      ]);
      const old = posts.add(makePost('<p>old</p><time datetime="2026-11-20T12:00:00Z"></time>'));
      const fresh = posts.add(makePost('<p>new</p><time datetime="2026-11-27T08:00:00Z"></time>'));
      const timeless = posts.add(makePost('<p>no time</p>'));
      expect([old, fresh, timeless].map(filtered)).toEqual(['hidden', null, null]);
    });

    it('marks posts with a valid ID read or unread', async () => {
      await start();
      const history = savedReadHistory(data);
      await history.ready;
      await history.set({ '2000002': 1 });
      await setFilters([
        keepFilter({
          conditions: [{ kind: 'text', part: 'text', test: 'contains', values: ['seen'] }],
          actions: [{ kind: 'set_read' }],
        }),
        keepFilter({
          conditions: [{ kind: 'text', part: 'text', test: 'contains', values: ['again'] }],
          actions: [{ kind: 'set_unread' }],
        }),
      ]);
      const seen = posts.track(makePost('<p>seen it</p>'));
      posts.announce(seen, '1000001');
      posts.add(makePost('<p>show again</p>'), '2000002');
      posts.add(makePost('<p>seen, no id</p>'), null);
      posts.add(makePost('<p>seen, bad id</p>'), 'none');
      await vi.waitFor(() => expect(Object.keys(history.get())).toEqual(['1000001']));
    });
  });

  describe('ads', () => {
    const SPONSORED_ANSWER = { sponsored: true };

    it('hides posts the page world says are ads, and checks them only once answered', async () => {
      const answers = new Map<Element, PromiseWithResolvers<unknown>>();
      const ask = vi.fn((element: Element) => {
        const answer = Promise.withResolvers<unknown>();
        answers.set(element, answer);
        return answer.promise;
      });
      await start({ hide_sponsored_posts: true }, askingBridge(ask as PageWorld['ask']));
      const ad = posts.add(makePost('<p>Buy now</p>'));
      const plain = posts.add(makePost('<p>Sponsored</p>'));
      expect(ask).toHaveBeenCalledTimes(2);
      expect(ad.element.hasAttribute(POST_CHECKED)).toBe(false);

      answers.get(ad.element)?.resolve(SPONSORED_ANSWER);
      answers.get(plain.element)?.resolve({ sponsored: false });
      await vi.waitFor(() => expect(filtered(ad)).toBe('hidden'));
      expect(note(ad)?.textContent).toBe(`${BUILT_IN_NOTES.sponsored}${NOTE_SHOW}`);
      expect(ad.element.hasAttribute(POST_CHECKED)).toBe(true);
      await vi.waitFor(() => expect(plain.element.hasAttribute(POST_CHECKED)).toBe(true));
      // The visible word "Sponsored" is never taken for an ad.
      expect(filtered(plain)).toBeNull();

      posts.update(ad);
      expect(ask).toHaveBeenCalledTimes(2);
    });

    it('asks again after a timeout, and gives up after another failure', async () => {
      const failures: BridgeError[] = [
        new BridgeError('timeout', 'slow'),
        new BridgeError('failed', 'broken'),
      ];
      const ask = vi.fn(() => Promise.reject(failures.shift() ?? new Error('asked too often')));
      await start({ hide_sponsored_posts: true }, askingBridge(ask as PageWorld['ask']));
      const post = posts.add(makePost('<p>maybe an ad</p>'));
      await vi.waitFor(() => expect(post.element.hasAttribute(POST_CHECKED)).toBe(true));
      posts.update(post);
      expect(ask).toHaveBeenCalledTimes(2);
      await vi.waitFor(() => expect(failures).toHaveLength(0));
      posts.update(post);
      expect(ask).toHaveBeenCalledTimes(2);
      expect(filtered(post)).toBeNull();
    });

    it('takes no post for an ad when the bridge is unavailable', async () => {
      await start({ hide_sponsored_posts: true }, testBridge());
      const post = posts.add(makePost('<p>Sponsored</p>'));
      await vi.waitFor(() => expect(post.element.hasAttribute(POST_CHECKED)).toBe(true));
      expect(filtered(post)).toBeNull();
    });

    it('does not ask while no filter tests for ads, and never asks about the page post', async () => {
      const ask = vi.fn(() => Promise.resolve(SPONSORED_ANSWER));
      await start({ hidden_keywords: 'x' }, askingBridge(ask as PageWorld['ask']));
      const post = posts.add(makePost('<p>text</p>'));
      expect(ask).not.toHaveBeenCalled();
      expect(post.element.hasAttribute(POST_CHECKED)).toBe(true);

      await options.set('hide_sponsored_posts', true);
      expect(ask).toHaveBeenCalledTimes(1);
      posts.add(makePost('<p>text</p>', { permalink: true }));
      expect(ask).toHaveBeenCalledTimes(1);
    });

    it('hides Sponsored cards in the right rail and keeps the others', async () => {
      const rail = document.createElement('div');
      rail.dataset.pagelet = 'RightRail';
      const card = (text: string): HTMLElement => {
        const unit = document.createElement('div');
        const inner = document.createElement('span');
        inner.textContent = text;
        unit.append(inner);
        return unit;
      };
      const ad = card('An ad card');
      ad.id = 'ad';
      const birthdays = card('Birthdays');
      rail.append(ad, birthdays);
      document.body.append(rail);
      const bridge = testBridge({
        'right-rail-sponsored': (element) => ({ sponsored: element.id === 'ad' }),
      });
      await start({ hide_sponsored_posts: true }, bridge);
      await vi.waitFor(() => expect(ad.getAttribute(HIDDEN_ATTR)).toBe('none'));
      expect(birthdays.hasAttribute(HIDDEN_ATTR)).toBe(false);

      await options.set('hide_sponsored_posts', false);
      expect(ad.hasAttribute(HIDDEN_ATTR)).toBe(false);
    });
  });

  describe('no flash', () => {
    it('marks the page while new feed posts wait to be checked', async () => {
      await start({ hidden_keywords: 'cats' });
      const html = document.documentElement;
      expect(html.hasAttribute(FEED_FILTERING)).toBe(true);
      const post = posts.add(makePost('<p>hello</p>'));
      expect(post.element.hasAttribute(POST_CHECKED)).toBe(true);

      await options.set('post_filters_prevent_flash', false);
      expect(html.hasAttribute(FEED_FILTERING)).toBe(false);
      await options.set('post_filters_prevent_flash', true);
      expect(html.hasAttribute(FEED_FILTERING)).toBe(true);

      history.pushState({}, '', '/someone/posts/12345');
      dispatchEvent(new PopStateEvent('popstate'));
      await vi.waitFor(() => expect(html.hasAttribute(FEED_FILTERING)).toBe(false));
      history.pushState({}, '', '/someone');
      dispatchEvent(new PopStateEvent('popstate'));
      await vi.waitFor(() => expect(html.hasAttribute(FEED_FILTERING)).toBe(false));
      await options.set('post_filters_on_profiles', true);
      expect(html.hasAttribute(FEED_FILTERING)).toBe(true);
    });

    it('does nothing while there is nothing to filter', async () => {
      await start({ hide_suggested_posts: false });
      expect(document.documentElement.hasAttribute(FEED_FILTERING)).toBe(false);
      const post = posts.add(makePost('<p>hello</p>'));
      expect(post.element.hasAttribute(POST_CHECKED)).toBe(false);
      expect(document.querySelector(`#${STYLE_ID}`)).toBeNull();
    });
  });

  it('gives the built-in filters fixed ids', () => {
    expect(new Set(Object.values(BUILT_IN_IDS)).size).toBe(3);
  });
});
