# Porting from Social Fixer 31.1.0

The original source is in `reference/social-fixer-31.1.0/`. Each part below is checked off once it has been ported to `src/` with tests.

## Rules

- Keep the original option keys (for example `external_css_url`), so a settings import from Social Fixer stays possible.
- Put anything that depends on Facebook's markup in `src/facebook/`. Features import it from there.
- Every selector that depends on Facebook's markup goes in `src/facebook/selectors.ts`, so there is one file to fix when Facebook changes its pages. Each one is a locator: a name and a list of strategies, each with its selector and the date it was last seen working on the live site (`seen`). Declare it with `anyOf` when an element any strategy matches counts, or with `firstOf` when only the first strategy that finds anything is used. When Facebook changes its markup, add a strategy with the date it was seen, and keep the old ones while they may still match somewhere. Only this project's marks (`MARK`, `OWN`, `OWN_ELEMENT`) and plain attribute names stay as constants.
- Look elements up with `page.locate(LOCATOR)` and its `all`, `first`, `probe`, `matches` and `closest`. A lookup never throws: a strategy whose selector is not valid is logged once, counted and skipped. Each lookup is counted per locator and per strategy, and `Locators.stats()` in `src/core/locator.ts` reads the counts.
- The user can replace a locator's strategies without a new release: the saved value `locators` (`LOCATOR_OVERRIDES` in `src/facebook/feature.ts`) holds a list of selectors by locator name, such as `{ "post": ["[role=article]"] }`. It is read at startup and applied again whenever it changes. Unknown names and empty lists are ignored.
- Selectors name Facebook's generated classes through `S2F_` names, as the original does. Add the declaration behind a new name to `src/facebook/atom-rules.ts`. A strategy that uses a name whose class is not known yet is skipped, and it runs once the class is known. It never runs with the name left in, which inside `:not()` would exclude nothing. The first lookup starts the stylesheet scan. CSS text and the selectors in the user's filters still go through `page.atoms.translate`, which leaves an unknown name in place.
- Marks that people can target from their own CSS keep Social Fixer's names: `sfx_post`, `sfx_id`, `sfx_removing` and the others in `MARK` in `src/facebook/selectors.ts`. IDs of elements that only this project uses get a `feed_sanity_` prefix.
- Declare features with `defineFeature` from `src/facebook/feature.ts`. Its `setup` receives `page`, which holds the posts, `locate`, the class-name translator and `watch`. A test can pass a page of its own, wrapped with `bindPage`.
- Subscribe through what `setup` receives: `page`, `options` and `data`. Each feature has its own `scope`, and disposing it ends every subscription made there, so a feature does not keep the functions that stop them. Each subscription still returns one, to stop it early. Pass anything else that needs undoing to `scope.add`. For work that starts and stops while the feature runs, take `ctx.child()` and dispose its scope when the work stops, as `post_filters` does while no filter is set up.
- To find elements other than posts, such as videos or dialogs, as they come and go, use `page.watch(page.locate(LOCATOR), { added, removed })`. It looks again by itself when class names or the user's selectors change. Give it `attributes` to hear when those attributes change on a matching element. Do not create a `MutationObserver`: the content script shares one, in `src/core/page-watcher.ts`.
- A feature that one of its yes-or-no options switches on and off names that option in `enabledBy`. Its `setup` runs when the option turns on, and its scope is disposed when it turns off, with no page reload.
- Callbacks registered through `setup`'s context are guarded. A feature whose callbacks throw 10 times in a row, with no call between them that went through, is stopped and marked as failed. `FeatureRunner` in `src/core/app.ts` keeps each feature's state and error count.
- To act on posts, subscribe with `page.posts.onAdd`. Post detection does not run until something subscribes.
- To act on videos, subscribe with `page.videos.onAdd` and `onRemove` (`Videos` in `src/facebook/videos.ts`). Nothing looks for videos until something subscribes. Each `Video` has its `<video>` element, the `container` Facebook wraps it in (the video's parent when there is no wrapper), its `surface` (`feed`, `reel` or `other`) and `controls()`, Facebook's buttons, sliders and links in the player, each marked `bar` when it is a slider running from side to side. Measure them to know where they are: Facebook keeps them in the page after they fade out, and a reel's position slider lies outside its card. `onControls` reports when they may have moved: one of Facebook's sliders came to the video or left it, the element was emptied to be given another video, or the video first played since it was loaded. `container` and `surface` are looked up each time they are read, because Facebook can move a video. `page.videos.around(element)` gives the video something drawn over it belongs to. Anchor video features on what Facebook cannot rename: the `<video>` element, roles and geometry.
- UI that belongs on one of Facebook's elements, such as a video, goes over it with `mountOverlay(target, ui, { container, css })` from `src/ui/overlay.tsx`. The host goes inside Facebook's own tree as the last child of `container`, so it scrolls with the target and stays under Facebook's sticky header and dialogs. Its place and size are measured only when the target, the container or the host's containing block changes size, or when the returned function's `measure()` asks for it. An `onMeasure` callback runs while the overlays are being read, so UI that has to fit around Facebook's elements can measure them there without forcing extra layouts. The host takes no pointer events: give the parts that should take them `pointer-events: auto`. Presses, clicks and keys inside it stop at the host. It carries `data-feed-sanity`, it is put back if Facebook removes it while the target stays, and the function it returns removes it, for `scope.add`.
- Hide one of Facebook's elements only where the feature puts something of its own in its place, and only while that is there: `post_filters` hides a post's content behind its note, and `video_scrubber` hides Facebook's position bar in the reel viewer while the scrubber stands in for it. Mark the element with a class or attribute declared in `src/facebook/selectors.ts` (`MARK.hidden`, `STOOD_IN_FOR`), hide what carries the mark with a rule in a style sheet from `addStyle` tied to the feature's scope, and set no inline styles on Facebook's elements. Undo it whenever the stand-in goes, so nothing of Facebook's is hidden with nothing in its place. The reel viewer's bar is hidden because the bottom of a reel is crowded with captions and buttons, and the band Facebook keeps for its bar is the one clear place for the scrubber's strip. Facebook already lets the bar sit over its corner buttons there, and the strip does the same.
- To take an event before Facebook sees it, use `intercept(scope, types, handler)` from `src/core/intercept.ts`. It listens on `window` in the capture phase, and a handler that returns true stops the event there. Settle on the first event of a press whether to take it, and take the rest of that press too, so Facebook never sees half of one. A listener on `window` that the page added earlier still hears the event first; none of Facebook's did on 2026-11-14.
- Locators need nothing more. For CSS text with `S2F_` names, call `page.atoms.start()` and translate again when `page.atoms.onChange` fires. To redo work when a locator may find something different, subscribe with its `onChange`.
- Each ported feature gets a test next to it.
- Read a post's text and parts from `post.content`, not `post.element`. They are the same element except in the comments popup, where `element` is the popup and `content` is the post inside it. `postText`, `postElements` and `readPostFields` in `src/facebook/` leave the comments out.
- Give every element a feature adds inside one of Facebook's the `data-feed-sanity` attribute (`OWN` in `src/facebook/selectors.ts`). Its text is then left out of the post's, and adding it does not count as new content.
- Facebook empties posts that scroll out of view and refills them later, which discards anything a feature put inside. Subscribe with `page.posts.onUpdate` and put it back. It also fires for other new content, such as comments, so the listener must be safe to run again.
- Styles for Facebook's own elements go in the page with `addStyle` from `src/core/dom.ts`. UI the project draws itself goes in a shadow root with `mount`. Both return a function that removes what they added, for `scope.add`.
- Saved data that is not an option, such as a list the user builds, goes through `data.value(name, read)` in `setup`. Keep Social Fixer's name for it (`filters`), so an import stays possible.
- A feature that needs more in the options dialog than a list of options declares a panel with `definePanel` from `src/ui/options-dialog/panel.ts` and adds it in `src/features/index.ts`. The dialog saves and drops the panel's edits with its own.
- Features must work in the userscript too. Reach browser APIs through `src/platform/`, which has an extension version and a userscript version of each one.

## Framework

- [ ] `x.js`: Zepto build plus utilities (publish/subscribe, storage, ajax, DOM helpers)
- [ ] `fx.js`: options, page lifecycle hooks, page context detection
  - [x] option registration, defaults, storage, change listeners (`src/core/options.ts`)
  - [x] watching for inserted and removed content (`PageWatcher` in `src/core/page-watcher.ts`). One `MutationObserver` serves the whole content script: `watchTree` reports each added and removed subtree, and `watch` the elements that match a selector.
  - [x] page context from the address (`src/facebook/page.ts`)
  - [x] noticing navigation without a reload (`onUrlChange` in `src/core/navigation.ts`, run by the page watcher). The original patched `history.pushState` in the page and ignored addresses containing `theater`. This version compares the address when the document changes, and listens for the Navigation API's `currententrychange` where the browser has it. It ignores nothing.
  - [x] running features (`FeatureRunner` in `src/core/app.ts`): each one gets a scope that ends what it subscribed to, an `enabledBy` option switches it on and off without a reload, and one whose callbacks keep throwing is stopped
  - [ ] looking up a group's name when the address has its number
  - [x] finding Facebook's elements through locators (`Locators` in `src/core/locator.ts`, with the definitions in `src/facebook/selectors.ts`). Not in the original, which kept one selector string for each element. Each strategy records when it was last seen working, strategies wait for their class names, lookups are counted, and the user can replace a locator's selectors without a reload.
- [ ] `sfx.js`: build identity, cross-origin fetch through the background script, debug hooks
- [ ] `post_processor.js`: finding posts in the page and working out their IDs
  - [x] finding posts, Marketplace listings and posts in the comments popup (`src/facebook/posts.ts`). It looks at the page at once with the strategies that need no class names, and again whenever the locators change. A post found early is marked and not counted again. Each ID lookup waits for the first stylesheet scan, so IDs and what features read from a post do not depend on how early it was found.
  - [x] IDs from the page address, from links in the post and from hovering the time link (`src/facebook/post-id.ts`)
  - [ ] IDs from React's data on the post's elements. A content script cannot see that data. It needs a script running in the page's own world that passes the IDs back.
  - [ ] pausing post loading after `max_post_load_count` posts
- [x] `vue_sfx.js`: Vue 1 directives and filters used by the dialogs. Replaced by components written with React's API and run on Preact; see `src/ui/`.
- [ ] `index.js`: startup
  - [x] per-user storage key from the `c_user` cookie (`src/facebook/user.ts`)
- [ ] `background.js`: cross-origin fetch for the content script

## Features

- [x] aargh_fb_gibberish (`src/facebook/atoms.ts`, `src/facebook/atom-rules.ts`)
- [ ] apps
- [ ] bubble_note
- [ ] comment_button
- [ ] comment_navigator
- [ ] control_panel
- [ ] debug
- [ ] debugger
- [ ] disable_tooltips
- [ ] display_tweaks
- [ ] donate
- [ ] edit_buffer
- [ ] esc_service
- [x] external_css (`src/features/external-css/`)
- [ ] fb_dtsg
- [ ] font_family
- [ ] friend_manager
- [ ] hide
- [ ] logging
- [ ] login_page
- [ ] mark_read
- [ ] menu
- [ ] messages
- [ ] most_recent
- [ ] notify
- [ ] options
  - [x] the dialog: every registered option by section, search, Save and Cancel (`src/ui/options-dialog/`)
  - [x] opening it from the toolbar button (extension) or the userscript manager's menu
  - [ ] opening it from Social Fixer's badge menu on the page, which comes with the `menu` port
  - [x] multi-line text options, used for the Hide Posts keywords
  - [x] the Filters section: the filter list and the filter editor, as a panel a feature draws itself (`src/features/post-filters/filters-panel.tsx`). Not ported: filter subscriptions, which came from Social Fixer's server
  - [ ] the Data section, and the link and action option types
- [ ] permalink_target
- [ ] photo_tags
- [x] post_filters (`src/features/post-filters/`)
  - [x] Hide Posts: hiding posts by keyword, with the note that stands in for a hidden post. The keywords run as the first filter. It keeps the original's option keys, the `filters_enabled` switches and the `sfx_filter_hidden` class names. Not ported: never hiding posts from Social Fixer's own page, and skipping hidden "Facebook" filler text.
  - [x] rules: every target and operator of the original, `contains_selector` with its `:contains`, `:has-visible-text` and `:hidden-within` extras, and the `day` and `age` rules. Filters are saved in Social Fixer's format under its `filters` name. The `page` target is always empty, because it needs React's data on the post.
  - [x] actions: hide, unhide, add CSS, add a class, replace text, move to tab and copy to tab, with `$1` and `${field}` variables in notes and tab names
  - [ ] the `read` and `unread` actions, which come with the `mark_read` port
  - [x] tabs (`post_tabs.js`): the `sfx_filter_tab_<n>` classes and a list of the tabs in a corner of the page. The original kept the list in its control panel. Not ported: choosing a starting tab that has posts in it, and the counts of read posts.
  - [ ] the filter debugger and the `filter_forced_visible_style` option
  - Different from the original on purpose: a post is filtered again whenever Facebook adds content to it, and every post is filtered again when the filters or their settings change, so no page reload is needed. What a filter did is undone first. Replaced text is the exception and stays until Facebook draws the post again. A rule that cannot be tested, such as a broken regular expression, counts as not matching; the original ignored it. A text rule with nothing to look for never matches; in the original it matched every post. A post the page is about is left out of the tabs, so a filter cannot sort it out of view.
- [ ] post_font
- [ ] regex_tester
- [ ] sfx_collision
- [ ] stats
- [ ] stay_on_page
- [ ] sticky_note
- [ ] storage_check
- [ ] subscriptions
- [ ] unread_messages

## Features new in this project

These have no counterpart in Social Fixer. They have run in unit tests and in the end-to-end tests on a page that copies the markup recorded under "A look at videos on 2026-11-14". On the live site, a click on a feed video paused it in place with no viewer, Facebook's own play button followed, and the overlays went into `[data-video-id]` with no errors from Facebook's scripts. A second check found the strip in the free band under a feed video's control row, with clicks and drags seeking correctly, and the pause holding through a scroll away and back until Facebook's own play button started the video. Taking the place of the reel viewer's bar was tried there by hand before it was built: with the outermost element around the bar that has its box hidden, the strip took the pointer across the whole band, corners included, and a click at its middle moved a 115 s reel to 58 s. A third check ran the built version in the reel viewer: the strip took the bar's place with 8 pixel insets, a click at its middle moved a 90 s reel to about half, three moves to the next reel and one back each left one hidden bar and one strip, and turning the option off brought Facebook's bar back at once.

- [x] video_scrubber (`src/features/video-scrubber/`): a thin bar on every video showing what has played and what has loaded. Its 12 pixel strip along the bottom edge always takes the pointer, and the bar grows upward from it when the pointer comes onto it, with the time and length beside it and the time under the pointer in a bubble. A click or a drag moves the video, and a drag seeks only once the last seek has finished. Left and right move it 5 seconds and Home and End go to the ends; the bar is a `slider` for assistive technology. A video whose length is not known yet, and a live video, get no bar, and nor do videos less than 120 pixels wide. The strip is placed from where Facebook's own controls are on the screen. Where a slider of Facebook's at least half as wide as the video lies over the bottom edge, as the reel viewer's position bar does, the strip takes its place between the bar's ends, and Facebook's bar is hidden (the outermost element around it with its box that holds no other control) for as long as the scrubber shows on that video. Otherwise the strip runs from side to side and keeps clear of any control in its band; under a feed video's control row nothing is in it. It is measured when it is put on the video, when the video changes size, when Facebook's sliders come or go, and when the video first plays.
- [x] video_click_pauses (`src/features/video-click-pauses/`): a plain click on the picture of a video in a post pauses it or plays it again, where Facebook would open it in a viewer. Clicks on Facebook's player controls, links and this project's UI, presses of other buttons and presses with a modifier key go to Facebook. The second click of a double click goes to Facebook too, so a double click opens the viewer. A press that starts on the picture is kept from Facebook as a whole, so one that turns into a drag does nothing. Videos in the reel viewer and anywhere else are left alone. A video paused this way stays paused: Facebook starts a video again when it scrolls back into view, and if nothing the person pressed or typed inside the video's container in the second before started it, it is paused again. It is let go when the person starts it or double-clicks it to open the viewer, when its element is emptied or given another video, when it leaves the page, and after Facebook has started it more than three times in ten seconds.

## Checked against Facebook

A live check on 2026-11-13, logged in to the news feed in Chrome, found:

- Generated class names still look like `x9f619`. `Atoms` found 102 of the 109 names, including all 25 that `src/facebook/selectors.ts` uses. Missing: `bb_bt2`, `bbl_rad10`, `bbl_rad50`, `bbl_radcrd`, `font_bold`, `list_none`, `wid_panel`.
- All 13 stylesheets could be read, so nothing had to be downloaded.
- Feed posts carry `aria-posinset` and are found. Facebook empties feed slots that scroll out of view and fills them again when they come back, so `Posts` waits for a slot to have content. A post that Facebook empties and refills keeps its marks but is not announced again, so a feature that adds things inside a post will need to add them again after a refill.
- The 2023 time-link selector matched nothing. The current time link is `a[role=link][aria-labelledby][aria-describedby]`, and its address already holds the post's ID: 10 of 19 posts, all with different IDs. The others were sponsored posts, which have no such link, and empty slots. Running the ported code on the feed marked all 22 slots that had content; 17 got an ID, all different. The 5 without one were sponsored posts, and hovering their links did not reveal an address.
- Facebook's colour variables (`--card-background`, `--primary-text` and the rest) are set, in dark mode as well.

The options dialog was opened on the same page over sample options. It used Facebook's dark colours and font, opened as a modal above everything else on the page, and took focus. Keys typed into it reached its search box and not Facebook: nothing scrolled or moved focus, and listeners on the document saw none of them. Listeners on `window` in the capture phase still see the keys, so a Facebook shortcut that listened there would fire; none did. In a search box that holds text, the first Escape clears the box and the second closes the dialog, as in any Chrome dialog.

Keyword hiding ran on the same feed twice with the keyword "the". On the second run 16 of 28 posts were hidden, each collapsed to a one-line note 21 px high. Clicking a note showed the post and clicking again hid it. After scrolling far down and back, every hidden post still had exactly one note. Turning notes off, hiding the matched word, whole-word matching, clearing the keywords and turning filtering off all took effect at once, and the posts were hidden again when the keywords were set again. Turning notes off also collapsed a post that had been revealed. Today's feed posts contain no `<form>`, and their Like, Comment and Share buttons carry no text, so those words are not matched. The original skips hidden "Facebook" filler text inside posts. No post had any, so that check is not ported. Every fifth feed slot, the sponsored ones, already had zero height in the test browser before this project touched it, so a note placed in one of them cannot be seen.

The filter engine ran the same day on the news feed, on the groups feed and on a post opened in the comments popup.

- On the news feed the author was found for all 15 posts. One filter copied posts with a photo description to a tab and another moved posts with a video to a second tab, and the keyword notes kept working beside them. The tab list showed each tab with its count, and clicking a tab showed only its posts.
- Changes to the filters and options took effect on the posts already on the page. Turning filtering off removed every class, note and style, and the tab list.
- Going from the news feed to the groups feed inside the page found 34 posts. The group's name was found for all 27 that still had content when they were sampled.
- In the popup the tracked element is the dialog. The post is an article inside it with no label, and each comment is an article inside the post labelled "Comment by ...". The author was found there, and a hidden post got its note and stayed visible.
- Opening a post in the popup changes the address to the post's own, which counts as a page or profile. Filters run there only when "Filter on pages and profiles" is on, as in the original.
- No feed post had an `l.php` link or an `abbr[data-utime]`, so the link rules and the age rule have nothing to match on today's feed.
- The options dialog showed the filter list and the filter editor over the live page.

Facebook's pages do not allow `eval`, but they allow scripts from `blob:` addresses. The test build was loaded that way, from a file put in a file input. The steps are in `.claude/skills/live-facebook-check/SKILL.md`.

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

After the page watcher and feature scopes went in, the test build ran alone on the news feed, started from `/saved/` where the installed extension does not run. All 27 posts were found and identified, the keyword "the" hid 17 of them, clearing the keyword removed the notes, the tab list and the style sheet, and a move to the groups feed and back kept everything in step.

After the locators went in, the test build ran alone on the news feed again. All 16 posts were found, 13 with an ID, 2 with none and 1 still being looked up; no comment was taken for a post; and Chrome reported no selector as invalid. A saved override that gave `post` the selectors `[unclosed` and `div:not(` was reported once for each and skipped, and removing the override brought the built-in strategies back, all without a reload.

A video paused from outside starts again when it scrolls out of view and back, because Facebook plays videos that come into view. Its own play button does follow a pause made from outside.

Not checked for videos: an ad during a video, stories, and anything in Firefox.

Not checked yet: profile and Marketplace pages, the page of a single group, Facebook's light mode, Firefox, and the extension or userscript installed in a browser.

## Not yet checked against Facebook

Apart from the checks above, the ported code has only run in unit tests. These parts copy what worked in 2023 and still need checking on the live site:

- the declarations in `src/facebook/atom-rules.ts` behind the seven names `Atoms` did not find
- the strategies in `src/facebook/selectors.ts` whose `seen` date is still 2023
- downloading stylesheets the page may not read. The original went through its background script. `Atoms` uses `fetch`, which depends on Facebook's servers allowing it.

One behaviour differs from the original on purpose:

- `findPostId` reads the page address only on a page whose address names one post (`singlePost` in `pageContext`). The original read it on every page, after trying React's data, so on an event page every post could get the event's number as its ID. Single photos, videos and reels do not count as single posts, so posts there get their ID from a link or the time link. Check these on the live site:
  - a reel on its own page, which may have neither and would then end with no ID
  - a photo or video in theater mode, where a link to an event inside a comment is tried before the time link
  - an event page, where a post that links to the event itself still gets the event's number from the first rule in `POST_ID_LINKS`

The dialog has not been checked in Facebook's light mode, or in Firefox.
