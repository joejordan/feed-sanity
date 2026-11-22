import { defineConfig } from 'wxt';
import { PREACT_ALIAS } from './preact-alias';
import { DESCRIPTION, NAME, OPTIONS_TITLE } from './project';
import { OPTIONAL_SITE_MATCHES } from './src/sites/manifest';

export default defineConfig({
  srcDir: 'src',
  // Every import is written out, so the linter and the type checker see
  // the same names as the bundler.
  imports: false,
  vite: () => ({ resolve: { alias: PREACT_ALIAS } }),
  manifest: ({ manifestVersion }) => ({
    name: NAME,
    description: DESCRIPTION,
    // `activeTab` populates `tab.url` on toolbar click with zero install warning;
    // `scripting` is supported in Chrome MV3 and Firefox 102+ (MAIN world since 128).
    permissions: ['storage', 'scripting', 'activeTab'],
    ...(manifestVersion === 3
      ? { optional_host_permissions: OPTIONAL_SITE_MATCHES }
      : { optional_permissions: OPTIONAL_SITE_MATCHES }),
    // The toolbar button opens the options dialog in the current tab, or
    // prompts to enable an optional site on first click there.
    action: { default_title: OPTIONS_TITLE },
    browser_specific_settings: {
      // Do not change this ID once the add-on is published: Firefox would
      // treat it as a different add-on and users would lose their settings.
      gecko: {
        id: 'feed-sanity@burgtech.com',
        // The extension sends no data anywhere. Update this if that changes.
        data_collection_permissions: { required: ['none'] },
      },
    },
  }),
});
