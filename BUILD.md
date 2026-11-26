# Building Feed Sanity from Source

These instructions allow Mozilla Add-ons (AMO) reviewers and contributors to reproduce the exact extension and userscript artifacts shipped in each release.

## Environment

- **Operating System**: Linux, macOS, or Windows (CI builds run on `ubuntu-latest`)
- **Node.js**: `26.x`
- **Package Manager**: `pnpm@10.33.2` (pinned in `package.json`'s `packageManager` field)

Verify your toolchain before building:

```sh
node --version   # v26.x
pnpm --version   # 10.33.2
```

## Build Steps

1. Extract the source archive (`feed-sanity-<version>-sources.zip`) or check out the release tag.
2. Install exact locked dependencies:

   ```sh
   pnpm install --frozen-lockfile
   ```

3. Build the Firefox MV2 extension, Chrome MV3 extension, Safari MV3 extension, and userscript:

   ```sh
   pnpm build
   ```

4. Package the Firefox, Chrome, and Safari release archives:

   ```sh
   pnpm zip
   ```

5. *(macOS with Xcode only)* Wrap, build, and auto-update the Safari extension app container:

   ```sh
   pnpm build:safari-xcode                     # macOS app (auto-signs with Apple Development if present & registers via pluginkit)
   pnpm build:safari-xcode -- --all-platforms  # universal macOS + iOS/iPadOS project
   pnpm build:safari-xcode -- --no-sign        # unsigned build (CODE_SIGNING_ALLOWED=NO)
   pnpm build:safari-xcode -- --open           # register extension and launch Feed Sanity.app
   pnpm safari:update                          # ~1s incremental sync, re-sign, and pluginkit refresh
   pnpm dev:safari:app                         # watch src/ + auto-update Safari extension on save (--test runs WKWebExtension E2E)
   ```

## Output Artifacts

- `.output/firefox-mv2/` — Unpacked Firefox Manifest V2 add-on
- `.output/feed-sanity-<version>-firefox.zip` — Packaged Firefox add-on (for AMO)
- `.output/feed-sanity-<version>-sources.zip` — Full source archive matching the build
- `.output/chrome-mv3/` — Unpacked Chrome Manifest V3 extension
- `.output/feed-sanity-<version>-chrome.zip` — Packaged Chrome extension (for Chrome Web Store)
- `.output/safari-mv3/` — Unpacked Safari Manifest V3 web extension
- `.output/feed-sanity-<version>-safari.zip` — Packaged Safari web extension resources
- `.output/safari-xcode/` — Generated Xcode Safari Web Extension wrapper project and app bundle (macOS)
- `.output/userscript/feed-sanity.user.js` — Unminified userscript for Tampermonkey, Violentmonkey, and Greasemonkey

## Verification

```sh
pnpm check                # TypeScript typecheck, Biome lint, and Vitest unit suite
pnpm test:e2e             # Chromium Playwright end-to-end suite
pnpm test:firefox         # Firefox MV2 WebDriver BiDi smoke test
pnpm test:safari:manifest # Safari MV3 manifest and cross-browser isolation smoke check
pnpm test:safari          # macOS 15.4+ native WKWebExtension E2E suite (-- --appex also tests signed .appex)
pnpm dlx addons-linter@10.16.0 .output/feed-sanity-*-firefox.zip
```

## Why Firefox Uses Manifest V2

Firefox builds target Manifest V2 (`gecko.strict_min_version: "140.0"`, `gecko_android.strict_min_version: "142.0"`) so that declared content-script host matches apply immediately upon install while supporting `content_scripts[].world: "MAIN"` and `data_collection_permissions`.
