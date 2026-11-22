import type { OptionsPanel } from '../ui/options-dialog/panel';
import type { Feature, PageFactory } from './feature';
import type { Platform } from './platform';
import { setSiteThemeCss } from '../ui/mount';
import { openOptionsDialog } from '../ui/options-dialog';
import { FeatureRunner } from './app';
import { createLogger } from './log';
import { Options } from './options';
import { SavedData } from './saved';

/** One site-contributed section rendered in Diagnostics and text bug reports. */
export interface DiagnosticSection {
  readonly title: string;
  readonly lines: readonly string[];
}

/**
 * Site-agnostic privacy scrubber applied to error messages and diagnostics
 * before copying a bug report: strips URLs, email addresses, and long numeric
 * identifiers. Individual `SiteAdapter`s layer site-specific scrubbers on top.
 */
export const scrubCommonPii = (message: string): string =>
  message
    .replaceAll(/\b(?:[a-z][a-z0-9+.-]*:)+\/\/\S+/gi, '<address>')
    .replaceAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '<email>')
    .replaceAll(/\d{6,}/g, '<number>');

/**
 * Contract every target site implements (`src/sites/facebook/`,
 * `src/sites/instagram/`, `src/sites/x/`, `src/sites/tiktok/`,
 * `src/sites/gmail/`). Keeps `src/core/`, `src/ui/`, and `src/platform/`
 * free of site-specific assumptions.
 */
export interface SiteAdapter<P = unknown> {
  readonly id: string;
  readonly displayName: string;
  /** Hostname matcher for runtime dispatch in multi-site builds and tests. */
  readonly matchesHost: (hostname: string) => boolean;
  /** CSS token overrides mapping the host's palette onto `--fs-*` shadow-DOM tokens. */
  readonly themeCss: string;
  /** Identifies the signed-in account on this host (or `'anonymous'`). */
  readonly accountId: () => string;
  /** Storage key prefix for this site and account. */
  readonly storagePrefix: (accountId: string) => string;
  /** Strips site-specific personal identifiers (handles, slugs, post IDs) from diagnostics. */
  readonly scrubPii: (message: string) => string;
  /** Creates the site's page factory bound to saved data and page-world installer. */
  readonly createPage: (data: SavedData, installPageWorld: () => Promise<void>) => PageFactory<P>;
  /** Features enabled on this site, in start order. */
  readonly features: readonly Feature<P>[];
  /** Custom panels added to the Options dialog (Filters, Data, Diagnostics, etc.). */
  readonly createPanels: (args: {
    options: Options;
    data: SavedData;
    page: PageFactory<P>;
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

  register<P>(site: SiteAdapter<P>): this {
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
 * Boots a single `SiteAdapter` against `platform`: applies the site's shadow
 * DOM theme, namespaces storage, starts features with fault isolation, syncs
 * the toolbar badge, and wires the Options dialog.
 */
export function startSite<P>(site: SiteAdapter<P>, platform: Platform): Promise<string[]> {
  setSiteThemeCss(site.themeCss);
  const account = site.accountId();
  const prefix = site.storagePrefix(account);
  const options = new Options(platform.store, `${prefix}/options`);
  const data = new SavedData(platform.store, prefix);
  const page = site.createPage(data, () => platform.installPageWorld());
  const runner = new FeatureRunner(site.features, options, page, data);
  const panels = site.createPanels({ options, data, page, runner, platform });

  // The browser may keep the badge of the page this tab showed before, so
  // the first one is sent even when it is empty.
  platform.setBadge(runner.badge());
  runner.onBadgeChange((badge) => platform.setBadge(badge));

  // Register feature options before the first await so the dialog can open as
  // soon as saved values are read rather than after the slowest feature starts.
  const started = runner.start();
  platform.onOpenOptions(() => {
    openOptionsDialog(options, panels).catch((error: unknown) => {
      createLogger('options').error('could not open the options dialog', error);
    });
  });
  return started;
}
