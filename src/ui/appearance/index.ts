import type { DomEnvironment } from '../../core/dom-env';
import type { Logger } from '../../core/log';
import type { SavedData, SavedValue } from '../../core/saved';
import type {
  SiteThemeMapping,
  ThemeController,
  ThemeDocumentV1,
  ThemeLibraryClient,
  ThemeUrlFetcher,
} from '../../core/theming';
import type { OptionsPanel } from '../options-dialog/panel';
import { createLogger } from '../../core/log';
import {
  createThemeController,
  readGlobalThemeRevision,
  resolveTheme,
  THEME_GLOBAL_REV_KEY,
  writeEarlyThemeCss,
} from '../../core/theming';
import { setUserThemeCss } from '../mount';
import { appearancePanel, readThemeDocument, THEME_DATA_KEY } from './appearance-panel';

export { readThemeDocument, THEME_DATA_KEY } from './appearance-panel';

const log = createLogger('theme');

/**
 * Connects a site's saved `ThemeDocumentV1` to the cross-site `ThemeLibraryClient`
 * so "Apply to all sites" broadcasts adopt once per revision on both live tabs
 * and the standalone Settings window.
 */
export function connectGlobalThemeSync({
  data,
  saved,
  library,
  onAdopted,
  logger = log,
}: {
  readonly data: SavedData;
  readonly saved: SavedValue<ThemeDocumentV1>;
  readonly library: ThemeLibraryClient;
  readonly onAdopted: () => void;
  readonly logger?: Logger;
}): { readonly ready: Promise<void>; readonly dispose: () => void } {
  const globalRev = data.value(THEME_GLOBAL_REV_KEY, readGlobalThemeRevision);
  let disposed = false;
  let lastAdoptedRev = 0;
  let stopLibrary: (() => void) | undefined;

  const reconcile = async (): Promise<void> => {
    if (disposed) {
      return;
    }
    const global = library.getGlobalTheme();
    const targetRev = global?.revision ?? 0;
    const seenRev = Math.max(globalRev.get(), lastAdoptedRev);
    if (!global || targetRev <= seenRev) {
      return;
    }
    lastAdoptedRev = targetRev;
    try {
      const sameDoc = JSON.stringify(saved.get()) === JSON.stringify(global.document);
      if (!sameDoc) {
        await saved.set(global.document);
        if (!disposed) {
          onAdopted();
        }
      }
      if (!disposed && lastAdoptedRev === targetRev) {
        await globalRev.set(targetRev);
      }
    } catch (error: unknown) {
      if (lastAdoptedRev === targetRev) {
        lastAdoptedRev = globalRev.get();
      }
      logger.error('could not adopt global theme', error);
    }
  };

  const ready = Promise.all([saved.ready, globalRev.ready, library.ready]).then(async () => {
    if (disposed) {
      return;
    }
    stopLibrary = library.onChange(() => {
      void reconcile();
    });
    await reconcile();
  });

  return {
    ready,
    dispose() {
      disposed = true;
      stopLibrary?.();
      stopLibrary = undefined;
    },
  };
}

export interface SiteThemeRuntime {
  readonly controller: ThemeController;
  readonly panel: OptionsPanel;
  /** Enables or suspends live theme injection without losing saved configuration. */
  readonly setActive: (active: boolean) => void;
  readonly dispose: () => void;
}

export interface SiteThemeOptions {
  readonly active?: boolean;
  /** When set, keeps the per-origin `sessionStorage` early-theme CSS cache synced for zero-FOUC boot. */
  readonly earlyCacheKey?: string;
  /** Shared cross-site "My Themes" library & "Apply to all sites" broadcast client. */
  readonly library?: ThemeLibraryClient;
  /** Optional HTTPS fetcher routed through the extension background context for Import-by-URL. */
  readonly fetchThemeUrl?: ThemeUrlFetcher;
}

/**
 * Initializes first-class theming for a site: loads the site's persisted
 * `ThemeDocumentV1` from `SavedData`, reconciles any newer cross-site
 * `globalTheme` broadcast from `library`, applies it while `active` (and
 * whenever storage changes across tabs), and returns the ready-to-mount
 * `Appearance` panel.
 */
export function initSiteTheme(
  env: DomEnvironment,
  data: SavedData,
  mapping: SiteThemeMapping,
  { active: initialActive = true, earlyCacheKey, library, fetchThemeUrl }: SiteThemeOptions = {},
): SiteThemeRuntime {
  const saved = data.value(THEME_DATA_KEY, readThemeDocument);
  const controller = createThemeController(env, mapping, setUserThemeCss);
  let active = initialActive;
  let loaded = false;
  let disposed = false;

  const syncCache = (effective: ReturnType<typeof resolveTheme>): void => {
    if (!earlyCacheKey) {
      return;
    }
    writeEarlyThemeCss(earlyCacheKey, effective ? (controller.compiledHostCss?.() ?? '') : '');
  };

  const sync = (clearPreview = false): void => {
    const effective = active ? resolveTheme(saved.get()) : null;
    controller.apply(effective, clearPreview ? { clearPreview: true } : undefined);
    if (loaded || !active) {
      syncCache(effective);
    }
  };

  const stopWatch = saved.onChange((_next, source) => {
    loaded = true;
    // External updates (e.g. QuickPopup toolbar toggle or another tab) clear any
    // lingering in-page preview atomically in one render.
    sync(source === 'external');
  });
  void saved.ready.then(() => {
    if (!loaded && !disposed) {
      loaded = true;
      if (active) {
        sync();
      }
    }
  });

  const globalSync = library
    ? connectGlobalThemeSync({
        data,
        saved,
        library,
        onAdopted: () => sync(true),
      })
    : undefined;

  let cachedPanel: OptionsPanel | undefined;

  return {
    controller,
    // Construct the Appearance panel lazily on first Settings open to keep page boot light.
    get panel(): OptionsPanel {
      // `saved.set` already triggers `onChange(sync)` above (which respects `active`).
      cachedPanel ??= appearancePanel(
        saved,
        controller,
        () => undefined,
        library,
        globalSync?.ready,
        fetchThemeUrl,
      );
      return cachedPanel;
    },
    setActive(next) {
      if (active === next) {
        return;
      }
      active = next;
      if (!next) {
        sync(true);
        return;
      }
      // Preserve any synchronously injected early-theme `<style>` while initial
      // storage is still loading; `saved.onChange` / `saved.ready` will reconcile.
      if (loaded) {
        sync();
      }
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      stopWatch();
      globalSync?.dispose();
      controller.dispose();
    },
  };
}
