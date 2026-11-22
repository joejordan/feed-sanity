import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDomEnvironment } from './dom-env';

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
});
