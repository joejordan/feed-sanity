# Release notes

Feed Sanity is a multi-site extension and userscript for **Facebook**, **X (Twitter)**, **Instagram**, **Reddit**, and **Gmail**.

Nothing has been published to stores yet. The version in `package.json` is `1.0.0`, and this document reflects `master` as of 2026-11-27.

## Summary

- **Five supported sites on one architecture**: Facebook, X, Instagram, Reddit, and Gmail, built from one TypeScript codebase into a Firefox MV2 extension, a Chrome MV3 extension, a Safari MV3 extension, and a single-file userscript.
- **Quick Control Center & Standalone Settings**: Toolbar popup (and draggable userscript overlay) with Starter Modes (`Default`, `Clean`, `Focus`, `Minimal`), per-site toggles, Quick Mute, quick theme swatches, `My Themes` strip, polarity toggle, `Apply to all sites`, and instant-apply Undo toasts, synced live with the full-window standalone Settings page.
- **Unified 3-tier theming (`ThemeDocumentV1`)**: Canonical `.fstheme.json` theme documents (file or HTTPS URL import) powering `My Themes`, curated `Live Themes`, static `Color Themes`, 10 animated backdrop engines, surface finishes, click FX, Tier 2 declarative multi-layer scenes, Tier 3 opt-in sandboxed GLSL fragment shaders, an adaptive CSSOM compiler, and an on-demand WCAG contrast/layout auto-healer.
- **Cross-site cleanup & video tools**: Default-to-Following feeds, clutter removal, filter rules, and video controls/downloads across X, Instagram, Reddit, and Gmail.
- **Verification**: 1,138 unit tests across 123 test files and 69 Playwright end-to-end tests pass alongside strict TypeScript checks, Biome lint, Firefox MV2 smoke tests, and all four build targets.

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
- **Live Themes**: Curated one-click full-scene themes led by two Tier 3 WebGL flagships. **Luminous Tide** is a moonlit shoreline with bioluminescent surf: the water glows under the pointer and along its wake, in rings around each click, and across the whole surf while you scroll, and a click on the sky sends a shooting star. The moon shows its real phase, the sky can follow your clock or hold at night, dusk, or dawn, and the theme pairs with the Moonlit surface finish and Tide click effect. **Event Horizon** is the other (gravitational-lensing black hole with *Black Hole* / *Quasar Jet* / *Solar Eclipse* modes, overlapping 4-click gravitational shockwaves, pointer-tracked Prism specular surfaces, and Supernova click bursts). **Rainforest Canopy** is a jungle clearing seen from the forest floor, built on the `canopy` backdrop engine. Monstera, palm, banana, and fern leaves frame the corners of the viewport and sway in the breeze. Each sunbeam is traced back to the canopy and lit only where it passes between those leaves, so the beams move as the leaves do. Pollen drifts in the light by day and fireflies blink at dusk and night, both passing behind the closest leaves, and they glow brighter near the pointer. A click shakes a ring of pollen loose, and scrolling rustles the leaves. The time of day holds at misty dawn, sunlit morning, golden hour, firefly dusk, or moonlit night, or follows your clock. The theme pairs with the Dappled surface finish and Petals click effect. **Coral Lagoon** is a sunlit aerial tropical island cove built on the `shoreline` backdrop engine: warm coral sand with shells and starfish curves along the beach while crystal-clear turquoise water carries refracted underwater caustics, lacy foaming swash waves, glistening wet-sand memory, swaying coconut palm shadows, submerged coral reef heads, and a gliding manta ray with an offset seabed shadow, shifting across sunrise, sunlit lagoon, mango sunset, moonlit cove, or your local clock alongside the real lunar spring/neap tide. It pairs with the Sea Glass (`caustic`) surface finish and Seafoam click effect. All four sit alongside *Enter the Matrix*, *Vice City VI*, *Prism Dream*, *Velvet Silk*, *Night City Grid*, *Deep Space*, and *Blueprint Studio*.
- **Color Themes & Palette Tools**: Static light and dark presets, 9 individual palette token overrides (including secondary surface, muted text, borders, and danger), accent ribbon position/thickness/angle controls, one-click dark/light polarity flipping, typography presets & sanitized custom font stacks, inline custom CSS, external HTTPS stylesheets, and opt-in live hover preview (off by default under Appearance).
- **Customize Effects**: 10 built-in canvas/CSS backdrop engines (`digital-rain`, `vice-horizon`, `aurora`, `silk`, `starfield`, `cyber-grid`, `prism-beams`, `dot-spotlight`, `canopy`, `shoreline`) with declarative per-engine parameter tuners, tunable surface finishes (`glass`, `gradient`, `neon`, `prism`, `moonlit`, `dappled`, `caustic`), tunable click FX (`ripple`, `spark`, `matrix-burst`, `glow-pulse`, `supernova`, `tide`, `petals`, `seafoam`), background-tab pause, and `prefers-reduced-motion` support. `canopy` takes its greens, light, and motes from the active palette, so any theme can use it, and it has tuners for time of day, sunbeams, foliage, mist, fireflies and pollen, and breeze. `shoreline` adapts to both light and dark palettes with tuners for time of day, water caustics, tide level, surf & foam, trade wind, palm shadows, and lagoon wildlife. `dappled` lays static pools of sunlight across cards with a green glow from the opposite corner, `caustic` (Sea Glass) adds refracted coastal caustic washes and pearlescent sea-glass rims, `petals` scatters a dewdrop ring and a few petals from each press, and `seafoam` pops sunlit surf spray rings and buoyant glossy sea-bubbles.
- **Tier 2 Declarative Scene Layers**: Themes can define multi-layer animated backgrounds (`gradient`, `grid`, `stars`, `rain`, `orbs`, `waves`, `scanlines`) purely in `.fstheme.json` data.
- **Tier 3 Opt-In GLSL Shaders**: Themes can bundle a WebGL fragment shader with built-in GLSL helpers (`rot2`, `gauss`, `fbm`, `hsv2rgb`), 4-slot overlapping click shockwaves (`u_clicks[4]`), local time-of-day (`u_dayPhase`), lunar phase computed from the clock (`u_moonPhase`), smoothed pointer velocity for wakes and motion-reactive scenes (`u_pointerVel`), extended palette uniforms (`u_border`, `u_danger`), `enum` / `number` / `color` / `boolean` declarative params, static safety validation, and an explicit trust confirmation before running.
- **Adaptive Compiler & Theme Health**: Automatically rewrites host stylesheet rules (including Shadow DOM CSSOM and SPA polarity switches) and provides an on-demand WCAG contrast and layout audit with one-click Auto-Heal.
- **Host Display Notices**: When visiting Facebook's or X's native Dark Mode / Display settings while a Feed Sanity theme is active, an inline notice reminds you that Feed Sanity is controlling appearance and links straight to Appearance settings.

## Per-site features

### Facebook

- **Post filters**: Keyword hiding, full rule engine (text, element, weekday and age conditions; hide, keep visible, CSS, class, text replace), live re-filtering on post updates, hide suggested posts (on by default), hide ads via page-world React data (off by default), and an optional hidden-post placeholder toggle under Quick Shields.
- **Mark Posts as Read**: Inline checkmark in post headers (and left-anchored fallback for post dialogs/Marketplace so it never overlaps close buttons), Shift+Click to mark a post and everything above it as read, compact read notes with peek/unmark, floating read bar with Show/Hide and Undo, and automatic cache pruning.
- **Feeds & stability**: Home feed menu (Home, Friends, Favorites, Groups, Pages, Most recent), always-on **Hide Reels bar** and **Hide Stories bar** toggles across all feeds, and stop automatic feed refreshes / stale-session redirects.
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

- **Automated checks**: Strict TypeScript (`tsc --noEmit`), Biome lint/format, 1,138 Vitest unit tests (happy-dom), Firefox MV2 + Chrome MV3 + Safari MV3 + Userscript builds, 69 Playwright E2E tests, and Firefox MV2 BiDi smoke tests pass.
- **Known gaps**:
  - Firefox runtime testing (the page-world bridge requires Firefox 128+).
  - Video ads inside Reels are not filtered yet.
  - Post-release roadmap items (layout presets, open theme creator platform) are tracked in [ideas/custom-layouts-and-open-theme-platform.md](ideas/custom-layouts-and-open-theme-platform.md).
