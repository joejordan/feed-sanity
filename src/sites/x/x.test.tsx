import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Badge, Platform } from '../../core/platform';
import type { NetworkTapHost } from '../../engines/network-tap';
import { startSite } from '../../core/site';
import { HIDDEN_ATTR } from '../../core/surface';
import { inMemoryStore } from '../../core/testing';
import { xSite } from '.';
import { startXPageWorld } from './page-world';

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

describe('xSite adapter and features', () => {
  const cleanups: Array<() => void> = [];

  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    vi.spyOn(document, 'cookie', 'get').mockReturnValue('twid=u%3D424242');
    history.replaceState({}, '', '/home');
  });

  afterEach(() => {
    for (const stop of cleanups.splice(0)) {
      stop();
    }
    vi.restoreAllMocks();
  });

  it('strips promoted timeline API entries, hides DOM/keyword tweets, hides clutter, and defaults to Following tab', async () => {
    const timelineJson = JSON.stringify({
      instructions: [
        {
          entries: [{ entryId: 'tweet-1' }, { entryId: 'promoted-tweet-2' }],
        },
      ],
    });
    const baseFetch = vi.fn(() => Promise.resolve(new Response(timelineJson, { status: 200 })));
    const netHost: NetworkTapHost = { fetch: baseFetch as unknown as typeof globalThis.fetch };

    document.body.innerHTML = `
      <nav>
        <a href="/i/grok">Grok</a>
        <a data-testid="premium-hub-tab" href="/i/premium">Premium</a>
        <a data-testid="AppTabBar_Explore_Link" href="/explore">Explore</a>
      </nav>
      <div data-testid="GrokDrawer">Grok Drawer</div>
      <div data-testid="primaryColumn">
        <div role="tablist">
          <a role="tab" aria-selected="true">For you</a>
          <a id="following-tab" role="tab" aria-selected="false">Following</a>
        </div>
        <article id="t-organic" data-testid="tweet">
          <a href="/alice/status/111">1h</a>
          <button id="grok-actions-btn" type="button" aria-label="Grok actions">
            Grok
          </button>
          <button id="grok-explain-btn" type="button" aria-label="Explain this post with Grok">
            Explain
          </button>
          <div id="grok-img-btn" data-testid="grokImgGen">
            Edit with Grok
          </div>
          <a id="grok-deep-link" href="/i/grok?focus=1&post=111">
            Ask Grok
          </a>
          <div data-testid="tweetText">Great systems engineering post</div>
        </article>
        <article id="t-reply" data-testid="tweet">
          <div id="grok-reply-btn" role="button" aria-label="Grok actions">
            Grok
          </div>
          <div data-testid="tweetText">Reply mentioning Grok in plain text</div>
        </article>
        <article id="t-ad" data-testid="tweet">
          <div data-testid="placementTracking"><span>Ad</span></div>
          <div data-testid="tweetText">Buy now</div>
        </article>
        <article id="t-kw" data-testid="tweet">
          <a href="/bob/status/222">2h</a>
          <div data-testid="tweetText">Check out this airdrop promo</div>
        </article>
        <article id="t-vid" data-testid="tweet">
          <div id="player" data-testid="videoPlayer"><video></video></div>
        </article>
      </div>
      <div data-testid="sidebarColumn">What's happening</div>
    `;

    const followingTab = document.querySelector('#following-tab') as HTMLElement;
    const followingClick = vi.fn(() => followingTab.setAttribute('aria-selected', 'true'));
    followingTab.addEventListener('click', followingClick);

    const { platform, store, badges } = fakePlatform(
      {
        'v2/x/424242/options': {
          x_default_following: true,
          x_hide_sponsored: true,
          x_hide_suggested: true,
          x_keywords: 'airdrop\n',
          x_hide_grok: true,
          x_hide_premium: true,
          x_hide_sidebar: true,
          x_video_scrubber: true,
          custom_stylesheet_url: 'https://example.com/x.css',
        },
      },
      async () => {
        const handle = startXPageWorld(netHost);
        cleanups.push(handle.dispose);
      },
    );

    const failed = await startSite(xSite, platform);
    expect(failed).toEqual([]);

    // Following tab automatically clicked once on `/home`, and stays silent on extra DOM tab mutations.
    expect(followingClick).toHaveBeenCalledTimes(1);
    const extraTab = document.createElement('a');
    extraTab.setAttribute('role', 'tab');
    extraTab.textContent = 'Following';
    document.querySelector('[role="tablist"]')?.append(extraTab);
    await new Promise((r) => setTimeout(r, 0));
    expect(followingClick).toHaveBeenCalledTimes(1);

    // Leaving `/home` and returning re-arms the one-shot switch when Following is unselected.
    history.pushState({}, '', '/explore');
    globalThis.dispatchEvent(new PopStateEvent('popstate'));
    followingTab.setAttribute('aria-selected', 'false');
    history.pushState({}, '', '/home');
    globalThis.dispatchEvent(new PopStateEvent('popstate'));
    expect(followingClick).toHaveBeenCalledTimes(2);
    // Re-entering when already `aria-selected="true"` does not click again.
    history.pushState({}, '', '/explore');
    globalThis.dispatchEvent(new PopStateEvent('popstate'));
    history.pushState({}, '', '/home');
    globalThis.dispatchEvent(new PopStateEvent('popstate'));
    expect(followingClick).toHaveBeenCalledTimes(2);

    // Organic tweet stays visible; ad and keyword tweets are hidden and counted on badge.
    expect(document.querySelector('#t-organic')?.hasAttribute(HIDDEN_ATTR)).toBe(false);
    expect(document.querySelector('#t-ad')?.getAttribute(HIDDEN_ATTR)).toBe('none');
    expect(document.querySelector('#t-kw')?.getAttribute(HIDDEN_ATTR)).toBe('none');
    expect(badges.at(-1)).toEqual({ count: 2, failed: false });

    // MAIN-world Network Tap toggle is enabled and strips promoted entries before render!
    await vi.waitFor(() => expect(netHost.fetch).not.toBe(baseFetch));
    const res = await netHost.fetch?.('https://x.com/i/api/graphql/xyz/HomeTimeline');
    const json = (await res?.json()) as {
      instructions: Array<{ entries: Array<{ entryId: string }> }>;
    };
    expect(json.instructions[0]?.entries.map((e) => e.entryId)).toEqual(['tweet-1']);

    // Chrome clutter toggles inject scoped CSS rules for Grok (nav, drawer, and post/reply buttons),
    // Premium, and Sidebar while leaving Explore and organic post content untouched.
    const grokStyle = document.querySelector('#feed_sanity_clutter_x_hide_grok')?.textContent ?? '';
    expect(grokStyle).toContain('display: none !important');
    const grokSelector = grokStyle.replace(/\s*\{[\s\S]*$/, '').trim();
    for (const id of [
      '#grok-actions-btn',
      '#grok-explain-btn',
      '#grok-img-btn',
      '#grok-deep-link',
      '#grok-reply-btn',
    ]) {
      expect(document.querySelector(id)?.matches(grokSelector), id).toBe(true);
    }
    expect(document.querySelector('#t-reply')?.matches(grokSelector)).toBe(false);
    expect(document.querySelector('#t-organic')?.matches(grokSelector)).toBe(false);
    expect(document.querySelector('#feed_sanity_clutter_x_hide_premium')?.textContent).toContain(
      'display: none !important',
    );
    expect(document.querySelector('#feed_sanity_clutter_x_hide_sidebar')?.textContent).toContain(
      'display: none !important',
    );
    expect(document.querySelector('#feed_sanity_clutter_x_hide_explore')).toBeNull();

    // Shared video scrubber mounts inside `[data-testid="videoPlayer"]`.
    const player = document.querySelector('#player') as HTMLElement;
    await vi.waitFor(() => expect(player.querySelector('[data-feed-sanity]')).not.toBeNull());

    // X natively supports click-to-pause, so `x_video_click_pauses` is not registered and
    // clicks inside `[data-testid="videoPlayer"]` (including X's volume slider track) pass through untouched.
    expect(
      xSite.features.some(
        (feature) => feature.options && 'x_video_click_pauses' in feature.options,
      ),
    ).toBe(false);
    const xVideo = player.querySelector('video') as HTMLVideoElement;
    const volumeTrack = document.createElement('div');
    player.append(volumeTrack);
    Object.defineProperty(xVideo, 'paused', { value: false, configurable: true });
    vi.spyOn(xVideo, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 200));
    const pauseSpy = vi.spyOn(xVideo, 'pause').mockImplementation(() => undefined);
    const seenEvents: string[] = [];
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'] as const) {
      volumeTrack.addEventListener(type, () => seenEvents.push(type));
    }
    const origElementsFromPoint = document.elementsFromPoint;
    document.elementsFromPoint = () => [volumeTrack, xVideo];
    try {
      volumeTrack.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          composed: true,
          isPrimary: true,
          pointerId: 1,
          clientX: 280,
          clientY: 140,
        }),
      );
      volumeTrack.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          composed: true,
          button: 0,
          clientX: 280,
          clientY: 140,
        }),
      );
      volumeTrack.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          composed: true,
          isPrimary: true,
          pointerId: 1,
          clientX: 280,
          clientY: 140,
        }),
      );
      volumeTrack.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          composed: true,
          button: 0,
          clientX: 280,
          clientY: 140,
        }),
      );
      volumeTrack.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          composed: true,
          detail: 1,
          clientX: 280,
          clientY: 140,
        }),
      );
      expect(seenEvents).toEqual(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
      expect(pauseSpy).not.toHaveBeenCalled();
    } finally {
      document.elementsFromPoint = origElementsFromPoint;
    }

    // Cross-site `external_css` runs identically on X.
    const cssLink = document.querySelector('#feed_sanity_custom_stylesheet') as HTMLLinkElement | null;
    expect(cssLink?.href).toBe('https://example.com/x.css');

    // Disabling `x_hide_sponsored` restores `netHost.fetch` cleanly without reload.
    await store.set('v2/x/424242/options', {
      x_default_following: false,
      x_hide_sponsored: false,
      x_hide_suggested: false,
      x_keywords: '',
      x_hide_grok: false,
      x_hide_premium: false,
      x_hide_sidebar: false,
      x_video_scrubber: false,
      custom_stylesheet_url: '',
    });
    await vi.waitFor(() => expect(netHost.fetch).toBe(baseFetch));
    await vi.waitFor(() => expect(player.querySelector('[data-feed-sanity]')).toBeNull());
    expect(document.querySelector('#t-ad')?.hasAttribute(HIDDEN_ATTR)).toBe(false);
    expect(document.querySelector('#feed_sanity_clutter_x_hide_sidebar')).toBeNull();
  });
});
