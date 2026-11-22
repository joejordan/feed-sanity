# Idea: Cross-Site Unified Feed

> **Status:** Parked for exploration after the current multi-site core rework is finalized.

## Goal

Bring posts from multiple enabled sites into whichever social site you prefer to browse — for example, reading your Facebook feed inside X.com, reading X posts inside Facebook, or viewing a combined chronological stream across Facebook, Instagram, and X with shared filters and theming.

## Why It Fits the Current Platform

Most of the foundational pieces already exist:

- **`SiteAdapter` & `FeedCapability`**: Each site already tracks feed items, strips ads/suggested posts, and parses structured GraphQL/REST payloads in `NetworkTap` / `SiteFeed`.
- **Optional host permissions** (`src/sites/manifest.ts`): Users already grant per-site access explicitly.
- **First-class theming** (`src/core/theming.ts`, `--fs-*` tokens): One shared Shadow-DOM `<UnifiedPostCard>` component automatically matches the host site's native theme or the user's chosen Feed Sanity theme.
- **Native entry points**: Facebook already has our Home feed switcher (`Home | Friends | Groups`), and X already has `[data-testid="primaryColumn"] [role="tablist"]` (`For you` / `Following`).

## Data Sourcing Options

### Tier 1: Passive Local Feed Bus (Recommended for v1)

- Whenever you browse or keep a tab open on an enabled site, its adapter normalizes organic (already ad-filtered) posts into a compact `UnifiedPost` record (`site`, `id`, `author`, `avatar`, `timestamp`, `text`, `media[]`, `permalink`, `counts`).
- Records live locally in `browser.storage.local` or background IndexedDB as a rolling window.
- **Pros:** Zero extra API requests, no CSRF/token replay, no anti-bot risk.
- **Tradeoff:** Freshness depends on having visited or kept a tab open for the source site.

### Tier 2: On-Demand Background Refresh (v2)

- **X & Instagram:** The background service worker can query timeline endpoints using existing browser cookies and CSRF tokens (`ct0` on X, `csrftoken` + `x-ig-app-id` on Instagram), using `declarativeNetRequest` session rules if `Origin`/`Referer` headers must match.
- **Facebook:** Comet relies on a live `fb_dtsg` token and rotating GraphQL `doc_id`s, making cold service-worker fetches brittle. Reliable background sync either reuses an open Facebook tab or briefly opens a background sync tab that lets Comet execute its normal feed query and stream normalized items into the local bus.
- **Note:** Hidden `<iframe>`s are not viable because Facebook, Instagram, and X enforce `X-Frame-Options: DENY` / strict `frame-ancestors` CSP.

## Key Technical Constraints & Solutions

1. **Host CSP blocks cross-origin media (`img-src` / `media-src`) and signed CDN URLs expire**
   - Rendering `scontent.fbcdn.net` images directly inside `x.com` will be blocked by X's CSP, and signed URLs expire after a few hours.
   - **Solution:** Proxy thumbnails/images through the background service worker (using the extension's optional host permissions, outside page CSP) into cached `data:` URLs or extension-hosted blobs, falling back cleanly to a text/link card if needed.

2. **X.com's virtualized timeline (`transform: translateY(...)`)**
   - **Into Facebook:** Straightforward — Facebook's feed uses normal vertical document flow, so themed Shadow-DOM cards can interleave chronologically or live inside a dedicated `Unified` feed view.
   - **Into X.com:** Naively inserting foreign DOM nodes into X's virtualized list breaks `translateY` height calculations and causes overlapping cards.
   - **Solution:** Add a native-looking **`All Feeds`** (or **`Facebook`**) tab next to `For you` and `Following` inside `primaryColumn`. When active, hide X's virtualized list and render our normal-flow unified stream using `--fs-*` tokens. *(True interleaving inside X's native virtualizer is theoretically possible via transforming `NetworkTap` placeholder entries + `ResizeObserver`, but significantly more fragile.)*

3. **Read-Only vs. Cross-Site Interactions**
   - **v1 scope (high reliability):** Read-only viewing, chronological sorting, shared keyword filters, mark-as-read, local cross-site bookmarks, unified theming, and one-click open on the original site.
   - **Deferred / optional:** Cross-site like/reply mutations carry higher breakage risk (rotating `doc_id`s, anti-abuse headers) and account-safety risk if anything misfires; defer until the read-only bus is proven.

## Proposed Incremental Milestones

1. **v1 — Passive Unified Feed Tab:** Define `UnifiedPost` + local `FeedBus`, build shared `<UnifiedPostCard>` with service-worker thumbnail proxying, and expose a `Unified` view in Facebook's Home switcher and an `All Feeds` tab in X's `primaryColumn`.
2. **v2 — On-Demand Sync:** Add a manual "Sync feeds" trigger (background fetch for X/Instagram; tab-assisted sync for Facebook).
3. **v3 — Local Cross-Site Bookmarks & Optional Interleaving:** Add unified "Saved for later" storage and optional chronological interleaving on normal-flow hosts like Facebook.
