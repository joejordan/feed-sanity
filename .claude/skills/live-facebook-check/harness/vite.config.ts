// Builds the live-check bundle. Run from the repository root:
//
//   pnpm exec vite build .claude/skills/live-facebook-check/harness \
//     -c .claude/skills/live-facebook-check/harness/vite.config.ts
//
// The bundle is written to .output/live/live.js, which git ignores.
import { defineConfig } from 'vite';
// Vite's native config loader needs the file extension.
import { PREACT_ALIAS } from '../../../../preact-alias.ts';

export default defineConfig({
  resolve: { alias: PREACT_ALIAS },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: '../../../../.output/live',
    emptyOutDir: true,
    minify: true,
    lib: { entry: 'live.ts', formats: ['iife'], name: 'fslive', fileName: () => 'live.js' },
  },
});
