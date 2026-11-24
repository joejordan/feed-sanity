import type { OptionsPanel } from '../ui/options-dialog/panel';
import type { DomEnvironment } from './dom-env';
import type { Feature, PageFactory } from './feature';
import type { Platform } from './platform';
import type { SiteThemeMapping } from './theming';
import { initSiteTheme, THEME_DATA_KEY } from '../ui/appearance';
import { setSiteThemeCss } from '../ui/mount';
import { openOptionsDialog } from '../ui/options-dialog';
import { sitesPanel } from '../ui/sites-panel';
import { FeatureRunner } from './app';
import { createDomEnvironment } from './dom-env';
import { createLogger } from './log';
import { Options } from './options';
import { SavedData } from './saved';
import { createSiteSettings, SITES_STORAGE_KEY } from './site-settings';
import { siteStoragePrefix } from './site-storage';
import { createPreloadedStore, readStoreMany } from './storage';
import { applyEarlyThemeCss, clearEarlyThemeStyle, writeEarlyThemeCss } from './theming';

export { scrubCommonPii } from './pii';

/** One site-contributed section rendered in Diagnostics and text bug reports. */
export interface DiagnosticSection {
  readonly title: string;
  readonly lines: readonly string[];
}

/**
 * Contract every target site implements (`src/sites/facebook/`,
 * `src/sites/instagram/`, `src/sites/x/`, `src/sites/gmail/`). Keeps
 * `src/core/`, `src/ui/`, and `src/platform/` free of site-specific assumptions.
 */
export interface SiteAdapter<P = unknown, F extends PageFactory<P> = PageFactory<P>> {
  readonly id: string;
  readonly displayName: string;
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
  setSiteThemeCss(site.themeCss);
  if (site.themeMapping) {
    applyEarlyThemeCss(site.id);
  }

  // The browser may keep the badge of the page this tab showed before, so
  // the first one is sent synchronously even before storage resolves.
  platform.setBadge({ count: 0, failed: false });

  // Collapse startup storage reads (`v2/sites`, options, filters, theme) into
  // one native `getMany` IPC round-trip when the platform supports it. If the
  // batched read rejects, fall back to `platform.store` directly so individual
  // consumers observe the real storage failure and refuse to overwrite data.
  const bootPrefix = siteStoragePrefix(site.id, site.accountId());
  const bootKeys = [
    SITES_STORAGE_KEY,
    `${bootPrefix}/options`,
    `${bootPrefix}/filters`,
    ...(site.themeMapping ? [`${bootPrefix}/${THEME_DATA_KEY}`] : []),
  ];
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
    readonly options: Options;
    readonly runner: FeatureRunner<P>;
    readonly theme: ReturnType<typeof initSiteTheme> | undefined;
    readonly ensurePanels: () => OptionsPanel[];
  }

  let runtime: SiteRuntime | undefined;
  let bootStore = platform.store;
  let siteSettings: ReturnType<typeof createSiteSettings> | undefined;

  const ensureSiteSettings = (): ReturnType<typeof createSiteSettings> => {
    siteSettings ??= createSiteSettings(bootStore);
    return siteSettings;
  };

  const ensureRuntime = (): SiteRuntime => {
    if (runtime) {
      return runtime;
    }
    const options = new Options(bootStore, `${bootPrefix}/options`);
    const data = new SavedData(bootStore, bootPrefix);
    const env = createDomEnvironment({
      log: createLogger(`${site.id}-dom`),
      ...site.envOptions,
    });
    const theme = site.themeMapping
      ? initSiteTheme(env, data, site.themeMapping, {
          active: false,
          earlyCacheSiteId: site.id,
        })
      : undefined;
    const page = site.createPage(
      data,
      () => platform.installPageWorld(),
      env,
      (section) => openOptions(section),
    );
    const runner = new FeatureRunner(site.features, options, page, data);
    let cachedPanels: OptionsPanel[] | undefined;
    const ensurePanels = (): OptionsPanel[] => {
      if (cachedPanels) {
        return cachedPanels;
      }
      const sitePanels = site.createPanels({ options, data, page, runner, platform });
      const diagIndex = sitePanels.findIndex((panel) => panel.section === 'Diagnostics');
      const insertAt = diagIndex === -1 ? sitePanels.length : diagIndex;
      cachedPanels = [
        ...(theme ? [theme.panel] : []),
        ...sitePanels.slice(0, insertAt),
        sitesPanel(ensureSiteSettings(), site.id),
        ...sitePanels.slice(insertAt),
      ];
      return cachedPanels;
    };

    runner.onBadgeChange((badge) => platform.setBadge(badge));
    runtime = { options, runner, theme, ensurePanels };
    return runtime;
  };

  // Register the Options, Quick Popup, and Popup State handlers synchronously
  // before awaiting storage so immediate toolbar interactions are never dropped.
  let bootSettled = false;

  const resolveBootSettings = async () => {
    const resolvedStore = await bootStoreReady;
    if (!bootSettled) {
      bootStore = resolvedStore;
    }
    const settings = ensureSiteSettings();
    await settings.ready;
    return settings;
  };

  const readPopupTabState = async () => {
    const settings = await resolveBootSettings();
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
    void resolveBootSettings()
      .then((settings) => {
        const { options, runner, ensurePanels } = ensureRuntime();
        return runner.prepare().then(() =>
          openOptionsDialog(options, ensurePanels(), {
            site: { id: site.id, displayName: site.displayName },
            siteEnabled: settings.isEnabled(site.id),
            onToggleSite: (enabled) => {
              void settings.setEnabled(site.id, enabled).catch((error: unknown) => {
                createLogger('sites').error('could not toggle site state', error);
              });
            },
            onSiteEnabledChange: (listener) =>
              settings.onChange(() => listener(settings.isEnabled(site.id))),
            ...(initialSection ? { initialSection } : {}),
          }),
        );
      })
      .catch((error: unknown) => {
        createLogger('options').error('could not open the options dialog', error);
      });
  };

  platform.onOpenOptions(openOptions);

  platform.onPopupStateRequest?.(async () => (await readPopupTabState()).state);

  platform.registerQuickPopup?.(async () => {
    const { settings, state } = await readPopupTabState();
    return {
      store: platform.store,
      activeTab: state,
      siteSettings: settings,
      onOpenSettings: openOptions,
    };
  });

  bootStore = await bootStoreReady;
  bootSettled = true;
  const resolvedSiteSettings = ensureSiteSettings();
  await resolvedSiteSettings.ready;
  if (!resolvedSiteSettings.isEnabled(site.id)) {
    // Discard unconsumed preloaded keys so re-enabling or opening Options later
    // reads fresh values instead of stale T=0 startup snapshots.
    preloadedStore?.clear();
    if (site.themeMapping) {
      writeEarlyThemeCss(site.id, '');
      clearEarlyThemeStyle();
    }
  }

  let active = false;
  let generation = 0;

  const deactivate = (): void => {
    if (!runtime) {
      return;
    }
    runtime.runner.stop();
    runtime.theme?.setActive(false);
  };

  const syncEnabled = async (): Promise<string[]> => {
    const want = resolvedSiteSettings.isEnabled(site.id);
    if (want === active) {
      return [];
    }
    const token = ++generation;
    active = want;
    if (!want) {
      deactivate();
      return [];
    }
    const current = ensureRuntime();
    current.theme?.setActive(true);
    const failed = await current.runner.start();
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
    return failed;
  };

  resolvedSiteSettings.onChange(() => {
    void syncEnabled();
  });

  return syncEnabled();
}
