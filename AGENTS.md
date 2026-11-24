# Feed Sanity — Agent Guidelines

Short, high-signal rules for working in `feed-sanity` (TypeScript / Preact / WXT multi-site browser extension & userscript).

## Standing Workflow

1. **Before committing or handing back any notable code change**, always run:
   - **`simplify`** first (code reuse, quality, efficiency — preserve behavior).
   - **`code-review --fix`** second (multi-agent review, validate at confidence `>= 80`, fix validated issues).
2. **Verify end-to-end** after your final edit (`Windows PowerShell 5.1` — chain with `; if ($LASTEXITCODE -eq 0) { ... }`, never `&&`):
   ```powershell
   pnpm format; if ($LASTEXITCODE -eq 0) { pnpm typecheck }; if ($LASTEXITCODE -eq 0) { pnpm lint }; if ($LASTEXITCODE -eq 0) { pnpm test }; if ($LASTEXITCODE -eq 0) { pnpm build }; if ($LASTEXITCODE -eq 0) { pnpm test:e2e:only }
   ```
3. **Git hygiene**:
   - Conventional Commits with body lines `<= 100` characters (`commitlint` enforced).
   - Zero AI attribution anywhere in commits or PRs.
   - Never run `git push` unless explicitly asked.
   - Remind the user to reload the unpacked extension in `chrome://extensions` and refresh open tabs after builds.

## Hard Constraints

- **Trusted Types strict**: Never use `innerHTML`, `outerHTML`, `insertAdjacentHTML`, or `dangerouslySetInnerHTML` (Gmail enforces strict Trusted Types CSP). Use DOM APIs or Preact JSX.
- **Minimal footprint**: No extra browser permissions and no new npm dependencies without explicit user approval.
- **No global leaks**: Do not pollute `window.*`.
- **Biome conventions**: `useGlobalThis`, `useDomQuerySelector`, `noNestedTernary`, Preact via `react` alias (check `biome.json`).

## Architectural Invariants

### Runtime & DOM Performance
- **Shadow DOM & watchers**: Use `DomEnvironment` (`onShadowRoot`, `shadowWatcherOf`) and `PageWatcher` — never add full-document polling timers or duplicate `MutationObserver`s.
- **Self-healing `OWN_ATTR`**: Filter `OWN_ATTR` from `PageWatcher` `added` notifications to prevent mutation storms, but **never** filter `OWN_ATTR` from `removed` (slots and overlays rely on removal notifications to self-heal).
- **Hot event paths**: Never call `getBoundingClientRect()` or `querySelectorAll()` unconditionally on `pointermove`, `pointerdown`, `click`, or `keydown`. Pre-check containers/targets first, isolate ephemeral FX (like `click-fx`) inside a `ShadowRoot`, and avoid `characterData: true` observers on broad subtrees.

### Theming & Studio Effects
- **CSS Cascade Layers**: Every injected host/shadow theme sheet (`THEME_STYLE_ID`, `ADAPTIVE_STYLE_ID`, `HEALER_STYLE_ID`) must start with `THEME_LAYER_ORDER`:
  `@layer fs-user, fs-reveal-shell, fs-healer, fs-finish, fs-reveal, fs-mapping, fs-adaptive;`
  Never reintroduce repeated-attribute specificity hacks (`[attr][attr]`) or `:where(...)` wrapping that defeats O(1) class bucketing.
- **Site-agnostic core**: Keep `src/core/theme-effects/surfaces.ts` free of site-specific selectors; declare `surfaces` (`transparentShell`, `columns`, `softSurfaces`, `leafCards`, `popups`, `primaryCtas`, `feedCards`, `searchContainers`) in each site's `theme-mapping.ts` and reuse `TEXT_INPUT_SELECTOR`.
- **Backdrops & compositing**:
  - Mount backdrops at `z-index: -1`; never wrap `body > :not(...)` or put `backdrop-filter` on landmarks, columns, banners, or popups (stacking/scroll traps).
  - Reserve `backdrop-filter: blur()` for `surface === 'glass'` only (capped `<= 10px`).
  - Use `--fs-reveal-canvas` for canvas-tier backgrounds rather than giant `:not(:where(...))` negation chains or deep `:has()` walks.
  - Never use `body { background-attachment: fixed }` (forces full-page repaints on scroll); use a fixed `body::after` layer instead.
