import { defineConfig } from 'wxt';
import { PREACT_ALIAS } from './preact-alias';
import {
  ACTIVE_ICON_PATHS,
  DESCRIPTION,
  FIREFOX_TOOLBAR_ICON,
  NAME,
  OPTIONS_TITLE,
} from './project';

const MANIFEST_ICONS = {
  ...ACTIVE_ICON_PATHS,
  48: 'icon/icon-48.png',
  96: 'icon/icon-96.png',
  128: 'icon/icon-128.png',
} as const;

export default defineConfig({
  srcDir: 'src',
  // Every import is written out, so the linter and the type checker see
  // the same names as the bundler.
  imports: false,
  vite: () => ({ resolve: { alias: PREACT_ALIAS } }),
  manifest: ({ browser, manifestVersion }) => {
    const toolbarAction = {
      default_title: OPTIONS_TITLE,
      default_icon: browser === 'firefox' ? FIREFOX_TOOLBAR_ICON : ACTIVE_ICON_PATHS,
    };
    return {
      name: NAME,
      description: DESCRIPTION,
      permissions: ['storage'],
      icons: MANIFEST_ICONS,
      // Fallback toolbar title and icon; clicking opens `src/entrypoints/popup/index.html`.
      // Firefox MV2 reads `browser_action` and scales the small-cut SVG across arbitrary HiDPI factors.
      ...(manifestVersion === 2 ? { browser_action: toolbarAction } : { action: toolbarAction }),
      browser_specific_settings: {
        // Do not change this ID once the add-on is published: Firefox would
        // treat it as a different add-on and users would lose their settings.
        // Firefox stays on MV2 intentionally so content-script host matches apply
        // automatically on install (MV3 makes host permissions opt-in per site).
        gecko: {
          id: 'feed-sanity@burgtech.com',
          // Matches Firefox 140 ESR, which supports data_collection_permissions,
          // content_scripts[].world: "MAIN", popover="manual", @layer, and scrollbar-gutter.
          strict_min_version: '140.0',
          // The extension sends no data anywhere. Update this if that changes.
          data_collection_permissions: { required: ['none'] },
        },
        gecko_android: {
          strict_min_version: '142.0',
        },
      },
    };
  },
});
