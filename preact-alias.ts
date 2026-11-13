// The UI code imports React, and every build and the tests swap in Preact's
// React-compatible layer, which is a small fraction of React's size. To go
// back to React, remove this alias from wxt.config.ts,
// vite.userscript.config.ts and vitest.config.ts, and install react and
// react-dom.
//
// Type checking still uses React's types, which include APIs preact/compat
// lacks or only imitates. biome.json therefore lists the React imports the
// UI may use. Check that preact/compat supports a name before adding it there.

/**
 * Vite `resolve.alias` entries. Each also covers its subpaths, such as
 * `react/jsx-runtime` and `react-dom/client`, which preact/compat provides too.
 */
export const PREACT_ALIAS = {
  'react': 'preact/compat',
  'react-dom': 'preact/compat',
};
