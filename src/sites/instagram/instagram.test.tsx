import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Badge, Platform } from '../../core/platform';
import type { NetworkTapHost } from '../../engines/network-tap';
import { PageBridge } from '../../core/bridge';
import { createDomEnvironment } from '../../core/dom-env';
import { Locators } from '../../core/locator';
import { startSite } from '../../core/site';
import { HIDDEN_ATTR } from '../../core/surface';
import { inMemoryStore } from '../../core/testing';
import { instagramSite } from '.';
import { isPlainInstagramHome } from './features/default-following';
import { InstagramFeed } from './feed';
import { startInstagramPageWorld } from './page-world';
import { IG_FEED_POST, IG_VIDEO, IG_VIDEO_CONTROL } from './selectors';
import { InstagramVideos } from './videos';

function fakePlatform(
  initial: Record<string, unknown> = {},
  installPageWorld: () => Promise<void> = () =>
    Promise.reject(new Error('no page world in unit test')),
): {
  platform: Platform;
  store: ReturnType<typeof inMemoryStore>;
  badges: Badge[];
} {
  const store = inMemoryStore(initial);
  const badges: Badge[] = [];
  const platform: Platform = {
    store,
    build: 'test',
    onOpenOptions: () => undefined,
    setBadge: (badge) => badges.push(badge),
    installPageWorld,
  };
  return { platform, store, badges };
}

describe('instagramSite adapter and features', () => {
  const cleanups: Array<() => void> = [];

  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    sessionStorage.clear();
    vi.spyOn(document, 'cookie', 'get').mockReturnValue('ds_user_id=555123');
    history.replaceState({}, '', '/');
  });

  afterEach(() => {
    for (const stop of cleanups.splice(0)) {
      stop();
    }
    vi.restoreAllMocks();
  });

  it('delivers initial posts exactly once in InstagramFeed and resets stats().started on unsubscribe', () => {
    document.body.innerHTML = '<article id="p1"><a href="/p/First1/">1h</a></article>';
    const env = createDomEnvironment();
    cleanups.push(() => env.dispose());
    const locators = new Locators({ resolve: (s) => s, onChange: () => () => undefined }, [
      IG_FEED_POST,
    ]);
    const bridge = new PageBridge(() => Promise.reject(new Error('offline')));
    const feed = new InstagramFeed(env, (spec) => locators.locate(spec), bridge);

    const added: string[] = [];
    const tracked: string[] = [];
    const stopAdd = feed.onAdd((post) => added.push(post.element.id));
    const stopTrack = feed.onTrack((post) => tracked.push(post.element.id));

    expect(added).toEqual(['p1']);
    expect(tracked).toEqual(['p1']);
    expect(feed.stats().started).toBe(true);

    stopAdd();
    stopTrack();
    expect(feed.stats().started).toBe(false);
  });

  it('hides Sponsored, Suggested, and keyword posts, updates on Network Tap capture, and tears down when off', async () => {
    document.body.innerHTML = `
      <nav>
        <a href="/reels/">Reels</a>
        <a href="/explore/">Explore</a>
        <a href="https://www.threads.com/">Threads</a>
      </nav>
      <main>
        <article id="organic"><a href="/p/Org123/">2h</a><span>Nice photo of mountains</span></article>
        <article id="ad"><span>Sponsored</span><span>Buy widgets now</span></article>
        <article id="suggested"><span>Suggested for you</span><span>Random reel</span></article>
        <article id="keyword"><a href="/p/Kw456/">1h</a><span>Crypto giveaway today</span></article>
        <article id="stealth-ad"><a href="/p/Stealth99/">1h</a><span>Unlabeled promo</span></article>
      </main>
    `;

    const netHost: NetworkTapHost = {
      fetch: vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ data: { node: { code: 'Stealth99', ad_id: 'ad77' } } }), {
            status: 200,
          }),
        ),
      ) as unknown as typeof globalThis.fetch,
    };

    const { platform, store, badges } = fakePlatform(
      {
        'v2/instagram/555123/options': {
          ig_hide_sponsored: true,
          ig_hide_suggested: true,
          ig_keywords: 'crypto\n',
          ig_hide_reels_nav: true,
          ig_hide_threads_nav: true,
          custom_stylesheet_url: 'https://example.com/ig.css',
        },
      },
      async () => {
        const handle = startInstagramPageWorld(netHost);
        cleanups.push(handle.dispose);
      },
    );

    const failed = await startSite(instagramSite, platform);
    expect(failed).toEqual([]);

    const organic = document.querySelector('#organic') as HTMLElement;
    const ad = document.querySelector('#ad') as HTMLElement;
    const suggested = document.querySelector('#suggested') as HTMLElement;
    const keyword = document.querySelector('#keyword') as HTMLElement;
    const stealthAd = document.querySelector('#stealth-ad') as HTMLElement;

    expect(organic.hasAttribute(HIDDEN_ATTR)).toBe(false);
    expect(ad.getAttribute(HIDDEN_ATTR)).toBe('none');
    expect(suggested.getAttribute(HIDDEN_ATTR)).toBe('none');
    expect(keyword.getAttribute(HIDDEN_ATTR)).toBe('none');
    expect(stealthAd.hasAttribute(HIDDEN_ATTR)).toBe(false);
    expect(badges.at(-1)).toEqual({ count: 3, failed: false });

    // Late GraphQL response arrives AFTER render: `ig:network-stats` triggers recheck and hides stealthAd!
    await netHost.fetch?.('https://www.instagram.com/graphql/query', {
      method: 'POST',
      body: '{}',
    });
    await vi.waitFor(() => expect(stealthAd.getAttribute(HIDDEN_ATTR)).toBe('none'));
    expect(badges.at(-1)).toEqual({ count: 4, failed: false });

    // Removing a hidden article decrements the badge count.
    ad.remove();
    await vi.waitFor(() => expect(badges.at(-1)).toEqual({ count: 3, failed: false }));

    // Disabling all three filters unhides remaining posts and cleans up concealment attributes.
    await store.set('v2/instagram/555123/options', {
      ig_hide_sponsored: false,
      ig_hide_suggested: false,
      ig_keywords: '',
      ig_hide_reels_nav: false,
      ig_hide_threads_nav: false,
      custom_stylesheet_url: 'https://example.com/ig.css',
    });
    await vi.waitFor(() => expect(badges.at(-1)).toEqual({ count: 0, failed: false }));
    expect(suggested.hasAttribute(HIDDEN_ATTR)).toBe(false);
    expect(keyword.hasAttribute(HIDDEN_ATTR)).toBe(false);
    expect(stealthAd.hasAttribute(HIDDEN_ATTR)).toBe(false);
    expect(document.documentElement.hasAttribute('data-feed-sanity-ig-filtering')).toBe(false);
    expect(document.querySelector('a[href="/reels/"]')?.hasAttribute(HIDDEN_ATTR)).toBe(false);

    // Cross-site `external_css` feature runs identically on Instagram.
    const cssLink = document.querySelector('#feed_sanity_custom_stylesheet') as HTMLLinkElement | null;
    expect(cssLink?.href).toBe('https://example.com/ig.css');
  });

  it('redirects plain home and Home clicks to Following feed with session loop guard and signed-out guard', async () => {
    expect(isPlainInstagramHome({ pathname: '/', search: '' })).toBe(true);
    expect(isPlainInstagramHome({ pathname: '/', search: '?foo=1' })).toBe(true);
    expect(isPlainInstagramHome({ pathname: '/', search: '?variant=following' })).toBe(false);
    expect(isPlainInstagramHome({ pathname: '/reels/', search: '' })).toBe(false);

    document.body.innerHTML = '<nav><a id="home-link" href="/">Home</a></nav>';
    const replaceSpy = vi.spyOn(location, 'replace').mockImplementation(() => undefined);
    const assignSpy = vi.spyOn(location, 'assign').mockImplementation(() => undefined);

    const { platform } = fakePlatform({
      'v2/instagram/555123/options': {
        ig_default_following: true,
        ig_hide_sponsored: false,
        ig_hide_suggested: false,
      },
    });
    await startSite(instagramSite, platform);
    expect(replaceSpy).toHaveBeenCalledWith('/?variant=following');

    // A second start within LOOP_GUARD_MS does not redirect again thanks to sessionStorage.
    replaceSpy.mockClear();
    await startSite(instagramSite, platform);
    expect(replaceSpy).not.toHaveBeenCalled();

    // Plain left click on Home navigates to Following; Ctrl+click passes through.
    const homeLink = document.querySelector('#home-link') as HTMLAnchorElement;
    const plainClick = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    homeLink.dispatchEvent(plainClick);
    expect(plainClick.defaultPrevented).toBe(true);
    expect(assignSpy).toHaveBeenCalledWith('/?variant=following');

    assignSpy.mockClear();
    const ctrlClick = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
      ctrlKey: true,
    });
    homeLink.dispatchEvent(ctrlClick);
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it('mounts scrubber, pauses/plays feed videos on full PRESS_EVENTS, and fires TrackedInstagramVideo.onControls', async () => {
    document.body.innerHTML = `
      <main>
        <article>
          <div id="video-wrap"><video id="vid"></video></div>
        </article>
      </main>
    `;
    const video = document.querySelector('#vid') as HTMLVideoElement;
    const rect = new DOMRect(0, 0, 300, 300);
    vi.spyOn(video, 'getBoundingClientRect').mockReturnValue(rect);
    const origElementsFromPoint = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint');
    Object.defineProperty(document, 'elementsFromPoint', {
      value: () => [video],
      configurable: true,
    });
    cleanups.push(() => {
      if (origElementsFromPoint) {
        Object.defineProperty(document, 'elementsFromPoint', origElementsFromPoint);
      } else {
        Reflect.deleteProperty(document, 'elementsFromPoint');
      }
    });

    let paused = false;
    Object.defineProperty(video, 'paused', { get: () => paused, configurable: true });
    const pauseSpy = vi.spyOn(video, 'pause').mockImplementation(() => {
      paused = true;
    });
    const playSpy = vi.spyOn(video, 'play').mockImplementation(async () => {
      paused = false;
    });

    const { platform } = fakePlatform({
      'v2/instagram/555123/options': {
        ig_hide_sponsored: false,
        ig_hide_suggested: false,
        ig_video_scrubber: true,
        ig_video_click_pauses: true,
      },
    });
    await startSite(instagramSite, platform);

    const wrap = document.querySelector('#video-wrap') as HTMLElement;
    await vi.waitFor(() => expect(wrap.querySelector('[data-feed-sanity]')).not.toBeNull());

    // Full pointer press toggles playing -> paused.
    video.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        isPrimary: true,
        pointerId: 1,
        button: 0,
        clientX: 100,
        clientY: 100,
      }),
    );
    video.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        isPrimary: true,
        pointerId: 1,
        button: 0,
        clientX: 100,
        clientY: 100,
      }),
    );
    video.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        detail: 1,
        button: 0,
        clientX: 100,
        clientY: 100,
      }),
    );
    expect(pauseSpy).toHaveBeenCalledTimes(1);

    // Second click resumes playback.
    video.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        isPrimary: true,
        pointerId: 2,
        button: 0,
        clientX: 100,
        clientY: 100,
      }),
    );
    video.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        isPrimary: true,
        pointerId: 2,
        button: 0,
        clientX: 100,
        clientY: 100,
      }),
    );
    video.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        detail: 1,
        button: 0,
        clientX: 100,
        clientY: 100,
      }),
    );
    expect(playSpy).toHaveBeenCalledTimes(1);

    // TrackedInstagramVideo.onControls notifies on first `playing` event.
    const env = createDomEnvironment();
    cleanups.push(() => env.dispose());
    const locators = new Locators({ resolve: (s) => s, onChange: () => () => undefined }, [
      IG_VIDEO,
      IG_VIDEO_CONTROL,
    ]);
    const videos = new InstagramVideos(env, (spec) => locators.locate(spec));
    let controlEvents = 0;
    const stopVid = videos.onAdd((tracked) => {
      tracked.onControls(() => {
        controlEvents++;
      });
    });
    cleanups.push(stopVid);
    video.dispatchEvent(new Event('playing'));
    video.dispatchEvent(new Event('playing'));
    expect(controlEvents).toBe(1);
    video.dispatchEvent(new Event('emptied'));
    video.dispatchEvent(new Event('playing'));
    expect(controlEvents).toBe(3);
  });
});
