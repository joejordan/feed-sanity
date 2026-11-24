import type { SiteThemeMapping } from '../../core/theming';
import { hexWithAlpha } from '../../core/theming';

/**
 * Maps Feed Sanity's semantic `ThemePalette` onto Gmail's Material 3 / Closure
 * workspace surfaces (chrome, navigation rail, search bar, thread rows, compose
 * CTA, dialogs, and same-origin reading/compose iframes). Targets descendant
 * text nodes cleanly without blanket-overriding styled HTML email CTA links.
 */
export const gmailThemeMapping: SiteThemeMapping = {
  rootSelectors: [':root'],
  adaptive: {
    enabled: true,
    brandColors: ['#0b57d0', '#1a73e8'],
  },
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
html, body, div.wl {
  background-color: ${p.background} !important;
  color: ${p.text} !important;
}
header[role="banner"],
div[role="navigation"] {
  background-color: ${p.background} !important;
  color: ${p.text} !important;
}
div[role="navigation"] a,
div[role="navigation"] span {
  color: ${p.text} !important;
}
header[role="banner"] form[role="search"],
form[role="search"],
form[role="search"] input {
  background-color: ${p.surfaceAlt} !important;
  color: ${p.text} !important;
  border-color: ${p.border} !important;
}
div.nH:has(> div[role="main"]),
div[role="main"] {
  background-color: ${p.surface} !important;
  color: ${p.text} !important;
  border-color: ${p.border} !important;
}
div[role="main"] tr[role="row"],
div[role="main"] table[role="grid"] tbody > tr {
  background-color: ${p.surface} !important;
  color: ${p.text} !important;
  border-bottom-color: ${p.border} !important;
}
div[role="main"] tr[role="row"] td,
div[role="main"] tr[role="row"] span,
div[role="main"] table[role="grid"] tbody > tr td,
div[role="main"] table[role="grid"] tbody > tr span {
  color: ${p.text} !important;
}
div[role="main"] tr[role="row"]:hover,
div[role="main"] table[role="grid"] tbody > tr:hover {
  background-color: ${p.surfaceAlt} !important;
}
div[role="main"] [role="tablist"] {
  background-color: ${p.surface} !important;
  border-bottom-color: ${p.border} !important;
}
div[role="main"] [role="tab"][aria-selected="true"],
div[role="main"] [role="tab"][aria-selected="true"] * {
  color: ${p.accent} !important;
  border-bottom-color: ${p.accent} !important;
}
div[role="button"][gh="cm"] {
  background-color: ${p.accent} !important;
  color: ${p.accentText} !important;
}
div[role="button"][gh="cm"] * {
  color: ${p.accentText} !important;
}
div[role="dialog"],
div[role="menu"] {
  background-color: ${p.surface} !important;
  color: ${p.text} !important;
  border-color: ${p.border} !important;
}
div[role="dialog"] *,
div[role="menu"] * {
  color: ${p.text} !important;
}
::selection {
  background-color: ${hexWithAlpha(p.accent, 0.28)} !important;
}
`.trim(),
  surfaces: {
    transparentShell: ['div.wl', 'header[role="banner"]', 'div[role="navigation"]'],
    softSurfaces: ['div.nH:has(> div[role="main"])', 'div[role="main"]'],
    popups: ['div[role="dialog"]', 'div[role="menu"]', 'div[role="listbox"]'],
  },
};
