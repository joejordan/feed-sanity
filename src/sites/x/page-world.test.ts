import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NetworkTapHost } from '../../engines/network-tap';
import { PageBridge } from '../../core/bridge';
import { startXPageWorld, stripPromotedEntries, stripPromotedFromTimelineJson } from './page-world';

describe('x page-world engine (React fiber + transforming Network Tap)', () => {
  const disposers: Array<() => void> = [];

  afterEach(() => {
    for (const dispose of disposers.splice(0)) {
      dispose();
    }
    document.body.innerHTML = '';
  });

  it('strips promoted timeline entries before React render when x-strip-promoted toggle is enabled and restores fetch when off', async () => {
    const timelineJson = JSON.stringify({
      data: {
        home: {
          home_timeline_urt: {
            instructions: [
              {
                type: 'TimelineAddEntries',
                entries: [
                  { entryId: 'tweet-101', content: { itemContent: { tweet_results: {} } } },
                  { entryId: 'promoted-tweet-202', content: { itemContent: {} } },
                  {
                    entryId: 'tweet-303',
                    content: { itemContent: { promotedMetadata: { impressionId: 'imp1' } } },
                  },
                  {
                    entryId: 'home-conversation-404',
                    content: {
                      items: [
                        { entryId: 'tweet-404-1', item: { itemContent: {} } },
                        {
                          entryId: 'promotedTweet-404-2',
                          item: { itemContent: { promotedMetadata: { impressionId: 'imp2' } } },
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        },
      },
    });

    const baseFetch = vi.fn(() =>
      Promise.resolve(
        new Response(timelineJson, {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'content-length': String(timelineJson.length),
          },
        }),
      ),
    );
    const host: NetworkTapHost = { fetch: baseFetch as unknown as typeof globalThis.fetch };

    let handle!: ReturnType<typeof startXPageWorld>;
    const bridge = new PageBridge(async () => {
      handle = startXPageWorld(host);
      disposers.push(handle.dispose);
    });

    const statsSeen: unknown[] = [];
    bridge.on('x:network-stats', (payload) => statsSeen.push(payload));

    // Toggle starts off: host.fetch is untouched.
    expect(host.fetch).toBe(baseFetch);

    // Enable promoted-entry stripping via PageToggle.
    expect(await bridge.set('x-strip-promoted', true)).toEqual({ enabled: true });
    expect(host.fetch).not.toBe(baseFetch);

    const res = await host.fetch?.('https://x.com/i/api/graphql/abc123/HomeTimeline?variables={}', {
      method: 'GET',
    });
    const parsed = (await res?.json()) as {
      data: {
        home: {
          home_timeline_urt: {
            instructions: Array<{
              entries: Array<{ entryId: string; content: { items?: Array<{ entryId: string }> } }>;
            }>;
          };
        };
      };
    };
    const entries = parsed.data.home.home_timeline_urt.instructions[0]?.entries ?? [];
    expect(entries.map((e) => e.entryId)).toEqual(['tweet-101', 'home-conversation-404']);
    expect(entries[1]?.content.items?.map((i) => i.entryId)).toEqual(['tweet-404-1']);
    await vi.waitFor(() =>
      expect(statsSeen).toEqual([{ matchedResponses: 1, strippedPromoted: 3 }]),
    );

    // Organic-only timeline payload takes fast-path without rewriting and still increments matchedResponses.
    baseFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ instructions: [{ entries: [{ entryId: 'tweet-999' }] }] }), {
        status: 200,
      }),
    );
    const organicRes = await host.fetch?.('https://x.com/i/api/graphql/abc123/HomeLatestTimeline');
    expect(((await organicRes?.json()) as { instructions: unknown[] }).instructions).toHaveLength(
      1,
    );
    await vi.waitFor(() =>
      expect(statsSeen.at(-1)).toEqual({ matchedResponses: 2, strippedPromoted: 3 }),
    );

    // Disabling the toggle restores the original host.fetch cleanly.
    expect(await bridge.set('x-strip-promoted', false)).toEqual({ enabled: false });
    expect(host.fetch).toBe(baseFetch);
    handle.dispose();
  });

  it('handles malformed/false-positive JSON, SKIP_KEYS large timelines, moduleItems, XHR rewriting, and fiber variants', async () => {
    // Malformed JSON that passes PROMOTED_TEXT_HINT exercises the JSON.parse catch branch.
    expect(stripPromotedFromTimelineJson('{"promotedMetadata": broken')).toBeUndefined();
    // Valid JSON mentioning "promotedMetadata" in organic tweet text exercises the `removed === 0` branch.
    expect(
      stripPromotedFromTimelineJson(
        JSON.stringify({
          entries: [
            {
              entryId: 'tweet-1',
              content: {
                itemContent: { tweet_results: { text: 'talking about promotedMetadata' } },
              },
            },
          ],
        }),
      ),
    ).toBeUndefined();

    const cyclic: Record<string, unknown> = { entries: [{ entryId: 'tweet-1' }] };
    cyclic.self = cyclic;
    expect(stripPromotedEntries(cyclic)).toBe(0);

    // SKIP_KEYS keeps >6000 leaf objects inside `tweet_results` from starving `MAX_WALK_NODES`
    // and leaves non-timeline `items` inside leaf `card` subtrees untouched, while stripping `moduleItems`.
    const bulkyTweets = Array.from({ length: 300 }, (_, i) => ({
      entryId: `tweet-bulk-${i}`,
      content: {
        itemContent: {
          tweet_results: {
            result: {
              legacy: {
                full_text: 'organic',
                nested: Array.from({ length: 25 }, () => ({ a: 1 })),
              },
              card: { items: [{ entryId: 'promoted-leaf-keep' }] },
            },
          },
        },
      },
    }));
    const modulePayload = {
      instructions: [
        { entries: [...bulkyTweets, { entryId: 'promoted-tweet-after-bulk' }] },
        {
          type: 'TimelineAddToModule',
          moduleItems: [
            { entryId: 'reply-1', item: { itemContent: {} } },
            { entryId: 'reply-ad', item: { itemContent: { promotedMetadata: { id: 'p1' } } } },
          ],
        },
      ],
    };
    expect(stripPromotedEntries(modulePayload)).toBe(2);
    expect(modulePayload.instructions[0]?.entries).toHaveLength(300);
    expect(modulePayload.instructions[1]?.moduleItems?.map((m) => m.entryId)).toEqual(['reply-1']);
    // Leaf `card.items` inside `itemContent` was skipped and preserved.
    expect(bulkyTweets[0]?.content.itemContent.tweet_results.result.card.items).toHaveLength(1);

    // Also verify XHR `transformResponseText` strips promoted entries on X GraphQL XHR responses.
    class FakeXHR extends EventTarget {
      readyState = 0;
      status = 0;
      responseType: XMLHttpRequestResponseType = '';
      #text = '';
      get responseText(): string {
        return this.#text;
      }
      get response(): unknown {
        return this.responseType === 'json' ? JSON.parse(this.#text) : this.#text;
      }
      open(_method: string, _url: string): void {
        this.readyState = 1;
      }
      send(): void {
        this.status = 200;
        this.readyState = 4;
        this.#text = JSON.stringify({
          entries: [{ entryId: 'tweet-xhr-1' }, { entryId: 'promoted-xhr-2' }],
        });
        this.dispatchEvent(new Event('loadend'));
      }
    }
    const xhrHost: NetworkTapHost = {
      XMLHttpRequest: FakeXHR as unknown as typeof globalThis.XMLHttpRequest,
    };

    const bridge = new PageBridge(async () => {
      const handle = startXPageWorld(xhrHost);
      disposers.push(handle.dispose);
    });

    await bridge.set('x-strip-promoted', true);
    const xhr = new (xhrHost.XMLHttpRequest as unknown as new () => FakeXHR)();
    xhr.open('GET', 'https://x.com/i/api/graphql/xyz/HomeTimeline');
    xhr.send();
    expect(JSON.parse(xhr.responseText)).toEqual({ entries: [{ entryId: 'tweet-xhr-1' }] });

    const tweet = document.createElement('article');
    tweet.setAttribute('data-testid', 'tweet');
    document.body.append(tweet);

    Object.defineProperty(tweet, '__reactFiber$xtest', {
      value: {
        return: {
          memoizedProps: {
            tweet: { rest_id: '2124521710376423470' },
            promotedContentAdvertiser: { id: 'adv1' },
            socialContext: { type: 'Topic' },
          },
          return: null,
        },
      },
      enumerable: true,
      configurable: true,
    });

    expect(await bridge.ask(tweet, 'x-tweet-meta')).toEqual({
      id: '2124521710376423470',
      isAd: true,
      isSuggested: true,
    });

    // Organic tweet with `{ type: 'Like' }` socialContext is neither ad nor suggested.
    const organic = document.createElement('article');
    document.body.append(organic);
    Object.defineProperty(organic, '__reactFiber$xtest', {
      value: {
        memoizedProps: {
          tweet: { id_str: '999' },
          socialContext: { type: 'Like' },
        },
        return: null,
      },
      enumerable: true,
      configurable: true,
    });
    expect(await bridge.ask(organic, 'x-tweet-meta')).toEqual({
      id: '999',
      isAd: false,
      isSuggested: false,
    });
  });

  it('dispatches SHADOW_ATTACHED_EVENT via attachShadow hook for open Shadow Roots and restores on dispose', () => {
    const origAttach = Element.prototype.attachShadow;
    const attachedTargets: EventTarget[] = [];
    const onShadow = (event: Event) => {
      if (event.target) {
        attachedTargets.push(event.target);
      }
    };
    document.addEventListener('feed-sanity:shadow-attached', onShadow);

    try {
      const handle = startXPageWorld({ Element });
      disposers.push(handle.dispose);

      const hostEl = document.createElement('div');
      document.body.append(hostEl);
      hostEl.attachShadow({ mode: 'open' });

      expect(attachedTargets).toEqual([hostEl]);
      disposers.pop()?.();
      expect(Element.prototype.attachShadow).toBe(origAttach);
    } finally {
      document.removeEventListener('feed-sanity:shadow-attached', onShadow);
    }
  });

  it('stays passive when startActive is false and toggles attachShadow via x-active', async () => {
    const origAttach = Element.prototype.attachShadow;
    const attachedTargets: EventTarget[] = [];
    const onShadow = (event: Event) => {
      if (event.target) {
        attachedTargets.push(event.target);
      }
    };
    document.addEventListener('feed-sanity:shadow-attached', onShadow);

    try {
      const handle = startXPageWorld({ Element }, { startActive: false });
      disposers.push(handle.dispose);

      // Passive boot leaves native attachShadow untouched.
      expect(Element.prototype.attachShadow).toBe(origAttach);
      const passiveHost = document.createElement('div');
      document.body.append(passiveHost);
      passiveHost.attachShadow({ mode: 'open' });
      expect(attachedTargets).toEqual([]);

      // Activating x-active hooks attachShadow; deactivating restores it cleanly.
      const bridge = new PageBridge(() => Promise.resolve());
      disposers.push(() => bridge.dispose());
      await bridge.set('x-active', true);
      expect(Element.prototype.attachShadow).not.toBe(origAttach);
      const activeHost = document.createElement('div');
      document.body.append(activeHost);
      activeHost.attachShadow({ mode: 'open' });
      expect(attachedTargets).toEqual([activeHost]);

      await bridge.set('x-active', false);
      expect(Element.prototype.attachShadow).toBe(origAttach);
    } finally {
      document.removeEventListener('feed-sanity:shadow-attached', onShadow);
    }
  });
});
