import type { OptionSpecs } from '../../core/options';
import type { SavedValue } from '../../core/saved';
import type { SiteSettingsClient } from '../../core/site-settings';
import type { Store } from '../../core/storage';
import type {
  ResolvedTheme,
  ThemeController,
  ThemeLibraryClient,
  ThemeUrlFetcher,
} from '../../core/theming';
import type { PostReadData } from '../../facebook/post-read';
import type { SiteId } from '../../sites/manifest';
import type { SavedVideoSpeed } from '../../sites/x/features/video-speed-model';
import type { OptionsPanel } from './panel';
import { readLocatorOverrides } from '../../core/locator';
import { createLogger } from '../../core/log';
import { Options } from '../../core/options';
import { SavedData } from '../../core/saved';
import { compileUiThemeCss, resolveTheme } from '../../core/theming';
import { siteDataPanel } from '../../data/data-panel';
import { LOCATOR_OVERRIDES as FB_LOCATOR_OVERRIDES } from '../../facebook/feature';
import { savedPostData } from '../../facebook/post-read';
import {
  features as facebookFeatures,
  optionsPanels as facebookOptionsPanels,
} from '../../features';
import { GMAIL_LOCATOR_OVERRIDES } from '../../sites/gmail/feature';
import { GMAIL_FILTER_SCHEMA } from '../../sites/gmail/filter-schema';
import { gmailFeatures } from '../../sites/gmail/index';
import { IG_LOCATOR_OVERRIDES } from '../../sites/instagram/feature';
import { INSTAGRAM_FILTER_SCHEMA } from '../../sites/instagram/filter-schema';
import { instagramFeatures } from '../../sites/instagram/index';
import { SITE_MANIFEST } from '../../sites/manifest';
import { REDDIT_LOCATOR_OVERRIDES } from '../../sites/reddit/feature';
import { REDDIT_FILTER_SCHEMA } from '../../sites/reddit/filter-schema';
import { redditFeatures } from '../../sites/reddit/index';
import { X_LOCATOR_OVERRIDES } from '../../sites/x/feature';
import { readSavedVideoSpeed, X_VIDEO_SPEED_KEY } from '../../sites/x/features/video-speed-model';
import { X_FILTER_SCHEMA } from '../../sites/x/filter-schema';
import { xFeatures } from '../../sites/x/index';
import { connectGlobalThemeSync } from '../appearance';
import { appearancePanel, readThemeDocument, THEME_DATA_KEY } from '../appearance/appearance-panel';
import { createFiltersPanel } from '../filters/filters-panel';
import { sitesPanel } from '../sites-panel';

const log = createLogger('standalone-options');

const DISPLAY_NAME_BY_ID: ReadonlyMap<string, string> = new Map(
  SITE_MANIFEST.map((site) => [site.id, site.displayName]),
);

interface FeatureWithOptions {
  readonly options?: OptionSpecs;
}

interface StandaloneSiteSpec {
  readonly features: readonly FeatureWithOptions[];
  readonly locatorKey: string;
  readonly createFilterPanels: (data: SavedData) => OptionsPanel[];
  readonly extraDataStores?: (data: SavedData) => {
    readonly read_history?: SavedValue<PostReadData>;
    readonly videoSpeed?: SavedValue<SavedVideoSpeed>;
  };
}

const STANDALONE_SITES: Readonly<Record<SiteId, StandaloneSiteSpec>> = {
  facebook: {
    features: facebookFeatures,
    locatorKey: FB_LOCATOR_OVERRIDES,
    createFilterPanels: (data) => facebookOptionsPanels(data),
    extraDataStores: (data) => ({ read_history: savedPostData(data) }),
  },
  x: {
    features: xFeatures,
    locatorKey: X_LOCATOR_OVERRIDES,
    createFilterPanels: (data) => [createFiltersPanel(data, X_FILTER_SCHEMA)],
    extraDataStores: (data) => ({
      videoSpeed: data.value(X_VIDEO_SPEED_KEY, readSavedVideoSpeed),
    }),
  },
  instagram: {
    features: instagramFeatures,
    locatorKey: IG_LOCATOR_OVERRIDES,
    createFilterPanels: (data) => [createFiltersPanel(data, INSTAGRAM_FILTER_SCHEMA)],
  },
  reddit: {
    features: redditFeatures,
    locatorKey: REDDIT_LOCATOR_OVERRIDES,
    createFilterPanels: (data) => [createFiltersPanel(data, REDDIT_FILTER_SCHEMA)],
  },
  gmail: {
    features: gmailFeatures,
    locatorKey: GMAIL_LOCATOR_OVERRIDES,
    createFilterPanels: (data) => [
      createFiltersPanel(data, GMAIL_FILTER_SCHEMA, { section: 'Inbox Filtering' }),
    ],
  },
};

export function isKnownSiteId(id: string | null | undefined): id is SiteId {
  return typeof id === 'string' && Object.hasOwn(STANDALONE_SITES, id);
}

/** Default site shown when opening standalone Settings with no explicit `?site=` parameter. */
export const DEFAULT_STANDALONE_SITE_ID: SiteId = SITE_MANIFEST[0]?.id ?? 'facebook';

/**
 * Lightweight `ThemeController` for standalone Settings mode (no live host DOM):
 * updates the standalone Settings window's own UI theme live on apply/preview
 * while omitting host-only `audit` / `healNow` capabilities.
 */
function createStandaloneThemeController(onUiThemeCss: (css: string) => void): ThemeController {
  let applied: ResolvedTheme | null = null;
  let previewing: ResolvedTheme | null | undefined;
  let disposed = false;

  const current = (): ResolvedTheme | null => (previewing === undefined ? applied : previewing);

  const paint = (): void => {
    if (disposed) {
      return;
    }
    const effective = current();
    onUiThemeCss(effective ? compileUiThemeCss(effective) : '');
  };

  return {
    current,
    apply(theme, opts) {
      applied = theme;
      if (opts?.clearPreview) {
        previewing = undefined;
      }
      paint();
    },
    preview(theme) {
      previewing = theme;
      paint();
    },
    clearPreview() {
      if (previewing !== undefined) {
        previewing = undefined;
        paint();
      }
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      applied = null;
      previewing = undefined;
    },
  };
}

export interface StandaloneSiteSession {
  readonly siteId: SiteId;
  readonly displayName: string;
  readonly options: Options;
  readonly panels: readonly OptionsPanel[];
  readonly ready: Promise<void>;
  readonly dispose: () => void;
}

export interface CreateStandaloneSiteSessionArgs {
  readonly siteId: SiteId;
  readonly storagePrefix: string;
  readonly store: Store;
  readonly siteSettings: SiteSettingsClient;
  readonly themeLibrary: ThemeLibraryClient;
  readonly fetchThemeUrl?: ThemeUrlFetcher;
  readonly onUiThemeCss?: (css: string) => void;
}

/**
 * Builds a complete, storage-backed `OptionsDialog` session for `siteId` without
 * touching any host page DOM or starting site features. Changes written here
 * persist to the site's real storage prefix and sync live to open tabs.
 */
export function createStandaloneSiteSession({
  siteId,
  storagePrefix,
  store,
  siteSettings,
  themeLibrary,
  fetchThemeUrl,
  onUiThemeCss = () => undefined,
}: CreateStandaloneSiteSessionArgs): StandaloneSiteSession {
  const spec = STANDALONE_SITES[siteId];
  const displayName = DISPLAY_NAME_BY_ID.get(siteId) ?? siteId;
  const options = new Options(store, `${storagePrefix}/options`);
  for (const feature of spec.features) {
    if (feature.options) {
      options.register(feature.options);
    }
  }
  const data = new SavedData(store, storagePrefix);

  let disposed = false;
  const cleanups: Array<() => void> = [];

  const savedTheme = data.value(THEME_DATA_KEY, readThemeDocument);
  const controller = createStandaloneThemeController(onUiThemeCss);
  const syncTheme = (clearPreview = false): void => {
    controller.apply(
      resolveTheme(savedTheme.get()),
      clearPreview ? { clearPreview: true } : undefined,
    );
  };

  cleanups.push(
    savedTheme.onChange((_next, source) => {
      if (source !== 'init') {
        syncTheme(source === 'external');
      }
    }),
  );

  const globalSync = connectGlobalThemeSync({
    data,
    saved: savedTheme,
    library: themeLibrary,
    onAdopted: () => controller.clearPreview(),
    logger: log,
  });
  const initialThemeReady = globalSync.ready.then(() => {
    if (!disposed) {
      syncTheme();
    }
  });
  cleanups.push(() => {
    globalSync.dispose();
    controller.dispose();
  });

  const extra = spec.extraDataStores?.(data);
  const panels: OptionsPanel[] = [
    appearancePanel(
      savedTheme,
      controller,
      () => undefined,
      themeLibrary,
      initialThemeReady,
      fetchThemeUrl,
    ),
    ...spec.createFilterPanels(data),
    siteDataPanel({
      siteId,
      siteName: displayName,
      options,
      data,
      locators: data.value(spec.locatorKey, readLocatorOverrides),
      siteSettings,
      themeLibrary,
      ...(extra?.read_history ? { read_history: extra.read_history } : {}),
      ...(extra?.videoSpeed ? { videoSpeed: extra.videoSpeed } : {}),
    }),
    sitesPanel(siteSettings, siteId),
  ];

  const ready = Promise.all([options.load(), ...panels.map((panel) => panel.ready)]).then(
    () => undefined,
  );

  return {
    siteId,
    displayName,
    options,
    panels,
    ready,
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const cleanup of cleanups.splice(0)) {
        cleanup();
      }
      options.dispose();
      data.dispose();
    },
  };
}
