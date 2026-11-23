import { describe, expect, it, vi } from 'vitest';
import type { CapablePage } from '../capabilities';
import type { SiteAdapter } from './site';
import { defineCapabilityFeature } from '../capabilities';
import { defineFeature } from './feature';
import { SiteRegistry, scrubCommonPii, startSite } from './site';
import { SITES_STORAGE_KEY } from './site-settings';
import { inMemoryStore } from './testing';

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
      storagePrefix: (account) => `v2/demo/${account}`,
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
      storagePrefix: (account) => `v2/facebook/${account}`,
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
});
