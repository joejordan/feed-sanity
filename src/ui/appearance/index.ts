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
  readonly dispose: () => void;
}

/**
 * Initializes first-class theming for a site: loads the site's persisted
 * `ThemeConfig` from `SavedData`, applies it immediately (and whenever storage
 * changes across tabs), and returns the ready-to-mount `Appearance` panel.
 */
export function initSiteTheme(
  env: DomEnvironment,
  data: SavedData,
  mapping: SiteThemeMapping,
): SiteThemeRuntime {
  const saved = data.value(THEME_DATA_KEY, readThemeConfig);
  const controller = createThemeController(env, mapping, setUserThemeCss);

  const sync = (): void => {
    controller.apply(resolveTheme(saved.get()));
  };

  void saved.ready.then(sync);
  const stopWatch = saved.onChange(sync);

  return {
    controller,
    panel: appearancePanel(saved, controller),
    dispose() {
      stopWatch();
      controller.dispose();
    },
  };
}
