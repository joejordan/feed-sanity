# Facebook notes

What Feed Sanity's own live checks found about Facebook's pages, recorded so features can be built
and fixed against observed behaviour. Dates are when each check ran; Facebook changes often, so
check again before relying on a detail.

## The stories viewer

A look at stories on 2026-11-14, in Chrome 157 at `/stories/` and `/stories/<id>/<token>/` (`pageContext().type` is `stories`), found:

- A video story's `<video>` has no `[data-video-id]` above it. Its parent has the same box, is not positioned, and holds the video and a `div[role=group]`. The four levels above it have the same box, then a `div[data-pagelet]`, then the story card, a `div[data-id]` with the same box, `position: relative` and five children: (a) the layer with the video; (b) a full-size layer with `pointer-events: none`; (c) a zero-size element whose children are placed over the card; (d) a band 23 pixels high at the bottom with `pointer-events: none`; (e) an empty, transparent strip over the bottom 12 pixels with `pointer-events: all` and no React handlers. A photo story has an `<img>` in place of the video, in the same card.
- The header lies over the top of the card: the avatar link (40 pixels, 12 in and 28 down), the name link, a small labelled button, and three 32 by 24 buttons at the top right that are not inside the card. The rightmost of these has `aria-haspopup="menu"`, and the one just left of it is the story's pause and play button; the three share an ancestor three levels up. Progress segments run across the very top. The next and previous buttons, 48 pixels square, are outside the card at its sides.
- The player's React data has the same shape as in the feed: `implementations` 12 fibers up, with `hdSrc` and `sdSrc`, and `coreVideoPlayerMetaData.videoFBID`.
- A story runs on its own timer. Pressing its pause button with `.click()` stopped and started the progress bar.

With that, the three video features reach the stories viewer. A video in a story card on a stories page is on the `story` surface (`VideoSurface` in `src/facebook/videos.ts`), and its `container` is the card (`STORY_CARD` in `src/facebook/selectors.ts`, the `[data-id]` whose child is the `[data-pagelet]` layer), so the overlays go in as the card's last children and paint above layers (a) to (e). `controls()` there takes in the element that holds the card and the header, so the header's buttons outside the card count; `src/facebook/stories.ts` finds the header from its menu button (`STORY_MENU`) over the card's top, and the pause button by where it is next to it.

- `video_scrubber`: the strip runs along the whole bottom edge. Facebook's strip (e) has `z-index: 1`, so it takes the pointer above our host, which is later in the card but has no `z-index`. The scrubber stands in for it as it does for the reel viewer's bar. A video's `bottomCover()` gives it, from `storyBottomStrip` in `src/facebook/stories.ts`, which finds it by structure (`STORY_STRIP`, an empty child of the card, at least half as wide, along the bottom edge, no taller than 24 pixels, that takes pointer events), and it is marked with `STOOD_IN_FOR` and hidden while the scrubber shows on that story. It is measured against the video's bottom edge, and looked for again each time the pointer comes over the story, so a strip Facebook adds later is found too. It comes back when the scrubber goes: when the option is turned off, the video leaves or is given a story whose length is not known yet, or the video is too narrow or not laid out. The scrubber stands in for nothing on a video within a pixel of the 120 pixel width below which `scrubber.css` hides it, since the overlay's host follows the video's size only to half a pixel. Photo stories get no scrubber, and their strip stays.
- `video_download`: the button takes the place nearer the corner of the two it finds, along the top edge and down the left edge, so on a story it goes under the avatar at the left, 72 pixels down on the story measured, with its tooltip below.
- `video_click_pauses`: a plain click on a story card, video or photo, presses the story's own pause and play button, so Facebook's timer and progress bar stay in step, and the whole press is kept from Facebook. Clicks on the header, links and stickers in the story, this project's UI, and anything outside the card (the header's buttons on the right, the next and previous buttons and the reply box) go to Facebook, and so does a press made while the story's menu is open or while a field outside the card, such as the reply box, has focus, since it is meant to close or leave them. A press that ends after the card has been given the next story does nothing. Facebook's tap zones on the story, where a click on the left part goes back, no longer move the story while the option is on; the next and previous buttons do. Every click on a story counts, so a double click pauses and plays it again, and the double click itself is kept from Facebook. Facebook does the pausing there, so no hold keeps a story paused. When no pause button is found next to the menu button, clicks on that story go to Facebook and the feature says so once at debug level.

A live check the same day, with the code loaded alone and the viewer opened from the story tray, found both overlay hosts as the last children of the card (seven children in all), the save button at (8, 72) on a 419 by 745 video, and a click on a photo story stopping its progress bar and a second one starting it, with the address unchanged and no errors. The scrubber could not take the pointer there, because of strip (e)'s `z-index`, which led to the stand-in above. A second live check after the stand-in went in, on an 11 second video story, found strip (e) marked and hidden and nothing else marked. A click on the scrubber three quarters of the way along moved the video to 8.3 seconds, and a drag back moved it to 2.8. The save button showed under the avatar with its tooltip below it. A click on the picture paused the video and Facebook's play button followed, and a second click played it again. A click on the left third paused it, with the same story and the same address afterwards. With the scrubber switched off the strip was given back, and it was hidden again when the scrubber came back on. The save button was not pressed.

## Loading test code on the live site

Facebook's pages do not allow `eval`, but they allow scripts from `blob:` addresses. The test build was loaded that way, from a file put in a file input. The steps are in `.claude/skills/live-facebook-check/SKILL.md`.

## Videos

A look at videos on 2026-11-14, in the news feed and the reel viewer in Chrome 157, found:

- Every video is a plain `<video playsinline>` element in the page itself, with no iframe and no shadow root. Its `src` is empty and its `srcObject` is a `MediaSourceHandle`, so the address of the video file is not in the page.
- A wrapper above the video carries `data-video-id`, and sometimes `data-video-length`.
- Facebook draws its own controls on a video once it has played: two `[role=slider]` elements, for position and volume, and labelled buttons. They stay in the page when they fade out, at an opacity of 0.01 or 0.
- A feed video is not inside a link. A `div[role=presentation]` lies over it and Facebook handles the click in script.
- Setting `currentTime` moved a playing video from 30 s to 49 s.
- A capture listener on `window`, added after the page had loaded, received a click on a feed video before Facebook did. With the event stopped there, the video paused, the address stayed the same and nothing opened.
- With the extension installed and the test build loaded in the same tab, the extension marked the posts first and the test build saw none. The installed extension had found and sorted 14 posts.

A watch for video ads the same day played 11 reels through in the reel viewer over 39 minutes, most of them two to five minutes long, and stepped quickly through 45 more. No ad appeared: no sponsored reel, no ad break, no second video and no ad label. Facebook's React data, which only a script in the page's own world can read, showed:

- Every reel has `isSponsored`, false on all 56, and `sponsored_data`, empty on all 56.
- The player has an `instreamVideoAdBreaksPlayer` object and an `adClientToken` field.

What these hold during an ad is not known.

A video paused from outside starts again when it scrolls out of view and back, because Facebook plays videos that come into view. Its own play button does follow a pause made from outside.

Not checked for videos: an ad during a video, pressing the save button on the live site, and anything in Firefox. The page-world bridge has answered on the live site only in the test build, where both of its sides run in the page's own world. The extension's `world: 'MAIN'` content script and the userscript's `blob:` script have run only in the end-to-end tests.

## News feed, suggested posts and the top bar

A look at the news feed on 2026-11-14 in Chrome 157, with no ad blocker, found:

- Of 16 posts, 4 were ads, 6 had a Follow button and 2 a Join button in their header, and 4 were from friends or followed pages. The button is a `div[role=button]` three spans down inside the `h4` of the post's `[data-ad-rendering-role=profile_name]`. Posts from friends, followed pages and ads had no `[role=button]` in either. Each post had one header of its own; a shared post can hold a second one inside it. Its text is translated. No post said "Suggested for you". Group feeds, profiles and the comments popup were not looked at.
- In the page's own world, a fiber above each feed post has `memoizedProps.feedUnit`, with `__typename: "Story"` and `sponsored_data`: null on ordinary and suggested posts, and an object with `ad_id`, `client_token` and more on all 6 ads seen. The live check below found it 14 steps above the post element. Apart from `feedback.associated_group` on the one Join post, the feed unit of a suggested post looked like an ordinary one's.
- The Feeds page offers five feeds, each an address on the home path: `/?filter=<all|favorites|friends|groups|pages>&sk=h_chr`, and its left column links to each. The Friends feed showed 26 posts: none suggested, 2 ads. Its posts carry `aria-posinset`, and `pageContext()` reads the page as the news feed.
- The top bar is a `[role=navigation]` 56 pixels tall holding a `ul` of five 130 by 56 cells, Home first. Each is `li > span > div > a[role=link]`, the `div` positioned, and Home's link has the home address, a translated `aria-label` and `aria-current="page"` while it is the page shown. Its 24 pixel icon sits in the middle of the cell, in the accent colour while current, over a 3 pixel bar along the bottom. Facebook's menus have the card colour, a 12 pixel radius, the shadow `0 12px 28px 0 rgba(0, 0, 0, 0.2), 0 2px 4px 0 rgba(0, 0, 0, 0.1)` and 44 pixel `[role=menuitem]` items with a 4 pixel hover overlay, 20 pixel icons and 14 pixel labels of weight 500.

The built code then ran alone on the live site on 2026-11-14, in Chrome in dark mode, with the installed extension kept out:

- On the news feed with the default settings, 25 of 45 loaded posts had a Follow or Join button in the header, and all 25 were hidden behind the suggested note. The badge matched. Two of them also had a page's verified badge before the button: a `div[role=button]` with `tabindex=0`, an `aria-label`, an svg and text, inside the same `h4`. The first version of `SUGGESTION_BUTTON` took the badge for the button, which would have hidden a verified page the person follows. It now leaves out buttons with an `aria-label` or an svg.
- With "Hide ads" on, all 5 ads among those 45 posts were hidden behind the ad note, about a second after each appeared, and no other post was hidden. The fiber holding `feedUnit` was 14 steps above the post element, on the news feed and on the Feeds pages.
- On the Friends feed, 5 ads of 32 posts were hidden and nothing else. Four shared posts whose inner post had a Follow button stayed visible; that button is not inside any `h4`.
- The Feeds pages draw post headers with `h3`, where the news feed uses `h4`, so no post there counts as suggested. Those feeds list what the person follows, so that is left as it is.
- The caret sat right of the house icon, its 20 by 20 box 28 pixels right of the icon's centre, and followed the Home cell when the top bar's layout changed. The menu opened under the Home cell and matched Facebook's look in dark mode. Facebook's Home link has `href="/"`.
- Picking Friends on the news feed loaded the Friends address, since the page had no link to it. With the left column's "See more" open, its "Feeds" link to `filter=all` was in the page, and picking Most recent moved there without a reload, saved `all` and turned the chevron blue. On a Feeds page every feed has a link, so every pick moved without a reload. With `all` saved, a real click on Home from the Friends feed landed on Most recent without a reload. Picking Home went to `/` and saved `home`.
- Two things were fixed after this check: Facebook's own Home tooltip showed beside "Choose feed" and stayed above the open menu, and the focus ring sometimes showed on the first entry of a menu opened by a click. A second check the same day, on the stories and feed work together, found only "Choose feed" over the caret, Facebook's Home tooltip back when the pointer moved from the caret onto the house icon, no focus ring on a menu opened by a click, and the ring on the entry reached with the arrow keys. On that run 9 of 15 posts were suggestions and 4 were ads, all 13 were hidden, and the badge showed 13. No post in view had a verified badge without a Follow button, so that fix has run only in the tests. Facebook redrew the top bar once while the menu was open, and the menu closed.

## The stories list

A look at the stories viewer on 2026-11-14, in Chrome 157, found:

- The viewer opens at `/stories/` and `/stories/<id>/...`. `pageContext` used to read `/stories/` as a profile, and now reads both as `stories`.
- The "All stories" list is a `div[role=navigation]` with no `aria-label`, at the left edge under the top bar, at 0,56 and 360 by 713 pixels. The page's two other navigation elements are in the top bar and have a label. The entries in the list are `div[role=button][id]`.
- A story paused every time the pointer moved onto the list, and played again when it left. Inside the navigation element, a React component named `StoriesSuspenseNavigationPanePauseContainer` has four handlers. `onMouseEnter` and `onFocus` call `requestPause(true, HOVER_ON_PAUSE_OVERLAY)`. `onMouseLeave` and `onBlur` call `requestPause(false, HOVER_ON_PAUSE_OVERLAY)` unless an internal flag is set. The pointer and focus share that one pause reason.
- React works out `onMouseEnter` and `onMouseLeave` from native `mouseout` events, where the element left is the target and the element entered is `relatedTarget`, and from `mouseover` only when the pointer comes from outside the document.
- A capture listener on `window` for `mouseover` that, for a pointer entering the list, queued a microtask sending `mouseout` from the event's target to the list's parent kept the story playing through every move onto the list, between entries and back, with no `pause` event. Stopping the native events instead left Facebook's tooltips stuck and its state out of step.

The built `stories_keep_playing` then ran on a video story, with the code loaded into the page on its own. The story kept playing with no `pause` event when the pointer moved from the story onto an entry, between entries, and from the empty area beside the story onto an entry. A move from the list's heading onto an entry gave one `pause` followed at once by a `play`. With the option switched off the story paused as Facebook makes it, and with the option on again it played.

Not checked on the live site: focus moving into the list, the pointer coming onto the list from outside the window, the list drawn again under a resting pointer, what sets the internal flag, and Firefox.

## Automatic feed refreshes

A look at automatic feed refreshes on 2026-11-21, in Chrome logged in to Facebook through Chrome DevTools MCP, found four refresh/redirect paths across Facebook's Comet modules:

- `useCometHomeStaleFeedRefresh` (mounted in `CometHomeContent.react` on the Home feed `/`): listens to `CometVisibilityUserActivityMonitor` (`Visibility.HIDDEN`/`VISIBLE`) and `CometUserActivityMonitor` (`window` `blur`, `Visibility.HIDDEN`, and `UserActivity`). On return it reads `CometFeedStalenessConstantsEntryPointVariables` live and refreshes the feed when hidden longer than `FEED_VISIBILITY_TIMEOUT` (120 000 ms, 2 minutes) or inactive longer than `FEED_STALE_TIMEOUT` (600 000 ms, 10 minutes). Swallowing global `visibilitychange` or `blur` would also break background video pausing (`useFBReelsPause`, `Sound`), desktop push notifications (`BrowserPushVisibilityChanger`) and Messenger presence (`usePresenceUnifiedActivityMonitor.react`).
- `useCometFeedPushViewCloseRefresh` (called by `useCometHomeStaleFeedRefresh` on `/`): scrolls to top and refreshes the Home feed when closing a photo/reel/post push view open longer than `FEED_STALE_PUSH_VIEW_TIMEOUT` (1 800 000 ms, 30 minutes). Its effect checks `FEED_STALE_PUSH_VIEW_TIMEOUT != null` and passes that value to `window.setTimeout`, so `null` skips it cleanly whereas `Infinity` would overflow to 0 ms.
- `useStaleSessionReturnToFeed` (`CometStaleSessionReturnToFeedManager.react`, active site-wide): navigates back to `/` with a toast when returning to a stale tab on 16 routes checked live through `CometReturnToFeedRouteUtils.isRouteEligible` (groups, group feed, group permalink, Marketplace, profiles, Watch, single posts, stories viewer, search results, saved, memories, friending and birthdays).
- `useGroupsCometCrossFeedRefresh` (on `/groups/feed/`, gated by `qex._("556")`, which was `true`): subscribes to `CometUserActivityMonitor` and calls its `refreshHandler` prop on return from inactivity. Facebook's `requireLazy` hands its unwrapped default function rather than its `{ default }` object, and callers read `defaultExport` in `require('__debug').modulesMap['useGroupsCometCrossFeedRefresh']`.
- The Feeds pages (`/?filter=friends&sk=h_chr` and siblings) render through `FeedsCometRoot.react` / `FeedsCometContent.react` and do not mount `useCometHomeStaleFeedRefresh`.

The built **installed Chrome MV3 extension** (`world: 'MAIN'` page-world script + isolated content script) was reloaded and checked live on `/groups/feed/` and `/?sk=h_nor` on 2026-11-21:

- On `/groups/feed/`: `FEED_STALE_TIMEOUT` and `FEED_VISIBILITY_TIMEOUT` were `Infinity`, `FEED_STALE_PUSH_VIEW_TIMEOUT` was `null`, `BADGE_STALE_TIMEOUT` stayed `600000`, `CometReturnToFeedRouteUtils.isRouteEligible` returned `false` for `comet.group`, `comet.groups.feed` and `comet.profile.timeline.list`, and both `defaultExport` and `exports.default` of `useGroupsCometCrossFeedRefresh` were wrapped, with zero console errors from Feed Sanity.
- On `/?sk=h_nor`: all staleness constants and `isRouteEligible` were patched on load. Switching `stop_feed_refresh` to `false` in extension storage restored `600000`, `120000`, `1800000` and `isRouteEligible('comet.group') === true` immediately with no reload, and switching it back to `true` re-applied them immediately.

## Top bar on narrow windows, Home rails

A look at the top bar across narrow viewports on 2026-11-22, in Chrome through Chrome DevTools MCP, found Facebook's responsive breakpoints in its own stylesheets:

- `>= 1380 px` (height `>= 790 px`): middle tab cells are 130 px wide.
- `1100–1379 px` (or height `<= 789 px`): cells shrink to `max-width: 111.6px`.
- `701–1099 px`: cells shrink with `max-width: calc(-55px + 15vw)` down to 50 px at 701 px (leaving only 6–17 px between the fifth tab and the right-side bar). The earlier `@container (width < 64px)` rule hid the caret below 793 px.
- `<= 700 px`: Facebook hides all five middle tabs (`display: none`), leaving 131–381 px open to the left of the right-side bar (`[role=banner] [role=navigation]:not(:has(ul)):has([role=button])`, four 40 by 40 circular buttons with 8 px gaps inside a `position: fixed; right: 0` container).

The updated installed Chrome MV3 extension was reloaded and checked live on `/?filter=friends&sk=h_chr` on 2026-11-22:

- At `750 px` (Home cell 55 px wide): the compact 16 by 16 caret sat at `(253, 20)` right beside the 24 px house icon (`229..253`), with no fallback button on the right.
- At `600 px` (Home cell `0 x 0`): the 40 by 40 circular Feed Sanity button appeared at `(337, 8)`, 8 px left of Facebook's first right-bar button at `x = 385`, matching its `rgba(255, 255, 255, 0.1)` background and `rgb(226, 229, 233)` icon colour. Clicking it opened the 280 by 297 Feeds menu at `(217, 53)` with all 6 entries.
- Widening back to `1400 px`: the fallback button disappeared and the 20 by 20 Home caret returned cleanly.

The installed Chrome MV3 extension was also checked live on 2026-11-22 for in-place Home feed switching, responsive Home rails, Home tab active/tooltip state, and right-rail Sponsored ad hiding (with `home_feed: "friends"` and ad hiding on):

- On `https://www.facebook.com/`: the URL stayed `https://www.facebook.com/`, chronological Friends posts loaded (`8m`, `9m`, etc.), Home kept `aria-current="page"` and showed the `"Home | Friends"` tooltip on hover, the Right Rail kept Birthdays visible, and the Sponsored unit (`CometHomeRightSideEgoContainer.react`) was hidden (`display: none`) after pre-hydration retry.
- On `https://www.facebook.com/?filter=friends&sk=h_chr`: the fixed Feeds `[role=navigation]` sidebar was hidden (`display: none`), `#feed_sanity_home_left_rail` mounted Facebook's native Home left rail at `(0, 56)` 360 by 713 px (19 links + shortcuts), `#feed_sanity_home_right_rail` mounted Facebook's native Home right rail at `(1332, 56)` 360 by 713 px (Birthdays visible, Sponsored hidden), `#feed_sanity_home_composer` rendered at `(506, 72)` 680 by 62 px, the Home tab carried `data-feed-sanity-home-active` and showed `"Home | Friends"` on hover, and resizing to `1000 x 800` hid only the left rail while `800 x 800` hid both rails with zero horizontal overflow.

Not checked yet: profile and Marketplace pages, the page of a single group, Facebook's light mode, Firefox, the userscript installed in a browser, and waiting out an actual 2-minute hidden-tab interval on `/` to observe the full end-to-end live silence.
