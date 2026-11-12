import { defineConfig } from 'wxt';

// The display name is a placeholder until the project has its own name.
// It must not ship to a store as "Social Fixer".
const NAME = 'Social Fixer fork (unnamed)';

export default defineConfig({
  srcDir: 'src',
  // Every import is written out, so the linter and the type checker see
  // the same names as the bundler.
  imports: false,
  manifest: {
    name: NAME,
    description: 'Filter and tidy the Facebook news feed.',
    permissions: ['storage'],
    browser_specific_settings: {
      // Temporary ID. Choose the real one before the first store upload:
      // changing it afterwards cuts users off from their saved settings.
      gecko: {
        id: 'social-fixer-fork@dev.invalid',
        // The extension sends no data anywhere. Update this if that changes.
        data_collection_permissions: { required: ['none'] },
      },
    },
  },
});
