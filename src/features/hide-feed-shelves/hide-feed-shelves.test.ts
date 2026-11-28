import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { FacebookPage } from '../../facebook/feature';
import { FeatureRunner } from '../../core/app';
import { Options } from '../../core/options';
import { SavedData } from '../../core/saved';
import { HIDDEN_ATTR, OWN_ATTR } from '../../core/surface';
import { bindPage } from '../../facebook/feature';
import { videoPage } from '../../facebook/testing';
import { extensionStore } from '../../platform/extension-store';
import hideFeedShelves, { isReelsBarUnit } from './index';

const isHidden = (el: Element | null): boolean => el?.getAttribute(HIDDEN_ATTR) === 'none';

function navigateTo(address: string): void {
  history.replaceState({}, '', address);
  dispatchEvent(new PopStateEvent('popstate'));
}

describe('hide_feed_shelves', () => {
  let options: Options;
  let runner: FeatureRunner<FacebookPage> | undefined;

  beforeEach(() => {
    fakeBrowser.reset();
    history.replaceState({}, '', '/');
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    options = new Options(extensionStore, 'u/options');
  });

  afterEach(() => {
    runner?.stop();
    runner = undefined;
    options.dispose();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  const start = async (initial: Record<string, boolean> = {}): Promise<void> => {
    const page = videoPage();
    const data = new SavedData(extensionStore, 'u');
    const nextRunner = new FeatureRunner([hideFeedShelves], options, bindPage(page), data);
    runner = nextRunner;
    expect(await nextRunner.start()).toEqual([]);
    for (const [key, val] of Object.entries(initial)) {
      await options.set(key, val);
    }
  };

  it('hides the Stories bar across feeds, restores it live on toggle off, and stays inactive on /stories/', async () => {
    document.body.innerHTML = `
      <div role="main">
        <div id="column-wrapper">
          <div role="region" aria-label="Create a post">Composer</div>
          <div id="stories-pagelet" data-pagelet="Stories">
            <div aria-label="Stories">Story cards</div>
          </div>
          <div id="top-stories-region" role="region" aria-label="Top stories">News box</div>
          <div role="feed">
            <div id="regular-post" aria-posinset="1">Hello world</div>
            <div id="authored-stories-post" aria-posinset="2">
              <a href="/alice/posts/12345">Permalink</a>
              <div aria-label="Stories">Embedded card</div>
            </div>
          </div>
        </div>
      </div>
    `;
    await start();

    const stories = document.querySelector('#stories-pagelet');
    const composer = document.querySelector('[aria-label="Create a post"]');
    const topStories = document.querySelector('#top-stories-region');
    const regularPost = document.querySelector('#regular-post');
    const authoredStoriesPost = document.querySelector('#authored-stories-post');

    expect(isHidden(stories)).toBe(false);

    await options.set('hide_stories_bar', true);
    expect(isHidden(stories)).toBe(true);
    expect(document.querySelector('#feed_sanity_hide_stories_bar')).not.toBeNull();
    expect(isHidden(composer)).toBe(false);
    expect(isHidden(topStories)).toBe(false);
    expect(isHidden(regularPost)).toBe(false);
    expect(isHidden(authoredStoriesPost)).toBe(false);

    // Navigating to the Stories viewer restores Stories UI cleanly.
    navigateTo('/stories/12345/');
    expect(isHidden(stories)).toBe(false);
    expect(document.querySelector('#feed_sanity_hide_stories_bar')).toBeNull();

    // Returning to a Groups or Friends feed hides Stories again.
    navigateTo('/groups/gardening/');
    expect(isHidden(stories)).toBe(true);

    // Toggling off restores immediately without reload.
    await options.set('hide_stories_bar', false);
    expect(isHidden(stories)).toBe(false);
    expect(document.querySelector('#feed_sanity_hide_stories_bar')).toBeNull();
  });

  it('never hides a main column wrapper during progressive hydration before the feed mounts', async () => {
    document.body.innerHTML = `
      <div role="main">
        <div id="main-column">
          <div id="fallback-stories" aria-label="Stories">Story cards</div>
        </div>
      </div>
    `;
    await start({ hide_stories_bar: true });

    const column = document.querySelector('#main-column');
    const fallbackStories = document.querySelector('#fallback-stories');
    expect(isHidden(column)).toBe(false);
    expect(isHidden(fallbackStories)).toBe(true);
  });

  it('hides inline Reels carousels across all feeds without hiding authored posts, shared reels, or viewer/tab routes', async () => {
    document.body.innerHTML = `
      <div role="main">
        <div id="stories-bar" data-pagelet="Stories">
          <a href="/reel/100">Story reel tab</a>
          <a href="/reel/101">Second link</a>
        </div>
        <div role="feed">
          <div id="reels-pagelet" data-pagelet="FeedReels">Reels shelf</div>
          <div id="inline-carousel" aria-posinset="1">
            <a href="/reel/111111/">Reel 1</a>
            <a href="/reel/222222/">Reel 2</a>
          </div>
          <div id="heading-shelf" aria-posinset="2">
            <h3>Reels and short videos</h3>
            <a href="/reel/333333/">Reel 3</a>
          </div>
          <div id="shared-reel-post" aria-posinset="3">
            <h4>Jane Doe</h4>
            <svg aria-label="Reels"></svg>
            <a href="/reel/444444/">Cover</a>
            <a href="/reel/444444/?s=fb">Caption link to same reel</a>
          </div>
          <div id="authored-two-reels-post" aria-posinset="4">
            <h3>Reels</h3>
            <a href="/groups/123/posts/999/">Permalink</a>
            <a href="/reel/777777/">First shared reel</a>
            <a href="/reel/888888/">Second shared reel</a>
          </div>
          <div id="story-php-post" aria-posinset="5">
            <div data-ad-rendering-role="profile_name">Alice</div>
            <a href="/story.php?story_fbid=123">Timestamp</a>
            <a href="/reel/900001/">First reel</a>
            <a href="/reel/900002/">Second reel</a>
          </div>
          <div id="embedded-reels-label-post" aria-posinset="6">
            <a href="/alice/posts/123456">Permalink</a>
            <div aria-label="Reels">Embedded Reel player</div>
          </div>
        </div>
      </div>
    `;
    await start({ hide_reels_bar: true });

    const storiesBar = document.querySelector('#stories-bar');
    const reelsPagelet = document.querySelector('#reels-pagelet');
    const inlineCarousel = document.querySelector('#inline-carousel');
    const headingShelf = document.querySelector('#heading-shelf');
    const sharedReelPost = document.querySelector('#shared-reel-post');
    const authoredTwoReelsPost = document.querySelector('#authored-two-reels-post');
    const storyPhpPost = document.querySelector('#story-php-post');
    const embeddedLabelPost = document.querySelector('#embedded-reels-label-post');

    expect(isHidden(reelsPagelet)).toBe(true);
    expect(isHidden(inlineCarousel)).toBe(true);
    expect(isHidden(headingShelf)).toBe(true);
    // Single shared-reel posts and authored posts stay untouched.
    expect(isHidden(sharedReelPost)).toBe(false);
    expect(isHidden(authoredTwoReelsPost)).toBe(false);
    expect(isHidden(storyPhpPost)).toBe(false);
    expect(isHidden(embeddedLabelPost)).toBe(false);
    // Stories bar is controlled independently by hide_stories_bar.
    expect(isHidden(storiesBar)).toBe(false);

    // Late-arriving inline Reels carousel hydrated progressively across two mutations is hidden.
    const lateShelf = document.createElement('div');
    lateShelf.id = 'late-reels-shelf';
    lateShelf.setAttribute('aria-posinset', '7');
    const linkA = document.createElement('a');
    linkA.href = '/reel/555555/';
    linkA.textContent = 'First';
    lateShelf.append(linkA);
    document.querySelector('[role="feed"]')?.append(lateShelf);
    await Promise.resolve();
    expect(isHidden(lateShelf)).toBe(false);

    const linkB = document.createElement('a');
    linkB.href = '/reel/666666/';
    linkB.textContent = 'Second';
    lateShelf.append(linkB);
    await vi.waitFor(() => expect(isHidden(lateShelf)).toBe(true));

    // If React recycles the slot by removing its inner reel links, the slot unhides cleanly.
    linkA.remove();
    linkB.remove();
    await vi.waitFor(() => expect(isHidden(lateShelf)).toBe(false));

    // Navigating to /reel/, /reels/, profile Reels tab, or a single post restores cleanly.
    for (const excluded of [
      '/reel/444444/',
      '/reels/',
      '/janedoe/reels/',
      '/janedoe?sk=reels_tab',
      '/janedoe/posts/123456789/',
    ]) {
      navigateTo(excluded);
      expect(isHidden(reelsPagelet)).toBe(false);
      expect(isHidden(inlineCarousel)).toBe(false);
      expect(document.querySelector('#feed_sanity_hide_reels_bar')).toBeNull();

      // Returning to a feed route hides Reels bars again.
      navigateTo('/?filter=friends&sk=h_chr');
      expect(isHidden(reelsPagelet)).toBe(true);
      expect(isHidden(inlineCarousel)).toBe(true);
    }

    // Turning off restores immediately.
    await options.set('hide_reels_bar', false);
    expect(isHidden(reelsPagelet)).toBe(false);
    expect(isHidden(inlineCarousel)).toBe(false);
    expect(isHidden(headingShelf)).toBe(false);
  });

  it('never classifies dialogs, Feed Sanity UI, or main/feed/body landmarks as inline Reels bars', () => {
    document.body.innerHTML = `
      <div role="dialog" id="dlg">
        <a href="/reel/1/">A</a>
        <a href="/reel/2/">B</a>
      </div>
      <div ${OWN_ATTR} id="own">
        <a href="/reel/1/">A</a>
        <a href="/reel/2/">B</a>
      </div>
      <div role="main" id="main">
        <div role="feed" id="feed">
          <a href="/reel/1/">A</a>
          <a href="/reel/2/">B</a>
        </div>
      </div>
    `;
    expect(isReelsBarUnit(document.querySelector('#dlg')!)).toBe(false);
    expect(isReelsBarUnit(document.querySelector('#own')!)).toBe(false);
    expect(isReelsBarUnit(document.querySelector('#main')!)).toBe(false);
    expect(isReelsBarUnit(document.querySelector('#feed')!)).toBe(false);
    expect(isReelsBarUnit(document.body)).toBe(false);
  });
});
