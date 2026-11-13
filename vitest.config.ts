import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest(), react()],
  test: {
    environment: 'happy-dom',
    environmentOptions: {
      happyDOM: {
        // Code that reads the page address expects to be on Facebook.
        url: 'https://www.facebook.com/',
        // Tests add <link rel="stylesheet"> elements. happy-dom never fetches
        // them, and without this it logs an error for each one.
        settings: { handleDisabledFileLoadingAsSuccess: true },
      },
    },
    include: ['src/**/*.test.{ts,tsx}'],
    // Tests silence console.error with a spy. Undo it before the next test.
    restoreMocks: true,
  },
});
