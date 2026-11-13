// Builds the userscript for Greasemonkey, Tampermonkey and Violentmonkey:
//
//   pnpm build:userscript   ->   .output/userscript/<package name>.user.js
//
// The extension builds go through WXT instead (wxt.config.ts).

import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };
// Vite's native config loader needs the file extensions.
import { DESCRIPTION, NAME } from './project.ts';
import { EXCLUDE_GLOBS, EXCLUDE_MATCHES, MATCHES } from './src/facebook/urls.ts';
import { GRANTS } from './src/platform/userscript-store.ts';

const line = (key: string, value = '') => `// @${key.padEnd(12)} ${value}`.trimEnd();

const header = [
  '// ==UserScript==',
  line('name', NAME),
  line('namespace', pkg.name),
  line('version', pkg.version),
  line('description', DESCRIPTION),
  ...MATCHES.map((pattern) => line('match', pattern)),
  ...[...EXCLUDE_MATCHES, ...EXCLUDE_GLOBS].map((pattern) => line('exclude', pattern)),
  line('run-at', 'document-start'),
  // Violentmonkey: run outside the page's own script context, as the
  // extension does, so Facebook's content security policy does not apply.
  line('inject-into', 'content'),
  line('noframes'),
  ...GRANTS.map((grant) => line('grant', grant)),
  '// ==/UserScript==',
].join('\n');

export default defineConfig({
  build: {
    outDir: '.output/userscript',
    // Userscript sites such as Greasy Fork do not accept minified code.
    minify: false,
    lib: {
      entry: 'src/userscript.ts',
      formats: ['iife'],
      name: 'userscript',
      fileName: () => `${pkg.name}.user.js`,
    },
    rolldownOptions: {
      output: { banner: `${header}\n` },
    },
  },
});
