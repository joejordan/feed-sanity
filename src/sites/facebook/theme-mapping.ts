import type { SiteThemeMapping } from '../../core/theming';
import { OWN_ATTR } from '../../core/surface';
import { hexWithAlpha } from '../../core/theming';

const LOADER_SCOPE = `:is([role="progressbar"], [aria-valuetext*="Loading" i], [role="status"][aria-label*="Loading" i], svg[aria-label*="Loading" i]):not([${OWN_ATTR}], [${OWN_ATTR}] *)`;

/** Maps Feed Sanity's semantic `ThemePalette` onto Facebook's Meta Comet CSS custom properties. */
export const facebookThemeMapping: SiteThemeMapping = {
  rootSelectors: [':root', '.__fb-dark-mode', '.__fb-light-mode'],
  adaptive: {
    enabled: true,
    brandColors: ['#0866ff', '#1877f2'],
    mediaPreserveSelectors: ['[role="dialog"] video', '[data-pagelet="Stories"] *'],
  },
  colorVars: {
    '--web-wash': (p) => p.background,
    '--wash': (p) => p.background,
    '--base-wash': (p) => p.background,
    '--surface-background': (p) => p.surface,
    '--card-background': (p) => p.surface,
    '--card-background-flat': (p) => p.surface,
    '--card-background-wash': (p) => p.background,
    '--nav-bar-background': (p) => p.surface,
    '--nav-bar-background-gradient': (p) =>
      `linear-gradient(to top, ${p.surface}, ${hexWithAlpha(p.surface, 0)})`,
    '--nav-bar-background-gradient-wash': (p) =>
      `linear-gradient(to top, ${p.background}, ${hexWithAlpha(p.background, 0)})`,
    '--messenger-card-background': (p) => p.surface,
    '--messenger-application-background': (p) => p.background,
    '--popover-background': (p) => p.surface,
    '--comment-background': (p) => p.surfaceAlt,
    '--input-background': (p) => p.surfaceAlt,
    '--secondary-button-background': (p) => p.surfaceAlt,
    '--background-deemphasized': (p) => p.surfaceAlt,
    '--hosted-view-selected-state': (p) => hexWithAlpha(p.accent, 0.14),
    '--primary-text': (p) => p.text,
    '--secondary-text': (p) => p.textMuted,
    '--placeholder-text': (p) => p.textMuted,
    '--primary-icon': (p) => p.text,
    '--secondary-icon': (p) => p.textMuted,
    '--divider': (p) => p.border,
    '--media-inner-border': (p) => p.border,
    '--scroll-thumb': (p) => p.border,
    '--accent': (p) => p.accent,
    '--blue-link': (p) => p.accent,
    '--active-tab-color': (p) => p.accent,
    '--primary-button-background': (p) => p.accent,
    '--primary-button-text': (p) => p.accentText,
    '--primary-deemphasized-button-background': (p) => hexWithAlpha(p.accent, 0.16),
    '--primary-deemphasized-button-hovered': (p) => hexWithAlpha(p.accent, 0.24),
    '--primary-deemphasized-button-text': (p) => p.accent,
    '--negative': (p) => p.danger,
    '--progress-ring-neutral-background': (p) => hexWithAlpha(p.textMuted, 0.24),
    '--progress-ring-neutral-foreground': (p) => p.accent,
    '--progress-ring-blue-background': (p) => hexWithAlpha(p.accent, 0.24),
    '--progress-ring-blue-foreground': (p) => p.accent,
    '--progress-ring-on-media-background': (p) => hexWithAlpha(p.text, 0.24),
    '--progress-ring-on-media-foreground': (p) => p.accent,
    '--glimmer-spinner-icon': (p) => p.accent,
    '--glimmer-base-opaque': (p) => p.surfaceAlt,
    '--glimmer-high-contrast-base-opaque': (p) => p.border,
    '--hover-overlay': (p) =>
      p.colorScheme === 'dark' ? 'rgb(255 255 255 / 7%)' : 'rgb(0 0 0 / 5%)',
    '--press-overlay': (p) =>
      p.colorScheme === 'dark' ? 'rgb(255 255 255 / 13%)' : 'rgb(0 0 0 / 10%)',
  },
  extraCss: (p) =>
    `
body {
  background-color: ${p.background} !important;
  color: ${p.text} !important;
}
${LOADER_SCOPE} {
  color: ${p.accent} !important;
  --base-blue: ${p.accent} !important;
  --accent: ${p.accent} !important;
  --progress-ring-blue-foreground: ${p.accent} !important;
  --progress-ring-neutral-foreground: ${p.accent} !important;
}
${LOADER_SCOPE} circle:first-of-type:not(:only-of-type):not([stroke="none"]) {
  stroke: ${hexWithAlpha(p.textMuted, 0.25)} !important;
}
${LOADER_SCOPE} :is(circle:last-of-type, path:is([stroke], [stroke-width], [stroke-dasharray], [fill="none"])):not([stroke="none"]) {
  stroke: ${p.accent} !important;
}
${LOADER_SCOPE} :is(circle:last-of-type, path)[fill]:not([fill="none"]) {
  fill: ${p.accent} !important;
}
${LOADER_SCOPE} stop {
  stop-color: ${p.accent} !important;
}
`.trim(),
  surfaces: {
    transparentShell: ['[role="feed"]'],
    popups: ['[role="dialog"]', '[role="menu"]', '[role="listbox"]'],
    revealCssVars: (p, { cardAlpha, popupAlpha }) => {
      const surface = p?.surface ?? '#18191a';
      return {
        '--web-wash': 'transparent',
        '--wash': 'transparent',
        '--base-wash': 'transparent',
        '--card-background-wash': 'transparent',
        '--messenger-application-background': 'transparent',
        '--nav-bar-background-gradient-wash': 'transparent',
        '--card-background': hexWithAlpha(surface, cardAlpha),
        '--surface-background': hexWithAlpha(surface, cardAlpha),
        '--nav-bar-background': hexWithAlpha(surface, Math.max(0.92, cardAlpha)),
        '--popover-background': hexWithAlpha(surface, popupAlpha),
      };
    },
  },
};
