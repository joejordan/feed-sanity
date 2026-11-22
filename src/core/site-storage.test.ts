import { describe, expect, it } from 'vitest';
import { migrateStoragePrefix, siteStoragePrefix } from './site-storage';
import { inMemoryStore } from './testing';

describe('site-storage', () => {
  it('builds site- and account-namespaced prefixes and migrates legacy keys without overwriting', async () => {
    expect(siteStoragePrefix('instagram', '12345')).toBe('v2/instagram/12345');

    const store = inMemoryStore({
      '12345/options': { home_feed: 'friends' },
      '12345/filters': [{ title: 'Mute' }],
      'v2/facebook/12345/options': { home_feed: 'groups' },
    });

    const moved = await migrateStoragePrefix(store, '12345', 'v2/facebook/12345', [
      'options',
      'filters',
      'locators',
    ]);
    expect(moved).toBe(1);
    // Existing v2 key was preserved; legacy-only key was copied.
    expect(await store.get('v2/facebook/12345/options')).toEqual({ home_feed: 'groups' });
    expect(await store.get('v2/facebook/12345/filters')).toEqual([{ title: 'Mute' }]);
    expect(await store.get('v2/facebook/12345/locators')).toBeUndefined();
  });
});
