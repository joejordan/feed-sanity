import { describe, expect, it, vi } from 'vitest';
import type { CapablePage } from '../capabilities';
import type { DomEnvironment } from './dom-env';
import type { SiteAdapter } from './site';
import type { Store } from './storage';
import { defineCapabilityFeature } from '../capabilities';
import { defineFeature } from './feature';
import { SiteRegistry, scrubCommonPii, startSite } from './site';
import { SITES_STORAGE_KEY } from './site-settings';
import { inMemoryStore } from './testing';
import { readEarlyThemeCss, writeEarlyThemeCss } from './theming';

describe('SiteRegistry, capabilities, and startSite', () => {
  it('scrubs URLs, emails, and long numbers generically', () => {
    expect(
      scrubCommonPii(
        'Failed for user@example.com at https://mail.google.com/mail/u/0/#inbox/12345678',
      ),
    ).toBe('Failed for <email> at <address>');
    expect(scrubCommonPii('id 987654321 failed')).toBe('id <number> failed');
  });

  it('activates capability features only on sites that provide all required capabilities', async () => {
    const ran: string[] = [];
    const mediaFeature = defineCapabilityFeature({
      id: 'cap_media',
      requires: ['media'] as const,
      options: {},
      setup({ caps }) {
        ran.push(typeof caps.media.onAdd);
      },
    });
    const threadFeature = defineCapabilityFeature({
      id: 'cap_threads',
      requires: ['threads'] as const,
      options: {},
      setup() {
        ran.push('threads');
      },
    });

    const site: SiteAdapter<CapablePage> = {
      id: 'demo',
      displayName: 'Demo',
      matchesHost: (host) => host === 'demo.example',
      themeCss: '',
      accountId: () => 'u1',
      scrubPii: scrubCommonPii,
      createPage: () => () => ({
        capabilities: {
          media: {
            onAdd: () => () => undefined,
            onRemove: () => () => undefined,
            around: () => undefined,
          },
        },
      }),
      features: [mediaFeature, threadFeature],
      createPanels: () => [],
    };

    const registry = new SiteRegistry().register(site);
    expect(registry.matchHost('demo.example')?.id).toBe('demo');
    expect(registry.matchHost('other.example')).toBeUndefined();

    const setBadge = vi.fn();
    const failed = await startSite(site, {
      build: 'test',
      store: inMemoryStore(),
      setBadge,
      onOpenOptions: () => () => undefined,
      installPageWorld: () => Promise.resolve(),
    });
    expect(failed).toEqual([]);
    expect(ran).toEqual(['function']);
    expect(setBadge).toHaveBeenCalled();
  });

  it('toggles any site off and back on live via v2/sites without losing Options access', async () => {
    const events: string[] = [];
    const trackedFeature = defineFeature({
      id: 'demo_feature',
      options: {
        demo_on: { section: 'General', title: 'Demo', description: 'Demo.', default: true },
      },
      enabledBy: 'demo_on',
      setup({ scope, badge }) {
        events.push('start');
        badge(2);
        scope.add(() => events.push('stop'));
      },
    });
    const site: SiteAdapter<Record<string, never>> = {
      id: 'facebook',
      displayName: 'Facebook',
      matchesHost: () => true,
      themeCss: '',
      accountId: () => 'u1',
      scrubPii: scrubCommonPii,
      createPage: () => () => ({}),
      features: [trackedFeature],
      createPanels: () => [],
    };

    const store = inMemoryStore({ [SITES_STORAGE_KEY]: { facebook: false } });
    const badges: Array<{ count: number; failed: boolean }> = [];
    const openHandlers: Array<() => void> = [];

    // Starting while disabled runs zero features yet still registers the Options handler.
    await startSite(site, {
      build: 'test',
      store,
      setBadge: (badge) => badges.push(badge),
      onOpenOptions: (listener) => openHandlers.push(listener),
      installPageWorld: () => Promise.resolve(),
    });
    expect(events).toEqual([]);
    expect(openHandlers).toHaveLength(1);
    expect(badges.at(-1)).toEqual({ count: 0, failed: false });

    // Opening Options while disabled prepares options lazily without starting features.
    openHandlers[0]?.();
    await vi.waitFor(() => expect(document.querySelector('#feed_sanity_options')).not.toBeNull());
    expect(events).toEqual([]);
    document.querySelector('#feed_sanity_options')?.remove();

    // Enabling the site live starts its feature and updates the badge.
    await store.set(SITES_STORAGE_KEY, { facebook: true });
    await vi.waitFor(() => expect(events).toEqual(['start']));
    expect(badges.at(-1)).toEqual({ count: 2, failed: false });

    // Disabling the site live disposes its feature scope and clears the badge.
    await store.set(SITES_STORAGE_KEY, { facebook: false });
    await vi.waitFor(() => expect(events).toEqual(['start', 'stop']));
    expect(badges.at(-1)).toEqual({ count: 0, failed: false });

    // Re-enabling the site live restarts features cleanly on the same runtime.
    await store.set(SITES_STORAGE_KEY, { facebook: true });
    await vi.waitFor(() => expect(events).toEqual(['start', 'stop', 'start']));
    expect(badges.at(-1)).toEqual({ count: 2, failed: false });
  });

  it('batches startup reads via getMany, shares one DomEnvironment, and clears stale early-theme cache when disabled', async () => {
    writeEarlyThemeCss('facebook', 'body { background: #111; }');
    const backing = inMemoryStore({ [SITES_STORAGE_KEY]: { facebook: false } });
    const getSpy = vi.spyOn(backing, 'get');
    const getManySpy = vi.fn(async (keys: readonly string[]) =>
      Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await backing.get(k)]))),
    );
    const batchedStore: Store = {
      get: (key) => backing.get(key),
      getMany: getManySpy,
      set: (key, value) => backing.set(key, value),
      onChange: (key, listener) => backing.onChange(key, listener),
    };

    const receivedEnvs: Array<DomEnvironment | undefined> = [];
    const site: SiteAdapter<Record<string, never>> = {
      id: 'facebook',
      displayName: 'Facebook',
      matchesHost: () => true,
      themeCss: '',
      themeMapping: { rootSelectors: [':root'] },
      accountId: () => 'u1',
      scrubPii: scrubCommonPii,
      createPage: (_data, _install, env) => {
        receivedEnvs.push(env);
        return () => ({});
      },
      features: [],
      createPanels: () => [],
    };

    await startSite(site, {
      build: 'test',
      store: batchedStore,
      setBadge: () => undefined,
      onOpenOptions: () => () => undefined,
      installPageWorld: () => Promise.resolve(),
    });

    // Batched preload ran once; disabled site cleared early-theme cache and style immediately.
    expect(getManySpy).toHaveBeenCalledTimes(1);
    expect(readEarlyThemeCss('facebook')).toBe('');
    expect(document.querySelector('#feed_sanity_user_theme')).toBeNull();

    // Updating options while disabled and then enabling reads live storage (not stale T=0 preload)
    // and receives a single shared DomEnvironment.
    getSpy.mockClear();
    await backing.set('v2/facebook/u1/options', { demo: true });
    await backing.set(SITES_STORAGE_KEY, { facebook: true });
    await vi.waitFor(() => expect(receivedEnvs).toHaveLength(1));
    expect(receivedEnvs[0]).toBeDefined();
    expect(getSpy).toHaveBeenCalledWith('v2/facebook/u1/options');
  });

  it('defers createPanels until the user opens the Options dialog and caches them across reopens', async () => {
    const createPanels = vi.fn(() => []);
    const openHandlers: Array<() => void> = [];
    const site: SiteAdapter<Record<string, never>> = {
      id: 'facebook',
      displayName: 'Facebook',
      matchesHost: () => true,
      themeCss: '',
      themeMapping: { rootSelectors: [':root'] },
      accountId: () => 'u1',
      scrubPii: scrubCommonPii,
      createPage: () => () => ({}),
      features: [],
      createPanels,
    };

    await startSite(site, {
      build: 'test',
      store: inMemoryStore(),
      setBadge: () => undefined,
      onOpenOptions: (listener) => openHandlers.push(listener),
      installPageWorld: () => Promise.resolve(),
    });

    // Startup runs cleanly without constructing any Settings panel UI or subscriptions.
    expect(createPanels).not.toHaveBeenCalled();

    // First Options open constructs panels once; reopening reuses them.
    openHandlers[0]?.();
    await vi.waitFor(() => expect(createPanels).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(document.querySelector('#feed_sanity_options')).not.toBeNull());
    openHandlers[0]?.();
    expect(createPanels).toHaveBeenCalledTimes(1);
    document
      .querySelector('#feed_sanity_options')
      ?.shadowRoot?.querySelector<HTMLButtonElement>('button[aria-label="Close"]')
      ?.click();
  });
});
