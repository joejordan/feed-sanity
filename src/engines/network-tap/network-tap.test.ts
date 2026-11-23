import { describe, expect, it, vi } from 'vitest';
import type { NetworkResponseInfo, NetworkTapHost } from '.';
import { createNetworkTap } from '.';

describe('engines/network-tap', () => {
  it('passively clones fetch responses off the critical path and restores fetch when all rules remove', async () => {
    const baseFetch = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ items: [{ id: '1', ad: true }] }))),
    );
    const host: NetworkTapHost = { fetch: baseFetch as unknown as typeof globalThis.fetch };
    const tap = createNetworkTap(host);
    expect(tap.isActive()).toBe(false);

    const seen: NetworkResponseInfo[] = [];
    const remove = tap.addRule({
      id: 'timeline',
      match: (url) => url.includes('/graphql'),
      onResponse: (info) => seen.push(info),
    });
    expect(tap.isActive()).toBe(true);

    const res = await host.fetch?.('https://example.com/graphql', { method: 'POST', body: '{}' });
    // Host still reads the untouched body stream.
    expect(await res?.json()).toEqual({ items: [{ id: '1', ad: true }] });
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]?.status).toBe(200);
    expect(seen[0]?.method).toBe('POST');

    remove();
    expect(tap.isActive()).toBe(false);
    expect(host.fetch).toBe(baseFetch);
  });

  it('supports opt-in request body and response text transformation', async () => {
    const seenBodies: unknown[] = [];
    const baseFetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      seenBodies.push(init?.body);
      return Promise.resolve(new Response('{"ads":1,"posts":5}', { status: 200 }));
    });
    const host: NetworkTapHost = { fetch: baseFetch as unknown as typeof globalThis.fetch };
    const tap = createNetworkTap(host);
    tap.addRule({
      id: 'rewrite',
      match: (url) => url.includes('/api/feed'),
      transformRequestBody: ({ body }) =>
        typeof body === 'string' ? body.replace('default', 'chronological') : undefined,
      transformResponseText: ({ text }) => text.replace('"ads":1,', ''),
    });

    const res = await host.fetch?.('https://example.com/api/feed', {
      method: 'POST',
      body: '{"mode":"default"}',
    });
    expect(seenBodies).toEqual(['{"mode":"chronological"}']);
    expect(await res?.text()).toBe('{"posts":5}');

    tap.dispose();
    expect(host.fetch).toBe(baseFetch);
  });

  it('observes and rewrites XMLHttpRequest calls and restores prototype methods on dispose', () => {
    class FakeXHR extends EventTarget {
      status = 200;
      responseText = '{"ok":true}';
      sentBody: unknown;
      open(_method: string, _url: string | URL): void {
        // Recorded by the tap wrapper.
      }
      send(body?: unknown): void {
        this.sentBody = body;
        this.dispatchEvent(new Event('loadend'));
      }
    }
    const origOpen = FakeXHR.prototype.open;
    const origSend = FakeXHR.prototype.send;
    const host: NetworkTapHost = {
      XMLHttpRequest: FakeXHR as unknown as typeof globalThis.XMLHttpRequest,
    };
    const tap = createNetworkTap(host);
    const seen: NetworkResponseInfo[] = [];
    tap.addRule({
      id: 'xhr-rule',
      match: (url, method) => url.includes('/sync') && method === 'POST',
      transformRequestBody: ({ body }) => (body === 'old' ? 'new' : undefined),
      onResponse: (info) => seen.push(info),
    });

    const xhr = new FakeXHR();
    xhr.open('post', 'https://mail.google.com/sync/u/0/i/s');
    xhr.send('old');

    expect(xhr.sentBody).toBe('new');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.text).toBe('{"ok":true}');

    tap.dispose();
    expect(FakeXHR.prototype.open).toBe(origOpen);
    expect(FakeXHR.prototype.send).toBe(origSend);
  });

  it('transforms Request-object bodies, strips stale headers, and leaves null-body 204 responses intact', async () => {
    let forwardedRequest: Request | undefined;
    const baseFetch = vi.fn((input: RequestInfo | URL) => {
      if (input instanceof Request) {
        forwardedRequest = input;
      }
      let url = '';
      if (typeof input === 'string') {
        url = input;
      } else if (input instanceof URL) {
        url = input.href;
      } else {
        url = input.url;
      }
      if (url.includes('/empty')) {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(
        new Response('{"ads":1,"ok":true}', {
          status: 200,
          headers: { 'content-length': '19', 'content-encoding': 'gzip', 'x-keep': '1' },
        }),
      );
    });
    const host: NetworkTapHost = { fetch: baseFetch as unknown as typeof globalThis.fetch };
    const tap = createNetworkTap(host);
    tap.addRule({
      id: 'req-obj',
      match: (url) => url.includes('/api/'),
      transformRequestBody: ({ body }) =>
        typeof body === 'string' ? body.replace('a', 'b') : undefined,
      transformResponseText: ({ text }) => (text ? text.replace('"ads":1,', '') : 'should-skip'),
    });

    const req = new Request('https://example.com/api/items', { method: 'POST', body: 'a' });
    const res = await host.fetch?.(req);
    expect(forwardedRequest).toBeInstanceOf(Request);
    expect(await forwardedRequest?.text()).toBe('b');
    expect(await res?.text()).toBe('{"ok":true}');
    expect(res?.headers.get('content-length')).toBeNull();
    expect(res?.headers.get('content-encoding')).toBeNull();
    expect(res?.headers.get('x-keep')).toBe('1');

    // Null-body 204 status must not throw when response transformer returns a string.
    const emptyRes = await host.fetch?.('https://example.com/api/empty');
    expect(emptyRes?.status).toBe(204);

    tap.dispose();
  });

  it('isolates throwing rules, ignores aborted XHRs, preserves XHR arity, and respects later host wrappers', async () => {
    const baseFetch = vi.fn(() => Promise.resolve(new Response('{"v":1}', { status: 200 })));
    const host: NetworkTapHost = { fetch: baseFetch as unknown as typeof globalThis.fetch };
    const tap = createNetworkTap(host);
    tap.addRule({
      id: 'throws-match',
      match: () => {
        throw new Error('bad matcher');
      },
    });
    const seen: NetworkResponseInfo[] = [];
    tap.addRule({
      id: 'throws-hooks',
      match: () => true,
      transformRequestBody: () => {
        throw new Error('bad req transform');
      },
      transformResponseText: () => {
        throw new Error('bad res transform');
      },
      onResponse: (info) => {
        seen.push(info);
        throw new Error('bad observer');
      },
    });

    const res = await host.fetch?.('https://example.com/test', { method: 'POST', body: 'hi' });
    expect(await res?.text()).toBe('{"v":1}');
    expect(seen).toHaveLength(1);

    // Another script wraps host.fetch after ours; disposing must not clobber the outer wrapper.
    const tappedRef = host.fetch as typeof globalThis.fetch;
    const outerWrapper = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      tappedRef(input, init),
    ) as unknown as typeof globalThis.fetch;
    host.fetch = outerWrapper;
    tap.dispose();
    expect(host.fetch).toBe(outerWrapper);
    // Calling through the outer wrapper still works cleanly without invoking disposed rules.
    await host.fetch('https://example.com/after-dispose');
    expect(seen).toHaveLength(1);

    // XHR aborted (status === 0) is ignored, and open preserves exact argument count.
    const openArgCounts: number[] = [];
    class ArityXHR extends EventTarget {
      status = 0;
      responseText = '';
      open(...args: unknown[]): void {
        openArgCounts.push(args.length);
      }
      send(): void {
        this.dispatchEvent(new Event('loadend'));
      }
    }
    const xhrHost: NetworkTapHost = {
      XMLHttpRequest: ArityXHR as unknown as typeof globalThis.XMLHttpRequest,
    };
    const xhrTap = createNetworkTap(xhrHost);
    const xhrSeen: NetworkResponseInfo[] = [];
    xhrTap.addRule({
      id: 'xhr-abort',
      match: () => true,
      onResponse: (info) => xhrSeen.push(info),
    });
    const xhr = new ArityXHR();
    xhr.open('GET', 'https://example.com/x');
    xhr.send();
    expect(openArgCounts).toEqual([2]);
    expect(xhrSeen).toHaveLength(0);
    xhrTap.dispose();
  });

  it('tracks per-rule stats and reports hook failures through onError', async () => {
    const baseFetch = vi.fn(() => Promise.resolve(new Response('{"ads":1}', { status: 200 })));
    const host: NetworkTapHost = { fetch: baseFetch as unknown as typeof globalThis.fetch };
    const errors: Array<{ ruleId: string; phase: string }> = [];
    const tap = createNetworkTap(host, {
      onError: ({ ruleId, phase }) => errors.push({ ruleId, phase }),
    });

    tap.addRule({
      id: 'good-transform',
      match: (url) => url.includes('/feed'),
      transformResponseText: ({ text }) => text.replace('1', '0'),
    });
    tap.addRule({
      id: 'broken-rule',
      match: () => true,
      onResponse: () => {
        throw new Error('observer crash');
      },
    });

    const res = await host.fetch?.('https://example.com/feed');
    expect(await res?.text()).toBe('{"ads":0}');

    const snapshot = tap.stats();
    expect(snapshot.active).toBe(true);
    expect(snapshot.totalMatched).toBe(2);
    expect(snapshot.totalTransformed).toBe(1);
    expect(snapshot.totalErrors).toBe(1);
    expect(snapshot.rules['good-transform']).toEqual({ matched: 1, transformed: 1, errors: 0 });
    expect(snapshot.rules['broken-rule']).toEqual({ matched: 1, transformed: 0, errors: 1 });
    expect(errors).toEqual([{ ruleId: 'broken-rule', phase: 'onResponse' }]);
    tap.dispose();
  });
});
