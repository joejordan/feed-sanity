// Builds the userscript for Greasemonkey, Tampermonkey and Violentmonkey:
//
//   pnpm build:userscript   ->   .output/userscript/<package name>.user.js
//
// The extension builds go through WXT instead (wxt.config.ts).

import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };
// Vite's native config loader needs the file extensions.
import { pageWorldScript } from './page-world-plugin.ts';
import { PREACT_ALIAS } from './preact-alias.ts';
import { DESCRIPTION, NAME } from './project.ts';
import { GRANTS } from './src/platform/userscript-gm.ts';
import { ALL_USERSCRIPT_EXCLUDES, ALL_USERSCRIPT_MATCHES } from './src/sites/manifest.ts';

const line = (key: string, value = '') => `// @${key.padEnd(12)} ${value}`.trimEnd();

const REPO_URL = 'https://github.com/joejordan/feed-sanity';
const RELEASE_SCRIPT_URL = `${REPO_URL}/releases/latest/download/${pkg.name}.user.js`;
// Inline the 48px PNG icon as a data URI so userscript managers render it offline with zero network calls.
const ICON_DATA_URI = `data:image/png;base64,${readFileSync(new URL('./public/icon/icon-48.png', import.meta.url)).toString('base64')}`;

const header = [
  '// ==UserScript==',
  line('name', NAME),
  line('namespace', pkg.name),
  line('version', pkg.version),
  line('description', DESCRIPTION),
  line('icon', ICON_DATA_URI),
  line('license', pkg.license),
  line('homepageURL', REPO_URL),
  line('supportURL', `${REPO_URL}/issues`),
  line('downloadURL', RELEASE_SCRIPT_URL),
  line('updateURL', RELEASE_SCRIPT_URL),
  ...ALL_USERSCRIPT_MATCHES.map((pattern) => line('match', pattern)),
  ...ALL_USERSCRIPT_EXCLUDES.map((pattern) => line('exclude', pattern)),
  line('run-at', 'document-start'),
  // Violentmonkey: run outside the page's own script context, as the
  // extension does, so Facebook's content security policy does not apply.
  line('inject-into', 'content'),
  line('noframes'),
  ...GRANTS.map((grant) => line('grant', grant)),
  '// ==/UserScript==',
].join('\n');

export default defineConfig({
  plugins: [pageWorldScript()],
  resolve: { alias: PREACT_ALIAS },
  // Library builds leave `process.env.NODE_ENV` alone. Nothing bundled reads
  // it now, Preact included, but a userscript has no `process`, so the value
  // is filled in here in case a dependency starts to.
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
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
