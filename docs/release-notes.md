# Release notes

Nothing has been published to stores yet. The version in `package.json` is still `0.0.0`, and this document reflects the `core-rework` branch as of 2026-11-24.

## Summary

- **Five supported sites on one architecture**: Facebook, X, Instagram, Reddit, and Gmail, built from one TypeScript codebase into a Firefox MV2 extension, a Chrome MV3 extension, and a single-file userscript.
- **Quick Control Center**: Toolbar popup (and draggable userscript overlay) with Starter Modes (`Default`, `Clean`, `Focus`, `Minimal`), per-site toggles, Quick Mute, quick theme swatches, `My Themes` strip, polarity toggle, `Apply to all sites`, and instant-apply Undo toasts.
- **Unified 3-tier theming (`ThemeDocumentV1`)**: Canonical `.fstheme.json` theme documents powering `My Themes`, curated `Live Themes`, static `Color Themes`, 8 animated backdrop engines, surface finishes, click FX, Tier 2 declarative multi-layer scenes, Tier 3 opt-in sandboxed GLSL fragment shaders, an adaptive CSSOM compiler, and an on-demand WCAG contrast/layout auto-healer.
- **Cross-site cleanup & video tools**: Default-to-Following feeds, clutter removal, filter rules, and video controls/downloads across X, Instagram, Reddit, and Gmail.
- **Verification**: 1,009+ unit tests across 110 test files and 69 Playwright end-to-end tests pass alongside strict TypeScript checks, Biome lint, and all three build targets.

## Architecture & core platform

### Site adapters & runtime performance

- Each site lives under `src/sites/<site>/` with its own adapter, feature list, and `theme-mapping.ts`. `src/core/` stays completely site-agnostic.
- A single shared `PageWatcher` (`MutationObserver`) and `DomEnvironment` (`onShadowRoot`, `shadowWatcherOf`) coordinate DOM tracking across features and Shadow DOM roots without polling timers or mutation storms.
- Every feature runs inside a disposable `Scope` so toggling options or enabling/disabling sites takes effect immediately without reloading the page. A feature that throws repeatedly is isolated and marked failed while all other features continue running.
- Navigation is tracked across SPAs via URL comparison and the Navigation API.
- Strict **Trusted Types** compliance across the entire codebase (zero `innerHTML` / `outerHTML` / `insertAdjacentHTML` / `dangerouslySetInnerHTML`) so Gmail's strict CSP never blocks injection or UI updates.
- UI components use React types compiled against Preact (`preact/compat`) inside isolated Shadow DOM roots.

### Locators, bridge & diagnostics

- Facebook selectors are defined as named fallback locators in `src/facebook/selectors.ts` and can be overridden live from the Options dialog without waiting for a release.
- A small page-world bridge script exposes strictly named, validated readers (such as video media URLs and ad signals) over a per-page randomized event channel.
- The Diagnostics panel shows build info, page state, feature status/errors, tracked items, and selector match counts, and copies a sanitized bug report with no personal data.

## Theming system (`ThemeDocumentV1` / `.fstheme.json`)

Every built-in Color Theme, curated Live Theme, user customization, and imported file uses the single canonical `ThemeDocumentV1` format (legacy v0 theme and storage layers have been removed):

- **CSS Cascade Layers**: All injected host and Shadow DOM theme sheets use a deterministic cascade order (`@layer fs-user, fs-reveal-shell, fs-healer, fs-finish, fs-reveal, fs-mapping, fs-adaptive`) with O(1) class-bucketed selectors and automatic backdrop shell reveal (`[data-fs-shell]` + `--fs-reveal-canvas`).
- **My Themes & Apply to all sites**: Save customized or imported themes into a shared cross-site library, rename/export/delete them, and broadcast any theme live to all open tabs and future site loads via **Apply to all sites**.
- **Live Themes**: Curated one-click full-scene themes (*Enter the Matrix*, *Vice City VI*, *Northern Aurora*, *Velvet Silk*, *Deep Space*, *Synthwave Grid*, *Prism Studio*, *Noir Spotlight*) combining palettes, animated backdrops, surface finishes, typography, and click FX.
- **Color Themes & Palette Tools**: Static light and dark presets, individual swatch overrides, one-click dark/light polarity flipping, typography presets, inline custom CSS, external HTTPS stylesheets, and opt-in live hover preview (off by default under Appearance).
- **Customize Effects**: 8 built-in canvas/CSS backdrop engines (`digital-rain`, `vice-horizon`, `aurora`, `silk`, `starfield`, `cyber-grid`, `prism-beams`, `dot-spotlight`) with declarative per-engine parameter tuners, surface finishes (`glass`, `gradient`, `neon`, `matte`), click FX (`spark`, `ripple`, `matrix-burst`, `hearts`), background-tab pause, and `prefers-reduced-motion` support.
- **Tier 2 Declarative Scene Layers**: Themes can define multi-layer animated backgrounds (`gradient`, `grid`, `stars`, `rain`, `orbs`, `waves`, `scanlines`) purely in `.fstheme.json` data.
- **Tier 3 Opt-In GLSL Shaders**: Themes can bundle a WebGL2 fragment shader with static safety validation, strict uniform/compilation/runtime budgets, and an explicit trust confirmation before running.
- **Adaptive Compiler & Theme Health**: Automatically rewrites host stylesheet rules (including Shadow DOM CSSOM and SPA polarity switches) and provides an on-demand WCAG contrast and layout audit with one-click Auto-Heal.
- **Host Display Notices**: When visiting Facebook's or X's native Dark Mode / Display settings while a Feed Sanity theme is active, an inline notice reminds you that Feed Sanity is controlling appearance and links straight to Appearance settings.

## Per-site features

### Facebook

- **Post filters & tabs**: Keyword hiding, full rule engine (target/operator/selector/day/age rules; hide, unhide, CSS, class, text replace, move/copy to tab), live re-filtering on post updates, hide suggested posts (on by default), and hide ads via page-world React data (off by default).
- **Mark Posts as Read**: Inline checkmark in post headers (and left-anchored fallback for post dialogs/Marketplace so it never overlaps close buttons), Shift+Click to mark a post and everything above it as read, compact read notes with peek/unmark, floating read bar with Show/Hide and Undo, and automatic cache pruning.
- **Feeds & stability**: Home feed menu (Home, Friends, Favorites, Groups, Pages, Most recent) and stop automatic feed refreshes / stale-session redirects.
- **Videos & stories**: Bottom video scrubber, click-to-pause (double-click opens viewer), one-click `.mp4` download, story scrubber/pause/download, and keeping stories playing while hovering the story list.
- **Appearance**: Full Meta Comet variable mapping, adaptive dark/light support, backdrop reveal, and themed progress/loading throbbers.

### X (Twitter)

- Default to Following feed, hide clutter (Grok, Premium upsells, Trends/Who to follow), custom feed filters, video scrubber/controls, customizable video playback speed with popup stepper, and full theming + Display notice.

### Instagram

- Default to Following feed, hide clutter (suggested posts, Reels/Threads/Explore upsells), feed filters, video controls, video download, and full theming.

### Reddit

- Hide clutter (promoted posts, sidebar clutter, app prompts), feed filters, video controls, and full theming (including Shadow DOM Web Components).

### Gmail

- Hide clutter, thread filters, full theming, and strict Trusted Types CSP compatibility.

## Verification & known gaps

- **Automated checks**: Strict TypeScript (`tsc --noEmit`), Biome lint/format, 1,009+ Vitest unit tests (happy-dom), Firefox MV2 + Chrome MV3 + Userscript builds, and 69 Playwright E2E tests pass.
- **Known gaps**:
  - Firefox runtime testing (the page-world bridge requires Firefox 128+).
  - Video ads inside Reels are not filtered yet.
  - Post-release roadmap items (layout presets, open theme creator platform) are tracked in [ideas/custom-layouts-and-open-theme-platform.md](ideas/custom-layouts-and-open-theme-platform.md).
