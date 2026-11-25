// Compiles site-safe backdrop reveal CSS (translucent page gutters + readable
// feed columns) and Surface Finishes (Glass, Gradient Sheen, Neon, Prism) from
// one declarative `SurfaceSelectors` contract so no site ever creates
// stacking-context or `backdrop-filter` traps on ancestors or popups.

import type {
  SiteThemeMapping,
  SurfaceSelectors,
  ThemeColorScheme,
  ThemePalette,
} from '../theming/types';
import type { ThemeEffectsConfig } from './model';
import { OWN_ATTR, SHELL_ATTR } from '../surface';
import { splitSelectorList } from '../theming/adaptive-compiler';
import { hexWithAlpha } from '../theming/color';
import { formatRootSelectors, TEXT_INPUT_SELECTOR, wrapThemeLayer } from '../theming/types';
import { getSurfaceParamSpecs, resolveEffectParams, THEME_EFFECT_BOUNDS } from './model';

export const BACKDROP_OWN_VALUE = 'theme-backdrop';
export const BACKDROP_SELECTOR = `[${OWN_ATTR}="${BACKDROP_OWN_VALUE}"]`;
export const CLICK_FX_OWN_VALUE = 'theme-click-fx';
export const PRISM_ANGLE_VAR = '--fs-ptr-angle';

export const DEFAULT_POPUPS: readonly string[] = [
  '[role="dialog"]',
  '[role="menu"]',
  '[role="listbox"]',
];
export const DEFAULT_SHELL_LANDMARKS: readonly string[] = ['main', '[role="main"]'];

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
  const clamped = Math.max(
    THEME_EFFECT_BOUNDS.glassStrength.min,
    Math.min(THEME_EFFECT_BOUNDS.glassStrength.max, glassStrength),
  );
  const columnAlpha = Number((0.92 - clamped * 0.34).toFixed(2));
  const cardAlpha = Number((0.95 - clamped * 0.28).toFixed(2));
  const blurPx = Math.min(8, Math.round(4 + clamped * 6));
  return { columnAlpha, cardAlpha, blurPx };
}

function compileTransparentShellCss(extraShell?: readonly string[]): string {
  const shellSelectors: string[] = [`[${SHELL_ATTR}]`, ...(extraShell ?? [])];
  const basicShell = shellSelectors.filter((sel) => !sel.includes(':has('));
  const hasShell = shellSelectors.filter((sel) => sel.includes(':has('));
  const blocks: string[] = [
    `${basicShell.join(',\n')} {\n  background-color: transparent !important;\n  background-image: none !important;\n}`,
  ];
  if (hasShell.length > 0) {
    blocks.push(
      `${hasShell.join(',\n')} {\n  background-color: transparent !important;\n  background-image: none !important;\n}`,
    );
  }
  return blocks.join('\n\n');
}

function compileDeclarativeReveal(
  rootSelectors: readonly string[],
  surfaces: SurfaceSelectors,
  palette: ThemePalette | null,
  baseBg: string,
  surfaceBg: string,
  metrics: { readonly columnAlpha: number; readonly cardAlpha: number; readonly blurPx: number },
): { readonly shellCss: string; readonly revealCss: string } {
  const popupAlpha = Math.max(0.96, metrics.cardAlpha);
  const fullMetrics = { ...metrics, popupAlpha };
  const revealBlocks: string[] = [];

  // Bind `--fs-reveal-canvas` to transparent at the document root so Layer 1
  // canvas-tier backgrounds automatically reveal the Studio backdrop without
  // needing per-site RNW class blacklists or deep `:has()` chains.
  const rootSel = formatRootSelectors(rootSelectors);
  const rootVars: Record<string, string> = {
    '--fs-reveal-canvas': 'transparent',
    ...(surfaces.revealCssVars ? surfaces.revealCssVars(palette, fullMetrics) : {}),
  };
  const varDecls = Object.entries(rootVars).map(([name, val]) => `  ${name}: ${val} !important;`);
  revealBlocks.push(`${rootSel} {\n${varDecls.join('\n')}\n}`);

  // Universal ancestor shell markers stamped dynamically by `ThemeController`
  // replace per-site `> div > div` ladders across every current and future site.
  const shellCss = compileTransparentShellCss(surfaces.transparentShell);

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
    // Re-bind `--fs-reveal-canvas: transparent` inside leafCards so nested rows
    // (e.g. "What's happening" trends) never paint opaque boxes over frosted cards.
    // Glass `backdrop-filter: blur()` is owned solely by `compileSurfaceFinishCss` in `@layer fs-finish`.
    revealBlocks.push(
      `${surfaces.leafCards.join(',\n')} {\n  --fs-reveal-canvas: transparent;\n  background-color: ${cardBg} !important;\n}`,
    );
  }

  const popups = surfaces.popups && surfaces.popups.length > 0 ? surfaces.popups : DEFAULT_POPUPS;
  const popBg = hexWithAlpha(surfaceBg, popupAlpha);
  revealBlocks.push(
    `${popups.join(',\n')} {\n  --fs-reveal-canvas: ${popBg};\n  background-color: ${popBg} !important;\n}`,
  );

  return {
    shellCss,
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
  mapping?: Pick<SiteThemeMapping, 'rootSelectors' | 'surfaces'>,
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
${BACKDROP_SELECTOR} {
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  overflow: hidden;
  contain: strict;
  transition: opacity 220ms ease;
}`;

  if (mapping?.surfaces) {
    const { shellCss, revealCss } = compileDeclarativeReveal(
      mapping.rootSelectors,
      mapping.surfaces,
      palette,
      baseBg,
      surfaceBg,
      metrics,
    );
    return [
      wrapThemeLayer('fs-reveal-shell', shellCss),
      wrapThemeLayer('fs-reveal', `${genericReveal.trim()}\n\n${revealCss}`),
    ].join('\n\n');
  }

  const fallbackShell = wrapThemeLayer('fs-reveal-shell', compileTransparentShellCss());
  const fallbackCards = `
${DEFAULT_SHELL_LANDMARKS.join(', ')}, article {
  background-color: ${hexWithAlpha(surfaceBg, metrics.cardAlpha)} !important;
}
${DEFAULT_POPUPS.join(', ')} {
  background-color: ${hexWithAlpha(surfaceBg, Math.max(0.96, metrics.cardAlpha))} !important;
}`;

  return [
    fallbackShell,
    wrapThemeLayer('fs-reveal', `${genericReveal.trim()}\n\n${fallbackCards.trim()}`),
  ].join('\n\n');
}

function scaledHex(hex: string, alpha: number): string {
  return hexWithAlpha(hex, Number(Math.min(0.85, Math.max(0.02, alpha)).toFixed(3)));
}

/**
 * Compiles site-agnostic Surface Finish enhancements (`glass`, `gradient`, `neon`, `prism`)
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
  const secondary = palette?.accentSecondary ?? palette?.danger ?? '#ec4899';

  const leafTargets = surfaces?.leafCards?.join(',\n') ?? '';
  const popupTargets = (
    surfaces?.popups && surfaces.popups.length > 0 ? surfaces.popups : DEFAULT_POPUPS
  ).join(',\n');

  const sp = resolveEffectParams(getSurfaceParamSpecs(effects.surface), effects.surfaceParams);

  if (effects.surface === 'glass') {
    const { cardAlpha, blurPx } = resolveGlassMetrics(Math.max(0.24, effects.glassStrength));
    const satPct = Math.round(((sp.saturation as number | undefined) ?? 1.25) * 100);
    const highlight = hexWithAlpha(text, hostScheme === 'light' ? 0.14 : 0.08);
    const blocks: string[] = [];
    if (leafTargets) {
      blocks.push(
        `${leafTargets} {\n  background-color: ${hexWithAlpha(surface, cardAlpha)} !important;\n  backdrop-filter: blur(${blurPx}px) saturate(${satPct}%) !important;\n  -webkit-backdrop-filter: blur(${blurPx}px) saturate(${satPct}%) !important;\n  box-shadow: inset 0 1px 0 0 ${highlight}, 0 8px 24px rgb(0 0 0 / 18%) !important;\n}`,
      );
    }
    blocks.push(
      `${popupTargets} {\n  background-color: ${hexWithAlpha(surface, Math.max(0.96, cardAlpha))} !important;\n  box-shadow: inset 0 1px 0 0 ${highlight}, 0 10px 28px rgb(0 0 0 / 26%) !important;\n}`,
    );
    return blocks.join('\n\n');
  }

  const cardTargets = [leafTargets, popupTargets].filter(Boolean).join(',\n');
  const ctaTargets = surfaces?.primaryCtas?.join(',\n') ?? '';

  if (effects.surface === 'gradient') {
    const angle = Math.round((sp.angle as number | undefined) ?? 145);
    const strength = (sp.strength as number | undefined) ?? 1;
    const sheenA = scaledHex(accent, (hostScheme === 'light' ? 0.08 : 0.14) * strength);
    const sheenB = scaledHex(secondary, (hostScheme === 'light' ? 0.05 : 0.1) * strength);
    const blocks: string[] = [
      `${cardTargets} {\n  background-image: linear-gradient(${angle}deg, ${sheenA} 0%, ${hexWithAlpha(surface, 0.02)} 48%, ${sheenB} 100%) !important;\n}`,
    ];
    if (ctaTargets) {
      blocks.push(
        `${ctaTargets} {\n  background-image: linear-gradient(${Math.max(0, angle - 10)}deg, ${accent} 0%, ${secondary} 100%) !important;\n}`,
      );
    }
    return blocks.join('\n\n');
  }

  const feedCardHoverTargets =
    surfaces?.feedCards
      ?.flatMap((entry) => splitSelectorList(entry).map((sel) => `${sel}:hover`))
      .join(',\n') ?? '';
  const columnTargets = surfaces?.columns?.join(',\n') ?? '';
  const searchTargets = surfaces?.searchContainers?.join(',\n') ?? '';

  if (effects.surface === 'prism') {
    const isLight = hostScheme === 'light';
    const strength = (sp.strength as number | undefined) ?? 1;
    const glow = (sp.glow as number | undefined) ?? 1;
    const baseAngle = Math.round((sp.baseAngle as number | undefined) ?? 132);
    const sheenA = scaledHex(accent, (isLight ? 0.1 : 0.14) * strength);
    const sheenB = scaledHex(secondary, (isLight ? 0.08 : 0.13) * strength);
    const highlight = scaledHex(text, (isLight ? 0.18 : 0.11) * strength);
    const rim = scaledHex(accent, (isLight ? 0.28 : 0.34) * glow);
    const outerGlow = scaledHex(secondary, (isLight ? 0.1 : 0.14) * glow);
    const angleExpr = `var(${PRISM_ANGLE_VAR}, ${baseAngle}deg)`;
    const blocks: string[] = [
      `${cardTargets} {\n  background-image: linear-gradient(${angleExpr}, ${sheenA} 0%, ${hexWithAlpha(surface, 0.02)} 42%, ${sheenB} 100%) !important;\n  border-color: ${rim} !important;\n  box-shadow: inset 0 1px 0 0 ${highlight}, 0 0 0 1px ${scaledHex(accent, 0.18 * glow)}, 0 6px 16px ${outerGlow} !important;\n}`,
      `${TEXT_INPUT_SELECTOR}:focus-visible, textarea:focus-visible {\n  box-shadow: 0 0 0 2px ${scaledHex(accent, 0.55 * glow)}, 0 0 14px ${scaledHex(secondary, 0.32 * glow)} !important;\n}`,
    ];
    if (feedCardHoverTargets) {
      blocks.push(
        `${feedCardHoverTargets} {\n  box-shadow: inset 2px 0 0 0 ${accent}, inset 0 1px 0 0 ${highlight}, inset 0 0 12px ${scaledHex(accent, 0.14 * glow)} !important;\n}`,
      );
    }
    if (ctaTargets) {
      blocks.push(
        `${ctaTargets} {\n  background-image: linear-gradient(${angleExpr}, ${accent} 0%, ${secondary} 100%) !important;\n  box-shadow: 0 0 12px ${scaledHex(accent, 0.4 * glow)}, inset 0 1px 0 0 ${hexWithAlpha(text, 0.28)} !important;\n}`,
      );
    }
    if (columnTargets) {
      blocks.push(
        `${columnTargets} {\n  border-color: ${scaledHex(accent, 0.24 * glow)} !important;\n  box-shadow: 0 0 0 1px ${scaledHex(secondary, 0.2 * glow)} !important;\n}`,
      );
    }
    if (searchTargets) {
      blocks.push(
        `${searchTargets} {\n  background-color: ${hexWithAlpha(alt, 0.9)} !important;\n  border-color: ${scaledHex(accent, 0.36 * glow)} !important;\n}`,
      );
    }
    return blocks.join('\n\n');
  }

  // 'neon'
  const glow = (sp.glow as number | undefined) ?? 1;
  const blocks: string[] = [
    `${cardTargets} {\n  border-color: ${scaledHex(accent, 0.45 * glow)} !important;\n  box-shadow: 0 0 0 1px ${scaledHex(accent, 0.25 * glow)}, 0 0 16px ${scaledHex(accent, 0.16 * glow)} !important;\n}`,
    `${TEXT_INPUT_SELECTOR}:focus-visible, textarea:focus-visible {\n  box-shadow: 0 0 0 2px ${scaledHex(accent, 0.5 * glow)}, 0 0 12px ${scaledHex(accent, 0.28 * glow)} !important;\n}`,
  ];
  if (feedCardHoverTargets) {
    blocks.push(
      `${feedCardHoverTargets} {\n  box-shadow: inset 2px 0 0 0 ${accent}, inset 0 0 12px ${scaledHex(accent, 0.14 * glow)} !important;\n}`,
    );
  }
  if (ctaTargets) {
    blocks.push(
      `${ctaTargets} {\n  box-shadow: 0 0 12px ${scaledHex(accent, 0.46 * glow)}, inset 0 0 0 1px ${hexWithAlpha(text, 0.2)} !important;\n}`,
    );
  }
  if (columnTargets) {
    blocks.push(
      `${columnTargets} {\n  border-color: ${scaledHex(accent, 0.3 * glow)} !important;\n  box-shadow: 0 0 0 1px ${scaledHex(border, 0.28 * glow)} !important;\n}`,
    );
  }
  if (searchTargets) {
    blocks.push(
      `${searchTargets} {\n  background-color: ${hexWithAlpha(alt, 0.9)} !important;\n  border-color: ${scaledHex(accent, 0.4 * glow)} !important;\n}`,
    );
  }
  return blocks.join('\n\n');
}
