// Compiles site-safe backdrop reveal CSS (translucent page gutters + readable
// feed columns) and Surface Finishes (Glass, Gradient Sheen, Neon Edge) from
// one declarative `SurfaceSelectors` contract so no site ever creates
// stacking-context or `backdrop-filter` traps on ancestors or popups.

import type {
  SiteThemeMapping,
  SurfaceSelectors,
  ThemeColorScheme,
  ThemePalette,
} from '../theming/types';
import type { ThemeEffectsConfig } from './model';
import { OWN_ATTR } from '../surface';
import { hexWithAlpha } from '../theme';
import { TEXT_INPUT_SELECTOR } from '../theming/types';

export const BACKDROP_OWN_VALUE = 'theme-backdrop';
export const CLICK_FX_OWN_VALUE = 'theme-click-fx';

const DEFAULT_POPUPS: readonly string[] = ['[role="dialog"]', '[role="menu"]', '[role="listbox"]'];

/**
 * Computes safe surface alpha values from `glassStrength` (`0..0.65`) so text
 * on cards and reading columns ALWAYS maintains high contrast over live backdrops.
 * Blur radius is capped at `10px` to keep 30fps compositing lightweight.
 */
export function resolveGlassMetrics(glassStrength: number): {
  readonly columnAlpha: number;
  readonly cardAlpha: number;
  readonly blurPx: number;
} {
  const clamped = Math.max(0, Math.min(0.65, glassStrength));
  const columnAlpha = Number((0.92 - clamped * 0.34).toFixed(2));
  const cardAlpha = Number((0.95 - clamped * 0.28).toFixed(2));
  const blurPx = Math.min(10, Math.round(5 + clamped * 8));
  return { columnAlpha, cardAlpha, blurPx };
}

function compileDeclarativeReveal(
  mapping: Pick<SiteThemeMapping, 'rootSelectors' | 'surfaces'>,
  palette: ThemePalette | null,
  baseBg: string,
  surfaceBg: string,
  metrics: { readonly columnAlpha: number; readonly cardAlpha: number; readonly blurPx: number },
  enableBlur: boolean,
): { readonly shellCss: string; readonly revealCss: string } {
  const surfaces = mapping.surfaces;
  if (!surfaces) {
    return { shellCss: '', revealCss: '' };
  }
  const popupAlpha = Math.max(0.96, metrics.cardAlpha);
  const fullMetrics = { ...metrics, popupAlpha };
  const shellBlocks: string[] = [];
  const revealBlocks: string[] = [];

  // Bind `--fs-reveal-canvas` to transparent at the document root so Layer 1
  // canvas-tier backgrounds automatically reveal the Studio backdrop without
  // needing per-site RNW class blacklists or deep `:has()` chains.
  const rootSel = mapping.rootSelectors.length > 0 ? mapping.rootSelectors.join(', ') : ':root';
  const rootVars: Record<string, string> = {
    '--fs-reveal-canvas': 'transparent',
    ...(surfaces.revealCssVars ? surfaces.revealCssVars(palette, fullMetrics) : {}),
  };
  const varDecls = Object.entries(rootVars).map(([name, val]) => `  ${name}: ${val} !important;`);
  revealBlocks.push(`${rootSel} {\n${varDecls.join('\n')}\n}`);

  if (surfaces.transparentShell && surfaces.transparentShell.length > 0) {
    const shell = surfaces.transparentShell;
    const basicShell = shell.filter((sel) => !sel.includes(':has('));
    const hasShell = shell.filter((sel) => sel.includes(':has('));
    if (basicShell.length > 0) {
      shellBlocks.push(
        `${basicShell.join(',\n')} {\n  background-color: transparent !important;\n  background-image: none !important;\n}`,
      );
    }
    if (hasShell.length > 0) {
      shellBlocks.push(
        `${hasShell.join(',\n')} {\n  background-color: transparent !important;\n  background-image: none !important;\n}`,
      );
    }
  }

  if (surfaces.extraRevealCss) {
    const extra = surfaces.extraRevealCss(palette, fullMetrics).trim();
    if (extra) {
      revealBlocks.push(extra);
    }
  }

  if (surfaces.columns && surfaces.columns.length > 0) {
    const scale = surfaces.columnAlphaScale ?? 1;
    const colAlpha = Number(Math.max(0.5, Math.min(1, metrics.columnAlpha * scale)).toFixed(2));
    const colBg = hexWithAlpha(baseBg, colAlpha);
    revealBlocks.push(
      `${surfaces.columns.join(',\n')} {\n  --fs-reveal-canvas: transparent;\n  background-color: ${colBg} !important;\n}`,
    );
  }

  if (surfaces.softSurfaces && surfaces.softSurfaces.length > 0) {
    const softBg = hexWithAlpha(surfaceBg, metrics.cardAlpha);
    revealBlocks.push(
      `${surfaces.softSurfaces.join(',\n')} {\n  --fs-reveal-canvas: transparent;\n  background-color: ${softBg} !important;\n}`,
    );
  }

  if (surfaces.leafCards && surfaces.leafCards.length > 0) {
    const cardBg = hexWithAlpha(surfaceBg, metrics.cardAlpha);
    const blurDecls = enableBlur
      ? `\n  backdrop-filter: blur(${metrics.blurPx}px);\n  -webkit-backdrop-filter: blur(${metrics.blurPx}px);`
      : '';
    // Re-bind `--fs-reveal-canvas: transparent` inside leafCards so nested rows
    // (e.g. "What's happening" trends) never paint opaque boxes over frosted cards.
    revealBlocks.push(
      `${surfaces.leafCards.join(',\n')} {\n  --fs-reveal-canvas: transparent;\n  background-color: ${cardBg} !important;${blurDecls}\n}`,
    );
  }

  const popups = surfaces.popups && surfaces.popups.length > 0 ? surfaces.popups : DEFAULT_POPUPS;
  const popBg = hexWithAlpha(surfaceBg, popupAlpha);
  revealBlocks.push(
    `${popups.join(',\n')} {\n  --fs-reveal-canvas: ${popBg};\n  background-color: ${popBg} !important;\n}`,
  );

  return {
    shellCss: shellBlocks.join('\n\n'),
    revealCss: revealBlocks.join('\n\n'),
  };
}

/**
 * Compiles layered CSS (`@layer fs-reveal-shell` + `@layer fs-reveal`) that
 * positions the live backdrop at `z-index: -1` behind the host application while
 * making outer canvas wrappers transparent and keeping reading columns, cards,
 * and popups readable.
 */
export function compileBackdropRevealCss(
  palette: ThemePalette | null,
  hostScheme: ThemeColorScheme,
  effects: ThemeEffectsConfig,
  mapping?: Pick<SiteThemeMapping, 'rootSelectors' | 'surfaces' | 'backdropRevealCss'>,
): string {
  if (effects.backdrop === 'none') {
    return '';
  }
  const metrics = resolveGlassMetrics(effects.glassStrength);
  const baseBg = palette?.background ?? (hostScheme === 'light' ? '#f8fafc' : '#06090f');
  const surfaceBg = palette?.surface ?? (hostScheme === 'light' ? '#ffffff' : '#111622');

  const genericReveal = `
html {
  background-color: ${baseBg} !important;
}
:root body,
body {
  background-color: transparent !important;
  background-image: none !important;
}
body::after {
  display: none !important;
}
[${OWN_ATTR}="${BACKDROP_OWN_VALUE}"] {
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  overflow: hidden;
  contain: strict;
  opacity: ${effects.intensity};
  transition: opacity 220ms ease;
}`;

  if (mapping?.surfaces) {
    const { shellCss, revealCss } = compileDeclarativeReveal(
      mapping,
      palette,
      baseBg,
      surfaceBg,
      metrics,
      effects.surface === 'glass',
    );
    const blocks: string[] = [];
    if (shellCss) {
      blocks.push(`@layer fs-reveal-shell {\n${shellCss}\n}`);
    }
    blocks.push(`@layer fs-reveal {\n${genericReveal.trim()}\n\n${revealCss}\n}`);
    return blocks.join('\n\n');
  }

  const legacySiteCss = mapping?.backdropRevealCss?.(palette, metrics).trim();
  const fallbackCards = legacySiteCss
    ? legacySiteCss
    : `
main, [role="main"], article {
  background-color: ${hexWithAlpha(surfaceBg, metrics.cardAlpha)} !important;
}
${DEFAULT_POPUPS.join(', ')} {
  background-color: ${hexWithAlpha(surfaceBg, Math.max(0.96, metrics.cardAlpha))} !important;
}`;

  return `@layer fs-reveal {\n${genericReveal.trim()}\n\n${fallbackCards.trim()}\n}`;
}

/**
 * Compiles site-agnostic Surface Finish enhancements (`glass`, `gradient`, `neon`)
 * emitted into `@layer fs-finish` so finishes cleanly outrank `fs-reveal` and
 * `fs-mapping` without `:where(...)` specificity loss or hardcoded site selectors.
 */
export function compileSurfaceFinishCss(
  palette: ThemePalette | null,
  hostScheme: ThemeColorScheme,
  effects: ThemeEffectsConfig,
  surfaces?: SurfaceSelectors,
): string {
  if (effects.surface === 'default') {
    return '';
  }
  const accent = palette?.accent ?? (hostScheme === 'light' ? '#2563eb' : '#3b82f6');
  const surface = palette?.surface ?? (hostScheme === 'light' ? '#ffffff' : '#131926');
  const alt = palette?.surfaceAlt ?? (hostScheme === 'light' ? '#f1f5f9' : '#1c2436');
  const text = palette?.text ?? (hostScheme === 'light' ? '#0f172a' : '#f8fafc');
  const border = palette?.border ?? (hostScheme === 'light' ? '#cbd5e1' : '#2b364d');
  const danger = palette?.danger ?? '#ec4899';

  const leafList = surfaces?.leafCards ?? [];
  const popupList =
    surfaces?.popups && surfaces.popups.length > 0 ? surfaces.popups : DEFAULT_POPUPS;

  const leafTargets = leafList.join(',\n');
  const popupTargets = popupList.join(',\n');
  const cardTargets = [leafTargets, popupTargets].filter(Boolean).join(',\n');
  const ctaTargets = surfaces?.primaryCtas?.join(',\n') ?? '';
  const feedCardTargets = surfaces?.feedCards?.join(',\n') ?? '';
  const columnTargets = surfaces?.columns?.join(',\n') ?? '';
  const searchTargets = surfaces?.searchContainers?.join(',\n') ?? '';

  if (effects.surface === 'glass') {
    const { cardAlpha, blurPx } = resolveGlassMetrics(Math.max(0.24, effects.glassStrength));
    const highlight = hexWithAlpha(text, hostScheme === 'light' ? 0.14 : 0.08);
    const blocks: string[] = [];
    if (leafTargets) {
      blocks.push(
        `${leafTargets} {\n  background-color: ${hexWithAlpha(surface, cardAlpha)} !important;\n  backdrop-filter: blur(${blurPx}px) saturate(125%) !important;\n  -webkit-backdrop-filter: blur(${blurPx}px) saturate(125%) !important;\n  box-shadow: inset 0 1px 0 0 ${highlight}, 0 8px 24px rgb(0 0 0 / 18%) !important;\n}`,
      );
    }
    blocks.push(
      `${popupTargets} {\n  background-color: ${hexWithAlpha(surface, Math.max(0.96, cardAlpha))} !important;\n  box-shadow: inset 0 1px 0 0 ${highlight}, 0 10px 28px rgb(0 0 0 / 26%) !important;\n}`,
    );
    return blocks.join('\n\n');
  }

  if (effects.surface === 'gradient') {
    const sheenA = hexWithAlpha(accent, hostScheme === 'light' ? 0.08 : 0.14);
    const sheenB = hexWithAlpha(danger, hostScheme === 'light' ? 0.05 : 0.1);
    const blocks: string[] = [
      `${cardTargets} {\n  background-image: linear-gradient(145deg, ${sheenA} 0%, ${hexWithAlpha(surface, 0.02)} 48%, ${sheenB} 100%) !important;\n}`,
    ];
    if (ctaTargets) {
      blocks.push(
        `${ctaTargets} {\n  background-image: linear-gradient(135deg, ${accent} 0%, ${danger} 100%) !important;\n}`,
      );
    }
    return blocks.join('\n\n');
  }

  // 'neon'
  const blocks: string[] = [
    `${cardTargets} {\n  border-color: ${hexWithAlpha(accent, 0.45)} !important;\n  box-shadow: 0 0 0 1px ${hexWithAlpha(accent, 0.25)}, 0 0 18px ${hexWithAlpha(accent, 0.16)} !important;\n}`,
    `${TEXT_INPUT_SELECTOR}:focus-visible, textarea:focus-visible {\n  box-shadow: 0 0 0 2px ${hexWithAlpha(accent, 0.5)}, 0 0 14px ${hexWithAlpha(accent, 0.28)} !important;\n}`,
  ];
  if (feedCardTargets) {
    blocks.push(
      `${feedCardTargets}:hover {\n  box-shadow: inset 2px 0 0 0 ${accent}, 0 0 16px ${hexWithAlpha(accent, 0.14)} !important;\n}`,
    );
  }
  if (ctaTargets) {
    blocks.push(
      `${ctaTargets} {\n  box-shadow: 0 0 16px ${hexWithAlpha(accent, 0.48)}, inset 0 0 0 1px ${hexWithAlpha(text, 0.2)} !important;\n}`,
    );
  }
  if (columnTargets) {
    blocks.push(
      `${columnTargets} {\n  border-color: ${hexWithAlpha(accent, 0.3)} !important;\n  box-shadow: 0 0 24px ${hexWithAlpha(border, 0.24)} !important;\n}`,
    );
  }
  if (searchTargets) {
    blocks.push(
      `${searchTargets} {\n  background-color: ${hexWithAlpha(alt, 0.9)} !important;\n  border-color: ${hexWithAlpha(accent, 0.4)} !important;\n}`,
    );
  }
  return blocks.join('\n\n');
}

/** Subtle matching surface finish polish inside Feed Sanity's own Shadow DOM UI. */
export function compileUiSurfaceCss(
  palette: ThemePalette | null,
  effects: ThemeEffectsConfig | undefined,
): string {
  if (!effects || effects.surface === 'default') {
    return '';
  }
  const accent = palette?.accent ?? '#3b82f6';
  const danger = palette?.danger ?? '#ec4899';
  if (effects.surface === 'neon') {
    return `.dialog, .qp-root { box-shadow: 0 0 0 1px ${hexWithAlpha(accent, 0.45)}, 0 18px 48px ${hexWithAlpha(accent, 0.22)}; }`;
  }
  if (effects.surface === 'gradient') {
    return `.dialog-main, .qp-body { background-image: linear-gradient(160deg, ${hexWithAlpha(accent, 0.08)} 0%, transparent 45%, ${hexWithAlpha(danger, 0.06)} 100%); }`;
  }
  return '';
}
