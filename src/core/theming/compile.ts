import type { ResolvedTheme, SiteThemeMapping, ThemeColorScheme, ThemePalette } from './types';
import { OWN_ATTR } from '../surface';
import { hexWithAlpha } from '../theme';
import {
  compileBackdropRevealCss,
  compileSurfaceFinishCss,
  compileUiSurfaceCss,
} from '../theme-effects';
import { hexToRgbTriplet } from './color-utils';

function buildPaletteDeclarations(palette: ThemePalette, mapping: SiteThemeMapping): string[] {
  const decls: string[] = [`color-scheme: ${palette.colorScheme} !important;`];
  if (mapping.colorVars) {
    for (const [name, resolve] of Object.entries(mapping.colorVars)) {
      decls.push(`${name}: ${resolve(palette)} !important;`);
    }
  }
  if (mapping.rgbTripletVars) {
    for (const [name, resolve] of Object.entries(mapping.rgbTripletVars)) {
      decls.push(`${name}: ${hexToRgbTriplet(resolve(palette))} !important;`);
    }
  }
  return decls;
}

const FONT_TEXT_ELEMENTS =
  'p, span, div, a, li, td, th, dt, dd, label, legend, h1, h2, h3, h4, h5, h6, button, input, textarea, select, option, blockquote, figcaption, summary, article, section, main, nav, header, footer, aside';

const FONT_EXCLUDE_SELECTORS = `[${OWN_ATTR}], [${OWN_ATTR}] *, code, pre, kbd, samp, code *, pre *, [class*="icon" i], [class*="material-symbols" i], svg *`;

const HOST_FONT_VARS = [
  '--font-family-default',
  '--font-family-apple',
  '--font-family-segoe',
  '--font-family-system',
  '--x-font-sans',
  '--font-sans',
  '--font-body',
] as const;

function compileFontOverrideCss(fontFamily: string, target: 'host' | 'shadow'): string {
  const varDecls = HOST_FONT_VARS.map((v) => `${v}: ${fontFamily} !important;`).join('\n  ');
  if (target === 'shadow') {
    return [
      `:host {\n  font-family: ${fontFamily} !important;\n  ${varDecls}\n}`,
      `:where(${FONT_TEXT_ELEMENTS}):not(:where(${FONT_EXCLUDE_SELECTORS})) {\n  font-family: ${fontFamily} !important;\n}`,
    ].join('\n\n');
  }
  return [
    `:root {\n  ${varDecls}\n}`,
    `html, body {\n  font-family: ${fontFamily} !important;\n}`,
    `body :where(${FONT_TEXT_ELEMENTS}):not(:where(${FONT_EXCLUDE_SELECTORS})) {\n  font-family: ${fontFamily} !important;\n}`,
  ].join('\n\n');
}

/** Compiles `theme` + `mapping` into host-document CSS. */
export function compileHostThemeCss(
  theme: ResolvedTheme,
  mapping: SiteThemeMapping,
  hostScheme: ThemeColorScheme = theme.palette?.colorScheme ?? 'dark',
): string {
  const parts: string[] = [];
  if (theme.palette) {
    const decls = buildPaletteDeclarations(theme.palette, mapping);
    const selectors = mapping.rootSelectors.length > 0 ? mapping.rootSelectors.join(', ') : ':root';
    parts.push(`${selectors} {\n  ${decls.join('\n  ')}\n}`);
  }
  if (theme.fontFamily) {
    parts.push(compileFontOverrideCss(theme.fontFamily, 'host'));
  }
  const extra = theme.palette ? mapping.extraCss?.(theme.palette).trim() : undefined;
  if (extra) {
    parts.push(extra);
  }
  if (theme.presetHostCss) {
    parts.push(theme.presetHostCss);
  }
  if (theme.effects) {
    const revealCss = compileBackdropRevealCss(theme.palette, hostScheme, theme.effects, mapping);
    if (revealCss) {
      parts.push(revealCss);
    }
    const finishCss = compileSurfaceFinishCss(
      theme.palette,
      hostScheme,
      theme.effects,
      mapping.surfaces,
    );
    if (finishCss) {
      parts.push(finishCss);
    }
  }
  if (theme.customCss) {
    parts.push(theme.customCss);
  }
  return parts.join('\n\n');
}

/**
 * Compiles `theme` + `mapping` for injection into host open `ShadowRoot`s.
 * Maps document-level `:root` / `html, body` selectors to `:host` because
 * `:root` never matches inside a Shadow Tree per CSS Scoping Level 1.
 */
export function compileShadowThemeCss(theme: ResolvedTheme, mapping: SiteThemeMapping): string {
  const parts: string[] = [];
  if (theme.palette) {
    const decls = buildPaletteDeclarations(theme.palette, mapping);
    const shadowSelectors = mapping.rootSelectors.map((sel) =>
      sel.trim() === ':root' ? ':host' : sel,
    );
    if (!shadowSelectors.includes(':host')) {
      shadowSelectors.unshift(':host');
    }
    parts.push(`${shadowSelectors.join(', ')} {\n  ${decls.join('\n  ')}\n}`);
  }
  if (theme.fontFamily) {
    parts.push(compileFontOverrideCss(theme.fontFamily, 'shadow'));
  }
  const shadowExtra = theme.palette ? mapping.shadowExtraCss?.(theme.palette).trim() : undefined;
  if (shadowExtra) {
    parts.push(shadowExtra);
  }
  if (theme.customCss) {
    parts.push(theme.customCss);
  }
  return parts.join('\n\n');
}

/** Compiles `theme` into Feed Sanity's own Shadow DOM `--fs-*` token overrides. */
export function compileUiThemeCss(theme: ResolvedTheme): string {
  const lines: string[] = [];
  if (theme.palette) {
    const p = theme.palette;
    const hoverOverlay = p.colorScheme === 'dark' ? 'rgb(255 255 255 / 7%)' : 'rgb(0 0 0 / 5%)';
    const pressOverlay = p.colorScheme === 'dark' ? 'rgb(255 255 255 / 13%)' : 'rgb(0 0 0 / 10%)';
    lines.push(
      `color-scheme: ${p.colorScheme};`,
      `--fs-background: ${p.surface};`,
      `--fs-surface: ${p.background};`,
      `--fs-dialog-bg: ${p.surface};`,
      `--fs-sidebar-bg: ${p.background};`,
      `--fs-card-bg: ${p.colorScheme === 'dark' ? p.surfaceAlt : p.background};`,
      `--fs-control-bg: ${p.colorScheme === 'dark' ? p.background : p.surface};`,
      `--fs-hover: ${hoverOverlay};`,
      `--fs-press: ${pressOverlay};`,
      `--fs-icon: ${p.text};`,
      `--fs-icon-secondary: ${p.textMuted};`,
      `--fs-text: ${p.text};`,
      `--fs-text-secondary: ${p.textMuted};`,
      `--fs-divider: ${p.border};`,
      `--fs-accent: ${p.accent};`,
      `--fs-accent-surface: ${hexWithAlpha(p.accent, 0.16)};`,
      `--fs-accent-text: ${p.accentText};`,
      `--fs-button-secondary: ${p.surfaceAlt};`,
      `--fs-comment: ${p.surfaceAlt};`,
      `--fs-shadow-2: ${p.colorScheme === 'dark' ? 'rgb(0 0 0 / 45%)' : 'rgb(0 0 0 / 18%)'};`,
      `--fs-input: ${p.background};`,
      `--fs-error: ${p.danger};`,
    );
  }
  if (theme.fontFamily) {
    lines.push(`--fs-font: ${theme.fontFamily};`);
  }
  const parts: string[] = [];
  if (lines.length > 0) {
    parts.push(`:host {\n  ${lines.join('\n  ')}\n}`);
  }
  if (theme.presetUiCss) {
    parts.push(theme.presetUiCss);
  }
  const uiFxCss = compileUiSurfaceCss(theme.palette, theme.effects);
  if (uiFxCss) {
    parts.push(uiFxCss);
  }
  return parts.join('\n\n');
}
