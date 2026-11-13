# Porting from Social Fixer 31.1.0

The original source is in `reference/social-fixer-31.1.0/`. Each part below is checked off once it has been ported to `src/` with tests.

## Rules

- Keep the original option keys (for example `external_css_url`), so a settings import from Social Fixer stays possible.
- Put anything that depends on Facebook's markup in `src/facebook/`. Features import it from there.
- Every selector that depends on Facebook's markup goes in `src/facebook/selectors.ts`, so there is one file to fix when Facebook changes its pages.
- Selectors name Facebook's generated classes through `S2F_` names, as the original does. Add the declaration behind a new name to `src/facebook/atom-rules.ts`, and pass the selector through `page.atoms.translate` before using it.
- Marks that people can target from their own CSS keep Social Fixer's names: `sfx_post`, `sfx_id`, `sfx_removing` and the others in `MARK` in `src/facebook/selectors.ts`. IDs of elements that only this project uses get a `feed_sanity_` prefix.
- Declare features with `defineFeature` from `src/facebook/feature.ts`. Its `setup` receives `page`, which holds the posts and the class-name translator. A test can pass a page of its own.
- To act on posts, subscribe with `page.posts.onAdd`. Post detection does not run until something subscribes.
- Call `page.atoms.start()` before relying on translated selectors outside post detection, and translate again when `page.atoms.onChange` fires.
- Each ported feature gets a test next to it.
- Give every element a feature adds inside one of Facebook's the `data-feed-sanity` attribute (`OWN` in `src/facebook/selectors.ts`). Its text is then left out of the post's, and adding it does not count as new content.
- Facebook empties posts that scroll out of view and refills them later, which discards anything a feature put inside. Subscribe with `page.posts.onUpdate` and put it back. It also fires for other new content, such as comments, so the listener must be safe to run again.
- Styles for Facebook's own elements go in the page with `addStyle` from `src/core/dom.ts`. UI the project draws itself goes in a shadow root with `mount`.
- Features must work in the userscript too. Reach browser APIs through `src/platform/`, which has an extension version and a userscript version of each one.

## Framework

- [ ] `x.js`: Zepto build plus utilities (publish/subscribe, storage, ajax, DOM helpers)
- [ ] `fx.js`: options, page lifecycle hooks, page context detection
  - [x] option registration, defaults, storage, change listeners (`src/core/options.ts`)
  - [x] watching for inserted and removed content (`watchTree` in `src/core/dom.ts`)
  - [x] page context from the address (`src/facebook/page.ts`)
  - [x] noticing navigation without a reload (`onUrlChange` in `src/core/navigation.ts`). The original patched `history.pushState` in the page and ignored addresses containing `theater`. This version compares the address when the document changes and ignores nothing.
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
  - [ ] the Filters and Data sections, and the link and action option types
- [ ] permalink_target
- [ ] photo_tags
- [ ] post_filters
  - [x] Hide Posts: hiding posts by keyword, with the note that stands in for a hidden post (`src/features/hide-posts/`). It keeps the original's option keys, the `filters_enabled` switches and the `sfx_filter_hidden` class names. Not ported: never hiding posts from Social Fixer's own page, and skipping hidden "Facebook" filler text.
  - [ ] the filter engine: rules, actions and tabs
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

Not checked yet: group, profile and Marketplace pages, and the comments popup.

## Not yet checked against Facebook

Apart from the news feed check above, the ported code has only run in unit tests. These parts copy what worked in 2023 and still need checking on the live site:

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
