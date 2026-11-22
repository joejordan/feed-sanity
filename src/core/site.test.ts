import { describe, expect, it, vi } from 'vitest';
import type { CapablePage } from '../capabilities';
import type { SiteAdapter } from './site';
import { defineCapabilityFeature } from '../capabilities';
import { SiteRegistry, scrubCommonPii, startSite } from './site';
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
});
