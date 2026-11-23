import type { DomEnvironment } from '../../core/dom-env';
import type { SavedData } from '../../core/saved';
import type { SiteThemeMapping, ThemeController } from '../../core/theming';
import type { OptionsPanel } from '../options-dialog/panel';
import { createThemeController, resolveTheme } from '../../core/theming';
import { setUserThemeCss } from '../mount';
import { appearancePanel, readThemeConfig, THEME_DATA_KEY } from './appearance-panel';

export interface SiteThemeRuntime {
  readonly controller: ThemeController;
  readonly panel: OptionsPanel;
  /** Enables or suspends live theme injection without losing saved configuration. */
  readonly setActive: (active: boolean) => void;
  readonly dispose: () => void;
}

/**
 * Initializes first-class theming for a site: loads the site's persisted
 * `ThemeConfig` from `SavedData`, applies it while `active` (and whenever
 * storage changes across tabs), and returns the ready-to-mount `Appearance` panel.
 */
export function initSiteTheme(
  env: DomEnvironment,
  data: SavedData,
  mapping: SiteThemeMapping,
  { active: initialActive = true }: { readonly active?: boolean } = {},
): SiteThemeRuntime {
  const saved = data.value(THEME_DATA_KEY, readThemeConfig);
  const controller = createThemeController(env, mapping, setUserThemeCss);
  let active = initialActive;

  const sync = (): void => {
    controller.apply(active ? resolveTheme(saved.get()) : null);
  };

  void saved.ready.then(() => {
    if (active) {
      sync();
    }
  });
  const stopWatch = saved.onChange(sync);

  return {
    controller,
    // `saved.set` already triggers `onChange(sync)` above (which respects `active`).
    panel: appearancePanel(saved, controller, () => undefined),
    setActive(next) {
      if (active === next) {
        return;
      }
      active = next;
      if (!next) {
        controller.clearPreview();
      }
      sync();
    },
    dispose() {
      stopWatch();
      controller.dispose();
    },
  };
}
