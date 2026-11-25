// Standardized single-file Theme Document (`*.fstheme.json`, schema v1).
//
// Models built-in Color Themes, Studio Vibes, and user-shared themes in one
// self-contained, strictly validated, Trusted-Types-safe JSON format ready for
// both one-click Export/Import and a future visual Theme Customizer Studio.

import type {
  BackdropEffectId,
  ClickEffectId,
  EffectParamSpec,
  EffectParamValues,
  SurfaceFinishId,
  ThemeEffectsConfig,
} from '../theme-effects/model';
import type { CustomSceneSpec, CustomShaderSpec } from '../theme-effects/scene-schema';
import type { SanitizedCssResult } from './css-sanitizer';
import type {
  ThemeAmbientGlowSpot,
  ThemeChromeConfig,
  ThemeColorScheme,
  ThemeFontId,
  ThemePalette,
  ThemeRibbonSpec,
} from './types';
import { isRecord } from '../storage';
import {
  BACKDROP_EFFECT_IDS,
  CLICK_EFFECT_IDS,
  DEFAULT_THEME_EFFECTS,
  DIGITAL_RAIN_PARAM_SPECS,
  getActiveBackdropParamSpecs,
  hasActiveEffects,
  readThemeEffectsConfig,
  SURFACE_FINISH_IDS,
  THEME_EFFECT_BOUNDS,
  validateEffectParams,
} from '../theme-effects/model';
import {
  isOneOf,
  parseCustomScene,
  parseCustomShader,
  readClampedNumber,
} from '../theme-effects/scene-schema';
import {
  contrastRatio,
  hydratePalette,
  minTextContrast,
  normalizeHex,
  pickAccessibleText,
  WCAG_AA_ACCENT_CONTRAST,
  WCAG_AA_TEXT_CONTRAST,
} from './color';
import {
  cleanDocumentText,
  MAX_CUSTOM_CSS_BYTES,
  sanitizeCustomCss,
  sanitizeFontStack,
} from './css-sanitizer';
import { isThemeFontId } from './types';

export type { EffectParamSpec, EffectParamValues, SanitizedCssResult };
export {
  cleanDocumentText,
  DIGITAL_RAIN_PARAM_SPECS,
  MAX_CUSTOM_CSS_BYTES,
  sanitizeCustomCss,
  sanitizeFontStack,
};

export const THEME_FILE_FORMAT = 'feed-sanity-theme' as const;
export const THEME_SCHEMA_VERSION = 1 as const;
export const THEME_FILE_EXTENSION = '.fstheme.json' as const;
export const MAX_THEME_FILE_BYTES = 64 * 1024;

const MAX_GLOW_SPOTS = 4;
const MAX_RIBBON_STOPS = 8;
const MAX_TAGS = 6;
const MAX_SWATCHES = 6;

const TEXT_ENCODER = new TextEncoder();

export interface ThemeDocumentMeta {
  readonly name: string;
  readonly description?: string;
  readonly author?: string;
  readonly version?: string;
  readonly license?: string;
  readonly homepage?: string;
  readonly tags?: readonly string[];
  readonly swatches?: readonly string[];
}

export interface ThemeDocumentTypography {
  readonly preset?: ThemeFontId;
  readonly customStack?: string;
}

export interface ThemeDocumentEffects {
  readonly backdrop?: {
    readonly id: BackdropEffectId;
    readonly intensity?: number;
    readonly speed?: number;
    readonly paused?: boolean;
    readonly interactive?: boolean;
    readonly params?: EffectParamValues;
    readonly scene?: CustomSceneSpec;
    readonly shader?: CustomShaderSpec;
  };
  readonly surface?: {
    readonly finish: SurfaceFinishId;
    readonly glassStrength?: number;
    readonly params?: EffectParamValues;
  };
  readonly click?: {
    readonly id: ClickEffectId;
    readonly params?: EffectParamValues;
  };
}

export interface ThemeDocumentV1 {
  readonly format: typeof THEME_FILE_FORMAT;
  readonly schemaVersion: typeof THEME_SCHEMA_VERSION;
  readonly id: string;
  readonly meta: ThemeDocumentMeta;
  /** `null` keeps the host site's native palette (orthogonal typography/effects/customCss). */
  readonly palette: ThemePalette | null;
  readonly typography?: ThemeDocumentTypography;
  readonly chrome?: ThemeChromeConfig;
  readonly effects?: ThemeDocumentEffects;
  readonly customCss?: string;
}

export type ThemeTrustTier = 'data-only' | 'custom-css' | 'custom-shader' | 'custom-css-and-shader';

/**
 * Deterministic capability & trust manifest derived from a validated `ThemeDocumentV1`.
 * Surfaces exactly what a theme touches (zero scripts, zero external network) for
 * import previews and the My Themes Library.
 */
export interface ThemeCapabilities {
  readonly trust: ThemeTrustTier;
  readonly hasPalette: boolean;
  readonly colorScheme: ThemeColorScheme | null;
  readonly backdropEngine: Exclude<BackdropEffectId, 'none'> | null;
  readonly hasCustomScene: boolean;
  readonly sceneLayerCount: number;
  readonly hasCustomShader: boolean;
  readonly surfaceFinish: Exclude<SurfaceFinishId, 'default'> | null;
  readonly clickEffect: Exclude<ClickEffectId, 'none'> | null;
  readonly hasChrome: boolean;
  readonly hasTypography: boolean;
  readonly hasCustomCss: boolean;
  readonly minContrastRatio: number | null;
  /** Deterministic content fingerprint of the canonical document for library deduplication. */
  readonly fingerprint: string;
}

export interface ThemeParseResult {
  readonly ok: boolean;
  readonly document?: ThemeDocumentV1;
  readonly capabilities?: ThemeCapabilities;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly hadCustomCss: boolean;
  readonly hadCustomShader: boolean;
  readonly strippedCssRules: number;
}

/** Builds a failed `ThemeParseResult` with one or more validation messages. */
export function themeParseFailure(errors: string | readonly string[]): ThemeParseResult {
  return {
    ok: false,
    errors: typeof errors === 'string' ? [errors] : errors,
    warnings: [],
    hadCustomCss: false,
    hadCustomShader: false,
    strippedCssRules: 0,
  };
}

/** Turns a display name into a clean kebab-case theme slug. */
export function slugifyThemeId(input: string, fallback = 'custom-theme'): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || fallback;
}

function cleanHttpsUrl(raw: unknown): string | undefined {
  const text = cleanDocumentText(raw, 200);
  if (!text) {
    return undefined;
  }
  try {
    const parsed = new URL(text);
    return parsed.protocol === 'https:' ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function parseChrome(raw: unknown): ThemeChromeConfig | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  let ribbon: ThemeRibbonSpec | undefined;
  if (isRecord(raw.ribbon) && Array.isArray(raw.ribbon.stops)) {
    const stops: string[] = [];
    for (const item of raw.ribbon.stops.slice(0, MAX_RIBBON_STOPS)) {
      if (typeof item !== 'string') {
        continue;
      }
      if (item.trim().toLowerCase() === 'transparent') {
        stops.push('transparent');
      } else {
        const hex = normalizeHex(item);
        if (hex) {
          stops.push(hex);
        }
      }
    }
    if (stops.length > 0) {
      const angle = readClampedNumber(raw.ribbon.angle, 0, 360, 0);
      const height = readClampedNumber(raw.ribbon.height, 1, 6, 0);
      ribbon = {
        enabled: raw.ribbon.enabled !== false,
        stops,
        ...(angle === undefined ? {} : { angle }),
        ...(height === undefined ? {} : { height }),
        ...(raw.ribbon.position === 'bottom' ? { position: 'bottom' } : {}),
      };
    }
  }

  let ambientGlow: ThemeChromeConfig['ambientGlow'];
  if (isRecord(raw.ambientGlow) && Array.isArray(raw.ambientGlow.spots)) {
    const spots: ThemeAmbientGlowSpot[] = [];
    for (const item of raw.ambientGlow.spots.slice(0, MAX_GLOW_SPOTS)) {
      if (!isRecord(item)) {
        continue;
      }
      const color = typeof item.color === 'string' ? normalizeHex(item.color) : null;
      if (!color) {
        continue;
      }
      const radiusX = readClampedNumber(item.radiusX, 20, 90, 0);
      const radiusY = readClampedNumber(item.radiusY, 20, 80, 0);
      spots.push({
        color,
        alpha: readClampedNumber(item.alpha, 0.02, 0.3, 3) ?? 0.14,
        x: readClampedNumber(item.x, 0, 100, 0) ?? 50,
        y: readClampedNumber(item.y, 0, 100, 0) ?? 0,
        ...(radiusX === undefined ? {} : { radiusX }),
        ...(radiusY === undefined ? {} : { radiusY }),
      });
    }
    if (spots.length > 0) {
      ambientGlow = {
        enabled: raw.ambientGlow.enabled !== false,
        spots,
      };
    }
  }

  if (!ribbon && !ambientGlow) {
    return undefined;
  }
  return {
    ...(ribbon ? { ribbon } : {}),
    ...(ambientGlow ? { ambientGlow } : {}),
  };
}

/** Converts a structured `ThemeDocumentEffects` block into runtime `ThemeEffectsConfig`. */
export function documentEffectsToConfig(
  effects: ThemeDocumentEffects | undefined,
): ThemeEffectsConfig | undefined {
  if (!effects) {
    return undefined;
  }
  const resolved = readThemeEffectsConfig({
    backdrop: effects.backdrop?.id ?? DEFAULT_THEME_EFFECTS.backdrop,
    intensity: effects.backdrop?.intensity ?? DEFAULT_THEME_EFFECTS.intensity,
    speed: effects.backdrop?.speed ?? DEFAULT_THEME_EFFECTS.speed,
    paused: effects.backdrop?.paused ?? DEFAULT_THEME_EFFECTS.paused,
    interactive: effects.backdrop?.interactive ?? DEFAULT_THEME_EFFECTS.interactive,
    ...(effects.backdrop?.params ? { backdropParams: effects.backdrop.params } : {}),
    ...(effects.backdrop?.scene ? { customScene: effects.backdrop.scene } : {}),
    ...(effects.backdrop?.shader ? { customShader: effects.backdrop.shader } : {}),
    surface: effects.surface?.finish ?? DEFAULT_THEME_EFFECTS.surface,
    glassStrength: effects.surface?.glassStrength ?? DEFAULT_THEME_EFFECTS.glassStrength,
    click: effects.click?.id ?? DEFAULT_THEME_EFFECTS.click,
  });
  return hasActiveEffects(resolved) ? resolved : undefined;
}

/** Converts runtime `ThemeEffectsConfig` into the namespaced `ThemeDocumentEffects` representation. */
export function configEffectsToDocument(
  effects: ThemeEffectsConfig | undefined,
): ThemeDocumentEffects | undefined {
  if (!effects) {
    return undefined;
  }
  const normalized = readThemeEffectsConfig(effects);
  if (!hasActiveEffects(normalized)) {
    return undefined;
  }
  let backdrop: ThemeDocumentEffects['backdrop'];
  if (normalized.backdrop !== 'none') {
    backdrop = {
      id: normalized.backdrop,
      intensity: normalized.intensity,
      speed: normalized.speed,
      paused: normalized.paused,
      interactive: normalized.interactive,
      ...(normalized.backdropParams ? { params: normalized.backdropParams } : {}),
      ...(normalized.customScene ? { scene: normalized.customScene } : {}),
      ...(normalized.customShader ? { shader: normalized.customShader } : {}),
    };
  }
  const surface: ThemeDocumentEffects['surface'] =
    normalized.surface !== 'default' || normalized.backdrop !== 'none'
      ? {
          finish: normalized.surface,
          glassStrength: normalized.glassStrength,
        }
      : undefined;
  const click: ThemeDocumentEffects['click'] =
    normalized.click === 'none' ? undefined : { id: normalized.click };
  return {
    ...(backdrop ? { backdrop } : {}),
    ...(surface ? { surface } : {}),
    ...(click ? { click } : {}),
  };
}

function warnUnsupportedEffect(
  rawValue: unknown,
  label: string,
  fallback: string,
  warnings: string[],
): void {
  const id = cleanDocumentText(rawValue, 40);
  if (id) {
    warnings.push(`Unsupported ${label} "${id}" — ${fallback}.`);
  }
}

function parseBackdropEffect(
  rawBackdrop: Record<string, unknown>,
  errors: string[],
  warnings: string[],
): { readonly backdrop?: ThemeDocumentEffects['backdrop']; readonly hadCustomShader: boolean } {
  if (!isOneOf(rawBackdrop.id, BACKDROP_EFFECT_IDS)) {
    warnUnsupportedEffect(
      rawBackdrop.id,
      'backdrop engine',
      'falling back to static theme colors',
      warnings,
    );
    return { hadCustomShader: false };
  }
  const id = rawBackdrop.id;
  const intensity = readClampedNumber(
    rawBackdrop.intensity,
    THEME_EFFECT_BOUNDS.intensity.min,
    THEME_EFFECT_BOUNDS.intensity.max,
  );
  const speed = readClampedNumber(
    rawBackdrop.speed,
    THEME_EFFECT_BOUNDS.speed.min,
    THEME_EFFECT_BOUNDS.speed.max,
  );
  let scene: CustomSceneSpec | undefined;
  let shader: CustomShaderSpec | undefined;
  const hadCustomShader = id === 'custom-shader';
  if (id === 'custom-scene') {
    scene = parseCustomScene(rawBackdrop.scene, warnings);
    if (!scene) {
      errors.push('effects.backdrop.scene must include at least one valid scene layer.');
      return { hadCustomShader };
    }
  } else if (id === 'custom-shader') {
    const parsedShader = parseCustomShader(rawBackdrop.shader, warnings);
    if (parsedShader.errors.length > 0 || !parsedShader.shader) {
      errors.push(...parsedShader.errors);
      return { hadCustomShader };
    }
    shader = parsedShader.shader;
  }
  const paramSpecs = getActiveBackdropParamSpecs({
    backdrop: id,
    ...(shader ? { customShader: shader } : {}),
  });
  const params = validateEffectParams(rawBackdrop.params, paramSpecs, warnings);
  return {
    hadCustomShader,
    backdrop: {
      id,
      ...(intensity === undefined ? {} : { intensity }),
      ...(speed === undefined ? {} : { speed }),
      ...(typeof rawBackdrop.paused === 'boolean' ? { paused: rawBackdrop.paused } : {}),
      ...(typeof rawBackdrop.interactive === 'boolean'
        ? { interactive: rawBackdrop.interactive }
        : {}),
      ...(params ? { params } : {}),
      ...(scene ? { scene } : {}),
      ...(shader ? { shader } : {}),
    },
  };
}

function parseEffects(
  raw: unknown,
  errors: string[],
  warnings: string[],
): { readonly effects?: ThemeDocumentEffects; readonly hadCustomShader: boolean } {
  if (!isRecord(raw)) {
    return { hadCustomShader: false };
  }
  const { backdrop, hadCustomShader } = isRecord(raw.backdrop)
    ? parseBackdropEffect(raw.backdrop, errors, warnings)
    : { backdrop: undefined, hadCustomShader: false };

  let surface: ThemeDocumentEffects['surface'];
  if (isRecord(raw.surface)) {
    if (isOneOf(raw.surface.finish, SURFACE_FINISH_IDS)) {
      const glassStrength = readClampedNumber(
        raw.surface.glassStrength,
        THEME_EFFECT_BOUNDS.glassStrength.min,
        THEME_EFFECT_BOUNDS.glassStrength.max,
      );
      surface = {
        finish: raw.surface.finish,
        ...(glassStrength === undefined ? {} : { glassStrength }),
      };
    } else {
      warnUnsupportedEffect(raw.surface.finish, 'surface finish', 'using solid surfaces', warnings);
    }
  }

  let click: ThemeDocumentEffects['click'];
  if (isRecord(raw.click)) {
    if (isOneOf(raw.click.id, CLICK_EFFECT_IDS)) {
      click = { id: raw.click.id };
    } else {
      warnUnsupportedEffect(raw.click.id, 'click effect', 'click effects disabled', warnings);
    }
  }

  const active =
    (backdrop !== undefined && backdrop.id !== 'none') ||
    (surface !== undefined && surface.finish !== 'default') ||
    (click !== undefined && click.id !== 'none');
  if (!active) {
    return { hadCustomShader };
  }
  return {
    effects: {
      ...(backdrop ? { backdrop } : {}),
      ...(surface ? { surface } : {}),
      ...(click ? { click } : {}),
    },
    hadCustomShader,
  };
}

const REQUIRED_HEX_KEYS = ['background', 'surface', 'text', 'accent'] as const;
const OPTIONAL_HEX_KEYS = [
  'surfaceAlt',
  'textMuted',
  'border',
  'accentSecondary',
  'accentText',
  'danger',
] as const;

function parseDocumentPalette(
  rawPalette: unknown,
  errors: string[],
  warnings: string[],
): ThemePalette | null {
  if (rawPalette === null || rawPalette === undefined) {
    return null;
  }
  if (!isRecord(rawPalette)) {
    errors.push('palette must be an object or null.');
    return null;
  }
  const scheme = rawPalette.colorScheme;
  if (scheme !== 'dark' && scheme !== 'light') {
    errors.push('palette.colorScheme must be "dark" or "light".');
  }

  const parsedRequired: Partial<Record<(typeof REQUIRED_HEX_KEYS)[number], string>> = {};
  const parsedOptional: Partial<Record<(typeof OPTIONAL_HEX_KEYS)[number], string>> = {};
  const readHex = (key: string, required: boolean): string | null => {
    const val = rawPalette[key];
    if (!required && (val === undefined || val === '')) {
      return null;
    }
    const hex = typeof val === 'string' ? normalizeHex(val) : null;
    if (!hex) {
      errors.push(`palette.${key} must be a valid hex color like #3b82f6.`);
    }
    return hex;
  };

  for (const key of REQUIRED_HEX_KEYS) {
    const hex = readHex(key, true);
    if (hex) {
      parsedRequired[key] = hex;
    }
  }
  for (const key of OPTIONAL_HEX_KEYS) {
    const hex = readHex(key, false);
    if (hex) {
      parsedOptional[key] = hex;
    }
  }

  if (
    (scheme !== 'dark' && scheme !== 'light') ||
    !parsedRequired.background ||
    !parsedRequired.surface ||
    !parsedRequired.text ||
    !parsedRequired.accent
  ) {
    return null;
  }

  const palette = hydratePalette({
    colorScheme: scheme,
    background: parsedRequired.background,
    surface: parsedRequired.surface,
    text: parsedRequired.text,
    accent: parsedRequired.accent,
    ...parsedOptional,
  });

  const textContrast = minTextContrast(palette.text, palette.background, palette.surface);
  if (textContrast < WCAG_AA_TEXT_CONTRAST) {
    warnings.push(`Low text contrast (${textContrast.toFixed(1)}:1 — WCAG AA recommends 4.5:1+).`);
  }
  const accentContrast = contrastRatio(palette.accentText, palette.accent);
  if (accentContrast < WCAG_AA_ACCENT_CONTRAST) {
    warnings.push(
      `Low accent button contrast (${accentContrast.toFixed(1)}:1 — recommends 3.0:1+).`,
    );
  }
  return palette;
}

function parseDocumentTypography(
  rawTypography: unknown,
  warnings: string[],
): ThemeDocumentTypography | undefined {
  if (!isRecord(rawTypography)) {
    return undefined;
  }
  const preset =
    isThemeFontId(rawTypography.preset) && rawTypography.preset !== 'default'
      ? rawTypography.preset
      : undefined;
  const customStack = sanitizeFontStack(rawTypography.customStack);
  if (rawTypography.customStack !== undefined && !customStack) {
    warnings.push('Ignored typography.customStack containing unsupported characters.');
  }
  if (!preset && !customStack) {
    return undefined;
  }
  return {
    ...(preset ? { preset } : {}),
    ...(customStack ? { customStack } : {}),
  };
}

function parseDocumentMeta(
  rawMeta: Record<string, unknown> | null,
  name: string,
): ThemeDocumentMeta {
  const swatches = Array.isArray(rawMeta?.swatches)
    ? rawMeta.swatches.slice(0, MAX_SWATCHES).flatMap((s) => {
        const hex = typeof s === 'string' ? normalizeHex(s) : null;
        return hex ? [hex] : [];
      })
    : undefined;
  const tags = Array.isArray(rawMeta?.tags)
    ? rawMeta.tags.slice(0, MAX_TAGS).flatMap((t) => {
        const cleaned = cleanDocumentText(t, 24);
        return cleaned ? [cleaned] : [];
      })
    : undefined;
  const description = cleanDocumentText(rawMeta?.description, 200);
  const author = cleanDocumentText(rawMeta?.author, 64);
  const version = cleanDocumentText(rawMeta?.version, 24);
  const license = cleanDocumentText(rawMeta?.license, 32);
  const homepage = cleanHttpsUrl(rawMeta?.homepage);

  return {
    name,
    ...(description ? { description } : {}),
    ...(author ? { author } : {}),
    ...(version ? { version } : {}),
    ...(license ? { license } : {}),
    ...(homepage ? { homepage } : {}),
    ...(tags && tags.length > 0 ? { tags } : {}),
    ...(swatches && swatches.length >= 2 ? { swatches } : {}),
  };
}

function exceedsMaxBytes(input: string): boolean {
  if (input.length > MAX_THEME_FILE_BYTES) {
    return true;
  }
  if (input.length * 3 <= MAX_THEME_FILE_BYTES) {
    return false;
  }
  return TEXT_ENCODER.encode(input).byteLength > MAX_THEME_FILE_BYTES;
}

/**
 * Strictly parses, validates, clamps, hydrates, and sanitizes a `.fstheme.json`
 * string or plain object into a safe `ThemeDocumentV1`.
 */
export function parseThemeDocument(input: unknown): ThemeParseResult {
  let raw: unknown = input;
  if (typeof input === 'string') {
    if (exceedsMaxBytes(input)) {
      return themeParseFailure(`Theme file exceeds the ${MAX_THEME_FILE_BYTES / 1024} KB limit.`);
    }
    try {
      raw = JSON.parse(input);
    } catch {
      return themeParseFailure('Invalid JSON syntax. Select or paste a valid .fstheme.json file.');
    }
  }

  if (!isRecord(raw)) {
    return themeParseFailure('Theme document must be a JSON object.');
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  if (raw.format !== THEME_FILE_FORMAT) {
    errors.push(`Expected "format": "${THEME_FILE_FORMAT}".`);
  }
  if (typeof raw.schemaVersion !== 'number' || !Number.isInteger(raw.schemaVersion)) {
    errors.push(`Expected integer "schemaVersion": ${THEME_SCHEMA_VERSION}.`);
  } else if (raw.schemaVersion > THEME_SCHEMA_VERSION) {
    errors.push(
      `Unsupported schemaVersion ${raw.schemaVersion} (this version of Feed Sanity supports up to v${THEME_SCHEMA_VERSION}).`,
    );
  } else if (raw.schemaVersion < 1) {
    errors.push(`Invalid schemaVersion ${raw.schemaVersion}.`);
  }

  const rawMeta = isRecord(raw.meta) ? raw.meta : null;
  const name = cleanDocumentText(rawMeta?.name, 64);
  if (!name) {
    errors.push('meta.name is required (1–64 characters).');
  }

  const palette = parseDocumentPalette(raw.palette, errors, warnings);
  const typography = parseDocumentTypography(raw.typography, warnings);
  const chrome = parseChrome(raw.chrome);
  const { effects, hadCustomShader } = parseEffects(raw.effects, errors, warnings);

  let customCss: string | undefined;
  let hadCustomCss = false;
  let strippedCssRules = 0;
  if (typeof raw.customCss === 'string' && raw.customCss.trim().length > 0) {
    hadCustomCss = true;
    const sanitized = sanitizeCustomCss(raw.customCss);
    strippedCssRules = sanitized.strippedCount;
    if (sanitized.strippedCount > 0) {
      warnings.push(
        `Stripped ${sanitized.strippedCount} external/unsafe CSS directive(s) (@import/url).`,
      );
    }
    if (sanitized.truncated) {
      warnings.push(`Truncated customCss to ${MAX_CUSTOM_CSS_BYTES / 1024} KB.`);
    }
    if (sanitized.css.length > 0) {
      customCss = sanitized.css;
    }
  }

  if (errors.length > 0 || !name) {
    return { ok: false, errors, warnings, hadCustomCss, hadCustomShader, strippedCssRules };
  }

  const meta = parseDocumentMeta(rawMeta, name);
  const id = slugifyThemeId(typeof raw.id === 'string' ? raw.id : name);
  const document: ThemeDocumentV1 = {
    format: THEME_FILE_FORMAT,
    schemaVersion: THEME_SCHEMA_VERSION,
    id,
    meta,
    palette,
    ...(typography ? { typography } : {}),
    ...(chrome ? { chrome } : {}),
    ...(effects ? { effects } : {}),
    ...(customCss ? { customCss } : {}),
  };

  return {
    ok: true,
    document,
    capabilities: analyzeThemeDocument(document),
    errors: [],
    warnings,
    hadCustomCss,
    hadCustomShader,
    strippedCssRules,
  };
}

function stableHashHex(text: string): string {
  // Dual independent 32-bit FNV-1a accumulators -> 16-char deterministic hex fingerprint.
  let h1 = 0x81_1c_9d_c5;
  let h2 = 0x9e_37_79_b9;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01_00_01_93);
    h2 ^= code + i;
    h2 = Math.imul(h2, 0x85_eb_ca_6b);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalJsonValue);
  }
  if (isRecord(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const entry = value[key];
      if (entry !== undefined) {
        sorted[key] = canonicalJsonValue(entry);
      }
    }
    return sorted;
  }
  return value;
}

const CAPABILITIES_CACHE = new WeakMap<ThemeDocumentV1, ThemeCapabilities>();

/**
 * Computes a deterministic trust & capability summary for a `ThemeDocumentV1`,
 * suitable for import previews, verification badges, and library deduplication.
 */
export function analyzeThemeDocument(doc: ThemeDocumentV1): ThemeCapabilities {
  const cached = CAPABILITIES_CACHE.get(doc);
  if (cached) {
    return cached;
  }
  const hasCustomCss = Boolean(doc.customCss && doc.customCss.trim().length > 0);
  const backdropId = doc.effects?.backdrop?.id;
  const sceneLayerCount =
    backdropId === 'custom-scene' ? (doc.effects?.backdrop?.scene?.layers.length ?? 0) : 0;
  const hasCustomScene = sceneLayerCount > 0;
  const hasCustomShader =
    backdropId === 'custom-shader' && Boolean(doc.effects?.backdrop?.shader?.fragment);
  const surfaceFinish = doc.effects?.surface?.finish;
  const clickId = doc.effects?.click?.id;
  const hasTypography = Boolean(
    (doc.typography?.preset && doc.typography.preset !== 'default') || doc.typography?.customStack,
  );
  const hasChrome = Boolean(doc.chrome?.ribbon?.enabled || doc.chrome?.ambientGlow?.enabled);
  const minContrastRatio = doc.palette
    ? Number(
        minTextContrast(doc.palette.text, doc.palette.background, doc.palette.surface).toFixed(2),
      )
    : null;
  let trust: ThemeTrustTier = 'data-only';
  if (hasCustomCss && hasCustomShader) {
    trust = 'custom-css-and-shader';
  } else if (hasCustomShader) {
    trust = 'custom-shader';
  } else if (hasCustomCss) {
    trust = 'custom-css';
  }
  const fingerprint = stableHashHex(
    JSON.stringify(
      canonicalJsonValue({
        palette: doc.palette,
        typography: doc.typography,
        chrome: doc.chrome,
        effects: doc.effects,
        customCss: doc.customCss,
      }),
    ),
  );
  const result: ThemeCapabilities = {
    trust,
    hasPalette: doc.palette !== null,
    colorScheme: doc.palette?.colorScheme ?? null,
    backdropEngine: backdropId && backdropId !== 'none' ? backdropId : null,
    hasCustomScene,
    sceneLayerCount,
    hasCustomShader,
    surfaceFinish: surfaceFinish && surfaceFinish !== 'default' ? surfaceFinish : null,
    clickEffect: clickId && clickId !== 'none' ? clickId : null,
    hasChrome,
    hasTypography,
    hasCustomCss,
    minContrastRatio,
    fingerprint,
  };
  CAPABILITIES_CACHE.set(doc, result);
  return result;
}

/** Returns a copy of `doc` with `palette.text` and `palette.accentText` adjusted for WCAG AA contrast. */
export function autoFixDocumentContrast(doc: ThemeDocumentV1): ThemeDocumentV1 {
  if (!doc.palette) {
    return doc;
  }
  const p = doc.palette;
  const currentMin = minTextContrast(p.text, p.background, p.surface);
  const nextText =
    currentMin < WCAG_AA_TEXT_CONTRAST ? pickAccessibleText(p.background, p.surface) : p.text;
  const nextAccentText =
    contrastRatio(p.accentText, p.accent) >= WCAG_AA_ACCENT_CONTRAST
      ? p.accentText
      : pickAccessibleText(p.accent, p.accent);

  if (nextText === p.text && nextAccentText === p.accentText) {
    return doc;
  }
  return {
    ...doc,
    palette: {
      ...p,
      text: nextText,
      accentText: nextAccentText,
    },
  };
}

/** Formats a `ThemeDocumentV1` as canonical, human-readable `.fstheme.json`. */
export function serializeThemeDocument(doc: ThemeDocumentV1): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}
