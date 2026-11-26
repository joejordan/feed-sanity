import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NetworkTapHost } from '../../engines/network-tap';
import { PageBridge } from '../../core/bridge';
import { indexInstagramPayload, startInstagramPageWorld } from './page-world';

describe('instagram page-world engine (React fiber + Network Tap)', () => {
  const disposers: Array<() => void> = [];

  afterEach(() => {
    for (const dispose of disposers.splice(0)) {
      dispose();
    }
    document.body.innerHTML = '';
  });

  it('indexes GraphQL + NDJSON responses, enforces CDN URL validation, and supports fiber fallbacks', async () => {
    const ndjsonPayload = [
      `for (;;);${JSON.stringify({
        data: {
          node: {
            pk: '3000111222',
            id: '3000111222_999',
            code: 'AbCdEf123',
            ad_id: '999888',
            video_versions: [
              // Malicious higher-width foreign host must be rejected.
              { width: 2160, url: 'https://evil.example/fake4k.mp4' },
              { width: 480, url: 'https://scontent.cdninstagram.com/v/sd.mp4' },
              { width: 1080, url: 'https://scontent.cdninstagram.com/v/hd.mp4' },
            ],
          },
        },
      })}`,
      JSON.stringify({
        data: {
          node: {
            pk: '3000333444',
            is_unified_video_suggestion: true,
          },
        },
      }),
      'not-valid-json-chunk',
    ].join('\n');

    const baseFetch = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input);
      if (url.includes('/malformed')) {
        return Promise.resolve(new Response('<html>oops</html>', { status: 200 }));
      }
      return Promise.resolve(new Response(ndjsonPayload, { status: 200 }));
    });
    const host: NetworkTapHost = { fetch: baseFetch as unknown as typeof globalThis.fetch };

    let handle!: ReturnType<typeof startInstagramPageWorld>;
    const bridge = new PageBridge(async () => {
      handle = startInstagramPageWorld(host);
      disposers.push(handle.dispose);
    });

    const statsSeen: unknown[] = [];
    bridge.on('ig:network-stats', (payload) => statsSeen.push(payload));

    const article = document.createElement('article');
    const link = document.createElement('a');
    link.href = '/p/AbCdEf123/';
    const video = document.createElement('video');
    article.append(link, video);
    document.body.append(article);

    // Article without fiber falls back to shortcode link; video without fiber falls back to closest article.
    expect(await bridge.ask(article, 'ig-post-meta')).toEqual({
      id: 'AbCdEf123',
      isAd: false,
      isSuggested: false,
    });

    // Simulate NDJSON streamed `/graphql/query` response.
    await host.fetch?.('https://www.instagram.com/graphql/query', { method: 'POST', body: '{}' });
    await vi.waitFor(() => expect(statsSeen).toHaveLength(1));

    // Re-fetching the exact same payload adds 0 new entries and does NOT re-emit stats.
    await host.fetch?.('https://www.instagram.com/graphql/query', { method: 'POST', body: '{}' });
    await host.fetch?.('https://www.instagram.com/api/v1/feed/malformed', { method: 'GET' });
    await new Promise((r) => setTimeout(r, 15));
    expect(statsSeen).toHaveLength(1);

    // Shortcode + closest-article fallback resolves ad flag and valid CDN HD URL (rejecting evil.example).
    expect(await bridge.ask(article, 'ig-post-meta')).toEqual({
      id: 'AbCdEf123',
      isAd: true,
      isSuggested: false,
    });
    expect(await bridge.ask(video, 'ig-video-sources')).toEqual({
      url: 'https://scontent.cdninstagram.com/v/hd.mp4',
      videoId: 'AbCdEf123',
    });

    // Fiber `implementations` fallback with foreign URL rejected and valid SD URL accepted.
    const implVideo = document.createElement('video');
    document.body.append(implVideo);
    Object.defineProperty(implVideo, '__reactFiber$test', {
      value: {
        return: {
          memoizedProps: {
            coreVideoPlayerProps: {
              coreVideoPlayerMetaData: {
                videoFBID: '777',
                hdSrc: 'https://evil.example/bad.mp4',
                implementations: [{ data: { sdSrc: 'https://video.fbcdn.net/v/impl.mp4' } }],
              },
            },
          },
          return: null,
        },
      },
      enumerable: true,
      configurable: true,
    });
    expect(await bridge.ask(implVideo, 'ig-video-sources')).toEqual({
      url: 'https://video.fbcdn.net/v/impl.mp4',
      videoId: '777',
    });

    // Disposing restores `host.fetch`.
    handle.dispose();
    expect(host.fetch).toBe(baseFetch);
  });

  it('merges cache updates, handles circular payloads, and enforces MAX_CACHE FIFO eviction', () => {
    const cache = new Map<string, { isAd?: boolean; isSuggested?: boolean; videoUrl?: string }>();
    const circular: Record<string, unknown> = { pk: '10', ad_id: 'a1' };
    circular.self = circular;

    expect(indexInstagramPayload(circular, cache)).toBe(1);
    expect(indexInstagramPayload(circular, cache)).toBe(0);
    // Merging a new suggested flag onto the same pk counts as 1 update.
    expect(indexInstagramPayload({ pk: '10', is_suggested: true }, cache)).toBe(1);
    expect(cache.get('10')).toEqual({ isAd: true, isSuggested: true });

    // Exceeding MAX_CACHE (200) evicts oldest keys in FIFO order.
    const batch = Array.from({ length: 205 }, (_, i) => ({ pk: `item_${i}`, is_ad: true }));
    indexInstagramPayload(batch, cache);
    expect(cache.size).toBe(200);
    expect(cache.has('10')).toBe(false);
    expect(cache.has('item_204')).toBe(true);
  });

  it('scopes wrapper explore_story and ad flags to their own branches without tainting siblings or users, and validates adProps/adFragmentKey', async () => {
    const cache = new Map<string, { isAd?: boolean; isSuggested?: boolean; videoUrl?: string }>();
    indexInstagramPayload(
      {
        feed_items: [
          {
            explore_story: {
              media: { pk: 'sug_1', code: 'SUGCODE', user: { pk: 'user_99' } },
            },
          },
          {
            ad: {
              ad_id: 'ad_42',
              items: [{ pk: 'ad_media_1', code: 'ADCODE', user: { pk: 'user_88' } }],
            },
            items: [{ pk: 'org_sibling', code: 'ORGSIB' }],
            explore_story: {
              media: { pk: 'sug_sibling', code: 'SUGSIB' },
            },
          },
        ],
      },
      cache,
    );

    expect(cache.get('sug_1')).toEqual({ isSuggested: true });
    expect(cache.get('SUGCODE')).toEqual({ isSuggested: true });
    expect(cache.get('ad_media_1')).toEqual({ isAd: true });
    expect(cache.get('ADCODE')).toEqual({ isAd: true });
    // Sibling organic items and explore_story branches must not be cross-contaminated by `ad`.
    expect(cache.has('org_sibling')).toBe(false);
    expect(cache.has('ORGSIB')).toBe(false);
    expect(cache.get('sug_sibling')).toEqual({ isSuggested: true });
    expect(cache.get('SUGSIB')).toEqual({ isSuggested: true });
    expect(cache.has('user_99')).toBe(false);
    expect(cache.has('user_88')).toBe(false);

    const handle = startInstagramPageWorld({});
    disposers.push(handle.dispose);
    const bridge = new PageBridge(async () => undefined);
    disposers.push(() => bridge.dispose());

    const attachFiber = (el: Element, fiber: Record<string, unknown>): void => {
      Object.defineProperty(el, '__reactFiber$test', {
        value: fiber,
        enumerable: true,
        configurable: true,
      });
    };

    const fragmentAdArt = document.createElement('article');
    attachFiber(fragmentAdArt, {
      memoizedProps: { adFragmentKey: { ad_id: '777', pk: 'p777' } },
      return: null,
    });
    const adPropsAdArt = document.createElement('article');
    attachFiber(adPropsAdArt, {
      memoizedProps: { media: { pk: 'p778' } },
      return: { memoizedProps: { adProps: { adId: '888' } }, return: null },
    });
    const emptyAdPropsArt = document.createElement('article');
    attachFiber(emptyAdPropsArt, {
      memoizedProps: { media: { pk: 'org_empty' } },
      return: { memoizedProps: { adProps: {} }, return: null },
    });
    const falsyAdPropsArt = document.createElement('article');
    attachFiber(falsyAdPropsArt, {
      memoizedProps: { media: { pk: 'org_falsy' } },
      return: { memoizedProps: { adProps: { is_ad: false, ad_id: null } }, return: null },
    });
    const nullAdPropsArt = document.createElement('article');
    attachFiber(nullAdPropsArt, {
      memoizedProps: { media: { pk: 'org_null' }, adProps: null },
      return: null,
    });
    document.body.append(
      fragmentAdArt,
      adPropsAdArt,
      emptyAdPropsArt,
      falsyAdPropsArt,
      nullAdPropsArt,
    );

    expect(await bridge.ask(fragmentAdArt, 'ig-post-meta')).toEqual({
      id: 'p777',
      isAd: true,
      isSuggested: false,
    });
    expect(await bridge.ask(adPropsAdArt, 'ig-post-meta')).toEqual({
      id: 'p778',
      isAd: true,
      isSuggested: false,
    });
    expect(await bridge.ask(emptyAdPropsArt, 'ig-post-meta')).toEqual({
      id: 'org_empty',
      isAd: false,
      isSuggested: false,
    });
    expect(await bridge.ask(falsyAdPropsArt, 'ig-post-meta')).toEqual({
      id: 'org_falsy',
      isAd: false,
      isSuggested: false,
    });
    expect(await bridge.ask(nullAdPropsArt, 'ig-post-meta')).toEqual({
      id: 'org_null',
      isAd: false,
      isSuggested: false,
    });
  });

  it('indexes initial SSR hydration JSON scripts at boot before any fetch fires', async () => {
    const script = document.createElement('script');
    script.type = 'application/json';
    script.textContent = JSON.stringify({
      require: [
        [
          'RelayPrefetchedStreamCache',
          'next',
          [
            {
              pk: 'ssr_900',
              code: 'SSRCODE',
              ad_id: 'ad_ssr_1',
              video_versions: [{ url: 'https://video.cdninstagram.com/v/ssr.mp4', width: 720 }],
            },
          ],
        ],
      ],
    });
    document.body.append(script);

    const handle = startInstagramPageWorld({ document });
    disposers.push(handle.dispose);
    const bridge = new PageBridge(async () => undefined);
    disposers.push(() => bridge.dispose());

    const article = document.createElement('article');
    const link = document.createElement('a');
    link.href = '/reel/SSRCODE/';
    const video = document.createElement('video');
    article.append(link, video);
    document.body.append(article);

    expect(await bridge.ask(article, 'ig-post-meta')).toEqual({
      id: 'SSRCODE',
      isAd: true,
      isSuggested: false,
    });
    expect(await bridge.ask(video, 'ig-video-sources')).toEqual({
      url: 'https://video.cdninstagram.com/v/ssr.mp4',
      videoId: 'SSRCODE',
    });
  });
});
