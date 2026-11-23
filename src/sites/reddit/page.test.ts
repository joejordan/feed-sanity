import { afterEach, describe, expect, it } from 'vitest';
import { READY_EVENT } from '../../core/bridge-protocol';
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

  it('reads opaque account IDs without leaking raw cookies or usernames', () => {
    const app = document.createElement('shreddit-app');
    app.setAttribute('user-id', 't2_AbC123');
    document.body.append(app);
    expect(redditAccountId('', document)).toBe('t2_abc123');

    app.remove();
    expect(redditAccountId('loid=000000001234abcd.2.1700000000', document)).toBe(
      'loid-000000001234',
    );
    expect(redditAccountId('session=secret', document)).toBe('anonymous');
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

    const readyListener = () => undefined;
    document.addEventListener(READY_EVENT, readyListener);
    const originalAttach = Element.prototype.attachShadow;
    const handle = startRedditPageWorld(globalThis, document);
    try {
      expect(Element.prototype.attachShadow).not.toBe(originalAttach);
      const host = document.createElement('div');
      document.body.append(host);
      host.attachShadow({ mode: 'open' });
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      handle.dispose();
      document.removeEventListener(READY_EVENT, readyListener);
    }
    expect(Element.prototype.attachShadow).toBe(originalAttach);
  });
});
