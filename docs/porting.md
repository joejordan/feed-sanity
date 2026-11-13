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
- [ ] `vue_sfx.js`: Vue 1 directives and filters used by the dialogs
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
- [ ] permalink_target
- [ ] photo_tags
- [ ] post_filters
- [ ] post_font
- [ ] regex_tester
- [ ] sfx_collision
- [ ] stats
- [ ] stay_on_page
- [ ] sticky_note
- [ ] storage_check
- [ ] subscriptions
- [ ] unread_messages

## Not yet checked against Facebook

The ported code has only run in unit tests. These parts copy what worked in 2023 and need checking on the live site:

- the shape of a generated class name (`ATOM` in `src/facebook/atoms.ts`)
- the declarations in `src/facebook/atom-rules.ts`
- every selector in `src/facebook/selectors.ts`
- downloading stylesheets the page may not read. The original went through its background script. `Atoms` uses `fetch`, which depends on Facebook's servers allowing it.

One behaviour differs from the original on purpose:

- `findPostId` reads the page address only on a page whose address names one post (`singlePost` in `pageContext`). The original read it on every page, after trying React's data, so on an event page every post could get the event's number as its ID. Single photos, videos and reels do not count as single posts, so posts there get their ID from a link or the time link. Check these on the live site:
  - a reel on its own page, which may have neither and would then end with no ID
  - a photo or video in theater mode, where a link to an event inside a comment is tried before the time link
  - an event page, where a post that links to the event itself still gets the event's number from the first rule in `POST_ID_LINKS`

One behaviour is copied from the original and looks risky:

- A name with no class yet is left untranslated. Inside `:not()` it then excludes nothing, so `[role=article]:not(.S2F_pos_rel)` matches comments too until `pos_rel` is known. Post detection waits for the first stylesheet scan to narrow that window.
