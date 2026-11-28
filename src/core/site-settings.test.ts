import { describe, expect, it, vi } from 'vitest';
import type { Store } from './storage';
import { SITE_MANIFEST } from '../sites/manifest';
import { siteRegistry } from '../start';
import {
  createSiteSettings,
  EXPERIMENTAL_SITES_KEY,
  isSiteEnabled,
  readEnabledSites,
  readExperimentalUnlocked,
  SITES_STORAGE_KEY,
} from './site-settings';
import {
  readSiteAccountsFromSnapshot,
  resolveSiteAccountId,
  siteAccountStorageKey,
} from './site-storage';
import { inMemoryStore } from './testing';

describe('site settings and equal site registry', () => {
  it('registers and matches every manifest site equally with no silent fallback', () => {
    expect(siteRegistry.all().map((site) => site.id)).toEqual(SITE_MANIFEST.map((site) => site.id));
    expect(siteRegistry.matchHost('www.facebook.com')?.id).toBe('facebook');
    expect(siteRegistry.matchHost('www.instagram.com')?.id).toBe('instagram');
    expect(siteRegistry.matchHost('x.com')?.id).toBe('x');
    expect(siteRegistry.matchHost('twitter.com')?.id).toBe('x');
    expect(siteRegistry.matchHost('mail.google.com')?.id).toBe('gmail');
    expect(siteRegistry.matchHost('www.reddit.com')?.id).toBe('reddit');
    expect(siteRegistry.matchHost('sh.reddit.com')?.id).toBe('reddit');
    expect(siteRegistry.matchHost('example.com')).toBeUndefined();
  });

  it('defaults production sites enabled and experimental sites disabled, toggles any site, avoids no-op writes, and syncs across storage changes', async () => {
    const store = inMemoryStore({
      [SITES_STORAGE_KEY]: { facebook: true, unknown_site: false, instagram: 'bad' },
    });
    const setSpy = vi.spyOn(store, 'set');
    const settings = createSiteSettings(store);
    await settings.ready;

    // Production sites (Facebook, X) default enabled; experimental sites (Instagram, Reddit, Gmail)
    // default disabled, and malformed/unknown keys are ignored.
    expect(settings.list().map((s) => [s.id, s.enabled, Boolean(s.experimental)])).toEqual(
      SITE_MANIFEST.map((s) => [s.id, !s.experimental, Boolean(s.experimental)]),
    );
    expect(readEnabledSites(null)).toEqual({});
    expect(readEnabledSites(['facebook'])).toEqual({});
    expect(isSiteEnabled({}, 'facebook')).toBe(true);
    expect(isSiteEnabled({}, 'x')).toBe(true);
    expect(isSiteEnabled({}, 'instagram')).toBe(false);
    expect(isSiteEnabled({}, 'reddit')).toBe(false);
    expect(isSiteEnabled({}, 'gmail')).toBe(false);
    expect(isSiteEnabled({ instagram: true }, 'instagram')).toBe(true);

    const changes = vi.fn();
    const stop = settings.onChange(changes);

    // No-op toggle does not write to storage or notify listeners.
    await settings.setEnabled('facebook', true);
    await settings.setEnabled('instagram', false);
    expect(setSpy).not.toHaveBeenCalled();
    expect(changes).not.toHaveBeenCalled();

    // Production and experimental sites can both be toggled off/on identically.
    await settings.setEnabled('facebook', false);
    expect(settings.isEnabled('facebook')).toBe(false);
    expect(settings.isEnabled('instagram')).toBe(false);
    expect(await store.get(SITES_STORAGE_KEY)).toMatchObject({ facebook: false });
    expect(changes).toHaveBeenCalledTimes(1);

    // Unknown site IDs are ignored.
    await settings.setEnabled('nonexistent', false);
    expect(changes).toHaveBeenCalledTimes(1);

    // Cross-tab storage write updates state and notifies listeners.
    await store.set(SITES_STORAGE_KEY, { facebook: true, gmail: true });
    expect(settings.isEnabled('facebook')).toBe(true);
    expect(settings.isEnabled('gmail')).toBe(true);
    expect(changes).toHaveBeenCalledTimes(2);

    // Concurrent setEnabled calls serialize cleanly without clobbering each other.
    await Promise.all([
      settings.setEnabled('facebook', false),
      settings.setEnabled('instagram', true),
    ]);
    expect(settings.isEnabled('facebook')).toBe(false);
    expect(settings.isEnabled('instagram')).toBe(true);
    expect(await store.get(SITES_STORAGE_KEY)).toMatchObject({
      facebook: false,
      instagram: true,
      gmail: true,
    });

    stop();
  });

  it('keeps state unchanged on store write failure and refuses to overwrite unread storage', async () => {
    const failingWriteStore: Store = {
      get: async () => ({ facebook: true }),
      set: async () => {
        throw new Error('quota exceeded');
      },
      onChange: () => undefined,
    };
    const settings = createSiteSettings(failingWriteStore);
    await settings.ready;

    const changes = vi.fn();
    settings.onChange(changes);
    await expect(settings.setEnabled('facebook', false)).rejects.toThrow('quota exceeded');
    expect(settings.isEnabled('facebook')).toBe(true);
    expect(changes).not.toHaveBeenCalled();

    const unreadStore: Store = {
      get: async () => {
        throw new Error('storage corrupted');
      },
      set: vi.fn(async () => undefined),
      onChange: () => undefined,
    };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const unreadSettings = createSiteSettings(unreadStore);
    await unreadSettings.ready;
    await expect(unreadSettings.setEnabled('facebook', false)).rejects.toThrow('could not be read');
    await expect(unreadSettings.setExperimentalUnlocked(true)).rejects.toThrow('could not be read');
    expect(unreadStore.set).not.toHaveBeenCalled();
  });

  it('persists experimental sites opt-in reactively and resolves stored site account prefixes cleanly', async () => {
    const store = inMemoryStore();
    const setSpy = vi.spyOn(store, 'set');
    const settings = createSiteSettings(store);
    await settings.ready;

    expect(settings.isExperimentalUnlocked()).toBe(false);
    expect(readExperimentalUnlocked('true')).toBe(false);
    expect(readExperimentalUnlocked(true)).toBe(true);

    // No-op write is skipped.
    await settings.setExperimentalUnlocked(false);
    expect(setSpy).not.toHaveBeenCalled();

    const changes = vi.fn();
    const stop = settings.onChange(changes);
    await settings.setExperimentalUnlocked(true);
    expect(settings.isExperimentalUnlocked()).toBe(true);
    expect(await store.get(EXPERIMENTAL_SITES_KEY)).toBe(true);
    expect(changes).toHaveBeenCalledTimes(1);

    // Cross-tab update syncs immediately.
    await store.set(EXPERIMENTAL_SITES_KEY, false);
    expect(settings.isExperimentalUnlocked()).toBe(false);
    expect(changes).toHaveBeenCalledTimes(2);
    stop();
    settings.dispose?.();

    // Account resolution prefers recorded non-anonymous per-site keys, then scans storage keys.
    expect(
      readSiteAccountsFromSnapshot({
        [siteAccountStorageKey('facebook')]: '1000123',
        [siteAccountStorageKey('x')]: 'bad/slash',
        [siteAccountStorageKey('unknown')]: '99',
      }),
    ).toEqual({
      facebook: '1000123',
    });
    expect(
      resolveSiteAccountId('facebook', { facebook: '1000123' }, ['v2/facebook/999/options']),
    ).toBe('1000123');
    expect(resolveSiteAccountId('x', {}, ['v2/x/anonymous/options', 'v2/x/424242/theme'])).toBe(
      '424242',
    );
    expect(resolveSiteAccountId('gmail', {}, [])).toBe('anonymous');
  });
});
