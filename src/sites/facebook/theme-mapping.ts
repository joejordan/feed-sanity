import type { SiteThemeMapping } from '../../core/theming';
import { hexWithAlpha } from '../../core/theming';

/** Maps Feed Sanity's semantic `ThemePalette` onto Facebook's Meta Comet CSS custom properties. */
export const facebookThemeMapping: SiteThemeMapping = {
  rootSelectors: [':root', '.__fb-dark-mode', '.__fb-light-mode'],
  colorVars: {
    '--web-wash': (p) => p.background,
    '--surface-background': (p) => p.surface,
    '--card-background': (p) => p.surface,
    '--card-background-flat': (p) => p.surface,
    '--nav-bar-background': (p) => p.surface,
    '--nav-bar-background-gradient': (p) => p.surface,
    '--messenger-card-background': (p) => p.surface,
    '--popover-background': (p) => p.surface,
    '--comment-background': (p) => p.surfaceAlt,
    '--input-background': (p) => p.surfaceAlt,
    '--secondary-button-background': (p) => p.surfaceAlt,
    '--primary-text': (p) => p.text,
    '--secondary-text': (p) => p.textMuted,
    '--primary-icon': (p) => p.text,
    '--secondary-icon': (p) => p.textMuted,
    '--divider': (p) => p.border,
    '--media-inner-border': (p) => p.border,
    '--accent': (p) => p.accent,
    '--blue-link': (p) => p.accent,
    '--primary-button-background': (p) => p.accent,
    '--primary-button-text': (p) => p.accentText,
    '--primary-deemphasized-button-background': (p) => hexWithAlpha(p.accent, 0.16),
    '--primary-deemphasized-button-text': (p) => p.accent,
    '--negative': (p) => p.danger,
    '--hover-overlay': (p) =>
      p.colorScheme === 'dark' ? 'rgb(255 255 255 / 7%)' : 'rgb(0 0 0 / 5%)',
    '--press-overlay': (p) =>
      p.colorScheme === 'dark' ? 'rgb(255 255 255 / 13%)' : 'rgb(0 0 0 / 10%)',
  },
  extraCss: (p) =>
    `body { background-color: ${p.background} !important; color: ${p.text} !important; }`,
};
