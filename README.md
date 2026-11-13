# Feed Sanity

A TypeScript rewrite of [Social Fixer for Facebook](https://socialfixer.com/), the browser extension by Matt Kruse. The last official release, 31.1.0, came out on 2023-09-08. This project ports it feature by feature to a new codebase that builds a Firefox extension, a Chrome extension and a userscript for Greasemonkey, Tampermonkey and Violentmonkey.

Feed Sanity is a separate project from Social Fixer and is not published under that name.

## Status

The build, the feature framework, the options store, post detection and the translation of Facebook's generated class names are in place, and one feature is ported (external CSS). An options dialog lists every feature's options; open it from the toolbar button or the userscript manager's menu. Post detection and the dialog have only run in tests, not yet on Facebook itself. [docs/porting.md](docs/porting.md) lists what is left.

## Layout

| Path                             | What lives there                                                                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/entrypoints/`               | What the browser loads. `content.ts` runs on facebook.com.                                                                                                |
| `src/core/`                      | The framework features are built on: feature registry, options, DOM helpers. Nothing here knows about Facebook's markup.                                  |
| `src/facebook/`                  | Everything that depends on how Facebook builds its pages, such as selectors, cookies and URL formats. When Facebook changes something, the fix goes here. |
| `src/features/<name>/`           | One folder per feature, with its tests.                                                                                                                   |
| `src/platform/`                  | What differs between the extension and the userscript, such as where settings are stored.                                                                 |
| `src/ui/`                        | The React UI: `mount` for showing a component on the page, and the options dialog.                                                                         |
| `reference/social-fixer-31.1.0/` | The original 31.1.0 source, unmodified. Do not edit it.                                                                                                   |

## Getting started

Developed with Node 26 and pnpm 10.

```sh
pnpm install
pnpm dev          # run in Firefox and reload on change
pnpm dev:chrome   # the same in Chrome
pnpm check        # type check, lint and tests
pnpm build        # .output/firefox-mv2, .output/chrome-mv3 and .output/userscript
```

To compare against the original, open `about:debugging` in Firefox, choose "Load Temporary Add-on" and pick `reference/social-fixer-31.1.0/manifest.json`.

## Adding a feature

Create `src/features/<name>/index.ts`:

```ts
import { defineFeature } from '../../facebook/feature';

export default defineFeature({
  id: 'my_feature',
  options: {
    my_feature_enabled: {
      section: 'General',
      title: 'My feature',
      description: 'What it does.',
      default: false,
    },
  },
  setup({ options, log, page }) {
    options.watch('my_feature_enabled', (enabled) => {
      log.debug('enabled:', enabled);
    });
    page.posts.onAdd((post) => {
      log.debug('post', post.number, post.id, post.element);
    });
  },
});
```

`page.posts` reports each post on the page and each one Facebook adds later. `page.atoms` translates selectors that name Facebook's generated classes.

Then add it to the list in `src/features/index.ts`. A feature that throws during setup is logged and skipped, and the others keep running.

## UI

The UI is written in React. `mount` in `src/ui/mount.tsx` renders a component into a shadow root of its own at the end of the page, so Facebook's styles do not reach it and its styles do not leak out. It also stops keys typed into the UI from reaching Facebook's keyboard shortcuts. Import a component's style sheet with `?inline` and pass it to `mount`:

```tsx
import { mount } from '../../ui/mount';
import css from './my-panel.css?inline';

const unmount = mount(<MyPanel />, { id: 'feed_sanity_my_panel', css });
```

Every shadow root gets `src/ui/theme.css` first, then `src/facebook/theme.css`, which defines `--fs-*` colour variables from Facebook's own so the UI follows its light and dark themes. Use those rather than fixed colours.

## Code style

Biome formats and lints the code. Its rules in `biome.json` were ported from `@burgtech/eslint-config` with `biome migrate eslint`: 2-space indent, single quotes, semicolons, 100-column lines, kebab-case file names, and imports ordered as React, built-in, package, type, parent, sibling. `pnpm format` applies the fixes.

## Commits

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org). A commit-msg hook rejects anything else.

## License

Mozilla Public License 1.1, the license Social Fixer's source is published under. See [LICENSE](LICENSE). Based on Social Fixer, (c) 2009-2023 Matt Kruse.
