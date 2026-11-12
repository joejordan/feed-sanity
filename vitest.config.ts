import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'happy-dom',
    environmentOptions: {
      // Tests add <link rel="stylesheet"> elements. happy-dom never fetches
      // them, and without this it logs an error for each one.
      happyDOM: { settings: { handleDisabledFileLoadingAsSuccess: true } },
    },
    include: ['src/**/*.test.ts'],
    // Tests silence console.error with a spy. Undo it before the next test.
    restoreMocks: true,
  },
});
