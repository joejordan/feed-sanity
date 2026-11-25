# Feed Sanity

A multi-site browser extension and userscript for filtering, tidying, and theming **Facebook**, **X (Twitter)**, **Instagram**, **Reddit**, and **Gmail**.

## What's built

### Multi-site filtering, feeds, and video tools

- **Quick Control Center**: Clicking the toolbar icon (or opening the userscript overlay) opens a compact site-aware control center with one-click Starter Modes (`Default`, `Clean`, `Focus`, `Minimal`), per-site feature toggles, Quick Mute, quick theme swatches, `My Themes` switching, polarity flip, and `Apply to all sites`. Every change applies immediately with an Undo toast.
- **Cross-site Filter Rules**: Build keyword, author, domain, or selector filters to hide, highlight, or tag posts and threads across supported sites, with live hit counts and zero-reload updates.
- **Facebook**:
  - Hide suggested posts and ads (detected via Facebook's page-world React data rather than text heuristics), Home feed switcher (Home, Friends, Favorites, Groups, Pages, Most recent), stop automatic feed refreshes and stale-session redirects, video scrubber, click-to-pause, video download, and story playback improvements.
- **X (Twitter)**: Default to Following feed, hide clutter (Grok, Premium upsells, sidebar widgets, Who to follow), feed filters, video scrubber/controls, and customizable playback speed.
- **Instagram**: Default to Following feed, hide clutter (Reels/Explore/Threads upsells, suggestions), feed filters, video controls, and video download.
- **Reddit**: Hide clutter (promoted items, sidebar noise, app prompts), feed filters, and video controls.
- **Gmail**: Hide clutter (sidebar/banner distractions, promotions noise) and thread filters. Strict Trusted Types CSP compliance throughout.
- **Diagnostics**: Inspect active features, error counts, post tracking, selector health, and copy a sanitized report with no personal data.

### Unified 3-tier theming system (`ThemeDocumentV1`)

Every supported site shares a single theming engine backed by canonical `.fstheme.json` (`ThemeDocumentV1`) documents and CSS Cascade Layers (`@layer fs-user, fs-reveal-shell, fs-healer, fs-finish, fs-reveal, fs-mapping, fs-adaptive`):

- **My Themes & Cross-Site Sync**: Save customized or imported themes to a personal library, rename/export/delete entries, and broadcast any theme across every site with **Apply to all sites**.
- **Live Themes & Color Themes**: Curated full-scene Live Themes (led by two Tier 3 WebGL flagships: **Luminous Tide**, a moonlit shoreline whose surf glows wherever the pointer, a click, or scrolling disturbs it, with the moon in its real phase and an optional sky that follows your clock, and **Event Horizon** with *Black Hole*, *Quasar Jet*, and *Solar Eclipse* modes; alongside *Enter the Matrix*, *Vice City VI*, *Prism Dream*, *Velvet Silk*, *Night City Grid*, *Deep Space*, and *Blueprint Studio*) plus light and dark static Color Themes, 9 live palette token pickers, accent ribbon geometry controls (edge, thickness, angle), light/dark polarity flipping, typography presets & custom font stacks, and opt-in live hover preview.
- **Customize Effects**: Mix 8 built-in animated backdrop engines, tunable surface finishes (`glass`, `gradient`, `neon`, pointer-tracked specular `prism`, and top-lit `moonlit` with an accent underglow), tunable click FX (`ripple`, `spark`, `matrix-burst`, `glow-pulse`, `supernova`, `tide`), motion pause, and automatic `prefers-reduced-motion` and background-tab throttling.
- **Tier 2 Declarative Scene Layers**: Compose multi-layer custom animated scenes (`gradient`, `grid`, `stars`, `rain`, `orbs`, `waves`, `scanlines`) directly inside a `.fstheme.json` file with zero custom code.
- **Tier 3 Opt-In GLSL Shaders**: Import `.fstheme.json` themes with custom WebGL fragment shaders featuring built-in GLSL helpers (`rot2`, `gauss`, `fbm`, `hsv2rgb`), 4-slot overlapping click shockwaves (`u_clicks[4]`), time-of-day (`u_dayPhase`), lunar phase (`u_moonPhase`), pointer velocity (`u_pointerVel`), enum/number/color/boolean tuners, and explicit user trust gating before execution.
- **Adaptive Compiler & WCAG Auto-Healer**: Automatically maps host stylesheets, handles SPA dark/light polarity flips and Shadow DOM sheets, and runs on-demand WCAG contrast and layout audits.

For what is planned after the initial release (including site layout presets and a broader theme creator platform), see [docs/ideas/custom-layouts-and-open-theme-platform.md](docs/ideas/custom-layouts-and-open-theme-platform.md). For full history and details, see [docs/release-notes.md](docs/release-notes.md) and [docs/facebook-notes.md](docs/facebook-notes.md).

## Layout

| Path                             | What lives there                                                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `src/entrypoints/`               | Browser entrypoints: `content.ts`, `background.ts`, and `popup/` (Quick Control Center).                                                |
| `src/core/`                      | Site-agnostic framework: feature registry, options store, `PageWatcher`, `DomEnvironment`, filter engine, `theming/`, `theme-effects/`. |
| `src/sites/`                     | Per-site adapters (`facebook`, `x`, `instagram`, `reddit`, `gmail`) with each site's `theme-mapping.ts` and site-specific features.     |
| `src/facebook/`                  | Facebook DOM layer: locators, generated class-name translator, post detection, and React bridge readers.                                |
| `src/features/<name>/`           | Shared and Facebook features (`post-filters`, `mark-read`, `home-feed`, `video-*`, `display-notice`, `external-css`), with tests.       |
| `src/ui/`                        | Preact-backed Shadow DOM UI: primitives, Options dialog, `appearance/` studio, `popup/` Quick Control Center, filter rule editor.       |
| `src/diagnostics/`               | Diagnostics panel and sanitized bug-report exporter.                                                                                    |
| `src/platform/`                  | Extension vs. userscript implementations of storage, messaging, badges, and downloads.                                                  |
| `e2e/`                           | Playwright end-to-end tests running the built Chrome extension and userscript against site fixtures.                                    |

## Getting started

Developed with Node 26 and pnpm 10.

```sh
pnpm install
pnpm dev            # run in Firefox and reload on change
pnpm dev:chrome     # run in Chrome and reload on change
pnpm check          # typecheck, lint, and unit tests
pnpm build          # builds .output/firefox-mv2, .output/chrome-mv3, and .output/userscript
pnpm test:e2e       # build Chrome extension + userscript and run Playwright E2E suite
```

To load the unpacked Chrome extension locally, open `chrome://extensions`, enable Developer Mode, and load `.output/chrome-mv3`. After rebuilding, reload the extension there and refresh open tabs.

## Adding a feature

Create `src/features/<name>/index.ts` (or `src/sites/<site>/features/<name>.ts` for a site-specific feature):

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

Register it in `src/features/index.ts` or the site's adapter. A feature that throws during setup is isolated, logged, and marked failed without stopping other features.

## UI & Trusted Types

The UI is written against React's types and aliased to [Preact](https://preactjs.com) (`preact/compat`) in both builds and tests (`@testing-library/preact`). Every on-page UI mounts inside its own Shadow DOM via `mount()` in `src/ui/mount.tsx` so host CSS never bleeds in and keystrokes never trigger site shortcuts.

All code follows strict **Trusted Types** compliance (required by Gmail's CSP): `innerHTML`, `outerHTML`, `insertAdjacentHTML`, and `dangerouslySetInnerHTML` are never used.

## Code style & commits

- **Biome** formats and lints the codebase (`pnpm format`, `pnpm lint`): 2-space indent, single quotes, semicolons, 100-column lines, kebab-case file names.
- **Conventional Commits** are enforced via `commitlint` (body lines `<= 100` characters).

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
