// First-class multi-site theming engine.
//
// Compiles a single site-agnostic semantic `ResolvedTheme` (optional color
// palette + optional typography + optional custom CSS) onto any host site via
// its declarative `SiteThemeMapping`, automatically propagating into open host
// Shadow Roots (`:host`), same-origin iframes, and Feed Sanity's own Shadow DOM
// UI. Strictly Trusted Types safe (`style.textContent`) and 100% reversible.

export type { StudioVibe, ThemeEffectsConfig } from './theme-effects/model';
export type {
  CustomSceneSpec,
  CustomShaderParamSpec,
  CustomShaderSpec,
  SceneLayerSpec,
  ShaderValidationResult,
} from './theme-effects/scene-schema';
export type {
  ElementLayoutSample,
  LayoutSnapshot,
  ThemeAuditOptions,
  ThemeAuditReport,
  ThemeAuditSummary,
  ThemeViolation,
  ThemeViolationKind,
} from './theming/audit';
export {
  DEFAULT_THEME_EFFECTS,
  getActiveBackdropParamSpecs,
  hasActiveEffects,
  readThemeEffectsConfig,
} from './theme-effects/model';
export {
  MAX_CUSTOM_SHADER_BYTES,
  MAX_CUSTOM_SHADER_PARAMS,
  MAX_SCENE_LAYERS,
  parseCustomScene,
  parseCustomShader,
  validateCustomShaderSource,
} from './theme-effects/scene-schema';
export { auditThemeCoverage, captureLayoutSnapshot } from './theming/audit';
export {
  colorSchemeOf,
  compositeOver,
  contrastingText,
  contrastRatio,
  flipPaletteScheme,
  generateThemePalette,
  getPaletteSwatches,
  hexToHslTriplet,
  hexToRgbTriplet,
  hexWithAlpha,
  hydratePalette,
  isNeutralColor,
  isOppositePolarityNeutral,
  mapHostNeutralToPalette,
  matchesBrandHue,
  minTextContrast,
  mixHex,
  normalizeHex,
  type OklchColor,
  PALETTE_MOODS,
  type PaintPropertyKind,
  type PaletteMood,
  parseCssColor,
  pickAccessibleText,
  type RgbaColor,
  relativeLuminance,
  rgbaContrastRatio,
  rgbaLuminance,
  rgbToOklch,
  samePalette,
  WCAG_AA_ACCENT_CONTRAST,
  WCAG_AA_TEXT_CONTRAST,
} from './theming/color';
export {
  compileChromeHostCss,
  compileChromeUiCss,
  compileHostThemeCss,
  compileShadowThemeCss,
  compileUiThemeCss,
} from './theming/compile';
export { compileRibbonBackground } from './theming/compile-ui';
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
  type ThemeChromePatch,
  type ThemeDocumentFilterOptions,
  type ThemeSummary,
  updateThemeChrome,
  updateThemeCustomCss,
  updateThemeCustomFontStack,
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
  createThemeHealer,
  HEAL_BG_ATTR,
  HEAL_BORDER_ATTR,
  HEAL_FG_ATTR,
  HEALER_STYLE_ID,
  resolveEffectiveBackground,
  type ThemeHealer,
  type ThemeHealerOptions,
} from './theming/healer';
export {
  detectConfirmedHostColorScheme,
  detectHostColorScheme,
  HOST_SCHEME_ATTRS,
} from './theming/host-scheme';
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
  type ThemeLibraryViewMode,
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
