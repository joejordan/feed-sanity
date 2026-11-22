import type { SiteThemeMapping } from '../../core/theming';

/**
 * Maps Feed Sanity's semantic `ThemePalette` onto X.com's React Native Web
 * surface hierarchy (`body`, `primaryColumn`, `sidebarColumn`, tweet dividers,
 * and accent highlights).
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
html, body, #react-root {
  background-color: ${p.background} !important;
  color: ${p.text} !important;
}
[data-testid="primaryColumn"] {
  background-color: ${p.background} !important;
  border-color: ${p.border} !important;
}
[data-testid="sidebarColumn"] > div > div > div > div > div {
  background-color: ${p.surface} !important;
  border-color: ${p.border} !important;
}
article[data-testid="tweet"] {
  color: ${p.text} !important;
}
[data-testid="cellInnerDiv"] {
  border-color: ${p.border} !important;
}
[data-testid="primaryColumn"] [role="tab"][aria-selected="true"] {
  color: ${p.text} !important;
}
a[href^="/hashtag/"], a[role="link"][style*="rgb(29, 155, 240)"] {
  color: ${p.accent} !important;
}
`.trim(),
};
