# Porting from Social Fixer 31.1.0

The original source is in `reference/social-fixer-31.1.0/`. Each part below is checked off once it has been ported to `src/` with tests.

## Rules

- Keep the original option keys (for example `external_css_url`), so a settings import from Social Fixer stays possible.
- Put anything that depends on Facebook's markup in `src/facebook/`. Features import it from there.
- The original translates Facebook's generated class names through its `S2F_` layer (`aargh_fb_gibberish`). Port that layer before any feature that uses `S2F_` selectors.
- Each ported feature gets a test next to it.

## Framework

- [ ] `x.js`: Zepto build plus utilities (publish/subscribe, storage, ajax, DOM helpers)
- [ ] `fx.js`: options, page lifecycle hooks, page context detection
  - [x] option registration, defaults, storage, change listeners (`src/core/options.ts`)
- [ ] `sfx.js`: build identity, cross-origin fetch through the background script, debug hooks
- [ ] `post_processor.js`: finding posts in the page and working out their IDs
- [ ] `vue_sfx.js`: Vue 1 directives and filters used by the dialogs
- [ ] `index.js`: startup
  - [x] per-user storage key from the `c_user` cookie (`src/facebook/user.ts`)
- [ ] `background.js`: cross-origin fetch for the content script

## Features

- [ ] aargh_fb_gibberish
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
