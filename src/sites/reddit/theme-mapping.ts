import type { SiteThemeMapping } from '../../core/theming';
import { hexWithAlpha } from '../../core/theming';

/**
 * Maps Feed Sanity's semantic `ThemePalette` onto Reddit Shreddit's CSS custom
 * properties (`--color-neutral-*`, `--color-brand-*`, `--shreddit-*`), light
 * DOM chrome, AND nested open Shadow DOM Web Components via `shadowExtraCss`.
 */
export const redditThemeMapping: SiteThemeMapping = {
  rootSelectors: [':root', 'html.theme-dark', 'html.theme-light', 'shreddit-app'],
  colorVars: {
    '--fs-host-bg': (p) => p.background,
    '--fs-host-surface': (p) => p.surface,
    '--fs-host-surface-alt': (p) => p.surfaceAlt,
    '--fs-host-text': (p) => p.text,
    '--fs-host-muted': (p) => p.textMuted,
    '--fs-host-border': (p) => p.border,
    '--fs-host-accent': (p) => p.accent,

    // Shreddit design system tokens (inherited across Shadow DOM boundaries)
    '--color-neutral-background': (p) => p.background,
    '--color-neutral-background-strong': (p) => p.surface,
    '--color-neutral-background-weak': (p) => p.surfaceAlt,
    '--color-neutral-background-hover': (p) => hexWithAlpha(p.text, 0.08),
    '--color-neutral-background-selected': (p) => hexWithAlpha(p.accent, 0.14),
    '--color-neutral-content': (p) => p.text,
    '--color-neutral-content-strong': (p) => p.text,
    '--color-neutral-content-weak': (p) => p.textMuted,
    '--color-neutral-border': (p) => p.border,
    '--color-neutral-border-weak': (p) => p.border,
    '--color-neutral-border-strong': (p) => hexWithAlpha(p.text, 0.25),
    '--color-brand-background': (p) => p.accent,
    '--color-brand-background-hover': (p) => hexWithAlpha(p.accent, 0.88),
    '--color-brand-content': (p) => p.accent,
    '--color-tone-1': (p) => p.text,
    '--color-tone-2': (p) => p.textMuted,
    '--color-tone-7': (p) => p.background,
    '--shreddit-content-background': (p) => p.background,
    '--shreddit-header-background': (p) => p.surface,
  },
  extraCss: (p) =>
    `
html, body, shreddit-app, main, reddit-header-large {
  background-color: ${p.background} !important;
  color: ${p.text} !important;
  scrollbar-color: ${p.border} ${p.background} !important;
}
header, nav, #left-sidebar-container, #right-sidebar-container, shreddit-post {
  background-color: ${p.surface} !important;
  border-color: ${p.border} !important;
  color: ${p.text} !important;
}
::selection {
  background-color: ${hexWithAlpha(p.accent, 0.28)} !important;
}
`.trim(),
  shadowExtraCss: (p) =>
    `
:host {
  color: ${p.text};
  scrollbar-color: ${p.border} ${p.background};
}
:where(.post-card, .shreddit-card, article, header, aside) {
  background-color: ${p.surface} !important;
  border-color: ${p.border} !important;
  color: ${p.text} !important;
}
:where(.credit-bar, .post-meta, .muted, small) {
  color: ${p.textMuted} !important;
}
:where(a, .subreddit-link) {
  color: ${p.accent};
}
:where(input, textarea, select) {
  background-color: ${p.surfaceAlt} !important;
  border-color: ${p.border} !important;
  color: ${p.text} !important;
}
:where(hr, [role="separator"]) {
  border-color: ${p.border} !important;
  background-color: ${p.border} !important;
}
::selection {
  background-color: ${hexWithAlpha(p.accent, 0.28)} !important;
}
`.trim(),
};
