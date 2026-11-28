// Universal per-site enable/disable state backed by `Store` (`v2/sites`).
// Works identically across Chrome MV3, Firefox MV2, and userscript builds so
// production sites (Facebook, X) are active out of the box, experimental sites
// default off until opted in, and every site toggles live with zero page reload.

import type { Store } from './storage';
import { SITE_MANIFEST } from '../sites/manifest';
import { Listeners } from './listeners';
import { createLogger } from './log';
import { isRecord, readStoreMany, watchStoreKey } from './storage';

export const SITES_STORAGE_KEY = 'v2/sites';
/** Persisted opt-in toggled in the Sites tab before experimental/beta controls surface in the toolbar popup. */
export const EXPERIMENTAL_SITES_KEY = 'v2/experimental-sites';

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
  /** True once the user has explicitly opted into experimental sites in the Sites tab. */
  readonly isExperimentalUnlocked: () => boolean;
  /** Persists the user's experimental-sites opt-in from the Sites tab. */
  readonly setExperimentalUnlocked: (unlocked: boolean) => Promise<void>;
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

/** Validates a raw stored experimental-sites opt-in value. */
export function readExperimentalUnlocked(raw: unknown): boolean {
  return raw === true;
}

/** Creates a reactive `SiteSettingsClient` synced through `store` across tabs. */
export function createSiteSettings(store: Store): SiteSettingsClient {
  let state: Record<string, boolean> = {};
  let experimentalUnlocked = false;
  let sitesUnread = false;
  let experimentalUnread = false;
  let pendingSaves = 0;
  let pendingExperimentalSaves = 0;
  let disposed = false;
  let saveQueue: Promise<void> = Promise.resolve();
  let experimentalSaveQueue: Promise<void> = Promise.resolve();
  const listeners = new Listeners<[]>(log);

  const updateSites = (next: Record<string, boolean>): boolean => {
    const changed = !sameMap(state, next);
    state = next;
    return changed;
  };

  const apply = (next: Record<string, boolean>): void => {
    if (updateSites(next)) {
      listeners.emit();
    }
  };

  const updateExperimental = (next: boolean): boolean => {
    const changed = experimentalUnlocked !== next;
    experimentalUnlocked = next;
    return changed;
  };

  const applyExperimental = (next: boolean): void => {
    if (updateExperimental(next)) {
      listeners.emit();
    }
  };

  let liveSitesEventSeen = false;
  const stopSites = watchStoreKey(store, SITES_STORAGE_KEY, (newValue) => {
    if (!disposed && pendingSaves === 0) {
      liveSitesEventSeen = true;
      if (newValue === undefined || isRecord(newValue)) {
        sitesUnread = false;
      }
      apply(readEnabledSites(newValue));
    }
  });

  let liveExperimentalEventSeen = false;
  const stopExperimental = watchStoreKey(store, EXPERIMENTAL_SITES_KEY, (newValue) => {
    if (!disposed && pendingExperimentalSaves === 0) {
      liveExperimentalEventSeen = true;
      if (newValue === undefined || typeof newValue === 'boolean') {
        experimentalUnread = false;
      }
      applyExperimental(readExperimentalUnlocked(newValue));
    }
  });

  const ready = readStoreMany(store, [SITES_STORAGE_KEY, EXPERIMENTAL_SITES_KEY])
    .then((loaded) => {
      if (disposed) {
        return;
      }
      const sitesChanged =
        !liveSitesEventSeen && updateSites(readEnabledSites(loaded[SITES_STORAGE_KEY]));
      const expChanged =
        !liveExperimentalEventSeen &&
        updateExperimental(readExperimentalUnlocked(loaded[EXPERIMENTAL_SITES_KEY]));
      if (sitesChanged || expChanged) {
        listeners.emit();
      }
    })
    .catch((error: unknown) => {
      if (!liveSitesEventSeen) {
        sitesUnread = true;
      }
      if (!liveExperimentalEventSeen) {
        experimentalUnread = true;
      }
      if (!liveSitesEventSeen || !liveExperimentalEventSeen) {
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
        if (sitesUnread) {
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
    isExperimentalUnlocked: () => experimentalUnlocked,
    setExperimentalUnlocked(unlocked) {
      const run = experimentalSaveQueue.then(async () => {
        await ready;
        if (experimentalUnread) {
          throw new Error(
            `'${EXPERIMENTAL_SITES_KEY}' could not be read, so it is not overwritten`,
          );
        }
        if (experimentalUnlocked === unlocked) {
          return;
        }
        pendingExperimentalSaves++;
        try {
          await store.set(EXPERIMENTAL_SITES_KEY, unlocked);
        } finally {
          pendingExperimentalSaves--;
        }
        applyExperimental(unlocked);
      });
      experimentalSaveQueue = run.catch(() => undefined);
      return run;
    },
    onChange: (listener) => listeners.add(listener),
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      stopSites();
      stopExperimental();
      listeners.clear();
    },
  };
}
