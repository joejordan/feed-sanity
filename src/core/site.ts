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
  /** Legacy alias for `envOptions` when only theme propagation options were declared. */
  readonly themeEnvOptions?: { readonly pierceShadow?: boolean; readonly includeIframes?: boolean };
  /** Identifies the signed-in account on this host (or `'anonymous'`). */
  readonly accountId: () => string;
  /** Storage key prefix for this site and account. */
  readonly storagePrefix: (accountId: string) => string;
  /** Strips site-specific personal identifiers (handles, slugs, post IDs) from diagnostics. */
  readonly scrubPii: (message: string) => string;
  /** Creates the site's page factory bound to saved data, page-world installer, and shared `DomEnvironment`. */
  readonly createPage: (
    data: SavedData,
    installPageWorld: () => Promise<void>,
    env?: DomEnvironment,
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
  const bootPrefix = site.storagePrefix(site.accountId());
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
    readonly panels: OptionsPanel[];
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
    const prefix = bootPrefix;
    const options = new Options(bootStore, `${prefix}/options`);
    const data = new SavedData(bootStore, prefix);
    const env = createDomEnvironment({
      log: createLogger(`${site.id}-dom`),
      ...site.themeEnvOptions,
      ...site.envOptions,
    });
    const theme = site.themeMapping
      ? initSiteTheme(env, data, site.themeMapping, {
          active: false,
          earlyCacheSiteId: site.id,
        })
      : undefined;
    const page = site.createPage(data, () => platform.installPageWorld(), env);
    const runner = new FeatureRunner(site.features, options, page, data);
    const sitePanels = site.createPanels({ options, data, page, runner, platform });
    const diagIndex = sitePanels.findIndex((panel) => panel.section === 'Diagnostics');
    const insertAt = diagIndex === -1 ? sitePanels.length : diagIndex;
    const panels = [
      ...(theme ? [theme.panel] : []),
      ...sitePanels.slice(0, insertAt),
      sitesPanel(ensureSiteSettings()),
      ...sitePanels.slice(insertAt),
    ];

    runner.onBadgeChange((badge) => platform.setBadge(badge));
    runtime = { options, runner, theme, panels };
    return runtime;
  };

  // Register the Options trigger synchronously before awaiting storage so an
  // immediate toolbar click right after navigation is never dropped.
  let bootSettled = false;
  platform.onOpenOptions(() => {
    void bootStoreReady
      .then((resolvedStore) => {
        if (!bootSettled) {
          bootStore = resolvedStore;
        }
        const { options, runner, panels } = ensureRuntime();
        return runner.prepare().then(() => openOptionsDialog(options, panels));
      })
      .catch((error: unknown) => {
        createLogger('options').error('could not open the options dialog', error);
      });
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
