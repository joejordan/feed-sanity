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
  flipPaletteScheme,
  generateThemePalette,
  getPaletteSwatches,
  hexToHslTriplet,
  hexToRgbTriplet,
  hydratePalette,
  minTextContrast,
  mixHex,
  normalizeHex,
  PALETTE_MOODS,
  type PaletteMood,
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
  applyGeneratedPalette,
  applyStudioVibe,
  applyThemeDocument,
  applyThemePreset,
  clearThemeEffects,
  DEFAULT_THEME_DOCUMENT,
  describeThemeDocument,
  findActiveStudioVibe,
  findActiveThemePreset,
  flipThemeColorScheme,
  hasPaletteOverrides,
  isCustomImportedDocument,
  isSiteDefaultDocument,
  presetToThemeDocument,
  readThemeDocument,
  resolveTheme,
  type ThemeSummary,
  updateThemeChrome,
  updateThemeCustomCss,
  updateThemeEffects,
  updateThemePalette,
  updateThemeTypography,
  vibeToThemeDocument,
} from './theming/config';
export {
  attachThemeScope,
  createThemeController,
  type ThemeController,
} from './theming/controller';
export {
  analyzeThemeDocument,
  autoFixDocumentContrast,
  configEffectsToDocument,
  DIGITAL_RAIN_PARAM_SPECS,
  documentEffectsToConfig,
  type EffectParamSpec,
  type EffectParamValues,
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
  type ThemeCapabilities,
  type ThemeDocumentEffects,
  type ThemeDocumentMeta,
  type ThemeDocumentTypography,
  type ThemeDocumentV1,
  type ThemeParseResult,
  type ThemeTrustTier,
  themeParseFailure,
} from './theming/document';
export {
  applyEarlyThemeCss,
  clearEarlyThemeStyle,
  readEarlyThemeCss,
  THEME_STYLE_ID,
  writeEarlyThemeCss,
} from './theming/early-cache';
export {
  createThemeLibrary,
  EMPTY_THEME_LIBRARY,
  type GlobalThemeOverride,
  MAX_LIBRARY_THEMES,
  readGlobalThemeRevision,
  readThemeLibraryState,
  type SavedThemeEntry,
  type SaveLibraryThemeOptions,
  THEME_GLOBAL_REV_KEY,
  THEME_LIBRARY_KEY,
  type ThemeLibraryClient,
  type ThemeLibraryState,
} from './theming/library';
export { BUILTIN_THEMES, findThemePreset } from './theming/presets';
export {
  type AdaptiveThemeMappingOptions,
  type BackdropRevealMetrics,
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
  type ThemeFontId,
  type ThemePalette,
  type ThemePreset,
  type ThemeRibbonSpec,
} from './theming/types';
