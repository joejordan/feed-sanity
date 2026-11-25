# Privacy Policy

**Feed Sanity does not collect, transmit, sell, or share any personal data.**

## What Data Feed Sanity Stores

All settings, filter rules, saved themes (`My Themes`), and read-post state are stored **exclusively on your own device** using the browser's local extension storage (`browser.storage.local` / `chrome.storage.local`, or your userscript manager's local storage).

- No external servers, analytics, telemetry, crash reporters, or remote config endpoints are contacted.
- No personal data leaves your browser.
- Exported backups (`.json`), themes (`.fstheme.json`), and Diagnostics reports are created locally only when you explicitly click Export or Copy, and Diagnostics reports automatically scrub URLs, handles, and numeric IDs.

## Permissions

Feed Sanity requests only the single permission required to persist your local settings:

- **`storage`**: Saves your preferences, filter rules, and themes locally in your browser.

Content-script host matches in `manifest.json` cover only the five supported domains (`facebook.com`, `x.com` / `twitter.com`, `instagram.com`, `reddit.com`, and `mail.google.com`). Experimental sites (`instagram.com`, `reddit.com`, and `mail.google.com`) are disabled by default and exit immediately without modifying the page unless you explicitly enable them under **Sites → Show experimental sites**.

## Contact

Questions or privacy concerns can be filed in the project issue tracker:
<https://github.com/joejordan/feed-sanity/issues>
