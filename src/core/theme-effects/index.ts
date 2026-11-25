export type { BackdropContext, BackdropInstance, BackdropPlugin } from './backdrops';
export type { ClickEffectOptions, ClickEffectsController } from './click-fx';
export type { EffectsLayerController } from './controller';
export type { RainCharsetName } from './digital-rain/charsets';
export type { DigitalRainInstance, MountDigitalRainOptions } from './digital-rain/mount';
export type { DigitalRainOptions, RainIntro, RainLookName } from './digital-rain/settings';
export type {
  BackdropEffectId,
  BackdropOptionMeta,
  ClickEffectId,
  EffectParamSpec,
  EffectParamUnit,
  EffectParamValue,
  EffectParamValues,
  StudioVibe,
  SurfaceFinishId,
  ThemeEffectsConfig,
} from './model';
export type {
  CustomSceneSpec,
  CustomShaderParamSpec,
  CustomShaderSpec,
  GradientSceneLayer,
  GridSceneLayer,
  ParticleShape,
  ParticlesSceneLayer,
  RaysSceneLayer,
  SceneBlendMode,
  SceneColorRef,
  SceneColorToken,
  SceneLayerBase,
  SceneLayerSpec,
  ShaderValidationResult,
  SilhouetteSceneLayer,
  SilhouetteStyle,
  WavesSceneLayer,
} from './scene-schema';
export { compileUiSurfaceCss } from '../theming/compile-ui';
export { BACKDROP_REGISTRY } from './backdrops';
export { mountClickEffects } from './click-fx';
export { createEffectsLayerController } from './controller';
export { RAIN_CHARSETS } from './digital-rain/charsets';
export { mountDigitalRain } from './digital-rain/mount';
export { RAIN_PRESETS } from './digital-rain/settings';
export {
  BACKDROP_EFFECT_IDS,
  BACKDROP_OPTIONS,
  BACKDROP_PARAM_SPECS,
  CLICK_EFFECT_IDS,
  CLICK_EFFECT_OPTIONS,
  CLICK_PARAM_SPECS,
  DEFAULT_THEME_EFFECTS,
  DIGITAL_RAIN_PARAM_SPECS,
  deriveEffectParams,
  findBackdropOption,
  getActiveBackdropParamSpecs,
  getBackdropDisplayName,
  getBackdropParamSpecs,
  getClickEffectLabel,
  getClickParamSpecs,
  getSurfaceFinishLabel,
  getSurfaceParamSpecs,
  hasActiveEffects,
  mergeEffectsPatch,
  RAIN_CHARSET_NAMES,
  RAIN_INTRO_NAMES,
  RAIN_LOOK_NAMES,
  readThemeEffectsConfig,
  resolveEffectParams,
  STUDIO_VIBES,
  SURFACE_FINISH_IDS,
  SURFACE_FINISH_OPTIONS,
  SURFACE_PARAM_SPECS,
  sameEffectParams,
  THEME_EFFECT_BOUNDS,
  validateEffectParams,
} from './model';
export {
  MAX_CUSTOM_SHADER_BYTES,
  MAX_CUSTOM_SHADER_PARAMS,
  MAX_SCENE_LAYERS,
  MAX_SHADER_CLICKS,
  MAX_SHADER_LOOP_ITERATIONS,
  PARTICLE_SHAPES,
  parseCustomScene,
  parseCustomShader,
  SCENE_BLEND_MODES,
  SCENE_COLOR_TOKENS,
  SILHOUETTE_STYLES,
  validateCustomShaderSource,
} from './scene-schema';
export {
  BACKDROP_OWN_VALUE,
  BACKDROP_SELECTOR,
  CLICK_FX_OWN_VALUE,
  compileBackdropRevealCss,
  compileSurfaceFinishCss,
  DEFAULT_POPUPS,
  DEFAULT_SHELL_LANDMARKS,
  PRISM_ANGLE_VAR,
  resolveGlassMetrics,
} from './surfaces';
