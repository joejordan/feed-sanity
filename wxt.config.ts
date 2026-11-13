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
      // Do not change this ID once the add-on is published: Firefox would
      // treat it as a different add-on and users would lose their settings.
      gecko: {
        id: 'feed-sanity@burgtech.com',
        // The extension sends no data anywhere. Update this if that changes.
        data_collection_permissions: { required: ['none'] },
      },
    },
  },
});
