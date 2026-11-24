import type { DomEnvironment } from '../../core/dom-env';
import type { SavedData } from '../../core/saved';
import type { SiteThemeMapping, ThemeController, ThemeLibraryClient } from '../../core/theming';
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
  readonly earlyCacheSiteId?: string;
  /** Shared cross-site "My Themes" library & "Apply to all sites" broadcast client. */
  readonly library?: ThemeLibraryClient;
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
  { active: initialActive = true, earlyCacheSiteId, library }: SiteThemeOptions = {},
): SiteThemeRuntime {
  const saved = data.value(THEME_DATA_KEY, readThemeDocument);
  const globalRev = library ? data.value(THEME_GLOBAL_REV_KEY, readGlobalThemeRevision) : undefined;
  const controller = createThemeController(env, mapping, setUserThemeCss);
  let active = initialActive;
  let loaded = false;
  let disposed = false;
  let lastAdoptedRev = 0;
  let stopLibrary: (() => void) | undefined;

  const syncCache = (effective: ReturnType<typeof resolveTheme>): void => {
    if (!earlyCacheSiteId) {
      return;
    }
    writeEarlyThemeCss(earlyCacheSiteId, effective ? (controller.compiledHostCss?.() ?? '') : '');
  };

  const sync = (clearPreview = false): void => {
    const effective = active ? resolveTheme(saved.get()) : null;
    controller.apply(effective, clearPreview ? { clearPreview: true } : undefined);
    if (loaded || !active) {
      syncCache(effective);
    }
  };

  const reconcileGlobalTheme = async (): Promise<void> => {
    if (disposed || !library || !globalRev) {
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
          sync(true);
        }
      }
      if (!disposed && lastAdoptedRev === targetRev) {
        await globalRev.set(targetRev);
      }
    } catch (error: unknown) {
      if (lastAdoptedRev === targetRev) {
        lastAdoptedRev = globalRev.get();
      }
      log.error('could not adopt global theme', error);
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

  const initialSyncReady =
    library && globalRev
      ? Promise.all([saved.ready, globalRev.ready, library.ready]).then(async () => {
          if (disposed) {
            return;
          }
          stopLibrary = library.onChange(() => {
            void reconcileGlobalTheme();
          });
          await reconcileGlobalTheme();
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
        initialSyncReady,
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
      stopLibrary?.();
      controller.dispose();
    },
  };
}
