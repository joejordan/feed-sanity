// First-class multi-site theming engine.
//
// Compiles a single site-agnostic semantic `ResolvedTheme` (optional color
// palette + optional typography + optional custom CSS) onto any host site via
// its declarative `SiteThemeMapping`, automatically propagating into open host
// Shadow Roots (`:host`), same-origin iframes, and Feed Sanity's own Shadow DOM
// UI. Strictly Trusted Types safe (`style.textContent`) and 100% reversible.

export type { StudioVibe, ThemeEffectsConfig } from './theme-effects';
export { hexWithAlpha } from './theme';
export { DEFAULT_THEME_EFFECTS, hasActiveEffects, readThemeEffectsConfig } from './theme-effects';
export {
  contrastingText,
  contrastRatio,
  hexToHslTriplet,
  hexToRgbTriplet,
  mixHex,
  normalizeHex,
  relativeLuminance,
} from './theming/color-utils';
export { compileHostThemeCss, compileShadowThemeCss, compileUiThemeCss } from './theming/compile';
export {
  applyStudioVibe,
  applyThemePreset,
  clearThemeEffects,
  findActiveStudioVibe,
  readThemeConfig,
  resolveTheme,
} from './theming/config';
export {
  attachThemeScope,
  createThemeController,
  type ThemeController,
} from './theming/controller';
export {
  applyEarlyThemeCss,
  clearEarlyThemeStyle,
  readEarlyThemeCss,
  THEME_STYLE_ID,
  writeEarlyThemeCss,
} from './theming/early-cache';
export { BUILTIN_THEMES, findThemePreset } from './theming/presets';
export {
  type AdaptiveThemeMappingOptions,
  type BackdropRevealMetrics,
  DEFAULT_THEME_CONFIG,
  type ResolvedTheme,
  type SiteThemeMapping,
  type SurfaceRevealMetrics,
  type SurfaceSelectors,
  TEXT_INPUT_SELECTOR,
  THEME_DATA_KEY,
  THEME_FONT_STACKS,
  THEME_LAYER_ORDER,
  type ThemeColorScheme,
  type ThemeConfig,
  type ThemeFontId,
  type ThemePalette,
  type ThemePreset,
} from './theming/types';
