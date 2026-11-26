// Universal per-site enable/disable state backed by `Store` (`v2/sites`).
// Works identically across Chrome MV3, Firefox MV2, and userscript builds so
// production sites (Facebook, X) are active out of the box, experimental sites
// default off until opted in, and every site toggles live with zero page reload.

import type { Store } from './storage';
import { SITE_MANIFEST } from '../sites/manifest';
import { Listeners } from './listeners';
import { createLogger } from './log';
import { isRecord } from './storage';

export const SITES_STORAGE_KEY = 'v2/sites';

/** Runtime enablement state of one supported site, shown in the Options dialog's Sites section. */
export interface SiteStatus {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly experimental?: boolean;
}

/** Storage-backed client controlling which supported sites are enabled. */
export interface SiteSettingsClient {
  readonly ready: Promise<void>;
  readonly list: () => SiteStatus[];
  readonly isEnabled: (siteId: string) => boolean;
  readonly setEnabled: (siteId: string, enabled: boolean) => Promise<void>;
  readonly onChange: (listener: () => void) => () => void;
  readonly dispose?: () => void;
}

const DEFAULT_ENABLED_BY_ID: ReadonlyMap<string, boolean> = new Map(
  SITE_MANIFEST.map((site) => [site.id, !site.experimental]),
);
const log = createLogger('sites');

/** Whether a site defaults to enabled before any user toggle is saved in `v2/sites`. */
export function isSiteEnabledByDefault(siteId: string): boolean {
  return DEFAULT_ENABLED_BY_ID.get(siteId) ?? true;
}

/** Validates a raw stored site-enablement map, keeping only known site boolean flags. */
export function readEnabledSites(raw: unknown): Record<string, boolean> {
  if (!isRecord(raw)) {
    return {};
  }
  const result: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (DEFAULT_ENABLED_BY_ID.has(key) && typeof value === 'boolean') {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Resolves whether `siteId` is enabled: explicit user choice in `map` wins,
 * otherwise production sites default enabled and experimental sites default disabled.
 */
export const isSiteEnabled = (map: Readonly<Record<string, boolean>>, siteId: string): boolean => {
  const explicit = map[siteId];
  if (typeof explicit === 'boolean') {
    return explicit;
  }
  return isSiteEnabledByDefault(siteId);
};

/** True for production sites and any experimental site the user actively enabled. */
export const isSiteVisible = (site: Pick<SiteStatus, 'experimental' | 'enabled'>): boolean =>
  !site.experimental || site.enabled;

function sameMap(
  a: Readonly<Record<string, boolean>>,
  b: Readonly<Record<string, boolean>>,
): boolean {
  for (const site of SITE_MANIFEST) {
    if (isSiteEnabled(a, site.id) !== isSiteEnabled(b, site.id)) {
      return false;
    }
  }
  return true;
}

/** Creates a reactive `SiteSettingsClient` synced through `store` across tabs. */
export function createSiteSettings(store: Store): SiteSettingsClient {
  let state: Record<string, boolean> = {};
  let unread = false;
  let pendingSaves = 0;
  let disposed = false;
  let unsubscribeStore: (() => void) | undefined;
  let saveQueue: Promise<void> = Promise.resolve();
  const listeners = new Listeners<[]>(log);

  const apply = (next: Record<string, boolean>): void => {
    const changed = !sameMap(state, next);
    state = next;
    if (changed) {
      listeners.emit();
    }
  };

  let liveEventSeen = false;
  const stopStore = store.onChange(SITES_STORAGE_KEY, (_oldValue, newValue) => {
    if (!disposed && pendingSaves === 0) {
      liveEventSeen = true;
      if (newValue === undefined || isRecord(newValue)) {
        unread = false;
      }
      apply(readEnabledSites(newValue));
    }
  });
  if (typeof stopStore === 'function') {
    unsubscribeStore = stopStore;
  }

  const ready = store
    .get(SITES_STORAGE_KEY)
    .then((raw) => {
      if (!disposed && !liveEventSeen) {
        apply(readEnabledSites(raw));
      }
    })
    .catch((error: unknown) => {
      if (!liveEventSeen) {
        unread = true;
        log.error('could not read site settings', error);
      }
    });

  return {
    ready,
    list: () =>
      SITE_MANIFEST.map((site) => ({
        id: site.id,
        displayName: site.displayName,
        description: site.description,
        enabled: isSiteEnabled(state, site.id),
        ...(site.experimental ? { experimental: true } : {}),
      })),
    isEnabled: (siteId) => isSiteEnabled(state, siteId),
    setEnabled(siteId, enabled) {
      if (!DEFAULT_ENABLED_BY_ID.has(siteId)) {
        return Promise.resolve();
      }
      const run = saveQueue.then(async () => {
        await ready;
        if (unread) {
          throw new Error(`'${SITES_STORAGE_KEY}' could not be read, so it is not overwritten`);
        }
        if (isSiteEnabled(state, siteId) === enabled) {
          return;
        }
        const next = { ...state, [siteId]: enabled };
        pendingSaves++;
        try {
          await store.set(SITES_STORAGE_KEY, next);
        } finally {
          pendingSaves--;
        }
        apply(next);
      });
      // Keep the queue advancing even if one write fails while still rejecting this caller.
      saveQueue = run.catch(() => undefined);
      return run;
    },
    onChange: (listener) => listeners.add(listener),
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      unsubscribeStore?.();
      unsubscribeStore = undefined;
      listeners.clear();
    },
  };
}
