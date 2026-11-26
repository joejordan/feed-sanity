import { defineConfig } from 'wxt';
import { PREACT_ALIAS } from './preact-alias';
import {
  ACTIVE_ICON_PATHS,
  DESCRIPTION,
  FIREFOX_THEME_ICONS,
  FIREFOX_TOOLBAR_ICON,
  NAME,
  OPTIONS_TITLE,
} from './project';
import { MATCHES as FACEBOOK_MATCHES } from './src/facebook/urls';
import { GMAIL_MATCHES } from './src/sites/gmail/urls';
import { INSTAGRAM_MATCHES } from './src/sites/instagram/urls';
import { REDDIT_MATCHES } from './src/sites/reddit/urls';
import { X_MATCHES } from './src/sites/x/urls';

const MANIFEST_ICONS = {
  ...ACTIVE_ICON_PATHS,
  48: 'icon/icon-48.png',
  96: 'icon/icon-96.png',
  128: 'icon/icon-128.png',
} as const;

const FIREFOX_ONLY_ASSETS = new Set<string>(
  FIREFOX_THEME_ICONS.flatMap((entry) => [entry.light, entry.dark]),
);

// Scoped strictly to the 5 supported sites so Feed Sanity can automatically attach
// to and live-upgrade already-open tabs on install, update, or reload (plus register
// Safari's dynamic MAIN-world scripts) without requiring users to refresh open tabs.
const SITE_HOST_PERMISSIONS = [
  ...FACEBOOK_MATCHES,
  ...X_MATCHES,
  ...INSTAGRAM_MATCHES,
  ...REDDIT_MATCHES,
  ...GMAIL_MATCHES,
];

export default defineConfig({
  srcDir: 'src',
  // Every import is written out, so the linter and the type checker see
  // the same names as the bundler.
  imports: false,
  vite: () => ({ resolve: { alias: PREACT_ALIAS } }),
  manifest: ({ browser, manifestVersion }) => {
    const firefox = browser === 'firefox';
    const safari = browser === 'safari';
    const toolbarAction = {
      default_title: OPTIONS_TITLE,
      default_icon: firefox ? FIREFOX_TOOLBAR_ICON : ACTIVE_ICON_PATHS,
      ...(firefox ? { theme_icons: FIREFOX_THEME_ICONS.map((entry) => ({ ...entry })) } : {}),
    };
    return {
      name: NAME,
      description: DESCRIPTION,
      permissions:
        manifestVersion === 2
          ? ['storage', 'scripting', ...SITE_HOST_PERMISSIONS]
          : ['storage', 'scripting'],
      ...(manifestVersion === 3 && { host_permissions: SITE_HOST_PERMISSIONS }),
      icons: MANIFEST_ICONS,
      // Fallback toolbar title and icon; clicking opens `src/entrypoints/popup/index.html`.
      // Firefox MV2 reads `browser_action` and scales the small-cut SVG across arbitrary HiDPI factors.
      ...(manifestVersion === 2 ? { browser_action: toolbarAction } : { action: toolbarAction }),
      ...(firefox && {
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
      }),
      ...(safari && {
        browser_specific_settings: {
          // `URL.canParse`, Popover API, and `scripting.registerContentScripts({ world: 'MAIN' })`.
          safari: {
            strict_min_version: '17.0',
          },
        },
      }),
    };
  },
  hooks: {
    'build:publicAssets'(wxt, files) {
      if (wxt.config.browser === 'firefox') {
        return;
      }
      for (let i = files.length - 1; i >= 0; i--) {
        const dest = files[i]?.relativeDest.replaceAll('\\', '/');
        if (dest && FIREFOX_ONLY_ASSETS.has(dest)) {
          files.splice(i, 1);
        }
      }
    },
    'build:manifestGenerated': (wxt, manifest) => {
      if (wxt.config.browser !== 'safari' || !manifest.content_scripts) {
        return;
      }
      // Safari does not support `exclude_globs` in manifest `content_scripts`;
      // Facebook's content and page-world scripts check `isExcludedByGlob` instead.
      manifest.content_scripts = manifest.content_scripts.map(
        ({ exclude_globs: _, ...script }) => script,
      );
    },
  },
});
