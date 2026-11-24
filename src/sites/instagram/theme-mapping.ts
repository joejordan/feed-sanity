import type { SiteThemeMapping } from '../../core/theming';

/** Maps Feed Sanity's semantic `ThemePalette` onto Instagram's `--ig-*` RGB-triplet custom properties. */
export const instagramThemeMapping: SiteThemeMapping = {
  rootSelectors: [':root', '.__fb-dark-mode', '.__fb-light-mode'],
  adaptive: {
    enabled: true,
    brandColors: ['#0095f6'],
    mediaPreserveSelectors: ['video', 'article img'],
  },
  colorVars: {
    '--web-wash': (p) => p.background,
    '--surface-background': (p) => p.surface,
    '--card-background': (p) => p.surface,
  },
  rgbTripletVars: {
    '--ig-primary-background': (p) => p.background,
    '--ig-secondary-background': (p) => p.surfaceAlt,
    '--ig-tertiary-background': (p) => p.surfaceAlt,
    '--ig-elevated-background': (p) => p.surface,
    '--ig-elevated-highlight-background': (p) => p.surfaceAlt,
    '--ig-elevated-creation-background': (p) => p.surface,
    '--ig-floating-button-background': (p) => p.surface,
    '--ig-banner-background': (p) => p.surface,
    '--ig-bubble-background': (p) => p.surfaceAlt,
    '--ig-dropdown-background': (p) => p.surface,
    '--ig-highlight-background': (p) => p.surfaceAlt,
    '--ig-primary-text': (p) => p.text,
    '--ig-secondary-text': (p) => p.textMuted,
    '--ig-tertiary-text': (p) => p.textMuted,
    '--ig-primary-icon': (p) => p.text,
    '--ig-secondary-icon': (p) => p.textMuted,
    '--ig-separator': (p) => p.border,
    '--ig-elevated-separator': (p) => p.border,
    '--ig-stroke': (p) => p.border,
    '--ig-focus-stroke': (p) => p.accent,
    '--ig-link': (p) => p.accent,
    '--ig-primary-button': (p) => p.accent,
    '--ig-colors-button-primary-background': (p) => p.accent,
    '--ig-colors-button-primary-text': (p) => p.accentText,
    '--ig-colors-button-secondary-background': (p) => p.surfaceAlt,
    '--ig-colors-button-secondary-text': (p) => p.text,
    '--ig-colors-link-text': (p) => p.accent,
    '--ig-colors-button-borderless-text': (p) => p.accent,
    '--ig-error-or-destructive': (p) => p.danger,
  },
  extraCss: (p) =>
    `html, body { background-color: ${p.background} !important; color: ${p.text} !important; }`,
  surfaces: {
    columns: ['main[role="main"] > div'],
    columnAlphaScale: 0.75,
    softSurfaces: ['article', 'nav'],
    popups: ['[role="dialog"]', '[role="menu"]', '[role="listbox"]'],
    revealCssVars: () => ({
      '--web-wash': 'transparent',
    }),
  },
};
