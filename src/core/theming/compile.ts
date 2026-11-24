import type {
  ResolvedTheme,
  SiteThemeMapping,
  ThemeChromeConfig,
  ThemeColorScheme,
  ThemePalette,
  ThemeRibbonSpec,
} from './types';
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

const IMPORTANT_RE = /!\s*important\b/i;

function clampNumber(value: number, min: number, max: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return Math.round(Math.min(max, Math.max(min, value)) * factor) / factor;
}

function compileRibbonRule(
  ribbon: ThemeRibbonSpec | undefined,
  selector: string,
  position: 'fixed' | 'absolute',
  zIndex: number,
): string {
  if (!ribbon?.enabled || ribbon.stops.length === 0) {
    return '';
  }
  const stops = ribbon.stops.length === 1 ? [ribbon.stops[0], ribbon.stops[0]] : ribbon.stops;
  const angle = clampNumber(ribbon.angle ?? 90, 0, 360, 0);
  const height = clampNumber(ribbon.height ?? 3, 1, 6, 0);
  const inset = ribbon.position === 'bottom' ? 'auto 0 0 0' : '0 0 auto 0';
  const bg = `linear-gradient(${angle}deg, ${stops.join(', ')})`;
  return `${selector} { content: ""; position: ${position}; inset: ${inset}; height: ${height}px; pointer-events: none; z-index: ${zIndex}; background: ${bg}; }`;
}

/** Compiles declarative `chrome` niceties (`ribbon` + `ambientGlow`) into safe host CSS. */
export function compileChromeHostCss(
  chrome: ThemeChromeConfig | undefined,
  hasLiveBackdrop: boolean,
): string {
  if (!chrome) {
    return '';
  }
  const rules: string[] = [];
  const ribbonCss = compileRibbonRule(chrome.ribbon, 'body::before', 'fixed', 2_147_483_640);
  if (ribbonCss) {
    rules.push(ribbonCss);
  }
  if (!hasLiveBackdrop && chrome.ambientGlow?.enabled && chrome.ambientGlow.spots.length > 0) {
    const layers = chrome.ambientGlow.spots.map((spot) => {
      const rx = clampNumber(spot.radiusX ?? 60, 20, 90, 0);
      const ry = clampNumber(spot.radiusY ?? 42, 20, 80, 0);
      const x = clampNumber(spot.x, 0, 100, 0);
      const y = clampNumber(spot.y, 0, 100, 0);
      const alpha = clampNumber(spot.alpha, 0.02, 0.3, 3);
      return `radial-gradient(ellipse ${rx}% ${ry}% at ${x}% ${y}%, ${hexWithAlpha(spot.color, alpha)}, transparent 62%)`;
    });
    rules.push(
      `body::after { content: ""; position: fixed; inset: 0; pointer-events: none; z-index: -1; background-image: ${layers.join(', ')}; }`,
    );
  }
  return rules.join('\n');
}

/** Compiles declarative `chrome.ribbon` into Feed Sanity's Shadow DOM UI header bar. */
export function compileChromeUiCss(chrome: ThemeChromeConfig | undefined): string {
  return compileRibbonRule(chrome?.ribbon, '.dialog::before, .qp-root::before', 'absolute', 50);
}

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
 * Splits top-level CSS blocks cleanly so mixed normal and `!important` user rules
 * both win: `!important` blocks enter `@layer fs-user` (first layer = highest `!important`),
 * while normal blocks stay unlayered after all `@layer` blocks (highest normal priority).
 */
function formatUserCustomCss(customCss: string): string {
  if (!IMPORTANT_RE.test(customCss)) {
    return customCss;
  }
  const layeredBlocks: string[] = [];
  const normalBlocks: string[] = [];
  const pushBlock = (raw: string, hasImportant: boolean): void => {
    const block = raw.trim();
    if (!block) {
      return;
    }
    if (hasImportant) {
      layeredBlocks.push(block);
    } else {
      normalBlocks.push(block);
    }
  };

  let start = 0;
  let depth = 0;
  let quote: string | null = null;
  let inComment = false;
  let blockHasImportant = false;
  for (let i = 0; i < customCss.length; i++) {
    const ch = customCss[i];
    const next = customCss[i + 1];
    if (inComment) {
      if (ch === '*' && next === '/') {
        inComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (ch === '\\') {
        i++;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inComment = true;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '!' && !blockHasImportant) {
      const rest = customCss.slice(i);
      if (/^!\s*important\b/i.test(rest)) {
        blockHasImportant = true;
      }
    }
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        pushBlock(customCss.slice(start, i + 1), blockHasImportant);
        start = i + 1;
        blockHasImportant = false;
      }
    } else if (ch === ';' && depth === 0) {
      pushBlock(customCss.slice(start, i + 1), blockHasImportant);
      start = i + 1;
      blockHasImportant = false;
    }
  }
  let tail = customCss.slice(start).trim();
  if (tail) {
    if (blockHasImportant) {
      if (inComment) {
        tail += ' */';
      }
      if (depth > 0) {
        tail += '}'.repeat(depth);
      }
    }
    pushBlock(tail, blockHasImportant);
  }

  const parts: string[] = [];
  if (normalBlocks.length > 0) {
    parts.push(normalBlocks.join('\n\n'));
  }
  if (layeredBlocks.length > 0) {
    parts.push(wrapThemeLayer('fs-user', layeredBlocks.join('\n\n')));
  }
  return parts.join('\n\n');
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
  const hasLiveBackdrop = Boolean(theme.effects && theme.effects.backdrop !== 'none');
  const chromeCss = compileChromeHostCss(theme.chrome, hasLiveBackdrop);
  if (chromeCss) {
    mappingParts.push(chromeCss);
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
  const chromeUiCss = compileChromeUiCss(theme.chrome);
  if (chromeUiCss) {
    parts.push(chromeUiCss);
  }
  const uiFxCss = compileUiSurfaceCss(theme.palette, theme.effects);
  if (uiFxCss) {
    parts.push(uiFxCss);
  }
  return parts.join('\n\n');
}
