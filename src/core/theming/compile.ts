import type {
  ResolvedTheme,
  SiteThemeMapping,
  ThemeChromeConfig,
  ThemeColorScheme,
  ThemePalette,
} from './types';
import { compileBackdropRevealCss, compileSurfaceFinishCss } from '../theme-effects/surfaces';
import { hexToRgbTriplet, hexWithAlpha } from './color';
import {
  clampNumber,
  compileChromeUiCss,
  compileRibbonRule,
  compileUiThemeCss,
} from './compile-ui';
import {
  formatRootSelectors,
  TEXT_INPUT_SELECTOR,
  withThemeLayerOrder,
  wrapThemeLayer,
} from './types';

export { compileChromeUiCss, compileUiThemeCss };

const IMPORTANT_RE = /!\s*important\b/i;
const IMPORTANT_AT_INDEX_RE = /!\s*important\b/iy;

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
      IMPORTANT_AT_INDEX_RE.lastIndex = i;
      if (IMPORTANT_AT_INDEX_RE.test(customCss)) {
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

function buildMappingParts(
  theme: ResolvedTheme,
  mapping: SiteThemeMapping,
  target: 'host' | 'shadow',
): string[] {
  const parts: string[] = [];
  if (theme.palette) {
    const decls = buildPaletteDeclarations(theme.palette, mapping);
    const selectors = formatRootSelectors(
      mapping.rootSelectors,
      target === 'shadow' ? { shadow: true } : undefined,
    );
    parts.push(`${selectors} {\n  ${decls.join('\n  ')}\n}`);
  }
  if (theme.fontFamily) {
    parts.push(compileFontOverrideCss(theme.fontFamily, target));
  }
  const extraFn = target === 'shadow' ? mapping.shadowExtraCss : mapping.extraCss;
  const extra = theme.palette ? extraFn?.(theme.palette).trim() : undefined;
  if (extra) {
    parts.push(extra);
  }
  return parts;
}

/** Compiles `theme` + `mapping` into layered host-document CSS. */
export function compileHostThemeCss(
  theme: ResolvedTheme,
  mapping: SiteThemeMapping,
  hostScheme: ThemeColorScheme = theme.palette?.colorScheme ?? 'dark',
): string {
  const mappingParts = buildMappingParts(theme, mapping, 'host');
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
  const mappingParts = buildMappingParts(theme, mapping, 'shadow');
  const layers: string[] = [];
  if (mappingParts.length > 0) {
    layers.push(wrapThemeLayer('fs-mapping', mappingParts.join('\n\n')));
  }
  if (theme.customCss) {
    layers.push(formatUserCustomCss(theme.customCss));
  }
  return withThemeLayerOrder(layers);
}
