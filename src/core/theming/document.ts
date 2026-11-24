// Standardized single-file Theme Document (`*.fstheme.json`, schema v1).
//
// Models built-in Color Themes, Studio Vibes, and user-shared themes in one
// self-contained, strictly validated, Trusted-Types-safe JSON format ready for
// both one-click Export/Import and a future visual Theme Customizer Studio.

import type {
  BackdropEffectId,
  ClickEffectId,
  SurfaceFinishId,
  ThemeEffectsConfig,
} from '../theme-effects/model';
import type {
  ThemeAmbientGlowSpot,
  ThemeChromeConfig,
  ThemeFontId,
  ThemePalette,
  ThemeRibbonSpec,
} from './types';
import { isRecord } from '../storage';
import {
  BACKDROP_EFFECT_IDS,
  CLICK_EFFECT_IDS,
  DEFAULT_THEME_EFFECTS,
  hasActiveEffects,
  RAIN_CHARSET_NAMES,
  RAIN_INTRO_NAMES,
  RAIN_LOOK_NAMES,
  readThemeEffectsConfig,
  SURFACE_FINISH_IDS,
  THEME_EFFECT_BOUNDS,
} from '../theme-effects/model';
import {
  contrastRatio,
  hydratePalette,
  minTextContrast,
  normalizeHex,
  pickAccessibleText,
  WCAG_AA_ACCENT_CONTRAST,
  WCAG_AA_TEXT_CONTRAST,
} from './color-utils';
import { isThemeFontId } from './types';

export const THEME_FILE_FORMAT = 'feed-sanity-theme' as const;
export const THEME_SCHEMA_VERSION = 1 as const;
export const THEME_FILE_EXTENSION = '.fstheme.json' as const;
export const MAX_THEME_FILE_BYTES = 64 * 1024;
export const MAX_CUSTOM_CSS_BYTES = 16 * 1024;

const MAX_GLOW_SPOTS = 4;
const MAX_RIBBON_STOPS = 8;
const MAX_TAGS = 6;
const MAX_SWATCHES = 6;

const TEXT_ENCODER = new TextEncoder();
const FONT_STACK_SAFE_RE = /^[a-zA-Z0-9 ,"'-]+$/;
const UNSAFE_CSS_AT_RULES = new Set(['import', 'charset', 'namespace']);
const UNSAFE_CSS_FUNCTIONS = new Set([
  'url',
  'image-set',
  '-webkit-image-set',
  'image',
  'src',
  'expression',
]);
const UNSAFE_CSS_PROPERTIES = new Set(['behavior', '-moz-binding']);

/**
 * Declarative parameter schema for backdrop, surface, and click effect plugins.
 * One spec drives both `.fstheme.json` validation and future Studio UI controls.
 */
export type EffectParamSpec =
  | {
      readonly key: string;
      readonly kind: 'number';
      readonly label: string;
      readonly min: number;
      readonly max: number;
      readonly step: number;
      readonly defaultValue: number;
    }
  | {
      readonly key: string;
      readonly kind: 'enum';
      readonly label: string;
      readonly options: readonly string[];
      readonly defaultValue: string;
    }
  | {
      readonly key: string;
      readonly kind: 'boolean';
      readonly label: string;
      readonly defaultValue: boolean;
    }
  | {
      readonly key: string;
      readonly kind: 'color';
      readonly label: string;
      readonly defaultValue: string;
    };

export const DIGITAL_RAIN_PARAM_SPECS: readonly EffectParamSpec[] = [
  {
    key: 'look',
    kind: 'enum',
    label: 'Rain style',
    options: RAIN_LOOK_NAMES,
    defaultValue: DEFAULT_THEME_EFFECTS.rainLook,
  },
  {
    key: 'charset',
    kind: 'enum',
    label: 'Glyph charset',
    options: RAIN_CHARSET_NAMES,
    defaultValue: DEFAULT_THEME_EFFECTS.rainCharset,
  },
  {
    key: 'density',
    kind: 'number',
    label: 'Rain density',
    min: THEME_EFFECT_BOUNDS.rainDensity.min,
    max: THEME_EFFECT_BOUNDS.rainDensity.max,
    step: 0.05,
    defaultValue: DEFAULT_THEME_EFFECTS.rainDensity,
  },
  {
    key: 'intro',
    kind: 'enum',
    label: 'Intro',
    options: RAIN_INTRO_NAMES,
    defaultValue: DEFAULT_THEME_EFFECTS.rainIntro,
  },
];

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
    readonly params?: Readonly<Record<string, string | number | boolean>>;
  };
  readonly surface?: {
    readonly finish: SurfaceFinishId;
    readonly glassStrength?: number;
    readonly params?: Readonly<Record<string, string | number | boolean>>;
  };
  readonly click?: {
    readonly id: ClickEffectId;
    readonly params?: Readonly<Record<string, string | number | boolean>>;
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

export interface SanitizedCssResult {
  readonly css: string;
  readonly strippedCount: number;
  readonly truncated: boolean;
}

export interface ThemeParseResult {
  readonly ok: boolean;
  readonly document?: ThemeDocumentV1;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly hadCustomCss: boolean;
  readonly strippedCssRules: number;
}

/** Builds a failed `ThemeParseResult` with one or more validation messages. */
export function themeParseFailure(errors: string | readonly string[]): ThemeParseResult {
  return {
    ok: false,
    errors: typeof errors === 'string' ? [errors] : errors,
    warnings: [],
    hadCustomCss: false,
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

function readClampedNumber(
  raw: unknown,
  min: number,
  max: number,
  decimals = 2,
): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return undefined;
  }
  const factor = 10 ** decimals;
  return Math.round(Math.min(max, Math.max(min, raw)) * factor) / factor;
}

function isOneOf<T extends string>(raw: unknown, list: readonly T[]): raw is T {
  return typeof raw === 'string' && (list as readonly string[]).includes(raw);
}

/** Trims and clamps an optional string field, returning `undefined` when empty or non-string. */
export function cleanDocumentText(raw: unknown, maxLen: number): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const trimmed = raw.trim().slice(0, maxLen);
  return trimmed.length > 0 ? trimmed : undefined;
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

/** Sanitizes an optional user font stack to safe, balanced local font-family tokens only. */
export function sanitizeFontStack(raw: unknown): string | undefined {
  const text = cleanDocumentText(raw, 200);
  if (!text || !FONT_STACK_SAFE_RE.test(text)) {
    return undefined;
  }
  for (const part of text.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) {
      return undefined;
    }
    const first = trimmed[0];
    if (first === '"' || first === "'") {
      if (trimmed.length < 3 || trimmed.at(-1) !== first) {
        return undefined;
      }
      const inner = trimmed.slice(1, -1);
      if (inner.includes('"') || inner.includes("'") || !inner.trim()) {
        return undefined;
      }
    } else if (trimmed.includes('"') || trimmed.includes("'")) {
      return undefined;
    }
  }
  return text;
}

function isCssIdentChar(ch: string | undefined): boolean {
  if (!ch) {
    return false;
  }
  const code = ch.charCodeAt(0);
  return (
    (code >= 97 && code <= 122) ||
    (code >= 65 && code <= 90) ||
    (code >= 48 && code <= 57) ||
    code === 45 ||
    code === 95 ||
    code >= 128
  );
}

function isHexDigit(ch: string | undefined): boolean {
  if (!ch) {
    return false;
  }
  const code = ch.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
}

/** Reads a CSS identifier starting at `start`, decoding CSS Syntax Level 3 backslash escapes. */
function readCssIdent(
  input: string,
  start: number,
): { readonly name: string; readonly end: number } {
  let i = start;
  let name = '';
  while (i < input.length) {
    const ch = input.charAt(i);
    if (ch === '\\') {
      const next = input[i + 1];
      if (!next || next === '\n' || next === '\r' || next === '\f') {
        break;
      }
      if (isHexDigit(next)) {
        let hexEnd = i + 1;
        while (hexEnd < input.length && hexEnd < i + 7 && isHexDigit(input[hexEnd])) {
          hexEnd++;
        }
        const cp = Number.parseInt(input.slice(i + 1, hexEnd), 16);
        name += cp > 0 && cp <= 0x10_ff_ff ? String.fromCodePoint(cp) : '\ufffd';
        i = hexEnd;
        if (input[i] === '\r' && input[i + 1] === '\n') {
          i += 2;
        } else if (
          input[i] === ' ' ||
          input[i] === '\t' ||
          input[i] === '\n' ||
          input[i] === '\r' ||
          input[i] === '\f'
        ) {
          i++;
        }
      } else {
        name += next;
        i += 2;
      }
      continue;
    }
    if (isCssIdentChar(ch)) {
      name += ch;
      i++;
      continue;
    }
    break;
  }
  return { name: name.toLowerCase(), end: i };
}

function skipCssSpaceAndComments(input: string, start: number): number {
  let i = start;
  while (i < input.length) {
    const ch = input.charAt(i);
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f') {
      i++;
      continue;
    }
    if (ch === '/' && input[i + 1] === '*') {
      const close = input.indexOf('*/', i + 2);
      i = close === -1 ? input.length : close + 2;
      continue;
    }
    break;
  }
  return i;
}

function skipCssString(input: string, start: number): number {
  const quote = input[start];
  let i = start + 1;
  while (i < input.length) {
    const ch = input.charAt(i);
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === quote) {
      return i + 1;
    }
    if (ch === '\n' || ch === '\r' || ch === '\f') {
      return i;
    }
    i++;
  }
  return input.length;
}

function skipBalancedParens(input: string, openIndex: number): number {
  let i = openIndex + 1;
  let depth = 1;
  while (i < input.length && depth > 0) {
    const ch = input[i];
    if (ch === '/' && input[i + 1] === '*') {
      const close = input.indexOf('*/', i + 2);
      i = close === -1 ? input.length : close + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      i = skipCssString(input, i);
      continue;
    }
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
    }
    i++;
  }
  return i;
}

function skipUntilDeclarationEnd(input: string, start: number, consumeSemicolon: boolean): number {
  let i = start;
  while (i < input.length) {
    const ch = input.charAt(i);
    if (ch === '/' && input[i + 1] === '*') {
      const close = input.indexOf('*/', i + 2);
      i = close === -1 ? input.length : close + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      i = skipCssString(input, i);
      continue;
    }
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === ';') {
      return consumeSemicolon ? i + 1 : i;
    }
    if (ch === '}') {
      return i;
    }
    i++;
  }
  return input.length;
}

/**
 * Strips network/exfiltration vectors (`@import`, `@charset`, `@namespace`,
 * `url(...)`, `image-set(...)`, `-webkit-image-set(...)`, `image(...)`, `src(...)`,
 * `expression(...)`, `behavior:`, `-moz-binding:`) with CSS escape decoding and
 * comment/string safety, enforcing the 16 KB ceiling on imported custom CSS.
 */
export function sanitizeCustomCss(raw: string): SanitizedCssResult {
  const input = raw.trim();
  const out: string[] = [];
  let strippedCount = 0;
  let i = 0;

  while (i < input.length) {
    const ch = input.charAt(i);

    // Preserve comments verbatim (never emit `*/` inside a comment).
    if (ch === '/' && input[i + 1] === '*') {
      const close = input.indexOf('*/', i + 2);
      const end = close === -1 ? input.length : close + 2;
      out.push(input.slice(i, end));
      i = end;
      continue;
    }

    // Preserve quoted strings verbatim (active URL functions start outside quotes).
    if (ch === '"' || ch === "'") {
      const end = skipCssString(input, i);
      out.push(input.slice(i, end));
      i = end;
      continue;
    }

    // Strip disallowed at-rules (`@import`, `@charset`, `@namespace`), escape-aware.
    if (ch === '@') {
      const ident = readCssIdent(input, i + 1);
      if (UNSAFE_CSS_AT_RULES.has(ident.name)) {
        strippedCount++;
        out.push(' ');
        i = skipUntilDeclarationEnd(input, ident.end, true);
        continue;
      }
      out.push(input.slice(i, ident.end));
      i = ident.end;
      continue;
    }

    // Check identifiers (including backslash-escaped starts) for unsafe functions & properties.
    if (isCssIdentChar(ch) || ch === '\\') {
      const ident = readCssIdent(input, i);
      if (ident.end > i) {
        if (UNSAFE_CSS_FUNCTIONS.has(ident.name)) {
          const afterWs = skipCssSpaceAndComments(input, ident.end);
          if (input[afterWs] === '(') {
            strippedCount++;
            out.push(' ');
            i = skipBalancedParens(input, afterWs);
            continue;
          }
        }
        if (UNSAFE_CSS_PROPERTIES.has(ident.name)) {
          const afterWs = skipCssSpaceAndComments(input, ident.end);
          if (input[afterWs] === ':') {
            strippedCount++;
            out.push(' ');
            i = skipUntilDeclarationEnd(input, afterWs + 1, false);
            continue;
          }
        }
        out.push(input.slice(i, ident.end));
        i = ident.end;
        continue;
      }
    }

    out.push(ch);
    i++;
  }

  let css = out.join('').trim();
  let truncated = false;
  if (css.length > MAX_CUSTOM_CSS_BYTES) {
    css = css.slice(0, MAX_CUSTOM_CSS_BYTES).trim();
    truncated = true;
  }
  return { css, strippedCount, truncated };
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

function validateEffectParams(
  raw: unknown,
  specs: readonly EffectParamSpec[],
): Record<string, string | number | boolean> | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const out: Record<string, string | number | boolean> = {};
  for (const spec of specs) {
    const val = raw[spec.key];
    if (val === undefined) {
      continue;
    }
    if (spec.kind === 'number') {
      const num = readClampedNumber(val, spec.min, spec.max, 2);
      if (num !== undefined) {
        out[spec.key] = num;
      }
    } else if (spec.kind === 'enum' && isOneOf(val, spec.options)) {
      out[spec.key] = val;
    } else if (spec.kind === 'boolean' && typeof val === 'boolean') {
      out[spec.key] = val;
    } else if (spec.kind === 'color' && typeof val === 'string') {
      const hex = normalizeHex(val);
      if (hex) {
        out[spec.key] = hex;
      }
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Converts a structured `ThemeDocumentEffects` block into runtime `ThemeEffectsConfig`. */
export function documentEffectsToConfig(
  effects: ThemeDocumentEffects | undefined,
): ThemeEffectsConfig | undefined {
  if (!effects) {
    return undefined;
  }
  const rainParams = effects.backdrop?.id === 'digital-rain' ? effects.backdrop.params : undefined;
  const resolved = readThemeEffectsConfig({
    backdrop: effects.backdrop?.id ?? DEFAULT_THEME_EFFECTS.backdrop,
    intensity: effects.backdrop?.intensity ?? DEFAULT_THEME_EFFECTS.intensity,
    speed: effects.backdrop?.speed ?? DEFAULT_THEME_EFFECTS.speed,
    paused: effects.backdrop?.paused ?? DEFAULT_THEME_EFFECTS.paused,
    interactive: effects.backdrop?.interactive ?? DEFAULT_THEME_EFFECTS.interactive,
    rainLook: rainParams?.look ?? DEFAULT_THEME_EFFECTS.rainLook,
    rainCharset: rainParams?.charset ?? DEFAULT_THEME_EFFECTS.rainCharset,
    rainDensity: rainParams?.density ?? DEFAULT_THEME_EFFECTS.rainDensity,
    rainIntro: rainParams?.intro ?? DEFAULT_THEME_EFFECTS.rainIntro,
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
    const params =
      normalized.backdrop === 'digital-rain'
        ? {
            look: normalized.rainLook,
            charset: normalized.rainCharset,
            density: normalized.rainDensity,
            intro: normalized.rainIntro,
          }
        : undefined;
    backdrop = {
      id: normalized.backdrop,
      intensity: normalized.intensity,
      speed: normalized.speed,
      paused: normalized.paused,
      interactive: normalized.interactive,
      ...(params ? { params } : {}),
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

function parseEffects(raw: unknown): ThemeDocumentEffects | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  let backdrop: ThemeDocumentEffects['backdrop'];
  if (isRecord(raw.backdrop) && isOneOf(raw.backdrop.id, BACKDROP_EFFECT_IDS)) {
    const id = raw.backdrop.id;
    const intensity = readClampedNumber(
      raw.backdrop.intensity,
      THEME_EFFECT_BOUNDS.intensity.min,
      THEME_EFFECT_BOUNDS.intensity.max,
    );
    const speed = readClampedNumber(
      raw.backdrop.speed,
      THEME_EFFECT_BOUNDS.speed.min,
      THEME_EFFECT_BOUNDS.speed.max,
    );
    const params =
      id === 'digital-rain'
        ? validateEffectParams(raw.backdrop.params, DIGITAL_RAIN_PARAM_SPECS)
        : undefined;
    backdrop = {
      id,
      ...(intensity === undefined ? {} : { intensity }),
      ...(speed === undefined ? {} : { speed }),
      ...(typeof raw.backdrop.paused === 'boolean' ? { paused: raw.backdrop.paused } : {}),
      ...(typeof raw.backdrop.interactive === 'boolean'
        ? { interactive: raw.backdrop.interactive }
        : {}),
      ...(params ? { params } : {}),
    };
  }

  let surface: ThemeDocumentEffects['surface'];
  if (isRecord(raw.surface) && isOneOf(raw.surface.finish, SURFACE_FINISH_IDS)) {
    const glassStrength = readClampedNumber(
      raw.surface.glassStrength,
      THEME_EFFECT_BOUNDS.glassStrength.min,
      THEME_EFFECT_BOUNDS.glassStrength.max,
    );
    surface = {
      finish: raw.surface.finish,
      ...(glassStrength === undefined ? {} : { glassStrength }),
    };
  }

  let click: ThemeDocumentEffects['click'];
  if (isRecord(raw.click) && isOneOf(raw.click.id, CLICK_EFFECT_IDS)) {
    click = { id: raw.click.id };
  }

  const active =
    (backdrop !== undefined && backdrop.id !== 'none') ||
    (surface !== undefined && surface.finish !== 'default') ||
    (click !== undefined && click.id !== 'none');
  if (!active) {
    return undefined;
  }
  return {
    ...(backdrop ? { backdrop } : {}),
    ...(surface ? { surface } : {}),
    ...(click ? { click } : {}),
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
  const effects = parseEffects(raw.effects);

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
    return { ok: false, errors, warnings, hadCustomCss, strippedCssRules };
  }

  const meta = parseDocumentMeta(rawMeta, name);
  const id = slugifyThemeId(typeof raw.id === 'string' ? raw.id : name);

  return {
    ok: true,
    document: {
      format: THEME_FILE_FORMAT,
      schemaVersion: THEME_SCHEMA_VERSION,
      id,
      meta,
      palette,
      ...(typography ? { typography } : {}),
      ...(chrome ? { chrome } : {}),
      ...(effects ? { effects } : {}),
      ...(customCss ? { customCss } : {}),
    },
    errors: [],
    warnings,
    hadCustomCss,
    strippedCssRules,
  };
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
