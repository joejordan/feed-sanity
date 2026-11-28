// Pure Feed Sanity UI theme CSS compiler (zero DOM, zero backdrop renderers,
// zero host surface selectors) so `popup.html` stays ultra-lightweight.

import type { ThemeEffectsConfig } from '../theme-effects/model';
import type { ResolvedTheme, ThemeChromeConfig, ThemePalette, ThemeRibbonSpec } from './types';
import { hexWithAlpha, mixHex, SEA_GLASS_TINT, SUNLIGHT } from './color';

/** Clamps `value` to `[min, max]` and rounds to `decimals` decimal places. */
export function clampNumber(value: number, min: number, max: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return Math.round(Math.min(max, Math.max(min, value)) * factor) / factor;
}

/** Returns the CSS `linear-gradient` background for an enabled ribbon, or `null` when it is off. */
export function compileRibbonBackground(ribbon: ThemeRibbonSpec | undefined): string | null {
  if (!ribbon?.enabled || ribbon.stops.length === 0) {
    return null;
  }
  const stops = ribbon.stops.length === 1 ? [ribbon.stops[0], ribbon.stops[0]] : ribbon.stops;
  const angle = clampNumber(ribbon.angle ?? 90, 0, 360, 0);
  return `linear-gradient(${angle}deg, ${stops.join(', ')})`;
}

/** Compiles a declarative `ThemeRibbonSpec` into a safe fixed/absolute edge ribbon rule. */
export function compileRibbonRule(
  ribbon: ThemeRibbonSpec | undefined,
  selector: string,
  position: 'fixed' | 'absolute',
  zIndex: number,
): string {
  const bg = compileRibbonBackground(ribbon);
  if (!ribbon || !bg) {
    return '';
  }
  const height = clampNumber(ribbon.height ?? 3, 1, 6, 0);
  const inset = ribbon.position === 'bottom' ? 'auto 0 0 0' : '0 0 auto 0';
  const layerHint = position === 'fixed' ? ' contain: strict; transform: translateZ(0);' : '';
  return `${selector} { content: ""; position: ${position}; inset: ${inset}; height: ${height}px; pointer-events: none; z-index: ${zIndex};${layerHint} background: ${bg}; }`;
}

/** Compiles declarative `chrome.ribbon` into Feed Sanity's Shadow DOM UI header bar. */
export function compileChromeUiCss(chrome: ThemeChromeConfig | undefined): string {
  return compileRibbonRule(chrome?.ribbon, '.dialog::before, .qp-root::before', 'absolute', 50);
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
  const secondary = palette?.accentSecondary ?? palette?.danger ?? '#ec4899';
  if (effects.surface === 'neon') {
    return `.dialog, .qp-root { box-shadow: 0 0 0 1px ${hexWithAlpha(accent, 0.45)}, 0 18px 48px ${hexWithAlpha(accent, 0.22)}; }`;
  }
  if (effects.surface === 'gradient') {
    return `.pane, .qp-body { background-image: linear-gradient(160deg, ${hexWithAlpha(accent, 0.08)} 0%, transparent 45%, ${hexWithAlpha(secondary, 0.06)} 100%); }`;
  }
  if (effects.surface === 'moonlit') {
    const text = palette?.text ?? '#f8fafc';
    return `.dialog, .qp-root { box-shadow: inset 0 1px 0 0 ${hexWithAlpha(text, 0.1)}, 0 26px 54px -22px ${hexWithAlpha(accent, 0.4)}, 0 24px 60px var(--fs-shadow-2); }`;
  }
  if (effects.surface === 'dappled') {
    const sun = palette?.accentSecondary ?? SUNLIGHT[palette?.colorScheme ?? 'dark'];
    return `.pane, .qp-body { background-image: radial-gradient(ellipse 42% 46% at 8% 0%, ${hexWithAlpha(sun, 0.08)} 0%, transparent 70%), radial-gradient(ellipse 46% 50% at 100% 100%, ${hexWithAlpha(accent, 0.06)} 0%, transparent 72%); }`;
  }
  if (effects.surface === 'caustic') {
    const scheme = palette?.colorScheme ?? 'dark';
    const isLight = scheme === 'light';
    const sun = palette?.accentSecondary ?? SUNLIGHT[scheme];
    const aqua = mixHex(accent, SEA_GLASS_TINT[scheme], 0.42);
    return [
      `.dialog, .qp-root { box-shadow: inset 0 1px 0 0 ${hexWithAlpha('#ffffff', isLight ? 0.7 : 0.16)}, inset 0 -1px 0 0 ${hexWithAlpha(aqua, 0.34)}, 0 24px 56px -18px ${hexWithAlpha(accent, isLight ? 0.24 : 0.38)}, 0 24px 60px var(--fs-shadow-2); }`,
      `.pane, .qp-body { background-image: radial-gradient(ellipse 46% 50% at 14% 0%, ${hexWithAlpha(aqua, 0.1)} 0%, transparent 72%), radial-gradient(ellipse 36% 40% at 72% 4%, ${hexWithAlpha(sun, 0.07)} 0%, transparent 72%), radial-gradient(ellipse 48% 52% at 96% 100%, ${hexWithAlpha(accent, 0.06)} 0%, transparent 74%); }`,
    ].join('\n');
  }
  return '';
}

const BRAND_TOKENS = {
  dark: [
    '--fs-brand-tittle: #ffdc98;',
    '--fs-brand-moon-start: #fffcee;',
    '--fs-brand-wake-start: #b9fff1;',
    '--fs-brand-wake-mid: #5be9e0;',
    '--fs-brand-wake-end: #22aeea;',
  ],
  light: [
    '--fs-brand-tittle: #b7791f;',
    '--fs-brand-moon-start: #f2c15a;',
    '--fs-brand-wake-start: #1ea6d6;',
    '--fs-brand-wake-mid: #1488b2;',
    '--fs-brand-wake-end: #0b6b8f;',
  ],
} as const;

/** Compiles `theme` into Feed Sanity's own Shadow DOM `--fs-*` token overrides. */
export function compileUiThemeCss(theme: ResolvedTheme): string {
  const lines: string[] = [];
  if (theme.palette) {
    const p = theme.palette;
    const isDark = p.colorScheme === 'dark';
    const hoverOverlay = isDark ? 'rgb(255 255 255 / 7%)' : 'rgb(0 0 0 / 5%)';
    const pressOverlay = isDark ? 'rgb(255 255 255 / 13%)' : 'rgb(0 0 0 / 10%)';
    lines.push(
      `color-scheme: ${p.colorScheme};`,
      `--fs-background: ${p.surface};`,
      `--fs-surface: ${p.background};`,
      `--fs-dialog-bg: ${p.surface};`,
      `--fs-sidebar-bg: ${p.background};`,
      `--fs-card-bg: ${isDark ? p.surfaceAlt : p.background};`,
      `--fs-control-bg: ${isDark ? p.background : p.surface};`,
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
      `--fs-shadow-2: ${isDark ? 'rgb(0 0 0 / 45%)' : 'rgb(0 0 0 / 18%)'};`,
      `--fs-input: ${p.background};`,
      `--fs-error: ${p.danger};`,
      ...BRAND_TOKENS[p.colorScheme],
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
