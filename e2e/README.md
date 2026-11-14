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

`pages/videos/clip.webm` is 20 seconds of colour bars, 17 KB, made with the ffmpeg command at the top of `pages/videos/index.html`. The page loads it from a `blob:` address, which Chromium can seek in without the server answering range requests.

## What they do not cover

- The real Facebook. The pages in `pages/` copy the markup recorded in `docs/porting.md` under "Checked against Facebook". When Facebook changes, these tests keep passing until the pages are updated.
- Firefox and the userscript.
- A real click on the toolbar button. Playwright cannot click it. The tests run the extension's action through Chromium's DevTools protocol (`Extensions.triggerAction`), which fires the same `action.onClicked` event a click does, so the background script's listener runs. Whether the button is shown, and whether a click on it reaches the extension, is not tested.

## Running them

```sh
pnpm exec playwright install chromium --no-shell   # once, and after each Playwright upgrade
pnpm test:e2e                                      # builds the Chrome extension, then runs the tests
pnpm exec playwright test -c e2e --headed          # watch them run, without rebuilding
```

The tests run headless, in Playwright's `chromium` channel. That channel is the full Chromium build, which loads extensions in headless mode; the default headless shell cannot.

No request leaves the machine. Every request a page or the extension makes to `https://www.facebook.com/` is answered from `pages/`, every other one is refused, and a test fails if its page asked for another site. The browser is also started with every host name failing to resolve, which covers Chromium's own requests as well.

Starting Chromium with the extension takes several seconds, so the tests share one browser with a new, empty profile. Before each test the extension's storage is cleared, and after it the page is unloaded. The `c_user` cookie is set to `USER_ID` in `extension.ts`, and settings are saved under that prefix, as on Facebook.

## Adding a page

Put the file in `pages/` at the path it is served from: `pages/index.html` is `https://www.facebook.com/`, and `pages/groups/index.html` would be `https://www.facebook.com/groups/`. Query strings are ignored. Use invented names and text. To make the page change after it loads, as Facebook does, add a short inline script. Have it wait for something the extension does, such as a `sfx_post` mark, before it changes the page, so the change reaches posts the extension already knows about. `pages/index.html` does this with a `MutationObserver`.
