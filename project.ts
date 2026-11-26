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

/** Borderless dual-ground toolbar PNG icons for Chrome MV3 and Safari MV3. */
export const ACTIVE_ICON_PATHS: Readonly<Record<number, string>> = {
  16: 'icon/icon-16.png',
  32: 'icon/icon-32.png',
};

/** Borderless monochrome paused/disabled toolbar PNG icons for `action.setIcon` / `browserAction.setIcon`. */
export const PAUSED_ICON_PATHS: Readonly<Record<number, string>> = {
  16: 'icon/icon-monochrome-16.png',
  32: 'icon/icon-monochrome-32.png',
};

/** Adaptive borderless vector toolbar icon used on Firefox MV2 across arbitrary HiDPI scaling factors. */
export const FIREFOX_TOOLBAR_ICON = 'icon/icon.svg';

/**
 * Firefox MV2 `browser_action.theme_icons`: Firefox shows `light` on dark toolbars
 * (light text) and `dark` on light toolbars (dark text).
 */
export const FIREFOX_THEME_ICONS = [
  { size: 16, light: 'icon/toolbar-dark.svg', dark: 'icon/toolbar-light.svg' },
  { size: 32, light: 'icon/toolbar-dark.svg', dark: 'icon/toolbar-light.svg' },
] as const;
