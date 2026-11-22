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
});
