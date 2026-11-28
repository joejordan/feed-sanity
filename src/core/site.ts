import type { OptionsPanel } from '../ui/options-dialog/panel';
import type { DomEnvironment } from './dom-env';
import type { Feature, PageFactory } from './feature';
import type { Badge, Platform } from './platform';
import type { SiteSettingsClient } from './site-settings';
import type { SiteThemeMapping, ThemeDocumentV1, ThemeLibraryClient } from './theming';
import { initSiteTheme, THEME_DATA_KEY } from '../ui/appearance';
import { setSiteThemeCss } from '../ui/mount';
import { closeOptionsDialog, openOptionsDialog } from '../ui/options-dialog';
import { sitesPanel } from '../ui/sites-panel';
import { FeatureRunner } from './app';
import { PageBridge } from './bridge';
import { createDomEnvironment } from './dom-env';
import { createLogger } from './log';
import { Options } from './options';
import { SavedData } from './saved';
import { readSiteEnabledHint, writeSiteEnabledHint } from './site-hint';
import {
  createSiteSettings,
  EXPERIMENTAL_SITES_KEY,
  isSiteEnabledByDefault,
  SITES_STORAGE_KEY,
} from './site-settings';
import { readStoredAccountId, siteAccountStorageKey, siteStoragePrefix } from './site-storage';
import { createPreloadedStore, readStoreMany } from './storage';
import { OWN_ATTR, OWN_UI_TAG } from './surface';
import {
  applyEarlyThemeCss,
  clearEarlyThemeStyle,
  createThemeLibrary,
  HEALER_STYLE_ID,
  resolveTheme,
  THEME_GLOBAL_REV_KEY,
  THEME_LIBRARY_KEY,
  THEME_STYLE_ID,
  writeEarlyThemeCss,
} from './theming';

export { scrubCommonPii } from './pii';

/**
 * Dispatched synchronously on `document` at the start of `startSite` so any
 * previous (orphaned) Feed Sanity runtime in the same tab tears itself down
 * cleanly before the new runtime boots.
 */
export const SITE_INSTANCE_REPLACE_EVENT = 'feed-sanity-instance-replace';

/** Tracks replace events created in this JS realm (tests & userscript) so page JS cannot forge them. */
const localReplaceEvents = new WeakSet<Event>();

const LEGACY_STYLE_SELECTOR = [
  '#feed_sanity_options',
  `#${THEME_STYLE_ID}`,
  '#feed_sanity_adaptive_theme',
  `#${HEALER_STYLE_ID}`,
  '#feed_sanity_theme_healer',
  '#feed_sanity_early_theme',
  '#feed_sanity_surface',
  OWN_UI_TAG,
  `[${OWN_ATTR}]`,
].join(', ');

/**
 * Best-effort cleanup of DOM artifacts left behind when upgrading in-place from
 * an older Feed Sanity build that did not listen for `SITE_INSTANCE_REPLACE_EVENT`.
 */
function cleanupOrphanedDomArtifacts(siteId: string): void {
  if (typeof document === 'undefined') {
    return;
  }
  for (const el of document.querySelectorAll(LEGACY_STYLE_SELECTOR)) {
    el.remove();
  }
  if (siteId === 'facebook') {
    for (const post of document.querySelectorAll('[fs_post]')) {
      post.removeAttribute('fs_post');
      post.removeAttribute('fs_id');
    }
  }
}

/** One site-contributed section rendered in Diagnostics and text bug reports. */
export interface DiagnosticSection {
  readonly title: string;
  readonly lines: readonly string[];
}

/**
 * Contract every target site implements (`src/sites/facebook/`,
 * `src/sites/x/`, `src/sites/instagram/`, `src/sites/reddit/`,
 * `src/sites/gmail/`). Keeps `src/core/`, `src/ui/`, and `src/platform/`
 * free of site-specific assumptions.
 */
export interface SiteAdapter<P = unknown, F extends PageFactory<P> = PageFactory<P>> {
  readonly id: string;
  readonly displayName: string;
  /** Optional MAIN-world PageBridge toggle to deactivate if a stale localStorage hint booted hooks on a disabled site. */
  readonly pageWorldActiveToggle?: string;
  /** Hostname matcher for runtime dispatch in multi-site builds and tests. */
  readonly matchesHost: (hostname: string) => boolean;
  /** CSS token overrides mapping the host's palette onto `--fs-*` shadow-DOM tokens. */
  readonly themeCss: string;
  /** Optional declarative mapping enabling first-class user theming on this site. */
  readonly themeMapping?: SiteThemeMapping;
  /** Optional `DomEnvironment` flags shared by this site's page services and theme propagation. */
  readonly envOptions?: { readonly pierceShadow?: boolean; readonly includeIframes?: boolean };
  /** Identifies the signed-in account on this host (or `'anonymous'`). */
  readonly accountId: () => string;
  /** Strips site-specific personal identifiers (handles, slugs, post IDs) from diagnostics. */
  readonly scrubPii: (message: string) => string;
  /** Creates the site's page factory bound to saved data, page-world installer, shared `DomEnvironment`, and Options trigger. */
  readonly createPage: (
    data: SavedData,
    installPageWorld: () => Promise<void>,
    env?: DomEnvironment,
    openOptions?: (initialSection?: string) => void,
  ) => F;
  /** Features enabled on this site, in start order. */
  readonly features: readonly Feature<P>[];
  /** Custom panels added to the Options dialog (Filters, Data, Diagnostics, etc.). */
  readonly createPanels: (args: {
    options: Options;
    data: SavedData;
    page: F;
    runner: FeatureRunner<P>;
    platform: Platform;
    siteSettings?: SiteSettingsClient;
    themeLibrary?: ThemeLibraryClient;
  }) => OptionsPanel[];
}

/** Type-erased view of a registered `SiteAdapter` for hostname dispatch and startup. */
export interface RegisteredSite {
  readonly id: string;
  readonly displayName: string;
  readonly matchesHost: (hostname: string) => boolean;
  readonly start: (platform: Platform) => Promise<string[]>;
}

/** Registry of supported sites for hostname dispatch and site management UIs. */
export class SiteRegistry {
  readonly #sites = new Map<string, RegisteredSite>();

  register<P, F extends PageFactory<P>>(site: SiteAdapter<P, F>): this {
    this.#sites.set(site.id, {
      id: site.id,
      displayName: site.displayName,
      matchesHost: site.matchesHost,
      start: (platform) => startSite(site, platform),
    });
    return this;
  }

  get(id: string): RegisteredSite | undefined {
    return this.#sites.get(id);
  }

  matchHost(hostname: string): RegisteredSite | undefined {
    for (const site of this.#sites.values()) {
      if (site.matchesHost(hostname)) {
        return site;
      }
    }
    return undefined;
  }

  all(): readonly RegisteredSite[] {
    return [...this.#sites.values()];
  }
}

const EMPTY_BADGE: Badge = { count: 0, failed: false };
const PAUSED_BADGE: Badge = { count: 0, failed: false, paused: true };

const YIELD_FALLBACK_MS = 50;

/** Yields one paint frame on visible tabs (with a short timer fallback if hidden mid-yield) so UI throbbers render before site toggle work runs. */
const yieldToPaint = (): Promise<void> => {
  if (
    typeof document === 'undefined' ||
    document.hidden ||
    typeof globalThis.requestAnimationFrame !== 'function'
  ) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    let settled = false;
    let rafId = 0;
    let timerId: ReturnType<typeof setTimeout> | undefined;
    const done = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      globalThis.cancelAnimationFrame?.(rafId);
      if (timerId !== undefined) {
        clearTimeout(timerId);
      }
      resolve();
    };
    rafId = globalThis.requestAnimationFrame(done);
    timerId = setTimeout(done, YIELD_FALLBACK_MS);
  });
};

/**
 * Boots a single `SiteAdapter` against `platform`: loads the shared site
 * enablement state, wires the toolbar/menu Options trigger, and lazily creates
 * and runs the site's page services, features, and theme only while enabled
 * (or on demand when Options is opened while disabled).
 */
export async function startSite<P, F extends PageFactory<P>>(
  site: SiteAdapter<P, F>,
  platform: Platform,
): Promise<string[]> {
  const instanceId = crypto.randomUUID();
  if (typeof document !== 'undefined') {
    const replaceEvent = new CustomEvent(SITE_INSTANCE_REPLACE_EVENT, { detail: instanceId });
    localReplaceEvents.add(replaceEvent);
    document.dispatchEvent(replaceEvent);
    cleanupOrphanedDomArtifacts(site.id);
  }

  let disposed = false;
  const cleanups: Array<() => void> = [];
  const registerCleanup = (fn: (() => void) | void): void => {
    if (typeof fn === 'function') {
      if (disposed) {
        fn();
      } else {
        cleanups.push(fn);
      }
    }
  };

  const bootAccountId = site.accountId();
  const bootPrefix = siteStoragePrefix(site.id, bootAccountId);
  const siteAccountKey = siteAccountStorageKey(site.id);
  const hintedEnabled = readSiteEnabledHint(site.id, isSiteEnabledByDefault(site.id));
  const shouldRecordAccount = Boolean(
    platform.onPopupStateRequest &&
      bootAccountId &&
      bootAccountId !== 'anonymous' &&
      !bootAccountId.includes('/'),
  );

  setSiteThemeCss(site.themeCss);
  if (site.themeMapping && hintedEnabled) {
    applyEarlyThemeCss(bootPrefix);
  }

  let lastBadge: Badge | undefined;
  const emitBadge = (badge: Badge): void => {
    if (disposed) {
      return;
    }
    if (
      lastBadge &&
      lastBadge.count === badge.count &&
      lastBadge.failed === badge.failed &&
      Boolean(lastBadge.paused) === Boolean(badge.paused)
    ) {
      return;
    }
    lastBadge = badge;
    platform.setBadge(badge);
  };

  // The browser may keep the badge of the page this tab showed before, so
  // the first one is sent synchronously even before storage resolves.
  emitBadge(EMPTY_BADGE);

  // Collapse startup storage reads (`v2/sites`, options, filters, theme) into
  // one native `getMany` IPC round-trip when the platform supports it. When the
  // lightweight per-origin hint says this site is disabled, preload only
  // `v2/sites` so disabled experimental sites skip unnecessary IPC/parsing.
  const bootKeys = hintedEnabled
    ? [
        SITES_STORAGE_KEY,
        EXPERIMENTAL_SITES_KEY,
        ...(shouldRecordAccount ? [siteAccountKey] : []),
        `${bootPrefix}/options`,
        `${bootPrefix}/filters`,
        ...(site.themeMapping
          ? [
              `${bootPrefix}/${THEME_DATA_KEY}`,
              `${bootPrefix}/${THEME_GLOBAL_REV_KEY}`,
              THEME_LIBRARY_KEY,
            ]
          : []),
      ]
    : [SITES_STORAGE_KEY, EXPERIMENTAL_SITES_KEY];
  let preloadedStore: ReturnType<typeof createPreloadedStore> | undefined;
  const bootStoreReady: Promise<typeof platform.store> = platform.store.getMany
    ? readStoreMany(platform.store, bootKeys)
        .then((preloaded) => {
          preloadedStore = createPreloadedStore(platform.store, preloaded);
          return preloadedStore;
        })
        .catch(() => platform.store)
    : Promise.resolve(platform.store);

  interface SiteRuntime {
    readonly env: DomEnvironment;
    readonly page: F;
    readonly options: Options;
    readonly data: SavedData;
    readonly runner: FeatureRunner<P>;
    readonly theme: ReturnType<typeof initSiteTheme> | undefined;
    readonly ensurePanels: () => OptionsPanel[];
  }

  let runtime: SiteRuntime | undefined;
  let bootStore = platform.store;
  let siteSettings: ReturnType<typeof createSiteSettings> | undefined;
  let themeLibrary: ThemeLibraryClient | undefined;
  let active = false;
  let generation = 0;
  let initialBootDone = false;
  let activeSync: Promise<string[]> = Promise.resolve([]);
  const waitForSiteSync = async (targetSiteId: string): Promise<void> => {
    if (targetSiteId !== site.id) {
      return;
    }
    await activeSync;
  };

  const dispose = (): void => {
    if (disposed) {
      return;
    }
    disposed = true;
    active = false;
    generation++;
    for (const cleanup of cleanups.splice(0)) {
      try {
        cleanup();
      } catch {
        // Ignore teardown errors.
      }
    }
    platform.stopBadge?.();
    closeOptionsDialog();
    if (runtime) {
      runtime.runner.stop();
      runtime.theme?.dispose();
      runtime.env.dispose();
      runtime.options.dispose();
      runtime.data.dispose();
      runtime = undefined;
    }
    siteSettings?.dispose?.();
    siteSettings = undefined;
    themeLibrary?.dispose();
    themeLibrary = undefined;
    preloadedStore?.clear();
  };

  if (typeof document !== 'undefined') {
    let checkingInvalidation = false;
    let recheckPending = false;
    const runInvalidationCheck = (): void => {
      if (disposed || !platform.isContextInvalidated) {
        return;
      }
      const invalidated = platform.isContextInvalidated();
      if (invalidated === true) {
        dispose();
        return;
      }
      if (invalidated && typeof invalidated === 'object' && 'then' in invalidated) {
        checkingInvalidation = true;
        void invalidated.then(
          (dead) => {
            checkingInvalidation = false;
            if (dead) {
              dispose();
            } else if (recheckPending && !disposed) {
              recheckPending = false;
              runInvalidationCheck();
            }
          },
          () => {
            checkingInvalidation = false;
            dispose();
          },
        );
      }
    };
    const onReplace = (event: Event): void => {
      if (disposed || (event as CustomEvent<unknown>).detail === instanceId) {
        return;
      }
      // Same-realm replacement (userscript or unit tests) is authenticated by object identity.
      if (localReplaceEvents.has(event)) {
        dispose();
        return;
      }
      // Cross-world replacement (e.g. a newly loaded extension replacing an invalidated one):
      // ignore unless the platform confirms this instance's runtime is actually invalidated,
      // preventing untrusted host-page JS from killing Feed Sanity by spoofing the event.
      if (!platform.isContextInvalidated) {
        return;
      }
      if (checkingInvalidation) {
        recheckPending = true;
        return;
      }
      runInvalidationCheck();
    };
    document.addEventListener(SITE_INSTANCE_REPLACE_EVENT, onReplace, true);
    cleanups.push(() => document.removeEventListener(SITE_INSTANCE_REPLACE_EVENT, onReplace, true));
  }

  const ensureSiteSettings = (): ReturnType<typeof createSiteSettings> => {
    siteSettings ??= createSiteSettings(bootStore);
    return siteSettings;
  };

  const ensureThemeLibrary = (): ThemeLibraryClient | undefined => {
    if (!site.themeMapping) {
      return undefined;
    }
    themeLibrary ??= createThemeLibrary(bootStore);
    return themeLibrary;
  };

  const ensureRuntime = (): SiteRuntime => {
    if (runtime) {
      return runtime;
    }
    const options = new Options(bootStore, `${bootPrefix}/options`);
    const data = new SavedData(bootStore, bootPrefix);
    const env = createDomEnvironment({
      log: createLogger(`${site.id}-dom`),
      active,
      ...site.envOptions,
    });
    const library = ensureThemeLibrary();
    const theme = site.themeMapping
      ? initSiteTheme(env, data, site.themeMapping, {
          active: false,
          earlyCacheKey: bootPrefix,
          ...(library ? { library } : {}),
          ...(platform.fetchThemeUrl ? { fetchThemeUrl: platform.fetchThemeUrl } : {}),
        })
      : undefined;
    const page = site.createPage(
      data,
      () => platform.installPageWorld(site.id),
      env,
      (section) => openOptions(section),
    );
    const runner = new FeatureRunner(site.features, options, page, data);
    let cachedPanels: OptionsPanel[] | undefined;
    const ensurePanels = (): OptionsPanel[] => {
      if (cachedPanels) {
        return cachedPanels;
      }
      const settings = ensureSiteSettings();
      const sitePanels = site.createPanels({
        options,
        data,
        page,
        runner,
        platform,
        siteSettings: settings,
        ...(library ? { themeLibrary: library } : {}),
      });
      const diagIndex = sitePanels.findIndex((panel) => panel.section === 'Diagnostics');
      const insertAt = diagIndex === -1 ? sitePanels.length : diagIndex;
      cachedPanels = [
        ...(theme ? [theme.panel] : []),
        ...sitePanels.slice(0, insertAt),
        sitesPanel(settings, site.id, waitForSiteSync),
        ...sitePanels.slice(insertAt),
      ];
      return cachedPanels;
    };

    runner.onBadgeChange((badge) => {
      if (active && !disposed) {
        emitBadge(badge);
      }
    });
    runtime = { env, page, options, data, runner, theme, ensurePanels };
    return runtime;
  };

  // Register the Options, Quick Popup, and Popup State handlers synchronously
  // before awaiting storage so immediate toolbar interactions are never dropped.
  let bootSettled = false;

  const resolveBootSettings = async () => {
    const resolvedStore = await bootStoreReady;
    if (disposed) {
      return;
    }
    if (!bootSettled) {
      bootStore = resolvedStore;
    }
    const settings = ensureSiteSettings();
    await settings.ready;
    return disposed ? undefined : settings;
  };

  const readPopupTabState = async () => {
    const settings = await resolveBootSettings();
    if (!settings) {
      throw new Error('site runtime disposed');
    }
    return {
      settings,
      state: {
        siteId: site.id,
        displayName: site.displayName,
        storagePrefix: bootPrefix,
        enabled: settings.isEnabled(site.id),
        hiddenCount: runtime?.runner.badge().count ?? 0,
      },
    };
  };

  const openOptions = (initialSection?: string): void => {
    if (disposed) {
      return;
    }
    void resolveBootSettings()
      .then((settings) => {
        if (disposed || !settings) {
          return;
        }
        const { options, runner, ensurePanels } = ensureRuntime();
        return runner.prepare().then(() => {
          if (disposed) {
            return;
          }
          return openOptionsDialog(options, ensurePanels(), {
            site: { id: site.id, displayName: site.displayName },
            siteEnabled: settings.isEnabled(site.id),
            onToggleSite: async (enabled) => {
              try {
                await settings.setEnabled(site.id, enabled);
                await waitForSiteSync(site.id);
              } catch (error: unknown) {
                createLogger('sites').error('could not toggle site state', error);
              }
            },
            onSiteEnabledChange: (listener) =>
              settings.onChange(() => listener(settings.isEnabled(site.id))),
            ...(initialSection ? { initialSection } : {}),
          });
        });
      })
      .catch((error: unknown) => {
        createLogger('options').error('could not open the options dialog', error);
      });
  };

  const applyThemePreview = (doc: ThemeDocumentV1 | null): void => {
    if (disposed || !active || !runtime?.theme) {
      return;
    }
    if (doc === null) {
      runtime.theme.controller.clearPreview();
    } else {
      runtime.theme.controller.preview(resolveTheme(doc));
    }
  };

  registerCleanup(platform.onOpenOptions(openOptions));

  registerCleanup(platform.onPopupStateRequest?.(async () => (await readPopupTabState()).state));

  registerCleanup(platform.onThemePreview?.(applyThemePreview));

  registerCleanup(
    platform.registerQuickPopup?.(async () => {
      const { settings, state } = await readPopupTabState();
      const library = ensureThemeLibrary();
      return {
        store: platform.store,
        activeTab: state,
        siteSettings: settings,
        ...(library ? { themeLibrary: library } : {}),
        ...(site.themeMapping ? { onPreviewTheme: applyThemePreview } : {}),
        onOpenSettings: openOptions,
      };
    }),
  );

  bootStore = await bootStoreReady;
  if (disposed) {
    return [];
  }
  bootSettled = true;
  const resolvedSiteSettings = ensureSiteSettings();
  await resolvedSiteSettings.ready;
  if (disposed) {
    return [];
  }
  const initialEnabled = resolvedSiteSettings.isEnabled(site.id);
  let disarmBridge: PageBridge | undefined;
  const cancelDisarm = (): void => {
    if (disarmBridge) {
      const activeDisarm = disarmBridge;
      disarmBridge = undefined;
      activeDisarm.dispose({ keepRemoteAlive: true });
    }
  };
  registerCleanup(cancelDisarm);

  if (!initialEnabled) {
    writeSiteEnabledHint(site.id, false);
    // Discard unconsumed preloaded keys so re-enabling or opening Options later
    // reads fresh values instead of stale T=0 startup snapshots.
    preloadedStore?.clear();
    if (hintedEnabled && site.pageWorldActiveToggle) {
      // A stale or spoofed per-origin `localStorage` hint may have booted MAIN-world
      // hooks at `document_start`; deactivate them without spinning up `DomEnvironment`.
      const toggleName = site.pageWorldActiveToggle;
      const pendingDisarm = new PageBridge(() => Promise.resolve(), {
        log: createLogger(`${site.id}-disarm`),
      });
      disarmBridge = pendingDisarm;
      void pendingDisarm
        .set(toggleName, false)
        .catch(() => undefined)
        .finally(() => {
          if (disarmBridge === pendingDisarm) {
            disarmBridge = undefined;
          }
          pendingDisarm.dispose({ keepRemoteAlive: true });
        });
    }
    if (site.themeMapping) {
      writeEarlyThemeCss(bootPrefix, '');
      clearEarlyThemeStyle();
    }
    emitBadge(PAUSED_BADGE);
  } else if (shouldRecordAccount) {
    // Record this site's active account slot atomically under its own per-site
    // key so concurrent multi-tab boots never contend on a shared map.
    void bootStore
      .get(siteAccountKey)
      .then((raw) => {
        if (disposed || readStoredAccountId(raw) === bootAccountId) {
          return;
        }
        return platform.store.set(siteAccountKey, bootAccountId);
      })
      .catch(() => undefined);
  }

  const deactivate = (): void => {
    if (runtime) {
      runtime.runner.stop();
      runtime.theme?.setActive(false);
      runtime.page.setActive?.(false);
      runtime.env.setActive(false);
    }
    emitBadge(PAUSED_BADGE);
  };

  const syncEnabled = async (): Promise<string[]> => {
    if (disposed) {
      return [];
    }
    const want = resolvedSiteSettings.isEnabled(site.id);
    if (want === active) {
      writeSiteEnabledHint(site.id, want);
      return [];
    }
    const token = ++generation;
    const liveToggle = initialBootDone;
    active = want;
    if (!want) {
      writeSiteEnabledHint(site.id, false);
      if (liveToggle) {
        await yieldToPaint();
        if (disposed || token !== generation) {
          return [];
        }
      }
      deactivate();
      return [];
    }
    cancelDisarm();
    writeSiteEnabledHint(site.id, true);
    if (liveToggle) {
      await yieldToPaint();
      if (disposed || token !== generation) {
        return [];
      }
    }
    const current = ensureRuntime();
    current.env.setActive(true);
    current.page.setActive?.(true);
    current.theme?.setActive(true);
    if (liveToggle) {
      // Let the GPU View Transition start smoothly before starting all site features.
      await yieldToPaint();
      if (disposed || token !== generation) {
        return [];
      }
    }
    const failed = await current.runner.start();
    if (disposed) {
      return [];
    }
    // If the user disabled the site while an async feature setup was in flight,
    // stop immediately. If a newer re-enable superseded this token, leave the
    // newer run active.
    if (!resolvedSiteSettings.isEnabled(site.id)) {
      deactivate();
      return [];
    }
    if (token !== generation) {
      return [];
    }
    emitBadge(current.runner.badge());
    return failed;
  };

  const triggerSync = (): Promise<string[]> => {
    const next = syncEnabled();
    activeSync = next;
    return next;
  };

  registerCleanup(
    resolvedSiteSettings.onChange(() => {
      void triggerSync();
    }),
  );

  const initialResult = await triggerSync();
  initialBootDone = true;
  return initialResult;
}
