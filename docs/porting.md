# Porting from Social Fixer 31.1.0

The original source is in `reference/social-fixer-31.1.0/`. Each part below is checked off once it has been ported to `src/` with tests.

## Rules

- Keep the original option keys (for example `external_css_url`), so a settings import from Social Fixer stays possible.
- Put anything that depends on Facebook's markup in `src/facebook/`. Features import it from there.
- Every selector that depends on Facebook's markup goes in `src/facebook/selectors.ts`, so there is one file to fix when Facebook changes its pages.
- Selectors name Facebook's generated classes through `S2F_` names, as the original does. Add the declaration behind a new name to `src/facebook/atom-rules.ts`, and pass the selector through `page.atoms.translate` before using it.
- Marks that people can target from their own CSS keep Social Fixer's names: `sfx_post`, `sfx_id`, `sfx_removing` and the others in `MARK` in `src/facebook/selectors.ts`. IDs of elements that only this project uses get a `feed_sanity_` prefix.
- Declare features with `defineFeature` from `src/facebook/feature.ts`. Its `setup` receives `page`, which holds the posts, the class-name translator and `watch`. A test can pass a page of its own, wrapped with `bindPage`.
- Subscribe through what `setup` receives: `page`, `options` and `data`. Each feature has its own `scope`, and disposing it ends every subscription made there, so a feature does not keep the functions that stop them. Each subscription still returns one, to stop it early. Pass anything else that needs undoing to `scope.add`. For work that starts and stops while the feature runs, take `ctx.child()` and dispose its scope when the work stops, as `post_filters` does while no filter is set up.
- To find elements other than posts, such as videos or dialogs, use `page.watch(selector, { added, removed })`. Give it `attributes` to hear when those attributes change on a matching element. Do not create a `MutationObserver`: the content script shares one, in `src/core/page-watcher.ts`.
- A feature that one of its yes-or-no options switches on and off names that option in `enabledBy`. Its `setup` runs when the option turns on, and its scope is disposed when it turns off, with no page reload.
- Callbacks registered through `setup`'s context are guarded. A feature whose callbacks throw 10 times in a row, with no call between them that went through, is stopped and marked as failed. `FeatureRunner` in `src/core/app.ts` keeps each feature's state and error count.
- To act on posts, subscribe with `page.posts.onAdd`. Post detection does not run until something subscribes.
- Call `page.atoms.start()` before relying on translated selectors outside post detection, and translate again when `page.atoms.onChange` fires.
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
- [ ] `sfx.js`: build identity, cross-origin fetch through the background script, debug hooks
- [ ] `post_processor.js`: finding posts in the page and working out their IDs
  - [x] finding posts, Marketplace listings and posts in the comments popup (`src/facebook/posts.ts`)
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
- Facebook draws its own controls only on the video that is playing: two `[role=slider]` elements, for position and volume, and labelled buttons.
- A feed video is not inside a link. A `div[role=presentation]` lies over it and Facebook handles the click in script.
- Setting `currentTime` moved a playing video from 30 s to 49 s.
- A capture listener on `window`, added after the page had loaded, received a click on a feed video before Facebook did. With the event stopped there, the video paused, the address stayed the same and nothing opened.
- With the extension installed and the test build loaded in the same tab, the extension marked the posts first and the test build saw none. The installed extension had found and sorted 14 posts.

A watch for video ads the same day played 11 reels through in the reel viewer over 39 minutes, most of them two to five minutes long, and stepped quickly through 45 more. No ad appeared: no sponsored reel, no ad break, no second video and no ad label. Facebook's React data, which only a script in the page's own world can read, showed:

- Every reel has `isSponsored`, false on all 56, and `sponsored_data`, empty on all 56.
- The player has an `instreamVideoAdBreaksPlayer` object and an `adClientToken` field.

What these hold during an ad is not known.

After the page watcher and feature scopes went in, the test build ran alone on the news feed, started from `/saved/` where the installed extension does not run. All 27 posts were found and identified, the keyword "the" hid 17 of them, clearing the keyword removed the notes, the tab list and the style sheet, and a move to the groups feed and back kept everything in step.

Not checked for videos: an ad during a video, whether Facebook starts a paused video again when the page scrolls, whether its own play button follows a pause made from outside, and stories.

Not checked yet: profile and Marketplace pages, the page of a single group, Facebook's light mode, Firefox, and the extension or userscript installed in a browser.

## Not yet checked against Facebook

Apart from the checks above, the ported code has only run in unit tests. These parts copy what worked in 2023 and still need checking on the live site:

- the declarations in `src/facebook/atom-rules.ts` behind the seven names `Atoms` did not find
- the selectors in `src/facebook/selectors.ts` other than the feed position and the time link
- downloading stylesheets the page may not read. The original went through its background script. `Atoms` uses `fetch`, which depends on Facebook's servers allowing it.

One behaviour differs from the original on purpose:

- `findPostId` reads the page address only on a page whose address names one post (`singlePost` in `pageContext`). The original read it on every page, after trying React's data, so on an event page every post could get the event's number as its ID. Single photos, videos and reels do not count as single posts, so posts there get their ID from a link or the time link. Check these on the live site:
  - a reel on its own page, which may have neither and would then end with no ID
  - a photo or video in theater mode, where a link to an event inside a comment is tried before the time link
  - an event page, where a post that links to the event itself still gets the event's number from the first rule in `POST_ID_LINKS`

One behaviour is copied from the original and looks risky:

- A name with no class yet is left untranslated. Inside `:not()` it then excludes nothing, so `[role=article]:not(.S2F_pos_rel)` matches comments too until `pos_rel` is known. Post detection waits for the first stylesheet scan to narrow that window.

The dialog has not been checked in Facebook's light mode, or in Firefox.
