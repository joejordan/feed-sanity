# Feed Sanity

## Status

## Layout

| Path                             | What lives there                                                                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/entrypoints/`               | What the browser loads. `content.ts` runs on facebook.com.                                                                                                |
| `src/core/`                      | The framework features are built on: feature registry, options, DOM helpers. Nothing here knows about Facebook's markup.                                  |
| `src/facebook/`                  | Everything that depends on how Facebook builds its pages, such as selectors, cookies and URL formats. When Facebook changes something, the fix goes here. |
| `src/features/<name>/`           | One folder per feature, with its tests.                                                                                                                   |
| `src/diagnostics/`               | The Diagnostics section of the options dialog and the report it copies.                                                                                   |
| `src/platform/`                  | What differs between the extension and the userscript, such as where settings are stored.                                                                 |
| `src/ui/`                        | The UI, written with React's API: `mount` for showing a component on the page, and the options dialog.                                                     |

## Getting started

Developed with Node 26 and pnpm 10.

```sh
pnpm install
pnpm dev          # run in Firefox and reload on change
pnpm dev:chrome   # the same in Chrome
pnpm check        # type check, lint and tests
pnpm build        # .output/firefox-mv2, .output/chrome-mv3 and .output/userscript
```

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

`page.posts` reports each post on the page and each one Facebook adds later. `page.locate` finds Facebook's other elements through the locators in `src/facebook/selectors.ts`. `page.atoms` translates CSS that names Facebook's generated classes. `badge(count)` shows a number on the toolbar button, such as how many posts the feature has hidden.

Then add it to the list in `src/features/index.ts`. A feature that throws during setup is logged and skipped, and the others keep running.

## UI

The UI is written against React's API and ships with [Preact](https://preactjs.com) in its place: `preact-alias.ts` points every `react` and `react-dom` import at `preact/compat` in the builds and the tests. That keeps the content script at about 45 kB, where React made it about 247 kB. Tests use `@testing-library/preact`. To go back to React, remove the alias and install `react` and `react-dom`.

Type checking still uses React's types, which include APIs that `preact/compat` lacks or only imitates. `biome.json` lists the React imports the UI may use; check that Preact supports a name before adding it.

`mount` in `src/ui/mount.tsx` renders a component into a shadow root of its own at the end of the page, so Facebook's styles do not reach it and its styles do not leak out. It also stops keys typed into the UI from reaching Facebook's keyboard shortcuts. Import a component's style sheet with `?inline` and pass it to `mount`:

```tsx
import { mount } from '../../ui/mount';
import css from './my-panel.css?inline';

const unmount = mount(<MyPanel />, { id: 'feed_sanity_my_panel', css });
```

Every shadow root gets `src/ui/theme.css` first, then `src/facebook/theme.css`, which defines `--fs-*` colour variables from Facebook's own so the UI follows its light and dark themes. Use those rather than fixed colours.

## Code style

Biome formats and lints the code. Its rules in `biome.json` were converted from `@burgtech/eslint-config` with `biome migrate eslint`: 2-space indent, single quotes, semicolons, 100-column lines, kebab-case file names, and imports ordered as React, built-in, package, type, parent, sibling. `pnpm format` applies the fixes.

## Commits

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org). A commit-msg hook rejects anything else.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
