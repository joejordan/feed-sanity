import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageBridge } from '../../core/bridge';
import { READY_EVENT } from '../../core/bridge-protocol';
import { SHADOW_ATTACHED_EVENT } from '../../engines/shadow';
import { redditAccountId, redditPageType, scrubRedditPii } from './page';
import { indexRedditHydrationPayload, startRedditPageWorld } from './page-world';
import { isRedditHost } from './urls';

describe('reddit page helpers & page-world', () => {
  afterEach(() => {
    document.body.replaceChildren();
    document.head.replaceChildren();
  });

  it('matches modern Reddit hosts accurately', () => {
    expect(isRedditHost('www.reddit.com')).toBe(true);
    expect(isRedditHost('reddit.com')).toBe(true);
    expect(isRedditHost('sh.reddit.com')).toBe(true);
    expect(isRedditHost('WWW.REDDIT.COM')).toBe(true);
    expect(isRedditHost('evilreddit.com')).toBe(false);
    expect(isRedditHost('old.reddit.com')).toBe(false);
  });

  it('reads deterministic cookie-only account IDs without splitting document_start and auto-attach buckets', () => {
    const app = document.createElement('shreddit-app');
    app.setAttribute('user-id', 't2_AbC123');
    document.body.append(app);
    // Ignores DOM-only `shreddit-app[user-id]` so cold-start and late auto-attach use the same bucket.
    expect(redditAccountId('')).toBe('anonymous');
    expect(redditAccountId('loid=000000001234abcd.2.1700000000')).toBe('loid-000000001234abcd');
    expect(redditAccountId('loid=000000001234wxyz.2.1700000000')).toBe('loid-000000001234wxyz');
    expect(redditAccountId('session=secret')).toBe('anonymous');
  });

  it('classifies Reddit page types without leaking slugs or post IDs', () => {
    expect(redditPageType({ pathname: '/' })).toBe('home');
    expect(redditPageType({ pathname: '/best/' })).toBe('home');
    expect(redditPageType({ pathname: '/r/popular' })).toBe('popular');
    expect(redditPageType({ pathname: '/r/all' })).toBe('all');
    expect(redditPageType({ pathname: '/r/typescript' })).toBe('subreddit');
    expect(redditPageType({ pathname: '/r/typescript/comments/abc123/title' })).toBe('post');
    expect(redditPageType({ pathname: '/user/alice' })).toBe('profile');
    expect(redditPageType({ pathname: '/u/alice' })).toBe('profile');
    expect(redditPageType({ pathname: '/search' })).toBe('search');
    expect(redditPageType({ pathname: '/settings/account' })).toBe('other');
  });

  it('scrubs Reddit URLs, user handles, and t2 account IDs from diagnostics', () => {
    const scrubbed = scrubRedditPii(
      'Error on https://www.reddit.com/r/private/comments/abc/secret for u/alice (/user/bob, t2_99xyz)',
    );
    expect(scrubbed).not.toContain('reddit.com');
    expect(scrubbed).not.toContain('alice');
    expect(scrubbed).not.toContain('bob');
    expect(scrubbed).not.toContain('t2_99xyz');
  });

  it('indexes promoted and recommended t3_* IDs from SSR hydration payloads', () => {
    const ads = new Set<string>();
    const suggested = new Set<string>();
    indexRedditHydrationPayload(
      {
        feed: {
          posts: [
            { id: 't3_ad1', promoted: true },
            { postId: 't3_ad2', adPayload: { campaignId: 'cmp_1' } },
            { thingId: 't3_rec1', isRecommended: true },
            { id: 't3_org1', promoted: false },
          ],
        },
      },
      ads,
      suggested,
    );
    expect([...ads]).toEqual(['t3_ad1', 't3_ad2']);
    expect([...suggested]).toEqual(['t3_rec1']);
  });

  it('installs attachShadow hook and scans SSR hydration scripts at boot', async () => {
    const script = document.createElement('script');
    script.type = 'application/json';
    script.textContent = JSON.stringify({
      items: [{ id: 't3_ssr99', promoted: true }],
    });
    document.head.append(script);

    const readyListener = vi.fn();
    const shadowTargets: EventTarget[] = [];
    const shadowListener = (event: Event) => {
      if (event.target) {
        shadowTargets.push(event.target);
      }
    };
    document.addEventListener(READY_EVENT, readyListener);
    document.addEventListener(SHADOW_ATTACHED_EVENT, shadowListener);
    const originalAttach = Element.prototype.attachShadow;
    const handle = startRedditPageWorld(globalThis, document);
    const bridge = new PageBridge(async () => undefined);
    try {
      expect(readyListener).toHaveBeenCalledTimes(1);
      expect(Element.prototype.attachShadow).not.toBe(originalAttach);

      const host = document.createElement('div');
      document.body.append(host);
      host.attachShadow({ mode: 'open' });
      expect(shadowTargets).toEqual([host]);

      const post = document.createElement('shreddit-post');
      post.setAttribute('id', 't3_ssr99');
      document.body.append(post);
      expect(await bridge.ask(post, 'reddit-post-meta')).toEqual({
        id: 't3_ssr99',
        isAd: true,
        isSuggested: false,
      });
    } finally {
      bridge.dispose();
      handle.dispose();
      document.removeEventListener(READY_EVENT, readyListener);
      document.removeEventListener(SHADOW_ATTACHED_EVENT, shadowListener);
    }
    expect(Element.prototype.attachShadow).toBe(originalAttach);
  });
});
