// A Vite plugin that bundles the page-world side of the bridge,
// src/page-world-script.ts, into a string. The userscript imports that string
// as `virtual:page-world-script` and adds it to the page as a script loaded
// from a `blob:` address. The extensions do not need it: their manifest adds
// src/entrypoints/page-world.content.ts instead.
//
// vite.userscript.config.ts and vitest.config.ts both use it, so the tests
// run the same code the userscript puts in the page.

import path from 'node:path';
import { build } from 'vite';
import type { Plugin } from 'vite';

const MODULE = 'virtual:page-world-script';
const RESOLVED = `\0${MODULE}`;
const ENTRY = path.join(import.meta.dirname, 'src', 'page-world-script.ts');

async function bundle(): Promise<string> {
  const result = await build({
    configFile: false,
    logLevel: 'warn',
    build: {
      write: false,
      // Userscript sites such as Greasy Fork do not accept minified code.
      minify: false,
      // An IIFE of a module with no exports assigns nothing, so it leaves no global behind.
      lib: { entry: ENTRY, formats: ['iife'], name: 'pageWorld' },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const chunk = outputs
    .flatMap((output) => ('output' in output ? output.output : []))
    .find((item) => item.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') {
    throw new Error(`bundling ${ENTRY} gave no script`);
  }
  return chunk.code;
}

export function pageWorldScript(): Plugin {
  return {
    name: 'feed-sanity:page-world-script',
    resolveId: (id) => (id === MODULE ? RESOLVED : undefined),
    async load(id) {
      if (id !== RESOLVED) {
        return;
      }
      return `export default ${JSON.stringify(await bundle())};`;
    },
  };
}
