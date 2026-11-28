import { SITE_MANIFEST } from '../sites/manifest';

const KNOWN_SITE_IDS: ReadonlySet<string> = new Set(SITE_MANIFEST.map((site) => site.id));

/** Per-site storage key holding the last active account slot (atomic per site; zero cross-site write contention). */
export function siteAccountStorageKey(siteId: string): string {
  return `v2/site-account/${siteId}`;
}

/** Builds a site- and account-namespaced storage prefix (`v2/<siteId>/<accountId>`). */
export function siteStoragePrefix(siteId: string, accountId: string): string {
  return `v2/${siteId}/${accountId}`;
}

/** Validates a stored account ID value (must be a non-empty string with no path separator). */
export function readStoredAccountId(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.length > 0 && !raw.includes('/') ? raw : undefined;
}

/** Reads all valid per-site recorded account IDs from a `storage.local.get(null)` snapshot. */
export function readSiteAccountsFromSnapshot(
  snapshot: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const siteId of KNOWN_SITE_IDS) {
    const accountId = readStoredAccountId(snapshot[siteAccountStorageKey(siteId)]);
    if (accountId) {
      result[siteId] = accountId;
    }
  }
  return result;
}

/**
 * Resolves the best storage account ID for `siteId` when opened outside a live
 * host tab: prefers the recorded active account in `v2/site-account/<siteId>`,
 * then falls back to any existing `v2/<siteId>/<accountId>/*` keys in storage
 * (preferring a non-anonymous account), and finally `'anonymous'`.
 */
export function resolveSiteAccountId(
  siteId: string,
  recordedAccounts: Readonly<Record<string, string>>,
  allStorageKeys: readonly string[] = [],
): string {
  const recorded = recordedAccounts[siteId];
  if (recorded && recorded !== 'anonymous') {
    return recorded;
  }
  const prefix = `v2/${siteId}/`;
  for (const key of allStorageKeys) {
    if (!key.startsWith(prefix)) {
      continue;
    }
    const rest = key.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash <= 0) {
      continue;
    }
    const candidate = rest.slice(0, slash);
    if (candidate !== 'anonymous') {
      return candidate;
    }
  }
  return recorded || 'anonymous';
}
