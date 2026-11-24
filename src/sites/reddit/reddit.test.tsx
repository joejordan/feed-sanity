import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Badge, Platform } from '../../core/platform';
import { newFilter, newRule } from '../../core/filter-types';
import { startSite } from '../../core/site';
import { HIDDEN_ATTR } from '../../core/surface';
import { inMemoryStore } from '../../core/testing';
import { applyThemePreset, DEFAULT_THEME_DOCUMENT } from '../../core/theming';
import { THEME_DATA_KEY } from '../../ui/appearance';
import { redditSite } from './index';
import { startRedditPageWorld } from './page-world';

function fakePlatform(
  initial: Record<string, unknown>,
  installPageWorld: () => Promise<void>,
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

function makeShadowPost(
  id: string,
  attrs: Record<string, string>,
  shadowHtml: { title: string; body: string; credit?: string; hasVideo?: boolean },
): HTMLElement {
  const post = document.createElement('shreddit-post');
  post.setAttribute('id', id);
  for (const [k, v] of Object.entries(attrs)) {
    post.setAttribute(k, v);
  }
  const shadow = post.attachShadow({ mode: 'open' });
  const card = document.createElement('div');
  card.className = 'post-card';
  if (shadowHtml.credit) {
    const credit = document.createElement('div');
    credit.className = 'credit-bar';
    credit.textContent = shadowHtml.credit;
    card.append(credit);
  }
  const heading = document.createElement('h2');
  heading.dataset.testid = 'post-title';
  heading.textContent = shadowHtml.title;
  const body = document.createElement('p');
  body.className = 'post-body';
  body.textContent = shadowHtml.body;
  card.append(heading, body);

  if (shadowHtml.hasVideo) {
    const player = document.createElement('shreddit-player');
    const playerShadow = player.attachShadow({ mode: 'open' });
    const shell = document.createElement('div');
    shell.className = 'media-container';
    const video = document.createElement('video');
    shell.append(video);
    playerShadow.append(shell);
    card.append(player);
  }

  shadow.append(card);
  return post;
}

describe('Reddit Shreddit Shadow DOM stress test', () => {
  const cleanups: Array<() => void> = [];

  beforeEach(() => {
    document.body.replaceChildren();
    document.head.replaceChildren();
    history.replaceState({}, '', '/');
  });

  afterEach(() => {
    for (const stop of cleanups.splice(0)) {
      stop();
    }
    document.body.replaceChildren();
    document.head.replaceChildren();
    document.documentElement.removeAttribute('data-feed-sanity-reddit-filtering');
    vi.restoreAllMocks();
  });

  it('discovers nested & late-attached open Shadow Roots, filters SSR/DOM/keyword posts, redacts Shadow DOM text, hides Shadow clutter, themes Shadow Roots, and mounts 3-level Shadow video scrubber', async () => {
    // 1. Seed SSR hydration JSON flagging `t3_ssr_ad` as promoted before boot.
    const hydrationScript = document.createElement('script');
    hydrationScript.id = 'data';
    hydrationScript.type = 'application/json';
    hydrationScript.textContent = JSON.stringify({
      feed: [{ id: 't3_ssr_ad', promoted: true }],
    });
    document.head.append(hydrationScript);

    // 2. Build a realistic 3-level nested open Shadow DOM Shreddit page.
    const app = document.createElement('shreddit-app');
    app.setAttribute('user-id', 't2_reddit123');
    const feedHost = document.createElement('shreddit-feed');
    const feedShadow = feedHost.attachShadow({ mode: 'open' });

    const organic = makeShadowPost(
      't3_org1',
      { 'subreddit-prefixed-name': 'r/programming', author: 'devbuilder', domain: 'github.com' },
      {
        title: 'TypeScript shadow engine deep dive',
        body: 'Benchmarks show spoiler-free zero-polling performance.',
        hasVideo: true,
      },
    );
    const domAd = document.createElement('shreddit-ad-post');
    domAd.setAttribute('id', 't3_dom_ad');
    domAd.textContent = 'Buy Cloud Widgets';

    const ssrAd = makeShadowPost(
      't3_ssr_ad',
      { 'subreddit-prefixed-name': 'r/announcements', author: 'brandcorp' },
      { title: 'Subtle native campaign', body: 'No DOM ad badge at all.' },
    );
    const recommended = makeShadowPost(
      't3_rec1',
      { 'subreddit-prefixed-name': 'r/funny', author: 'someone', 'is-recommended': '' },
      { title: 'Popular meme', body: 'Suggested for you', credit: 'Because you visited r/memes' },
    );

    // Clutter banner placed INSIDE feedShadow (impossible for light-DOM-only CSS to reach!).
    const shadowPromo = document.createElement('faceplate-banner');
    shadowPromo.dataset.testid = 'promo';
    shadowPromo.textContent = 'Get the Reddit app!';

    // Late host that will attach its Shadow Root asynchronously AFTER boot.
    const lateHost = document.createElement('div');
    lateHost.id = 'late-shadow-host';

    feedShadow.append(organic, domAd, ssrAd, recommended, shadowPromo, lateHost);
    app.append(feedHost);
    document.body.append(app);

    // Match the exact phrase being replaced to verify re-evaluation stays idempotent,
    // AND verify `contains_selector` pierces open Shadow Roots to match `<shreddit-player>`.
    const redactFilter = newFilter({
      title: 'Redact spoiler word',
      rules: [
        { ...newRule('any'), condition: { text: 'spoiler-free', modifier: 'i' } },
        {
          target: 'any',
          operator: 'contains_selector',
          condition: { text: 'shreddit-player' },
        },
      ],
      actions: [{ action: 'replace', find: 'spoiler-free', replace: '[REDACTED]' }],
    });

    let pageWorldHandle: ReturnType<typeof startRedditPageWorld> | undefined;
    const { platform, store } = fakePlatform(
      {
        'v2/reddit/t2_reddit123/options': {
          reddit_hide_sponsored: true,
          reddit_hide_suggested: true,
          reddit_keywords: 'airdrop\n',
          reddit_hide_promos: true,
          reddit_video_scrubber: true,
          reddit_video_click_pauses: false,
        },
        'v2/reddit/t2_reddit123/filters': [redactFilter],
        [`v2/reddit/t2_reddit123/${THEME_DATA_KEY}`]: applyThemePreset(
          DEFAULT_THEME_DOCUMENT,
          'catppuccin-mocha',
        ),
      },
      async () => {
        if (!pageWorldHandle) {
          pageWorldHandle = startRedditPageWorld(globalThis, document);
          cleanups.push(() => pageWorldHandle?.dispose());
        }
      },
    );
    cleanups.push(() => {
      void store.set('v2/reddit/t2_reddit123/options', {
        reddit_hide_sponsored: false,
        reddit_hide_suggested: false,
        reddit_keywords: '',
        reddit_hide_promos: false,
        reddit_video_scrubber: false,
        reddit_video_click_pauses: false,
      });
      void store.set('v2/reddit/t2_reddit123/filters', []);
    });

    await startSite(redditSite, platform);

    // 3. Verify DOM ad, SSR hydration ad, and recommended post are hidden while organic stays visible.
    await vi.waitFor(() => {
      expect(domAd.getAttribute(HIDDEN_ATTR)).toBe('none');
      expect(ssrAd.getAttribute(HIDDEN_ATTR)).toBe('none');
      expect(recommended.getAttribute(HIDDEN_ATTR)).toBe('none');
    });
    expect(organic.getAttribute(HIDDEN_ATTR)).toBeNull();

    // 4. Verify Shadow DOM `concealPending` style was injected into feedShadow!
    expect(feedShadow.querySelector('#feed_sanity_reddit_conceal')).not.toBeNull();

    // 5. Verify Shadow DOM `replace` text redaction redacted text inside `organic`'s Shadow Root!
    const bodyEl = organic.shadowRoot?.querySelector('.post-body');
    expect(bodyEl?.textContent).toBe('Benchmarks show [REDACTED] zero-polling performance.');

    // 6. Verify zero-flash clutter CSS was mirrored into `feedShadow`!
    expect(feedShadow.querySelector('#feed_sanity_clutter_reddit_hide_promos')).not.toBeNull();

    // 7. Verify live theme (`shadowExtraCss`) was injected into BOTH feedShadow and organic's nested Shadow Root!
    await vi.waitFor(() => {
      expect(feedShadow.querySelector('#feed_sanity_user_theme')?.textContent).toContain('#262637');
      expect(organic.shadowRoot?.querySelector('#feed_sanity_user_theme')?.textContent).toContain(
        '#262637',
      );
    });

    // 8. Verify VideoScrubber mounted inside the 3rd-level `<shreddit-player>` Shadow Root!
    const player = organic.shadowRoot?.querySelector('shreddit-player');
    const mediaContainer = player?.shadowRoot?.querySelector('.media-container');
    await vi.waitFor(() => expect(mediaContainer?.querySelector('feed-sanity-ui')).not.toBeNull());

    // 9. Stress-test late async `attachShadow({ mode: 'open' })` caught via `reddit:shadow-attached`!
    const lateShadow = lateHost.attachShadow({ mode: 'open' });
    const lateKeywordPost = makeShadowPost(
      't3_late_kw',
      { 'subreddit-prefixed-name': 'r/webdev', author: 'spammer' },
      { title: 'Free token airdrop!', body: 'Claim now.' },
    );
    lateShadow.append(lateKeywordPost);

    await vi.waitFor(() => {
      expect(lateKeywordPost.getAttribute(HIDDEN_ATTR)).toBe('none');
      expect(lateShadow.querySelector('#feed_sanity_user_theme')).not.toBeNull();
    });

    // 10. Verify removing the redact filter cleanly restores the original Shadow DOM text!
    await store.set('v2/reddit/t2_reddit123/filters', []);
    await vi.waitFor(() => {
      expect(bodyEl?.textContent).toBe('Benchmarks show spoiler-free zero-polling performance.');
    });
  });
});
