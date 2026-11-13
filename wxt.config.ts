import { defineConfig } from 'wxt';
import { DESCRIPTION, NAME } from './project';

export default defineConfig({
  srcDir: 'src',
  // Every import is written out, so the linter and the type checker see
  // the same names as the bundler.
  imports: false,
  manifest: {
    name: NAME,
    description: DESCRIPTION,
    permissions: ['storage'],
    browser_specific_settings: {
      // Temporary ID. Choose the real one before the first store upload:
      // changing it afterwards cuts users off from their saved settings.
      gecko: {
        id: 'feed-sanity@dev.invalid',
        // The extension sends no data anywhere. Update this if that changes.
        data_collection_permissions: { required: ['none'] },
      },
    },
  },
});
