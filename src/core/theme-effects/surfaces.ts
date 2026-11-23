// Compiles site-safe backdrop reveal CSS (translucent page gutters + readable
// frosted glass feed columns) and Surface Finishes (Glass, Gradient Sheen, Neon Edge).

import type { ThemeColorScheme, ThemePalette } from '../theming';
import type { ThemeEffectsConfig } from './model';
import { OWN_ATTR } from '../surface';
import { hexWithAlpha } from '../theme';

export const BACKDROP_OWN_VALUE = 'theme-backdrop';
export const CLICK_FX_OWN_VALUE = 'theme-click-fx';

/**
 * Computes safe surface alpha values from `glassStrength` (`0..0.65`) so text
 * on cards and reading columns ALWAYS maintains high contrast over live backdrops.
 */
export function resolveGlassMetrics(glassStrength: number): {
  readonly columnAlpha: number;
  readonly cardAlpha: number;
  readonly blurPx: number;
} {
  const clamped = Math.max(0, Math.min(0.65, glassStrength));
  const columnAlpha = Number((0.92 - clamped * 0.34).toFixed(2));
  const cardAlpha = Number((0.95 - clamped * 0.28).toFixed(2));
  const blurPx = Math.round(6 + clamped * 18);
  return { columnAlpha, cardAlpha, blurPx };
}

/**
 * Compiles CSS that layers the active backdrop cleanly at `z-index: 0` behind
 * the host application while making outer canvas wrappers transparent so live
 * backgrounds (Matrix Rain, Vice Horizon, Aurora, Constellations, etc.) shine
 * dramatically through margins and gently behind frosted cards.
 */
export function compileBackdropRevealCss(
  palette: ThemePalette | null,
  hostScheme: ThemeColorScheme,
  effects: ThemeEffectsConfig,
  siteRevealCss?: (
    palette: ThemePalette | null,
    metrics: { readonly columnAlpha: number; readonly cardAlpha: number; readonly blurPx: number },
  ) => string,
): string {
  if (effects.backdrop === 'none') {
    return '';
  }
  const metrics = resolveGlassMetrics(effects.glassStrength);
  const baseBg = palette?.background ?? (hostScheme === 'light' ? '#f8fafc' : '#06090f');
  const surfaceBg = palette?.surface ?? (hostScheme === 'light' ? '#ffffff' : '#111622');
  const siteCustom = siteRevealCss?.(palette, metrics).trim();

  const genericReveal = `
html {
  background-color: ${baseBg} !important;
}
body {
  background-color: transparent !important;
  background-image: none !important;
}
body > :not([${OWN_ATTR}]) {
  position: relative;
  z-index: 1;
}
[${OWN_ATTR}="${BACKDROP_OWN_VALUE}"] {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
  contain: strict;
  opacity: ${effects.intensity};
  transition: opacity 220ms ease;
}`;

  const fallbackCards = siteCustom
    ? siteCustom
    : `
main, [role="main"], article, [role="dialog"], [role="menu"] {
  background-color: ${hexWithAlpha(surfaceBg, metrics.cardAlpha)} !important;
  backdrop-filter: blur(${metrics.blurPx}px);
  -webkit-backdrop-filter: blur(${metrics.blurPx}px);
}`;

  return [genericReveal.trim(), fallbackCards.trim()].filter(Boolean).join('\n\n');
}

/**
 * Compiles optional Surface Finish enhancements (`glass`, `gradient`, `neon`)
 * onto host cards, sidebars, headers, dialogs, and buttons while preserving
 * exact layout geometry (using box-shadow/background-image, never changing box sizes).
 */
export function compileSurfaceFinishCss(
  palette: ThemePalette | null,
  hostScheme: ThemeColorScheme,
  effects: ThemeEffectsConfig,
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

  const cardTargets =
    ':where([role="dialog"], [role="menu"], [data-testid="Dropdown"], [data-testid="HoverCard"], [data-testid="sidebarColumn"] section, [data-testid="sidebarColumn"] aside, shreddit-post)';

  if (effects.surface === 'glass') {
    const { cardAlpha, blurPx } = resolveGlassMetrics(Math.max(0.24, effects.glassStrength));
    const highlight = hexWithAlpha(text, hostScheme === 'light' ? 0.14 : 0.08);
    return `
${cardTargets} {
  background-color: ${hexWithAlpha(surface, cardAlpha)} !important;
  backdrop-filter: blur(${blurPx}px) saturate(135%) !important;
  -webkit-backdrop-filter: blur(${blurPx}px) saturate(135%) !important;
  box-shadow: inset 0 1px 0 0 ${highlight}, 0 8px 28px rgb(0 0 0 / 18%) !important;
}`.trim();
  }

  if (effects.surface === 'gradient') {
    const sheenA = hexWithAlpha(accent, hostScheme === 'light' ? 0.08 : 0.14);
    const sheenB = hexWithAlpha(danger, hostScheme === 'light' ? 0.05 : 0.1);
    return `
${cardTargets} {
  background-image: linear-gradient(145deg, ${sheenA} 0%, ${hexWithAlpha(surface, 0.02)} 48%, ${sheenB} 100%) !important;
}
:where([data-testid="SideNav_NewTweet_Button"], [data-testid="tweetButtonInline"], [data-testid="tweetButton"], div[role="button"][gh="cm"]) {
  background-image: linear-gradient(135deg, ${accent} 0%, ${danger} 100%) !important;
}
:where(button, [role="button"]):hover {
  background-image: linear-gradient(135deg, ${hexWithAlpha(accent, 0.12)}, transparent 80%);
}`.trim();
  }

  // 'neon'
  return `
${cardTargets} {
  border-color: ${hexWithAlpha(accent, 0.45)} !important;
  box-shadow: 0 0 0 1px ${hexWithAlpha(accent, 0.25)}, 0 0 18px ${hexWithAlpha(accent, 0.16)} !important;
}
:where(article[data-testid="tweet"], shreddit-post):hover {
  box-shadow: inset 2px 0 0 0 ${accent}, 0 0 16px ${hexWithAlpha(accent, 0.14)} !important;
}
:where([data-testid="SideNav_NewTweet_Button"], [data-testid="tweetButtonInline"], [data-testid="tweetButton"], div[role="button"][gh="cm"]) {
  box-shadow: 0 0 16px ${hexWithAlpha(accent, 0.48)}, inset 0 0 0 1px ${hexWithAlpha(text, 0.2)} !important;
}
:where([data-testid="primaryColumn"]) {
  border-color: ${hexWithAlpha(accent, 0.3)} !important;
  box-shadow: 0 0 28px ${hexWithAlpha(border, 0.25)} !important;
}
:where(input, textarea):focus-visible {
  box-shadow: 0 0 0 2px ${hexWithAlpha(accent, 0.5)}, 0 0 14px ${hexWithAlpha(accent, 0.28)} !important;
}
:where([data-testid="sidebarColumn"] form[role="search"] > div > div) {
  background-color: ${hexWithAlpha(alt, 0.9)} !important;
  border-color: ${hexWithAlpha(accent, 0.4)} !important;
}`.trim();
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
