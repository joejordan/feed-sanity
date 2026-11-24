import type { ResolvedTheme, SiteThemeMapping, ThemeColorScheme, ThemePalette } from './types';
import { hexWithAlpha } from '../theme';
import {
  compileBackdropRevealCss,
  compileSurfaceFinishCss,
  compileUiSurfaceCss,
} from '../theme-effects';
import { hexToRgbTriplet } from './color-utils';
import {
  formatRootSelectors,
  TEXT_INPUT_SELECTOR,
  withThemeLayerOrder,
  wrapThemeLayer,
} from './types';

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

const HOST_FONT_VARS = [
  '--font-family-default',
  '--font-family-apple',
  '--font-family-segoe',
  '--font-family-system',
  '--x-font-sans',
  '--font-sans',
  '--font-body',
] as const;

/**
 * Sets typography via CSS custom properties + document/form inheritance rather than
 * a 33-tag universal selector bomb. Explicit host stylesheet `font-family` overrides
 * are compiled selectively per-rule by Layer 1 (`compileAdaptiveRootCss`).
 */
function compileFontOverrideCss(fontFamily: string, target: 'host' | 'shadow'): string {
  const varDecls = HOST_FONT_VARS.map((v) => `${v}: ${fontFamily} !important;`).join('\n  ');
  if (target === 'shadow') {
    return [
      `:host {\n  font-family: ${fontFamily} !important;\n  ${varDecls}\n}`,
      `${TEXT_INPUT_SELECTOR}, textarea, select, button {\n  font-family: inherit;\n}`,
    ].join('\n\n');
  }
  return [
    `:root {\n  ${varDecls}\n}`,
    `html, body {\n  font-family: ${fontFamily} !important;\n}`,
    `${TEXT_INPUT_SELECTOR}, textarea, select, button {\n  font-family: inherit;\n}`,
  ].join('\n\n');
}

/**
 * Routes user Custom CSS so both normal and `!important` declarations win:
 * - Rules containing `!important` enter `@layer fs-user` (first layer, highest `!important` priority).
 * - Rules without `!important` stay unlayered after all `@layer` blocks (highest normal priority).
 */
function formatUserCustomCss(customCss: string): string {
  return /!important\b/i.test(customCss) ? wrapThemeLayer('fs-user', customCss) : customCss;
}

/** Compiles `theme` + `mapping` into layered host-document CSS. */
export function compileHostThemeCss(
  theme: ResolvedTheme,
  mapping: SiteThemeMapping,
  hostScheme: ThemeColorScheme = theme.palette?.colorScheme ?? 'dark',
): string {
  const mappingParts: string[] = [];
  if (theme.palette) {
    const decls = buildPaletteDeclarations(theme.palette, mapping);
    const selectors = formatRootSelectors(mapping.rootSelectors);
    mappingParts.push(`${selectors} {\n  ${decls.join('\n  ')}\n}`);
  }
  if (theme.fontFamily) {
    mappingParts.push(compileFontOverrideCss(theme.fontFamily, 'host'));
  }
  const extra = theme.palette ? mapping.extraCss?.(theme.palette).trim() : undefined;
  if (extra) {
    mappingParts.push(extra);
  }
  if (theme.presetHostCss) {
    mappingParts.push(theme.presetHostCss);
  }

  const layers: string[] = [];
  if (mappingParts.length > 0) {
    layers.push(wrapThemeLayer('fs-mapping', mappingParts.join('\n\n')));
  }
  if (theme.effects) {
    const revealCss = compileBackdropRevealCss(theme.palette, hostScheme, theme.effects, mapping);
    if (revealCss) {
      layers.push(revealCss);
    }
    const finishCss = compileSurfaceFinishCss(
      theme.palette,
      hostScheme,
      theme.effects,
      mapping.surfaces,
    );
    if (finishCss) {
      layers.push(wrapThemeLayer('fs-finish', finishCss));
    }
  }
  if (theme.customCss) {
    layers.push(formatUserCustomCss(theme.customCss));
  }
  return withThemeLayerOrder(layers);
}

/**
 * Compiles `theme` + `mapping` for injection into host open `ShadowRoot`s.
 * Maps document-level `:root` / `html, body` selectors to `:host` because
 * `:root` never matches inside a Shadow Tree per CSS Scoping Level 1.
 */
export function compileShadowThemeCss(theme: ResolvedTheme, mapping: SiteThemeMapping): string {
  const mappingParts: string[] = [];
  if (theme.palette) {
    const decls = buildPaletteDeclarations(theme.palette, mapping);
    const selectors = formatRootSelectors(mapping.rootSelectors, { shadow: true });
    mappingParts.push(`${selectors} {\n  ${decls.join('\n  ')}\n}`);
  }
  if (theme.fontFamily) {
    mappingParts.push(compileFontOverrideCss(theme.fontFamily, 'shadow'));
  }
  const shadowExtra = theme.palette ? mapping.shadowExtraCss?.(theme.palette).trim() : undefined;
  if (shadowExtra) {
    mappingParts.push(shadowExtra);
  }
  const layers: string[] = [];
  if (mappingParts.length > 0) {
    layers.push(wrapThemeLayer('fs-mapping', mappingParts.join('\n\n')));
  }
  if (theme.customCss) {
    layers.push(formatUserCustomCss(theme.customCss));
  }
  return withThemeLayerOrder(layers);
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
