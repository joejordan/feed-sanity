import type { Store } from './storage';

/** Builds a site- and account-namespaced storage prefix (`v2/<siteId>/<accountId>`). */
export function siteStoragePrefix(siteId: string, accountId: string): string {
  return `v2/${siteId}/${accountId}`;
}

/**
 * Lossless one-time migration helper: copies any keys still living under
 * `legacyPrefix/<key>` to `nextPrefix/<key>` when `nextPrefix/<key>` is not
 * yet present, preserving existing user settings and history.
 */
export async function migrateStoragePrefix(
  store: Store,
  legacyPrefix: string,
  nextPrefix: string,
  keys: readonly string[],
): Promise<number> {
  if (legacyPrefix === nextPrefix) {
    return 0;
  }
  const moved = await Promise.all(
    keys.map(async (key): Promise<number> => {
      const nextKey = `${nextPrefix}/${key}`;
      const existing = await store.get(nextKey);
      if (existing !== undefined) {
        return 0;
      }
      const legacy = await store.get(`${legacyPrefix}/${key}`);
      if (legacy === undefined) {
        return 0;
      }
      await store.set(nextKey, legacy);
      return 1;
    }),
  );
  return moved.reduce((sum, count) => sum + count, 0);
}
