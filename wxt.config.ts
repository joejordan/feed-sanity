import { defineConfig } from 'wxt';
import { PREACT_ALIAS } from './preact-alias';
import { DESCRIPTION, NAME, OPTIONS_TITLE } from './project';

export default defineConfig({
  srcDir: 'src',
  // Every import is written out, so the linter and the type checker see
  // the same names as the bundler.
  imports: false,
  vite: () => ({ resolve: { alias: PREACT_ALIAS } }),
  manifest: {
    name: NAME,
    description: DESCRIPTION,
    permissions: ['storage'],
    // Fallback toolbar title; the toolbar button opens `src/entrypoints/popup/index.html`.
    action: { default_title: OPTIONS_TITLE },
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
  },
});
