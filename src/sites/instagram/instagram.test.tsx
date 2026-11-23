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
import { InstagramVideos, resolveInstagramVideoContainer } from './videos';

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
  const cleanups: Array<() => void | Promise<void>> = [];

  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    sessionStorage.clear();
    vi.spyOn(document, 'cookie', 'get').mockReturnValue('ds_user_id=555123');
    history.replaceState({}, '', '/');
  });

  afterEach(async () => {
    for (const stop of cleanups.splice(0)) {
      await stop();
    }
    vi.restoreAllMocks();
  });

  const stubElementsFromPoint = (elements: () => Element[]): void => {
    const orig = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint');
    Object.defineProperty(document, 'elementsFromPoint', { value: elements, configurable: true });
    cleanups.push(() => {
      if (orig) {
        Object.defineProperty(document, 'elementsFromPoint', orig);
      } else {
        Reflect.deleteProperty(document, 'elementsFromPoint');
      }
    });
  };

  const dispatchPointerClick = (
    target: EventTarget,
    { pointerId, clientX, clientY }: { pointerId: number; clientX: number; clientY: number },
  ): void => {
    target.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        isPrimary: true,
        pointerId,
        button: 0,
        clientX,
        clientY,
      }),
    );
    target.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        isPrimary: true,
        pointerId,
        button: 0,
        clientX,
        clientY,
      }),
    );
    target.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        detail: 1,
        button: 0,
        clientX,
        clientY,
      }),
    );
  };

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
          ig_video_scrubber: false,
          ig_video_click_pauses: false,
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
      ig_video_scrubber: false,
      ig_video_click_pauses: false,
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
        ig_video_scrubber: false,
        ig_video_click_pauses: false,
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
    stubElementsFromPoint(() => [video]);

    let paused = false;
    Object.defineProperty(video, 'paused', { get: () => paused, configurable: true });
    const pauseSpy = vi.spyOn(video, 'pause').mockImplementation(() => {
      paused = true;
    });
    const playSpy = vi.spyOn(video, 'play').mockImplementation(async () => {
      paused = false;
    });

    const { platform, store } = fakePlatform({
      'v2/instagram/555123/options': {
        ig_hide_sponsored: false,
        ig_hide_suggested: false,
        ig_video_scrubber: true,
        ig_video_click_pauses: true,
      },
    });
    cleanups.push(() =>
      store.set('v2/instagram/555123/options', {
        ig_hide_sponsored: false,
        ig_hide_suggested: false,
        ig_video_scrubber: false,
        ig_video_click_pauses: false,
      }),
    );
    await startSite(instagramSite, platform);

    const wrap = document.querySelector('#video-wrap') as HTMLElement;
    await vi.waitFor(() => expect(wrap.querySelector('[data-feed-sanity]')).not.toBeNull());

    // Full pointer press toggles playing -> paused.
    dispatchPointerClick(video, { pointerId: 1, clientX: 100, clientY: 100 });
    expect(pauseSpy).toHaveBeenCalledTimes(1);

    // Second click resumes playback.
    dispatchPointerClick(video, { pointerId: 2, clientX: 100, clientY: 100 });
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

  it('resolves Instagram video containers above single-child wrappers, ignores scrubber clicks in click-to-pause, and pauses media on hide', async () => {
    document.body.innerHTML = `
      <main>
        <article id="nested-post">
          <div id="player">
            <div style="position:relative;z-index:0">
              <div id="inner"><video id="nested-vid"></video></div>
            </div>
            <div role="presentation"></div>
            <button type="button">Mute</button>
          </div>
        </article>
        <article id="carousel-post">
          <div id="carousel">
            <div id="slide-1"><video id="c-vid-1"></video></div>
            <div id="slide-2"><video id="c-vid-2"></video></div>
          </div>
        </article>
        <article id="pending-ad">
          <a href="/reel/PENDING1/">1m</a>
          <video id="ad-vid"></video>
        </article>
      </main>
    `;

    const nestedVid = document.querySelector('#nested-vid') as HTMLVideoElement;
    const player = document.querySelector('#player') as HTMLElement;
    const slide1 = document.querySelector('#slide-1') as HTMLElement;
    const cVid1 = document.querySelector('#c-vid-1') as HTMLVideoElement;
    expect(resolveInstagramVideoContainer(nestedVid)).toBe(player);
    // Never climbs into a multi-video carousel container.
    expect(resolveInstagramVideoContainer(cVid1)).toBe(slide1);

    const adArticle = document.querySelector('#pending-ad') as HTMLElement;
    const adVid = document.querySelector('#ad-vid') as HTMLVideoElement;
    let adPaused = false;
    Object.defineProperty(adVid, 'paused', { get: () => adPaused, configurable: true });
    const adPauseSpy = vi.spyOn(adVid, 'pause').mockImplementation(() => {
      adPaused = true;
    });

    // Attach React fiber ad metadata to `#pending-ad` so `#enrich()` catches it asynchronously.
    Object.defineProperty(adArticle, '__reactFiber$test', {
      value: { memoizedProps: { isSponsored: true }, return: null },
      enumerable: true,
      configurable: true,
    });

    const nestedPauseSpy = vi.spyOn(nestedVid, 'pause').mockImplementation(() => undefined);
    Object.defineProperty(nestedVid, 'paused', { get: () => false, configurable: true });
    vi.spyOn(nestedVid, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 300));
    stubElementsFromPoint(() => [nestedVid]);

    const { platform, store } = fakePlatform(
      {
        'v2/instagram/555123/options': {
          ig_hide_sponsored: true,
          ig_hide_suggested: true,
          ig_video_scrubber: true,
          ig_video_click_pauses: true,
        },
      },
      async () => {
        const handle = startInstagramPageWorld({});
        cleanups.push(handle.dispose);
      },
    );
    cleanups.push(() =>
      store.set('v2/instagram/555123/options', {
        ig_hide_sponsored: false,
        ig_hide_suggested: false,
        ig_video_scrubber: false,
        ig_video_click_pauses: false,
      }),
    );

    await startSite(instagramSite, platform);

    // Scrubber and Save-button overlays mount as direct children of `#player` (above `#inner` and `role="presentation"`).
    await vi.waitFor(() =>
      expect(player.querySelectorAll(':scope > [data-feed-sanity]').length).toBeGreaterThanOrEqual(
        2,
      ),
    );
    const overlays = [...player.querySelectorAll<HTMLElement>(':scope > [data-feed-sanity]')];
    const overlayHost = overlays[0] as HTMLElement;
    expect(overlays).toContain(player.lastElementChild);

    // Clicking our own `[data-feed-sanity]` overlay must NOT trigger click-to-pause.
    dispatchPointerClick(overlayHost, { pointerId: 7, clientX: 150, clientY: 295 });
    expect(nestedPauseSpy).not.toHaveBeenCalled();

    // Fiber-detected Sponsored video post is hidden AND its playing video is paused.
    await vi.waitFor(() => expect(adArticle.getAttribute(HIDDEN_ATTR)).toBe('none'));
    expect(adPauseSpy).toHaveBeenCalledTimes(1);
    expect(adArticle.getAttribute('data-feed-sanity-ig-checked')).toBe('1');
  });

  it('keeps pending articles concealed until bridge enrichment settles, catches late DOM signals, settles on bridge failure, and promotes late-mounted video overlays', async () => {
    document.body.innerHTML = `
      <main>
        <article id="delayed-organic"><a href="/p/ORG77/">1m</a><span>Organic caption</span></article>
        <article id="late-suggested"><a href="/p/LATE88/">2m</a><span>Hydrating...</span></article>
        <article id="late-video-post">
          <div id="late-player">
            <div style="position:relative;z-index:0">
              <div id="late-inner"><video id="late-vid"></video></div>
            </div>
          </div>
        </article>
      </main>
    `;

    let resolveBridge!: () => void;
    const bridgeReady = new Promise<void>((resolve) => {
      resolveBridge = resolve;
    });

    const { platform, store } = fakePlatform(
      {
        'v2/instagram/555123/options': {
          ig_hide_sponsored: true,
          ig_hide_suggested: true,
          ig_video_scrubber: true,
          ig_video_click_pauses: false,
        },
      },
      async () => {
        await bridgeReady;
        const handle = startInstagramPageWorld({});
        cleanups.push(handle.dispose);
      },
    );
    cleanups.push(() =>
      store.set('v2/instagram/555123/options', {
        ig_hide_sponsored: false,
        ig_hide_suggested: false,
        ig_video_scrubber: false,
        ig_video_click_pauses: false,
      }),
    );

    await startSite(instagramSite, platform);

    const delayedOrganic = document.querySelector('#delayed-organic') as HTMLElement;
    const lateSuggested = document.querySelector('#late-suggested') as HTMLElement;
    const latePlayer = document.querySelector('#late-player') as HTMLElement;
    const lateInner = document.querySelector('#late-inner') as HTMLElement;

    // While bridge enrichment is still in flight, neither article is prematurely stamped checked.
    expect(delayedOrganic.hasAttribute('data-feed-sanity-ig-checked')).toBe(false);
    expect(lateSuggested.hasAttribute('data-feed-sanity-ig-checked')).toBe(false);

    // Late-hydrated "Suggested for you" label arrives before `#enrich` settles.
    const sugSpan = document.createElement('span');
    sugSpan.textContent = 'Suggested for you';
    lateSuggested.append(sugSpan);

    // Video starts inside single-child wrappers -> overlay mounts in `#late-inner` first.
    await vi.waitFor(() =>
      expect(lateInner.querySelector(':scope > [data-feed-sanity]')).not.toBeNull(),
    );

    // Host later appends a sibling overlay inside `#late-player` -> overlay promotes to `#late-player`.
    const lateOverlay = document.createElement('div');
    lateOverlay.setAttribute('role', 'presentation');
    latePlayer.append(lateOverlay);
    await vi.waitFor(() =>
      expect(latePlayer.querySelector(':scope > [data-feed-sanity]')).not.toBeNull(),
    );
    expect(latePlayer.lastElementChild?.hasAttribute('data-feed-sanity')).toBe(true);

    // Once the bridge resolves, organic reveals (`checked="1"`) and late-hydrated suggested hides.
    resolveBridge();
    await vi.waitFor(() =>
      expect(delayedOrganic.getAttribute('data-feed-sanity-ig-checked')).toBe('1'),
    );
    expect(delayedOrganic.hasAttribute(HIDDEN_ATTR)).toBe(false);
    await vi.waitFor(() => expect(lateSuggested.getAttribute(HIDDEN_ATTR)).toBe('none'));

    // Also verify bridge failure settles pending items to `checked="1"` rather than stalling.
    await store.set('v2/instagram/555123/options', {
      ig_hide_sponsored: false,
      ig_hide_suggested: false,
      ig_video_scrubber: false,
      ig_video_click_pauses: false,
    });
    document.body.innerHTML = '<main><article id="offline-org"><span>Hello</span></article></main>';
    const offline = fakePlatform(
      {
        'v2/instagram/555123/options': {
          ig_hide_sponsored: true,
          ig_hide_suggested: true,
          ig_video_scrubber: false,
          ig_video_click_pauses: false,
        },
      },
      () => Promise.reject(new Error('bridge failed')),
    );
    cleanups.push(() =>
      offline.store.set('v2/instagram/555123/options', {
        ig_hide_sponsored: false,
        ig_hide_suggested: false,
        ig_video_scrubber: false,
        ig_video_click_pauses: false,
      }),
    );
    await startSite(instagramSite, offline.platform);
    const offlineOrg = document.querySelector('#offline-org') as HTMLElement;
    await vi.waitFor(() =>
      expect(offlineOrg.getAttribute('data-feed-sanity-ig-checked')).toBe('1'),
    );
    expect(offlineOrg.hasAttribute(HIDDEN_ATTR)).toBe(false);
  });
});
