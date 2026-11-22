import type { SiteThemeMapping } from '../../core/theming';
import { hexWithAlpha } from '../../core/theming';

/**
 * Maps Feed Sanity's semantic `ThemePalette` onto X.com's React Native Web
 * surface hierarchy (`body`, left nav, sticky header, `primaryColumn`,
 * `sidebarColumn`, dialogs, tweet cards, and accent buttons/links).
 */
export const xThemeMapping: SiteThemeMapping = {
  rootSelectors: [':root'],
  colorVars: {
    '--fs-host-bg': (p) => p.background,
    '--fs-host-surface': (p) => p.surface,
    '--fs-host-surface-alt': (p) => p.surfaceAlt,
    '--fs-host-text': (p) => p.text,
    '--fs-host-muted': (p) => p.textMuted,
    '--fs-host-border': (p) => p.border,
    '--fs-host-accent': (p) => p.accent,
  },
  extraCss: (p) =>
    `
html, body, #react-root, header[role="banner"] {
  background-color: ${p.background} !important;
  color: ${p.text} !important;
}
[data-testid="primaryColumn"] {
  background-color: ${p.background} !important;
  border-color: ${p.border} !important;
}
[data-testid="primaryColumn"] [role="tablist"] {
  background-color: ${hexWithAlpha(p.background, 0.88)} !important;
  border-bottom-color: ${p.border} !important;
}
[data-testid="sidebarColumn"] aside[role="complementary"],
[data-testid="sidebarColumn"] [data-testid="trend"],
[data-testid="sidebarColumn"] > div > div > div > div > div {
  background-color: ${p.surface} !important;
  border-color: ${p.border} !important;
  color: ${p.text} !important;
}
[role="dialog"],
[data-testid="Dropdown"],
[data-testid="HoverCard"] {
  background-color: ${p.surface} !important;
  border-color: ${p.border} !important;
  color: ${p.text} !important;
}
[data-testid="SearchBox_Search_Input"] {
  background-color: ${p.surfaceAlt} !important;
  color: ${p.text} !important;
}
article[data-testid="tweet"],
[data-testid="tweetText"],
[data-testid="User-Name"],
[data-testid="User-Name"] span,
[data-testid="primaryColumn"] [role="tab"][aria-selected="true"],
[data-testid="primaryColumn"] [role="tab"][aria-selected="true"] span {
  color: ${p.text} !important;
}
[data-testid="User-Name"] a[tabindex="-1"] span {
  color: ${p.textMuted} !important;
}
[data-testid="cellInnerDiv"] {
  border-color: ${p.border} !important;
}
[data-testid="SideNav_NewTweet_Button"],
[data-testid="tweetButtonInline"],
[data-testid="tweetButton"] {
  background-color: ${p.accent} !important;
  color: ${p.accentText} !important;
}
[data-testid="SideNav_NewTweet_Button"] *,
[data-testid="tweetButtonInline"] *,
[data-testid="tweetButton"] * {
  color: ${p.accentText} !important;
}
a[href^="/hashtag/"], a[role="link"][style*="rgb(29, 155, 240)"] {
  color: ${p.accent} !important;
}
`.trim(),
};
