# Idea: Custom Layouts, Classic Modes & Open Theme Creator Platform

> **Status:** Parked for exploration after the initial release.

## Guiding Principle

The bytes coming to your computer should be displayed in whatever way you wish. Users and creators should be able to reshape both the *look* and the *layout* of any supported site — from a nostalgic Classic 2014 Facebook or Old Twitter feel to fully custom visual worlds — without sacrificing browser store compliance (Chrome MV3, Firefox AMO, Userscripts), Trusted Types safety, or resilience against weekly site deploys.

## Part 1: Layout-Altering Experiences ("Classic Facebook" & Beyond)

Reshaping a site's layout splits cleanly into two orthogonal layers so users can freely mix-and-match **Structure** with **Color / Vibe** (e.g. Classic Compact Facebook layout + Catppuccin Mocha dark mode, or Modern Facebook layout + Classic Blue & Gray colors):

### Layer A — Visual & Spatial Layout in Themes (Pure Declarative, Zero JS)

Covers ~75% of nostalgic or radically redesigned aesthetics without fragile DOM surgery:

- **Cross-Site Layout & Density Tokens** on `ThemeDocumentV1`:
  - `density`: `compact | comfortable | spacious` (card padding, line-height, vertical rhythm)
  - `cardRadius` & `borderStyle`: flat solid-border cards (`2–4px` radius on a `#e9ebee`-style canvas) vs. floating rounded cards
  - `avatarShape`: `circle | rounded | square`
  - `feedWidth`: narrow classic column (`500–600px`) or wide reading layout
  - `headerStyle`: solid accent top bar (e.g. classic Facebook blue `#3b5998`) vs. blended canvas
- **Cross-Site Semantic CSS Targets**:
  - Expand stable semantic selectors (`@fs-header`, `@fs-feed-card`, `@fs-sidebar`, `@fs-avatar`, `@fs-cta`, `@fs-input`, `@fs-popup`, `@fs-canvas`) to each site's `mapping.surfaces` at compile time, so one stylesheet works across Facebook, X, Instagram, Gmail, and Reddit (including Shadow DOM and iframes).
- **Per-Site Scoped CSS Overrides (`siteCss?: Partial<Record<SiteId, string>>`)**:
  - Sanitized by the same CSS Syntax Level 3 sanitizer and opt-in gated just like `customCss`, allowing a theme like *Classic 2014 Facebook* to add Facebook-specific layout polish without bleeding into X or Reddit when applied globally.

### Layer B — Structural & Behavioral Layout Modes (First-Class Site Features)

Covers the remaining ~25% that genuinely requires moving widgets, rebuilding missing navigation, or rewriting page chrome (e.g. classic left-rail / top-bar feed switcher, inline post composer, pinned chat dock, classic nav bar):

- Built and maintained as first-class **Site Features** using resilient site adapters (`atoms.ts`, `locator.ts`, `PageWatcher`, `page-mounts.ts`) rather than untrusted JS inside `.fstheme.json`.
- Exposed as explicit **Layout Presets / Classic Modes** alongside Starter Modes (`Clean / Focus / Minimal`) so switching color themes never silently rearranges navigation or hides feeds.
- **Bridge**: A `.fstheme.json` can declare an optional, non-destructive `recommendedLayout` hint (e.g. *"Works best with Classic Layout — Apply?"*) surfaced as a one-click opt-in suggestion on import.

## Part 2: Open Theme Creator Platform (Post-v1 Extensions)

Extending our `.fstheme.json` format (building on Tier 2 Scene Layers & Tier 3 Opt-In GLSL Shaders) so creators can build nearly anything without arbitrary JS or remote network fetches:

1. **User-Defined Theme Parameters (`params: ThemeParamSpec[]`)**:
   - Reuses `EffectParamSpec` so theme authors can declare custom sliders, toggles, color pickers, enums, and strings that automatically render native controls in Appearance and bind to CSS custom properties (`--fs-param-*`), Scene Layer properties (`"$param.*"`), and GLSL uniforms (`uniform float u_*`).
2. **Ping-Pong Shader Feedback Buffer (`u_prevFrame`)**:
   - Adds a single previous-frame `sampler2D` pass to Tier 3 GLSL shaders, unlocking stateful GPU simulations (fluid smoke trails, water ripples, Game of Life, reaction-diffusion, phosphor persistence) with zero JS.
3. **Declarative Click & Hover FX Specs**:
   - Generalizes `click-fx.ts` beyond hardcoded presets into a declarative burst spec (particle shapes, custom glyphs, rings, gravity, spread, colors) synced with `u_click`.
4. **Creator Developer Experience**:
   - Published `fstheme.schema.json` for VS Code autocomplete and live validation.
   - Built-in **Live Theme Workbench** drawer inside Theme Studio with hot-reload editing for Scene Layers, Semantic CSS, Params, and GLSL, inline shader compile errors with line numbers, FPS/frame-time telemetry, and live WCAG Contrast + Layout Audit.
   - Bounded, magic-byte-validated inline procedural/tile assets if raster textures are ever needed — preserving zero remote URLs, zero IP tracking, and 100% offline portability.

## Proposed Post-Release Milestones

1. **v1.1 — Cross-Site Layout Tokens & `siteCss`**: Add `layout` tokens (`density`, `cardRadius`, `avatarShape`, `feedWidth`) and opt-in per-site `siteCss` to `ThemeDocumentV1`.
2. **v1.2 — Classic Layout Modes**: Add optional per-site structural Classic Layout features (starting with Facebook Classic Chrome + Compact Feed) decoupled from color themes, plus `recommendedLayout` import hints.
3. **v1.3 — Creator Platform & Live Workbench**: Ship user-defined `params`, semantic `@fs-*` CSS targets, `u_prevFrame` shader feedback, `fstheme.schema.json`, and the live Theme Studio Workbench.
