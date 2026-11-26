import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SHADOW_ATTACHED_EVENT } from '../engines/shadow';
import { createDomEnvironment } from './dom-env';
import { concealPending } from './surface';

describe('createDomEnvironment', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('discovers nested open ShadowRoots and queries across them when pierceShadow is enabled', async () => {
    const outerHost = document.createElement('div');
    const outerShadow = outerHost.attachShadow({ mode: 'open' });
    const innerHost = document.createElement('section');
    const innerShadow = innerHost.attachShadow({ mode: 'open' });
    const leaf = document.createElement('article');
    leaf.dataset.kind = 'post';
    innerShadow.append(leaf);
    outerShadow.append(innerHost);
    document.body.append(outerHost);

    const seen: ShadowRoot[] = [];
    const env = createDomEnvironment({ pierceShadow: true });
    env.onShadowRoot((root) => seen.push(root));

    expect(seen).toHaveLength(2);
    expect(env.queryAll('[data-kind=post]')).toEqual([leaf]);

    // Late-added shadow root is discovered too.
    const lateHost = document.createElement('div');
    const lateShadow = lateHost.attachShadow({ mode: 'open' });
    const lateLeaf = document.createElement('article');
    lateLeaf.dataset.kind = 'post';
    lateShadow.append(lateLeaf);
    document.body.append(lateHost);

    await vi.waitFor(() => expect(seen).toHaveLength(3));
    expect(env.queryAll('[data-kind=post]')).toEqual([leaf, lateLeaf]);

    env.dispose();
    expect(env.shadowRoots.size).toBe(0);
  });

  it('hides elements inside ShadowRoots and cleans up cleanly on dispose', () => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const card = document.createElement('div');
    shadow.append(card);
    document.body.append(host);

    const env = createDomEnvironment({ pierceShadow: true });
    env.hideElement(env.scope, card);
    expect(card.getAttribute('data-feed-sanity-hidden')).toBe('none');
    expect(shadow.querySelector('#feed_sanity_surface')).not.toBeNull();

    env.dispose();
    expect(card.hasAttribute('data-feed-sanity-hidden')).toBe(false);
    expect(shadow.querySelector('#feed_sanity_surface')).toBeNull();
  });

  it('discovers dynamically added nested ShadowRoots and prunes them when removed', async () => {
    const outerHost = document.createElement('div');
    const outerShadow = outerHost.attachShadow({ mode: 'open' });
    document.body.append(outerHost);

    const disposedRoots: ShadowRoot[] = [];
    const env = createDomEnvironment({ pierceShadow: true });
    env.onShadowRoot((root, rootScope) => {
      rootScope.add(() => disposedRoots.push(root));
    });
    expect(env.shadowRoots.size).toBe(1);

    // Dynamically add a nested shadow host inside `outerShadow` after env creation.
    const nestedHost = document.createElement('section');
    const nestedShadow = nestedHost.attachShadow({ mode: 'open' });
    outerShadow.append(nestedHost);

    await vi.waitFor(() => expect(env.shadowRoots.has(nestedShadow)).toBe(true));

    // Removing the nested host inside the shadow root prunes and disposes its scope.
    nestedHost.remove();
    await vi.waitFor(() => expect(env.shadowRoots.has(nestedShadow)).toBe(false));
    expect(disposedRoots).toEqual([nestedShadow]);

    env.dispose();
  });

  it('discovers open ShadowRoots attached asynchronously to already-connected hosts', async () => {
    // Also cover a pre-existing host already in the DOM before `createDomEnvironment` starts
    // (matching async `siteSettings.ready` startup on X Chat / Calls).
    const preExistingHost = document.createElement('div');
    preExistingHost.dataset.testid = 'xcallsRemoteHost';
    document.body.append(preExistingHost);

    const env = createDomEnvironment({ pierceShadow: true });
    const seen: ShadowRoot[] = [];
    env.onShadowRoot((root) => seen.push(root));

    // Mount an empty host element after startup, then attach both shadow roots later.
    const host = document.createElement('div');
    host.dataset.testid = 'xchatEmbedRoute';
    document.body.append(host);

    await new Promise((resolve) => setTimeout(resolve, 25));
    const preShadow = preExistingHost.attachShadow({ mode: 'open' });
    const shadow = host.attachShadow({ mode: 'open' });

    await vi.waitFor(() => expect(seen).toEqual([preShadow, shadow]), { timeout: 1000 });
    expect(env.shadowRoots.has(preShadow)).toBe(true);
    expect(env.shadowRoots.has(shadow)).toBe(true);

    env.dispose();
  });

  it('rescans on SPA URL change, expires stale shadow candidates, and cancels timers on dispose', () => {
    vi.useFakeTimers();
    try {
      const env = createDomEnvironment({ pierceShadow: true });
      const seen: ShadowRoot[] = [];
      env.onShadowRoot((root) => seen.push(root));

      // Non-candidate tag (`article`) is only found via the whole-doc URL-change rescan.
      const routeHost = document.createElement('article');
      document.body.append(routeHost);
      history.pushState({}, '', '/i/chat');
      globalThis.dispatchEvent(new PopStateEvent('popstate'));
      const routeShadow = routeHost.attachShadow({ mode: 'open' });

      vi.advanceTimersByTime(150);
      expect(seen).toEqual([routeShadow]);

      // Advance past the 3000ms TTL window so polling stops cleanly when idle.
      vi.advanceTimersByTime(3200);
      expect(vi.getTimerCount()).toBe(0);

      // Disposing while a candidate rescan timer is armed cancels the timer and stops discovery.
      const pendingHost = document.createElement('div');
      document.body.append(pendingHost);
      history.pushState({}, '', '/i/calls');
      globalThis.dispatchEvent(new PopStateEvent('popstate'));
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      env.dispose();
      expect(vi.getTimerCount()).toBe(0);

      pendingHost.attachShadow({ mode: 'open' });
      vi.advanceTimersByTime(500);
      expect(seen).toEqual([routeShadow]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('tracks same-origin iframes across load transitions and cleans up on removal', async () => {
    const frame = document.createElement('iframe');
    const docA = document.implementation.createHTMLDocument('a');
    const docB = document.implementation.createHTMLDocument('b');
    let currentDoc: Document | null = docA;
    Object.defineProperty(frame, 'contentDocument', {
      get: () => currentDoc,
      configurable: true,
    });
    document.body.append(frame);

    const seenDocs: Document[] = [];
    const disposedDocs: Document[] = [];
    const env = createDomEnvironment({ includeIframes: true });
    env.onIframe((childEnv) => {
      seenDocs.push(childEnv.doc);
      childEnv.scope.add(() => disposedDocs.push(childEnv.doc));
    });

    expect(seenDocs).toEqual([docA]);

    // Simulate iframe navigating from about:blank (docA) to real document (docB).
    currentDoc = docB;
    frame.dispatchEvent(new Event('load'));
    expect(seenDocs).toEqual([docA, docB]);
    expect(disposedDocs).toEqual([docA]);

    // Removing the iframe disposes the active child environment.
    frame.remove();
    await vi.waitFor(() => expect(disposedDocs).toEqual([docA, docB]));

    env.dispose();
  });

  it('watches selectors across light DOM and open ShadowRoots and notifies removed on host disconnect', async () => {
    const env = createDomEnvironment({ pierceShadow: true });
    const lightItem = document.createElement('article');
    lightItem.dataset.card = '1';
    document.body.append(lightItem);

    const added: Element[] = [];
    const removed: Element[] = [];
    const stop = env.watch('[data-card]', {
      added: (el) => added.push(el),
      removed: (el) => removed.push(el),
    });
    expect(added).toEqual([lightItem]);

    // Mount a Shadow Root containing a matching element.
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const shadowItem = document.createElement('article');
    shadowItem.dataset.card = '2';
    shadow.append(shadowItem);
    document.body.append(host);

    await vi.waitFor(() => expect(added).toEqual([lightItem, shadowItem]));

    // Disconnecting the shadow host reports tracked shadow elements as removed.
    host.remove();
    await vi.waitFor(() => expect(removed).toEqual([shadowItem]));

    stop();
    env.dispose();
  });

  it('injects concealPending styles into both light DOM and open ShadowRoots', async () => {
    const env = createDomEnvironment({ pierceShadow: true });
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    document.body.append(host);

    const stop = concealPending(
      env.scope,
      {
        id: 'test_conceal',
        activeAttr: 'data-fs-test-conceal',
        pendingSelector: 'article:not([data-checked])',
      },
      env,
    );

    expect(document.querySelector('#test_conceal')).not.toBeNull();
    await vi.waitFor(() => expect(shadow.querySelector('#test_conceal')).not.toBeNull());

    stop();
    expect(document.querySelector('#test_conceal')).toBeNull();
    expect(shadow.querySelector('#test_conceal')).toBeNull();
    env.dispose();
  });

  it('stops cleanly when a late ShadowRoot watch callback calls stop() re-entrantly', async () => {
    const env = createDomEnvironment({ pierceShadow: true });
    const seen: Element[] = [];
    const stop = env.watch('.hit', {
      added: (el) => {
        seen.push(el);
        stop();
      },
    });

    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const a = document.createElement('span');
    a.className = 'hit';
    const b = document.createElement('span');
    b.className = 'hit';
    shadow.append(a, b);
    document.body.append(host);

    await vi.waitFor(() => expect(seen).toEqual([a]));
    // Future mutations inside the ShadowRoot must not invoke the stopped callback.
    const c = document.createElement('span');
    c.className = 'hit';
    shadow.append(c);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(seen).toEqual([a]);
    env.dispose();
  });

  it('discovers open ShadowRoots in O(1) via SHADOW_ATTACHED_EVENT without full-document polling', () => {
    const env = createDomEnvironment({ pierceShadow: true });
    const seen: ShadowRoot[] = [];
    env.onShadowRoot((root) => seen.push(root));

    const host = document.createElement('article');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    host.dispatchEvent(new Event(SHADOW_ATTACHED_EVENT, { bubbles: true, composed: true }));

    expect(seen).toEqual([shadow]);
    expect(env.shadowRoots.has(shadow)).toBe(true);
    env.dispose();
  });

  it('flushes pre-hook pending candidates and enclosing ShadowRoots when first SHADOW_ATTACHED_EVENT fires from a nested host', async () => {
    const env = createDomEnvironment({ pierceShadow: true });
    const seen: ShadowRoot[] = [];
    env.onShadowRoot((root) => seen.push(root));

    // Outer custom element mounts BEFORE attachShadow is hooked, then attaches synchronously without dispatching.
    const outer = document.createElement('shreddit-feed');
    document.body.append(outer);
    await Promise.resolve();
    const outerShadow = outer.attachShadow({ mode: 'open' });
    const inner = document.createElement('div');
    outerShadow.append(inner);

    // Later, once the hook activates, an inner host dispatches SHADOW_ATTACHED_EVENT before the 150ms fallback timer.
    const innerShadow = inner.attachShadow({ mode: 'open' });
    inner.dispatchEvent(new Event(SHADOW_ATTACHED_EVENT, { bubbles: true, composed: true }));

    expect(env.shadowRoots.has(outerShadow)).toBe(true);
    expect(env.shadowRoots.has(innerShadow)).toBe(true);
    expect(seen).toContain(outerShadow);
    expect(seen).toContain(innerShadow);
    env.dispose();
  });
});
