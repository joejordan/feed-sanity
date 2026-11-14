# Release notes

Feed Sanity is a rewrite of Social Fixer for Facebook 31.1.0, the browser extension by Matt Kruse, whose last official release came out on 2023-09-08. These notes cover everything done since the fork: the fork itself, the rewrite, the parts ported so far, the core work that the original did not have, and the features that are new.

Nothing has been published yet. The version in `package.json` is still 0.0.0, and this document describes the `master` branch as of 2026-11-14.

## Summary

- One TypeScript codebase builds a Firefox extension, a Chrome extension and a userscript.
- Post detection, class-name translation, the options dialog, post filters and external CSS are ported and work on today's Facebook.
- Selectors are named locators with fallbacks. A person can replace one from the options dialog when Facebook changes its markup, without waiting for a release.
- A Diagnostics section shows what every feature and selector found on the page and copies a report that holds nothing personal.
- New features: a video scrubber, click to pause, a save button for videos, the same three in stories, stories that keep playing while the pointer is on the story list, hiding suggested posts, hiding ads, and a feed menu on the Home button.
- 697 unit tests and 45 end-to-end tests pass. Live checks ran in Chrome only. Firefox has not been tested.

## The fork

- Social Fixer 31.1.0 was imported unmodified and tagged `upstream-31.1.0`. It now lives in `reference/social-fixer-31.1.0/` and is read while porting. Nothing in the builds comes from it.
- The project was renamed Feed Sanity. It is a separate project from Social Fixer and is not published under that name.
- The licence is MPL 1.1.
- The Firefox add-on has its own ID.
- Option keys, the saved `filters` format and the marks that people target from their own CSS (`sfx_post`, `sfx_id`, `sfx_filter_hidden` and the rest) keep Social Fixer's names, so a settings import from Social Fixer stays possible. The import itself is not written yet.

## The rewrite

The original is plain JavaScript built on a Zepto build and Vue 1.

- The code is TypeScript 7 in strict mode.
- One source tree builds three things: a Firefox extension (manifest version 2), a Chrome extension (manifest version 3) and a userscript for Greasemonkey, Tampermonkey and Violentmonkey. The extensions are built with WXT and the userscript with Vite.
- The code is in layers. `src/core` knows nothing about Facebook. `src/facebook` holds everything that depends on Facebook's markup. `src/platform` has an extension version and a userscript version of each browser API. Each feature has its own folder under `src/features`, with its tests beside it.
- The dialogs are components written with React's API and run on Preact, which keeps the builds small. Everything the project draws goes in a shadow root, so Facebook's styles and the project's do not reach each other.
- Biome lints and formats. Vitest runs the unit tests on happy-dom. Playwright loads the built Chrome extension and runs it against pages that copy Facebook's recorded markup.
- GitHub Actions checks and builds on every push and pull request. Commit messages are checked with commitlint.

## Ported from Social Fixer

- Translation of Facebook's generated class names (`aargh_fb_gibberish`). On 2026-11-13 it found 102 of the 109 names, including every one the selectors use.
- Post detection for feed posts, Marketplace listings and posts in the comments popup, and post IDs from the page address, from links in the post and from hovering the time link. The 2023 selectors for the time link no longer matched, so these were rewritten for today's markup.
- The options store, with a storage key for each Facebook user, and the options dialog: every option by section, a search box, Save and Cancel. It opens from the toolbar button in the extensions and from the userscript manager's menu.
- Post filters:
  - Hide Posts, which hides posts by keyword and leaves a one-line note that shows the post when clicked.
  - Every rule target and operator of the original, including the selector rules and the day and age rules.
  - The actions hide, unhide, add CSS, add a class, replace text, move to tab and copy to tab.
  - Tabs, with a list of the tabs and their counts in a corner of the page.
  - The filter list and the filter editor in the options dialog.
- External CSS.

Two behaviours differ from the original on purpose:

- Filters run again whenever Facebook adds content to a post, and on every post when the filters or their settings change. No page reload is needed.
- A post's ID is read from the page address only on a page whose address names one post. The original read it on every page, so on an event page every post could get the event's number.

Not ported yet: marking posts read, the badge menu on the page, the control panel, display tweaks, the comment tools, the friend manager, sticky notes, filter subscriptions, the filter debugger, the Data section of the dialog and the rest of the unchecked list in [porting.md](porting.md).

## Core work the original did not have

### One page watcher and a scope for each feature

- The whole content script shares one `MutationObserver`. Features ask it for the elements that match a locator as they come and go.
- Navigation inside the page is noticed by comparing the address, with the Navigation API as a second signal. The original patched `history.pushState` in the page.
- Each feature gets a scope. Disposing the scope ends everything the feature subscribed to, so a feature can be switched on and off from its option with no page reload.
- A feature whose callbacks throw 10 times in a row is stopped and marked as failed. The other features keep running.

### Locators

- Every selector that depends on Facebook's markup is in one file, `src/facebook/selectors.ts`. Each is a named locator with a list of strategies, and each strategy records the date it was last seen working on the live site.
- A strategy that needs a class name that has not been found yet waits for it. A selector the browser rejects is logged once and skipped. Lookups never throw.
- Every lookup is counted for each locator and each strategy.
- A person can replace a locator's selectors from the options dialog. The change applies at once, with no release and no reload.

### Diagnostics and the toolbar badge

- The Diagnostics section of the options dialog shows the version and build, the page type, each feature's state with its error count and last error, how many posts are tracked, how many class names are known, and what every locator strategy has found. Locators that keep finding nothing are listed first.
- Copy report copies all of that as text for a bug report. It holds no user ID, names, post text or page addresses.
- The toolbar button shows how many posts are hidden on the tab, or an exclamation mark when a feature has failed.

### The bridge to the page's own script world

- A content script cannot see the data Facebook's scripts keep on elements, such as React's. A small script in the page's own world reads it for the content script.
- That script holds only named readers. The content script asks about an element through events on it, on a channel whose names are random for each page load, and checks every answer before using it. Addresses must be `https:` on `facebook.com` or `fbcdn.net`.
- It reads a video's file address and whether a feed post is an ad.

### Building blocks for features on Facebook's own elements

- Video tracking: every `<video>` with its wrapper, the surface it is on (feed, reel, story or other) and Facebook's own controls.
- Overlays: UI mounted inside Facebook's tree on the element it belongs to, so it scrolls with the element and stays under Facebook's header and dialogs.
- Event interception: a press is taken before Facebook sees it, as a whole press or not at all.
- Standing in: one of Facebook's elements is hidden only where the project puts something of its own in its place, and only while that is there.

### Testing on the real site

- A skill in `.claude/skills/live-facebook-check/` loads a test build into a logged-in Facebook tab without installing the extension. Each live check is written into [porting.md](porting.md) with its date and its counts.

## New features

These have no counterpart in Social Fixer.

### Videos

- Video scrubber. A thin bar along the bottom of every video shows what has played and what has loaded. It grows when the pointer comes onto it, shows the time under the pointer, and a click or a drag moves the video. In the reel viewer it takes the place of Facebook's own position bar.
- Click to pause. A click on a video in a post pauses it or plays it again, where Facebook would open it in a viewer at full volume. A double click still opens the viewer. A video paused this way stays paused when it scrolls out of view and back.
- Save button. A button in the top left corner of a video saves the video's file as `facebook-video-<id>.mp4`. Its tooltip is styled like those of Facebook's player controls.

### Stories

- The scrubber and the save button work on video stories. The scrubber runs along the bottom edge of the story, and the save button sits under the avatar.
- A click on a story, video or photo, pauses it and a second click plays it again. It presses the story's own pause button, so Facebook's timer and progress bar stay in step. A click on the left third pauses too, where Facebook would go back a story. Facebook's own next and previous buttons work as before.
- Stories keep playing while the pointer is on the list of stories at the left. Facebook pauses the story for as long as the pointer or keyboard focus is in that list.

### The feed

- Hide suggested posts, on by default. Posts that Facebook suggests from pages, people and groups you do not follow, the ones with a Follow or Join button by the name, collapse to a note that shows the post when clicked. A friend's share of such a post stays. On the news feed checked on 2026-11-14, 25 of 45 posts were suggestions.
- Hide ads, off by default. Sponsored posts are told apart by Facebook's own data on the page, read through the bridge, and never by the word "Sponsored". Where that data cannot be read, nothing is hidden. On the same feed, all 5 ads among the 45 posts were hidden and nothing else was.
- Both run as built-in filters, and the filter editor can test for them in filters you write yourself.
- Home feed. A caret beside the Home button opens a menu of Facebook's feeds: Home, Friends, Favorites, Groups, Pages and Most recent. Picking one goes there and saves the choice, and from then on the Home button, the logo and a fresh load of facebook.com lead to that feed. Picking Home gives Facebook's own feed back. The menu is styled like Facebook's own menus, and the caret can be switched off.
- The Friends feed is the desktop version of the friends-only feed in Facebook's mobile app. Facebook serves it at an address of its own, so nothing has to be filtered to get it.
- Options can now be a choice from a list, drawn as a select in the dialog.

## How it was checked

- 697 unit tests and 45 end-to-end tests pass, along with the type check, the lint and all three builds.
- Live checks ran in Chrome 157 on Windows 11, logged in, in dark mode, on the news feed, the groups feed, the Feeds pages, the comments popup, the reel viewer and the story viewer. [porting.md](porting.md) has the records.

Not checked yet:

- Firefox, in any form. The bridge needs Firefox 128 or later, and the manifest does not say so yet.
- The extension or userscript installed in a browser. The live checks loaded a test build into the page.
- Facebook's light mode, profile pages, Marketplace and the page of a single group.
- Saving a video from start to finish on the live site. A request for the first kilobyte of a video file was allowed.
- Whether saving a story's video is visible to the person who posted it. No mechanism for that is known, and it has not been tested with a second account.
- A post in a group from someone who is not a friend. If Facebook puts a Follow button in its heading, it would be hidden as a suggestion.
- A verified page you follow. The verified badge was first taken for a Follow button. That is fixed and tested, but no such post was in view during the live checks.

## Known gaps

- Video ads are not filtered. A 39 minute watch of 56 reels showed no ad, so there is nothing recorded to build on yet.
- A post waits for its ID before filters see it, which for an ad takes about a second.
- Picking a feed from the news feed reloads the page, because Facebook has no link to that feed there. From a Feeds page the move happens in the page.
- The video features have their own copies of the tooltip and press helpers that the feed menu now shares from `src/ui/tooltip.ts` and `src/core/intercept.ts`.
- The selector for a post's comment area is out of date. Diagnostics found it.
- There is no settings import from Social Fixer yet.
