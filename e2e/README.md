# End-to-end tests

These tests load the built Chrome extension (`.output/chrome-mv3`) into Playwright's Chromium and run it on pages that stand in for Facebook. They catch packaging mistakes the unit tests cannot see: a content script that does not start, a broken manifest, settings that do not reach the page, or a toolbar button that does not open the dialog.

## What they cover

- The content script starts on `https://www.facebook.com/` and applies a saved option.
- Posts in the feed are found and get their IDs from the time link. Comments are not taken for posts.
- A keyword saved before the page loads hides the posts that contain it behind a note, and clicking the note shows the post. A filter saved under `<user>/filters` hides posts too.
- A keyword changed in storage while the page is open takes effect without a reload.
- A post added after load is filtered, and a post that the page empties and fills again gets its note back.
- The toolbar button's click event opens the options dialog, and a setting saved in the dialog reaches extension storage.
- After a move to another page with `history.pushState`, the posts on the new page are found.
- On `pages/videos/`, which plays a short clip in two feed posts and a reel, each video gets a scrubber that takes the click over the layer the page lays across the video, and a click or a key on it moves the video. On a feed video the strip runs along the bottom edge, under the page's own control row, and on the reel it takes the place of the wide bar outside the card, which is hidden until the scrubber is switched off; the page's other controls still take their clicks. A click on the picture pauses and plays a feed video without opening the page's viewer, the video stays paused when the page starts it from script, and the page's own play button starts it. A double click opens the viewer. Switching the scrubber off removes it without a reload, and with both video options off a click opens the viewer as before.
- On the same page, each video's `<video>` element carries a fake React fiber chain with the player's props 12 steps up, as Facebook's does. Only a script in the page's own world can see it, so these tests run the page-world bridge end to end: the extension's `world: 'MAIN'` content script reads the chain, and the content script asks it through events. Hovering a feed video shows the save button in its top left corner with its tooltip below, and a press saves the file from the fake file server under `facebook-video-<ID>.mp4` (Playwright's `download` event), with the same bytes, while the video keeps playing and no viewer opens. A video with only a DASH manifest says it cannot be saved yet. When the file server does not let the page read the file, the address opens in a new tab and the button says so.
- On `pages/story-viewer/`, which copies the stories viewer and moves its address to a story's at once, a video story and a photo story each run on a timer with a progress bar. The overlays go last in the story card. The page's invisible strip over the bottom 12 pixels has `z-index: 1`, as Facebook's does, so the scrubber stands in for it: the strip is hidden while the scrubber shows, the scrubber there moves the video, and the strip comes back when the scrubber is switched off. A photo story keeps its strip. The save button sits under the story's header at the left and saves the story's video. A click on either story pauses and plays it through the page's own pause button, which stops the timer and the video. The page's tap zones hear none of the press's events, even on the left third, where they go back; with the option off they hear all of them. The header's links and buttons, a sticker, the next and previous buttons and the reply box still take their clicks.
- On `pages/stories/`, which pauses its story while the pointer or focus is inside a wrapper in the list of stories, as Facebook's stories viewer does, the story keeps playing while the pointer moves onto the list and along it, and after keyboard focus moves into it. Once the option is switched off, without a reload, the page pauses it as before. The filter tab list does not show there, and it shows after a move to the feed without a reload.
- The toolbar button's badge shows how many posts are hidden on the tab, and follows a change of keyword and a move to another page. The tests read it in the service worker with `chrome.action.getBadgeText`.
- The Diagnostics section of the options dialog shows a running feature and the post counts, and says so when post detection has not started.

`pages/react-data.js` puts the fake React data on the videos of `pages/videos/` and `pages/story-viewer/`.

`cdn/clip.mp4` is a copy of `pages/videos/clip.webm` under the name a progressive file has. The tests only compare its bytes, so its format does not matter.

`pages/videos/clip.webm` is 20 seconds of colour bars, 17 KB, made with the ffmpeg command at the top of `pages/videos/index.html`. The page loads it from a `blob:` address, which Chromium can seek in without the server answering range requests.

## What they do not cover

- The real Facebook. The pages in `pages/` copy the markup recorded in `docs/porting.md` under "Checked against Facebook". When Facebook changes, these tests keep passing until the pages are updated.
- Firefox and the userscript.
- A real click on the toolbar button. Playwright cannot click it. The tests run the extension's action through Chromium's DevTools protocol (`Extensions.triggerAction`), which fires the same `action.onClicked` event a click does, so the background script's listener runs. Whether the button is shown, and whether a click on it reaches the extension, is not tested.
- How the badge looks, and its `!` mark for a failed feature. The tests read only its text, and no feature fails on these pages.

## Running them

```sh
pnpm exec playwright install chromium --no-shell   # once, and after each Playwright upgrade
pnpm test:e2e                                      # builds the Chrome extension, then runs the tests
pnpm exec playwright test -c e2e --headed          # watch them run, without rebuilding
```

The tests run headless, in Playwright's `chromium` channel. That channel is the full Chromium build, which loads extensions in headless mode; the default headless shell cannot.

No request leaves the machine. Every request a page or the extension makes to `https://www.facebook.com/` is answered from `pages/`, and one to the fake file server `https://video.e2e.fbcdn.net/` (`CDN` in `extension.ts`) from `cdn/`. That server allows the fake Facebook to read its files, as Facebook's file server does for the files its player reads, except under `/no-cors/`, where it allows another site only. Every other request is refused, and a test fails if its page asked for another site. The browser is also started with every host name failing to resolve, which covers Chromium's own requests as well.

Starting Chromium with the extension takes several seconds, so the tests share one browser with a new, empty profile. Before each test the extension's storage is cleared, and after it the page is unloaded. The `c_user` cookie is set to `USER_ID` in `extension.ts`, and settings are saved under that prefix, as on Facebook.

## Adding a page

Put the file in `pages/` at the path it is served from: `pages/index.html` is `https://www.facebook.com/`, and `pages/groups/index.html` would be `https://www.facebook.com/groups/`. Query strings are ignored. Use invented names and text. To make the page change after it loads, as Facebook does, add a short inline script. Have it wait for something the extension does, such as a `sfx_post` mark, before it changes the page, so the change reaches posts the extension already knows about. `pages/index.html` does this with a `MutationObserver`.
