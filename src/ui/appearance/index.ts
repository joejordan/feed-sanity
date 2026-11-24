import type { DomEnvironment } from '../../core/dom-env';
import type { SavedData } from '../../core/saved';
import type { SiteThemeMapping, ThemeController } from '../../core/theming';
import type { OptionsPanel } from '../options-dialog/panel';
import { createThemeController, resolveTheme, writeEarlyThemeCss } from '../../core/theming';
import { setUserThemeCss } from '../mount';
import { appearancePanel, readThemeDocument, THEME_DATA_KEY } from './appearance-panel';

export { readThemeDocument, THEME_DATA_KEY } from './appearance-panel';

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
}

/**
 * Initializes first-class theming for a site: loads the site's persisted
 * `ThemeDocumentV1` from `SavedData`, applies it while `active` (and whenever
 * storage changes across tabs), and returns the ready-to-mount `Appearance` panel.
 */
export function initSiteTheme(
  env: DomEnvironment,
  data: SavedData,
  mapping: SiteThemeMapping,
  { active: initialActive = true, earlyCacheSiteId }: SiteThemeOptions = {},
): SiteThemeRuntime {
  const saved = data.value(THEME_DATA_KEY, readThemeDocument);
  const controller = createThemeController(env, mapping, setUserThemeCss);
  let active = initialActive;
  let loaded = false;

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

  const stopWatch = saved.onChange((_next, source) => {
    loaded = true;
    // External updates (e.g. QuickPopup toolbar toggle or another tab) clear any
    // lingering in-page preview atomically in one render.
    sync(source === 'external');
  });
  void saved.ready.then(() => {
    if (!loaded) {
      loaded = true;
      if (active) {
        sync();
      }
    }
  });

  let cachedPanel: OptionsPanel | undefined;

  return {
    controller,
    // Construct the Appearance panel lazily on first Settings open to keep page boot light.
    get panel(): OptionsPanel {
      // `saved.set` already triggers `onChange(sync)` above (which respects `active`).
      cachedPanel ??= appearancePanel(saved, controller, () => undefined);
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
      stopWatch();
      controller.dispose();
    },
  };
}
