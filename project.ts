// Names shared by the extension manifest and the userscript header.

export const NAME = 'Feed Sanity';

export const DESCRIPTION =
  'Filter feeds, hide clutter, control video playback, and customize themes across supported sites.';

/** The toolbar button, the userscript menu entry and the options dialog's heading. */
export const OPTIONS_TITLE = `${NAME} options`;

/** Official project website URL. */
export const WEBSITE_URL = 'https://feed-sanity.com';

/** Support / donation landing page opened by the "Keep Feed Sanity Alive" CTA. */
export const SUPPORT_URL = `${WEBSITE_URL}/support`;

/** Pixel-hinted small-cut PNG icons accepted by both Chrome MV3 and Firefox MV2. */
export const ACTIVE_ICON_PATHS: Readonly<Record<number, string>> = {
  16: 'icon/icon-16.png',
  32: 'icon/icon-32.png',
};

/** Monochrome paused/disabled toolbar PNG icons for `action.setIcon` / `browserAction.setIcon`. */
export const PAUSED_ICON_PATHS: Readonly<Record<number, string>> = {
  16: 'icon/icon-monochrome-16.png',
  32: 'icon/icon-monochrome-32.png',
};

/** Vector small-cut toolbar icon used on Firefox MV2 across arbitrary HiDPI scaling factors. */
export const FIREFOX_TOOLBAR_ICON = 'icon/icon.svg';
