import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Scope } from './scope';
import { concealPending, hideElement, markElement, mountSlot, whileOnRoute } from './surface';

describe('surface primitives', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    history.replaceState({}, '', '/');
  });

  it('ref-counts markElement and hideElement across overlapping scopes and manages shared style lifecycle', () => {
    const el = document.createElement('div');
    const a = new Scope();
    const b = new Scope();

    const releaseA = hideElement(a, el);
    hideElement(b, el);
    expect(el.getAttribute('data-feed-sanity-hidden')).toBe('none');
    expect(document.querySelector('#feed_sanity_surface')).not.toBeNull();

    // Early release is idempotent and leaves the second scope's hide intact.
    releaseA();
    releaseA();
    a.dispose();
    expect(el.getAttribute('data-feed-sanity-hidden')).toBe('none');
    expect(document.querySelector('#feed_sanity_surface')).not.toBeNull();

    b.dispose();
    expect(el.hasAttribute('data-feed-sanity-hidden')).toBe(false);
    expect(document.querySelector('#feed_sanity_surface')).toBeNull();

    // Already-disposed scopes are no-ops.
    hideElement(b, el);
    expect(el.hasAttribute('data-feed-sanity-hidden')).toBe(false);
    expect(document.querySelector('#feed_sanity_surface')).toBeNull();

    const c = new Scope();
    markElement(c, el, 'data-custom', '1');
    expect(el.getAttribute('data-custom')).toBe('1');
    c.dispose();
    expect(el.hasAttribute('data-custom')).toBe(false);
  });

  it('mounts a slot relative to an anchor, re-attaches after removal, and cleans up on dispose', async () => {
    const parent = document.createElement('div');
    const anchor = document.createElement('main');
    parent.append(anchor);
    document.body.append(parent);

    const slot = document.createElement('aside');
    const scope = new Scope();
    mountSlot(scope, anchor, 'after', slot);

    expect(slot.hasAttribute('data-feed-sanity')).toBe(true);
    expect(anchor.nextElementSibling).toBe(slot);

    // Simulate Facebook removing the slot while anchor stays connected.
    slot.remove();
    await vi.waitFor(() => expect(anchor.nextElementSibling).toBe(slot));

    scope.dispose();
    expect(slot.isConnected).toBe(false);
  });

  it('activates and disposes a route scope as SPA navigation enters and leaves', () => {
    const scope = new Scope();
    const enter = vi.fn();
    const leave = vi.fn();

    whileOnRoute(
      scope,
      (url) => url.search.includes('filter=friends'),
      (routeScope) => {
        enter();
        routeScope.add(leave);
      },
    );

    expect(enter).toHaveBeenCalledTimes(0);

    history.pushState({}, '', '/?filter=friends&sk=h_chr');
    globalThis.dispatchEvent(new PopStateEvent('popstate'));
    expect(enter).toHaveBeenCalledTimes(1);
    expect(leave).toHaveBeenCalledTimes(0);

    history.pushState({}, '', '/watch/');
    globalThis.dispatchEvent(new PopStateEvent('popstate'));
    expect(leave).toHaveBeenCalledTimes(1);

    scope.dispose();
  });

  it('hides elements inside an open ShadowRoot using a root-scoped style sheet and supports concealPending', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const card = document.createElement('article');
    shadow.append(card);

    const scope = new Scope();
    hideElement(scope, card);
    expect(card.getAttribute('data-feed-sanity-hidden')).toBe('none');
    expect(shadow.querySelector('#feed_sanity_surface')).not.toBeNull();
    expect(document.querySelector('#feed_sanity_surface')).toBeNull();

    concealPending(scope, {
      id: 'feed_sanity_conceal_test',
      activeAttr: 'data-feed-sanity-filtering',
      pendingSelector: 'article:not([data-checked])',
      maxMs: 250,
    });
    expect(document.querySelector('#feed_sanity_conceal_test')?.textContent).toContain('250ms');

    scope.dispose();
    expect(card.hasAttribute('data-feed-sanity-hidden')).toBe(false);
    expect(shadow.querySelector('#feed_sanity_surface')).toBeNull();
    expect(document.querySelector('#feed_sanity_conceal_test')).toBeNull();
  });
});
