// Manages optional host permissions and dynamic runtime content-script
// registration for secondary sites (Instagram today; X.com, TikTok, Gmail next).
// Keeps Facebook's static permissions minimal while letting users opt into
// additional sites on demand with zero page reload.

import type { SiteManifestEntry } from '../sites/manifest';
import type { SitePermissionStatus } from './messages';
import { OPTIONAL_SITES, SITE_MANIFEST } from '../sites/manifest';
import { isSitePermissionRevokeMessage, OPEN_OPTIONS, SITE_PERMISSIONS_GET } from './messages';

export interface PermissionsApi {
  contains: (query: { origins: string[] }) => Promise<boolean>;
  request: (query: { origins: string[] }) => Promise<boolean>;
  remove: (query: { origins: string[] }) => Promise<boolean>;
}

export interface RegisteredScriptSpec {
  readonly id: string;
  readonly matches: string[];
  readonly excludeMatches?: string[];
  readonly js: string[];
  readonly runAt: 'document_start';
  readonly world?: 'ISOLATED' | 'MAIN';
}

export interface ScriptingApi {
  getRegisteredContentScripts: (filter?: { ids?: string[] }) => Promise<Array<{ id: string }>>;
  registerContentScripts: (scripts: RegisteredScriptSpec[]) => Promise<void>;
  unregisterContentScripts: (filter?: { ids?: string[] }) => Promise<void>;
  executeScript: (injection: {
    target: { tabId: number };
    files: string[];
    world?: 'ISOLATED' | 'MAIN';
  }) => Promise<unknown>;
}

export interface LegacyContentScriptsApi {
  register: (options: {
    matches: string[];
    excludeMatches?: string[];
    js: Array<{ file: string }>;
    runAt: 'document_start';
  }) => Promise<{ unregister: () => Promise<void> }>;
}

export interface TabsApi {
  sendMessage: (tabId: number, message: unknown) => Promise<unknown>;
}

export interface SitePermissionsHost {
  readonly permissions?: PermissionsApi;
  readonly scripting?: ScriptingApi;
  readonly contentScripts?: LegacyContentScriptsApi;
  readonly tabs?: TabsApi;
}

const contentScriptId = (siteId: string): string => `feed-sanity-${siteId}-content`;
const pageWorldScriptId = (siteId: string): string => `feed-sanity-${siteId}-page-world`;

function scriptSpecsFor(site: SiteManifestEntry): RegisteredScriptSpec[] {
  const specs: RegisteredScriptSpec[] = [];
  const excludeMatches = site.excludeMatches.length > 0 ? [...site.excludeMatches] : undefined;
  if (site.pageWorldScript) {
    specs.push({
      id: pageWorldScriptId(site.id),
      matches: [...site.matches],
      ...(excludeMatches ? { excludeMatches } : {}),
      js: [site.pageWorldScript],
      runAt: 'document_start',
      world: 'MAIN',
    });
  }
  if (site.contentScript) {
    specs.push({
      id: contentScriptId(site.id),
      matches: [...site.matches],
      ...(excludeMatches ? { excludeMatches } : {}),
      js: [site.contentScript],
      runAt: 'document_start',
      world: 'ISOLATED',
    });
  }
  return specs;
}

/** Projects a manifest entry and permission flag onto a UI status record. */
export const toSiteStatus = (site: SiteManifestEntry, enabled: boolean): SitePermissionStatus => ({
  id: site.id,
  displayName: site.displayName,
  description: site.description,
  required: site.required,
  enabled,
});

/** Projects `SITE_MANIFEST` onto default status entries (`allEnabled` true for userscripts). */
export const manifestSiteStatuses = (allEnabled: boolean): SitePermissionStatus[] =>
  SITE_MANIFEST.map((site) => toSiteStatus(site, allEnabled || site.required));

interface HostSyncState {
  inFlight: Promise<void> | undefined;
  rerun: boolean;
  readonly enablingTabs: Set<number>;
  readonly legacyHandles: Map<string, { unregister: () => Promise<void> }>;
}

const syncStates = new WeakMap<SitePermissionsHost, HostSyncState>();

function stateFor(host: SitePermissionsHost): HostSyncState {
  let state = syncStates.get(host);
  if (!state) {
    state = {
      inFlight: undefined,
      rerun: false,
      enablingTabs: new Set(),
      legacyHandles: new Map(),
    };
    syncStates.set(host, state);
  }
  return state;
}

/** Checks whether the browser has granted origin permissions for `site`. */
export async function hasSitePermission(
  host: SitePermissionsHost,
  site: SiteManifestEntry,
): Promise<boolean> {
  if (site.required) {
    return true;
  }
  if (!host.permissions) {
    return false;
  }
  try {
    return await host.permissions.contains({ origins: [...site.matches] });
  } catch {
    return false;
  }
}

/** Returns the current enabled/required status for every site in `SITE_MANIFEST`. */
export async function listSitePermissions(
  host: SitePermissionsHost,
): Promise<SitePermissionStatus[]> {
  return Promise.all(
    SITE_MANIFEST.map(async (site) => toSiteStatus(site, await hasSitePermission(host, site))),
  );
}

async function runSyncOnce(host: SitePermissionsHost, state: HostSyncState): Promise<void> {
  if (host.scripting) {
    const existing = await host.scripting.getRegisteredContentScripts().catch(() => []);
    const existingIds = new Set(existing.map((entry) => entry.id));
    for (const site of OPTIONAL_SITES) {
      const specs = scriptSpecsFor(site);
      const granted = await hasSitePermission(host, site);
      if (granted) {
        const missing = specs.filter((spec) => !existingIds.has(spec.id));
        if (missing.length > 0) {
          await host.scripting.registerContentScripts(missing).catch(() => undefined);
        }
      } else {
        const toRemove = specs.map((spec) => spec.id).filter((id) => existingIds.has(id));
        if (toRemove.length > 0) {
          await host.scripting.unregisterContentScripts({ ids: toRemove }).catch(() => undefined);
        }
      }
    }
    return;
  }

  // Fallback for older MV2 environments without `browser.scripting`.
  if (host.contentScripts) {
    for (const site of OPTIONAL_SITES) {
      const granted = await hasSitePermission(host, site);
      const current = state.legacyHandles.get(site.id);
      if (granted && !current && site.contentScript) {
        const handle = await host.contentScripts
          .register({
            matches: [...site.matches],
            ...(site.excludeMatches.length > 0 ? { excludeMatches: [...site.excludeMatches] } : {}),
            js: [{ file: site.contentScript }],
            runAt: 'document_start',
          })
          .catch(() => undefined);
        if (handle) {
          state.legacyHandles.set(site.id, handle);
        }
      } else if (!granted && current) {
        state.legacyHandles.delete(site.id);
        await current.unregister().catch(() => undefined);
      }
    }
  }
}

/**
 * Synchronizes dynamically registered content scripts with the currently
 * granted optional host permissions. Serialized per host so overlapping
 * startup, permission event, and toolbar click calls never race or duplicate
 * script registrations.
 */
export function syncOptionalSiteScripts(host: SitePermissionsHost): Promise<void> {
  const state = stateFor(host);
  if (state.inFlight) {
    state.rerun = true;
    return state.inFlight;
  }
  const run = (async (): Promise<void> => {
    try {
      do {
        state.rerun = false;
        await runSyncOnce(host, state);
      } while (state.rerun);
    } finally {
      state.inFlight = undefined;
    }
  })();
  state.inFlight = run;
  return run;
}

/**
 * Requests optional host permission for `site` synchronously inside a toolbar
 * action click user gesture (resolving immediately when already granted).
 * Once granted, registers the site's runtime scripts, probes whether the
 * content script is already running in `tabId` (avoiding double injection),
 * injects if needed, and opens Options.
 */
export async function enableSiteForTab(
  host: SitePermissionsHost,
  site: SiteManifestEntry,
  tabId: number,
): Promise<boolean> {
  if (!host.permissions) {
    return false;
  }
  const state = stateFor(host);
  if (state.enablingTabs.has(tabId)) {
    return false;
  }
  state.enablingTabs.add(tabId);
  try {
    // Invoke `permissions.request` synchronously before any `await` so Firefox
    // preserves the user-input handler activation.
    const granted = await host.permissions
      .request({ origins: [...site.matches] })
      .catch(() => false);
    if (!granted) {
      return false;
    }
    await syncOptionalSiteScripts(host);
    // If a content script is already live in this tab, opening Options succeeds
    // directly without re-injecting.
    const alreadyRunning = host.tabs
      ? await host.tabs.sendMessage(tabId, OPEN_OPTIONS).then(
          () => true,
          () => false,
        )
      : false;
    if (!alreadyRunning && host.scripting) {
      for (const spec of scriptSpecsFor(site)) {
        await host.scripting
          .executeScript({
            target: { tabId },
            files: spec.js,
            ...(spec.world ? { world: spec.world } : {}),
          })
          .catch(() => undefined);
      }
      await host.tabs?.sendMessage(tabId, OPEN_OPTIONS).catch(() => undefined);
    }
    return true;
  } finally {
    state.enablingTabs.delete(tabId);
  }
}

/** Revokes optional host permission for `siteId` and unregisters its runtime scripts. */
export async function revokeSitePermission(
  host: SitePermissionsHost,
  siteId: string,
): Promise<boolean> {
  const site = OPTIONAL_SITES.find((entry) => entry.id === siteId);
  if (!site || !host.permissions) {
    return false;
  }
  const removed = await host.permissions.remove({ origins: [...site.matches] }).catch(() => false);
  await syncOptionalSiteScripts(host);
  return removed;
}

/**
 * Background runtime message listener answering site-permission queries and
 * revocations from the Options dialog's Sites panel. Uses `sendResponse` +
 * synchronous `return true` for full Chrome MV3 and Firefox MV2 compatibility.
 */
export function sitePermissionsListener(
  host: SitePermissionsHost,
): (
  message: unknown,
  sender?: unknown,
  sendResponse?: (response: unknown) => void,
) => boolean | Promise<unknown> | undefined {
  return (message, _sender, sendResponse) => {
    let pending: Promise<SitePermissionStatus[]> | undefined;
    if (message === SITE_PERMISSIONS_GET) {
      pending = listSitePermissions(host);
    } else if (isSitePermissionRevokeMessage(message)) {
      pending = revokeSitePermission(host, message.siteId).then(() => listSitePermissions(host));
    }
    if (!pending) {
      return;
    }
    if (typeof sendResponse === 'function') {
      void pending.then(sendResponse, () => sendResponse(undefined));
      return true;
    }
    return pending;
  };
}
