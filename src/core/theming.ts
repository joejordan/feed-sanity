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
  getPaletteSwatches,
  hexToHslTriplet,
  hexToRgbTriplet,
  hydratePalette,
  minTextContrast,
  mixHex,
  normalizeHex,
  pickAccessibleText,
  relativeLuminance,
  WCAG_AA_ACCENT_CONTRAST,
  WCAG_AA_TEXT_CONTRAST,
} from './theming/color-utils';
export {
  compileChromeHostCss,
  compileChromeUiCss,
  compileHostThemeCss,
  compileShadowThemeCss,
  compileUiThemeCss,
} from './theming/compile';
export {
  applyStudioVibe,
  applyThemeDocument,
  applyThemePreset,
  clearThemeEffects,
  findActiveStudioVibe,
  readThemeConfig,
  resolveTheme,
  themeConfigToDocument,
} from './theming/config';
export {
  attachThemeScope,
  createThemeController,
  type ThemeController,
} from './theming/controller';
export {
  autoFixDocumentContrast,
  configEffectsToDocument,
  DIGITAL_RAIN_PARAM_SPECS,
  documentEffectsToConfig,
  type EffectParamSpec,
  MAX_CUSTOM_CSS_BYTES,
  MAX_THEME_FILE_BYTES,
  parseThemeDocument,
  type SanitizedCssResult,
  sanitizeCustomCss,
  sanitizeFontStack,
  serializeThemeDocument,
  slugifyThemeId,
  THEME_FILE_EXTENSION,
  THEME_FILE_FORMAT,
  THEME_SCHEMA_VERSION,
  type ThemeDocumentEffects,
  type ThemeDocumentMeta,
  type ThemeDocumentTypography,
  type ThemeDocumentV1,
  type ThemeParseResult,
  themeParseFailure,
} from './theming/document';
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
  isThemeFontId,
  type ResolvedTheme,
  type SiteThemeMapping,
  type SurfaceRevealMetrics,
  type SurfaceSelectors,
  TEXT_INPUT_SELECTOR,
  THEME_DATA_KEY,
  THEME_FONT_STACKS,
  THEME_LAYER_ORDER,
  type ThemeAmbientGlowSpec,
  type ThemeAmbientGlowSpot,
  type ThemeChromeConfig,
  type ThemeColorScheme,
  type ThemeConfig,
  type ThemeFontId,
  type ThemePalette,
  type ThemePreset,
  type ThemeRibbonSpec,
} from './theming/types';
