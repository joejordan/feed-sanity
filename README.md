# Feed Sanity

## Status

## Layout

| Path                             | What lives there                                                                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/entrypoints/`               | What the browser loads. `content.ts` runs on facebook.com.                                                                                                |
| `src/core/`                      | The framework features are built on: feature registry, options, DOM helpers. Nothing here knows about Facebook's markup.                                  |
| `src/facebook/`                  | Everything that depends on how Facebook builds its pages, such as selectors, cookies and URL formats. When Facebook changes something, the fix goes here. |
| `src/features/<name>/`           | One folder per feature, with its tests.                                                                                                                   |
| `src/platform/`                  | What differs between the extension and the userscript, such as where settings are stored.                                                                 |

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
import { defineFeature } from '../../core/feature';

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
  setup({ options, log }) {
    options.watch('my_feature_enabled', (enabled) => {
      log.debug('enabled:', enabled);
    });
  },
});
```

Then add it to the list in `src/features/index.ts`. A feature that throws during setup is logged and skipped, and the others keep running.

## Code style

Biome formats and lints the code. Its rules in `biome.json` were converted from `@burgtech/eslint-config` with `biome migrate eslint`: 2-space indent, single quotes, semicolons, 100-column lines, kebab-case file names, and imports ordered as built-in, package, type, parent, sibling. `pnpm format` applies the fixes.

## Commits

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org). A commit-msg hook rejects anything else.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
