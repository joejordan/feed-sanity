// Canonical ThemeDocumentV1 state model, built-in catalog materializers,
// immutable document editors, and one-way migration from legacy flat v0 configs.

import type { StudioVibe, ThemeEffectsConfig } from '../theme-effects';
import type { ThemeDocumentMeta, ThemeDocumentTypography, ThemeDocumentV1 } from './document';
import type {
  ResolvedTheme,
  ThemeColorScheme,
  ThemeFontId,
  ThemePalette,
  ThemePreset,
} from './types';
import { isRecord } from '../storage';
import { samePalette } from '../theme';
import {
  DEFAULT_THEME_EFFECTS,
  hasActiveEffects,
  readThemeEffectsConfig,
  STUDIO_VIBES,
} from '../theme-effects';
import {
  contrastingText,
  getPaletteSwatches,
  hydratePalette,
  normalizeHex,
  relativeLuminance,
} from './color-utils';
import {
  configEffectsToDocument,
  documentEffectsToConfig,
  parseThemeDocument,
  sanitizeCustomCss,
  slugifyThemeId,
  THEME_FILE_FORMAT,
  THEME_SCHEMA_VERSION,
} from './document';
import { findThemePreset } from './presets';
import { isThemeFontId, THEME_FONT_STACKS } from './types';

/** Canonical Site Default `ThemeDocumentV1` (no palette, typography, chrome, effects, or CSS overrides). */
export const DEFAULT_THEME_DOCUMENT: ThemeDocumentV1 = {
  format: THEME_FILE_FORMAT,
  schemaVersion: THEME_SCHEMA_VERSION,
  id: 'default',
  meta: { name: 'Site Default' },
  palette: null,
};

const STUDIO_VIBE_BY_ID: ReadonlyMap<string, StudioVibe> = new Map(
  STUDIO_VIBES.map((vibe) => [vibe.id, vibe]),
);

function optionalSwatches(
  palette: ThemePalette | null,
  custom?: readonly string[],
): { readonly swatches?: readonly string[] } {
  const swatches = getPaletteSwatches(palette, custom);
  return swatches.length >= 2 ? { swatches } : {};
}

function matchStudioVibe(presetId: string, effects: ThemeEffectsConfig): StudioVibe | undefined {
  return STUDIO_VIBES.find(
    (vibe) =>
      presetId === vibe.preset &&
      effects.backdrop === (vibe.effects.backdrop ?? 'none') &&
      effects.surface === (vibe.effects.surface ?? 'default') &&
      effects.click === (vibe.effects.click ?? 'none'),
  );
}

/** Materializes a built-in `ThemePreset` as a canonical `ThemeDocumentV1`. */
export function presetToThemeDocument(preset: ThemePreset): ThemeDocumentV1 {
  return {
    format: THEME_FILE_FORMAT,
    schemaVersion: THEME_SCHEMA_VERSION,
    id: preset.id,
    meta: {
      name: preset.name,
      description: preset.description,
      ...optionalSwatches(preset.palette, preset.swatches),
    },
    palette: preset.palette,
    ...(preset.chrome ? { chrome: preset.chrome } : {}),
  };
}

/** Materializes a curated `StudioVibe` as a canonical `ThemeDocumentV1`. */
export function vibeToThemeDocument(vibe: StudioVibe): ThemeDocumentV1 {
  const basePreset = findThemePreset(vibe.preset);
  const fullEffects = readThemeEffectsConfig({ ...DEFAULT_THEME_EFFECTS, ...vibe.effects });
  const docEffects = configEffectsToDocument(fullEffects);
  const fontPreset =
    vibe.font && isThemeFontId(vibe.font) && vibe.font !== 'default' ? vibe.font : undefined;
  return {
    format: THEME_FILE_FORMAT,
    schemaVersion: THEME_SCHEMA_VERSION,
    id: vibe.id,
    meta: {
      name: vibe.name,
      description: vibe.tagline,
      ...optionalSwatches(basePreset?.palette ?? null, basePreset?.swatches),
    },
    palette: basePreset?.palette ?? null,
    ...(fontPreset ? { typography: { preset: fontPreset } } : {}),
    ...(basePreset?.chrome ? { chrome: basePreset.chrome } : {}),
    ...(docEffects ? { effects: docEffects } : {}),
  };
}

/**
 * Resolves a canonical `ThemeDocumentV1` into an active `ResolvedTheme` (or
 * `null` when representing Site Default with no color, typography, chrome,
 * effects, or custom CSS overrides).
 */
export function resolveTheme(doc: ThemeDocumentV1): ResolvedTheme | null {
  const palette = doc.palette;
  const fontPreset = doc.typography?.preset;
  const fontFamily =
    (fontPreset && fontPreset !== 'default' ? THEME_FONT_STACKS[fontPreset] : '') ||
    (doc.typography?.customStack ?? '');
  const customCss = doc.customCss?.trim() ?? '';
  const activeEffects = documentEffectsToConfig(doc.effects);
  const chrome = doc.chrome;

  if (!palette && !fontFamily && !customCss && !activeEffects && !chrome) {
    return null;
  }

  return {
    palette,
    ...(fontFamily ? { fontFamily } : {}),
    ...(customCss ? { customCss } : {}),
    ...(chrome ? { chrome } : {}),
    ...(activeEffects ? { effects: activeEffects } : {}),
  };
}

/** True when `doc` imposes no visual, typography, effects, chrome, or CSS overrides. */
export function isSiteDefaultDocument(doc: ThemeDocumentV1): boolean {
  const fontPreset = doc.typography?.preset;
  const hasTypography = Boolean(
    (fontPreset && fontPreset !== 'default') || doc.typography?.customStack,
  );
  return (
    !doc.palette &&
    !hasTypography &&
    !doc.chrome &&
    !(doc.customCss?.trim() ?? '') &&
    !documentEffectsToConfig(doc.effects)
  );
}

/** Returns the built-in `ThemePreset` underlying `doc`, if any (including Studio Vibes). */
export function findActiveThemePreset(doc: ThemeDocumentV1): ThemePreset | undefined {
  const direct = findThemePreset(doc.id);
  if (direct) {
    return direct;
  }
  const vibe = STUDIO_VIBE_BY_ID.get(doc.id);
  return vibe ? findThemePreset(vibe.preset) : undefined;
}

/** Returns the matching curated `StudioVibe` when `doc`'s active effects and base preset match it. */
export function findActiveStudioVibe(doc: ThemeDocumentV1): StudioVibe | undefined {
  const effects = documentEffectsToConfig(doc.effects);
  if (!effects) {
    return undefined;
  }
  const basePreset = findActiveThemePreset(doc);
  return basePreset ? matchStudioVibe(basePreset.id, effects) : undefined;
}

/** True when `doc` is an imported or external custom `.fstheme.json` document rather than a built-in preset/vibe. */
export function isCustomImportedDocument(doc: ThemeDocumentV1): boolean {
  if (doc.id === 'default' || doc.id === 'custom') {
    return false;
  }
  return !findThemePreset(doc.id) && !STUDIO_VIBE_BY_ID.has(doc.id);
}

/** True when `doc.palette` has been customized away from its base built-in preset (or built from Site Default). */
export function hasPaletteOverrides(doc: ThemeDocumentV1): boolean {
  if (!doc.palette) {
    return false;
  }
  const basePreset = findActiveThemePreset(doc);
  if (!basePreset) {
    return !isCustomImportedDocument(doc);
  }
  return !samePalette(doc.palette, basePreset.palette);
}

export interface ThemeSummary {
  readonly overriding: boolean;
  readonly label: string;
}

/** Canonical user-facing summary of whether `doc` overrides native site styling and its label. */
export function describeThemeDocument(doc: ThemeDocumentV1): ThemeSummary {
  const effects = documentEffectsToConfig(doc.effects);
  const fontPreset = doc.typography?.preset;
  const hasTypography = Boolean(
    (fontPreset && fontPreset !== 'default') || doc.typography?.customStack,
  );
  if (!doc.palette && !hasTypography && !doc.chrome && !(doc.customCss?.trim() ?? '') && !effects) {
    return { overriding: false, label: 'Site Default' };
  }
  if (isCustomImportedDocument(doc)) {
    return { overriding: true, label: doc.meta.name };
  }
  const preset = findActiveThemePreset(doc);
  if (preset && effects) {
    const vibe = matchStudioVibe(preset.id, effects);
    if (vibe) {
      return { overriding: true, label: vibe.name };
    }
  }
  if (preset) {
    return { overriding: true, label: preset.name };
  }
  const customName = doc.meta.name.trim();
  if (customName && customName !== 'Site Default') {
    return { overriding: true, label: customName };
  }
  return { overriding: true, label: 'Custom theme' };
}

function withPalettePatch(
  basePalette: ThemePalette | null,
  patch: Partial<ThemePalette>,
): ThemePalette | null {
  const accent = patch.accent === undefined ? null : normalizeHex(patch.accent);
  const background = patch.background === undefined ? null : normalizeHex(patch.background);
  const surface = patch.surface === undefined ? null : normalizeHex(patch.surface);
  const text = patch.text === undefined ? null : normalizeHex(patch.text);
  const surfaceAlt = patch.surfaceAlt === undefined ? null : normalizeHex(patch.surfaceAlt);
  const textMuted = patch.textMuted === undefined ? null : normalizeHex(patch.textMuted);
  const border = patch.border === undefined ? null : normalizeHex(patch.border);
  const accentSecondary =
    patch.accentSecondary === undefined ? null : normalizeHex(patch.accentSecondary);
  const danger = patch.danger === undefined ? null : normalizeHex(patch.danger);

  if (
    !accent &&
    !background &&
    !surface &&
    !text &&
    !surfaceAlt &&
    !textMuted &&
    !border &&
    !accentSecondary &&
    !danger
  ) {
    return basePalette;
  }

  const inferredLight = background !== null && relativeLuminance(background) > 0.45;
  const base =
    basePalette ??
    (findThemePreset(inferredLight ? 'warm-paper' : 'midnight')?.palette as ThemePalette);

  const resolvedBg = background ?? base.background;
  const resolvedSurface = surface ?? base.surface;
  const resolvedText = text ?? base.text;
  const resolvedAccent = accent ?? base.accent;
  const nextSecondary = accentSecondary ?? base.accentSecondary;
  let resolvedScheme: ThemeColorScheme = base.colorScheme;
  if (background !== null) {
    resolvedScheme = inferredLight ? 'light' : 'dark';
  }

  if (resolvedScheme === base.colorScheme) {
    return {
      ...base,
      colorScheme: resolvedScheme,
      background: resolvedBg,
      surface: resolvedSurface,
      surfaceAlt: surfaceAlt ?? base.surfaceAlt,
      text: resolvedText,
      textMuted: textMuted ?? base.textMuted,
      border: border ?? base.border,
      accent: resolvedAccent,
      accentText: accent ? contrastingText(resolvedAccent) : base.accentText,
      danger: danger ?? base.danger,
      ...(nextSecondary ? { accentSecondary: nextSecondary } : {}),
    };
  }

  return hydratePalette({
    colorScheme: resolvedScheme,
    background: resolvedBg,
    surface: resolvedSurface,
    text: resolvedText,
    accent: resolvedAccent,
    ...(surfaceAlt ? { surfaceAlt } : {}),
    ...(textMuted ? { textMuted } : {}),
    ...(border ? { border } : {}),
    ...(danger ? { danger } : {}),
    ...(nextSecondary ? { accentSecondary: nextSecondary } : {}),
  });
}

/**
 * One-way migration from pre-cutover flat `ThemeConfig` storage records
 * (`{ preset, accent, background, surface, text, font, customCss, effects?, document? }`)
 * into a canonical `ThemeDocumentV1`.
 */
function migrateLegacyThemeConfig(raw: Record<string, unknown>): ThemeDocumentV1 {
  const str = (key: string, fallback = ''): string =>
    typeof raw[key] === 'string' ? raw[key] : fallback;

  const parsedEmbedded = raw.document === undefined ? undefined : parseThemeDocument(raw.document);
  const baseDoc = parsedEmbedded?.ok ? parsedEmbedded.document : undefined;

  const presetId = str('preset', 'default');
  const preset = baseDoc ? undefined : findThemePreset(presetId);

  const basePalette = baseDoc ? baseDoc.palette : (preset?.palette ?? null);
  const palette = withPalettePatch(basePalette, {
    accent: str('accent'),
    background: str('background'),
    surface: str('surface'),
    text: str('text'),
  });
  const hasColorPatch = palette !== basePalette;

  const rawFont = str('font', 'default');
  const fontPreset = isThemeFontId(rawFont) && rawFont !== 'default' ? rawFont : undefined;
  const customStack = fontPreset ? undefined : baseDoc?.typography?.customStack;
  const typography: ThemeDocumentTypography | undefined =
    fontPreset || customStack
      ? {
          ...(fontPreset ? { preset: fontPreset } : {}),
          ...(customStack ? { customStack } : {}),
        }
      : undefined;

  const parsedEffects = raw.effects === undefined ? undefined : readThemeEffectsConfig(raw.effects);
  const activeEffects =
    parsedEffects && hasActiveEffects(parsedEffects) ? parsedEffects : undefined;
  const docEffects = configEffectsToDocument(activeEffects);

  const rawCss = str('customCss').trim();
  const customCss = rawCss ? sanitizeCustomCss(rawCss).css || undefined : undefined;
  const chrome = baseDoc?.chrome ?? preset?.chrome;

  // Match curated Studio Vibe when legacy flat config matches one.
  const matchedVibe =
    !baseDoc && preset && activeEffects ? matchStudioVibe(preset.id, activeEffects) : undefined;

  if (!palette && !typography && !docEffects && !chrome && !customCss) {
    return { ...DEFAULT_THEME_DOCUMENT };
  }

  let id = 'default';
  let baseMeta: ThemeDocumentMeta = { name: 'Site Default' };
  let inheritedSwatches: readonly string[] | undefined;
  if (baseDoc) {
    id = baseDoc.id;
    baseMeta = baseDoc.meta;
    inheritedSwatches = baseDoc.meta.swatches;
  } else if (matchedVibe) {
    id = matchedVibe.id;
    baseMeta = { name: matchedVibe.name, description: matchedVibe.tagline };
    inheritedSwatches = preset?.swatches;
  } else if (preset) {
    id = preset.id;
    baseMeta = { name: preset.name, description: preset.description };
    inheritedSwatches = preset.swatches;
  } else if (palette) {
    id = 'custom';
    baseMeta = { name: 'Custom theme' };
  }
  const meta: ThemeDocumentMeta = {
    ...baseMeta,
    ...optionalSwatches(palette, hasColorPatch ? undefined : inheritedSwatches),
  };

  return {
    format: THEME_FILE_FORMAT,
    schemaVersion: THEME_SCHEMA_VERSION,
    id: slugifyThemeId(id),
    meta,
    palette,
    ...(typography ? { typography } : {}),
    ...(chrome ? { chrome } : {}),
    ...(docEffects ? { effects: docEffects } : {}),
    ...(customCss ? { customCss } : {}),
  };
}

/**
 * Reads a persisted site theme from storage into a validated `ThemeDocumentV1`,
 * seamlessly migrating any legacy pre-v1 flat `ThemeConfig` record on read.
 */
export function readThemeDocument(raw: unknown): ThemeDocumentV1 {
  if (!isRecord(raw)) {
    return { ...DEFAULT_THEME_DOCUMENT };
  }
  if (raw.format === THEME_FILE_FORMAT) {
    const parsed = parseThemeDocument(raw);
    return parsed.ok && parsed.document ? parsed.document : { ...DEFAULT_THEME_DOCUMENT };
  }
  return migrateLegacyThemeConfig(raw);
}

/** Removes active Studio effects (and any vibe-owned font) while preserving the active palette & CSS. */
export function clearThemeEffects(doc: ThemeDocumentV1): ThemeDocumentV1 {
  const activeVibe = findActiveStudioVibe(doc) ?? STUDIO_VIBE_BY_ID.get(doc.id);
  const { effects: _removed, ...rest } = doc;
  let next: ThemeDocumentV1 = rest;

  // If the document was a curated Studio Vibe, revert identity cleanly to its underlying preset.
  if (activeVibe && doc.id === activeVibe.id) {
    const basePreset = findThemePreset(activeVibe.preset);
    if (basePreset) {
      const inheritedSwatches = hasPaletteOverrides(doc) ? undefined : basePreset.swatches;
      next = {
        ...next,
        id: basePreset.id,
        meta: {
          name: basePreset.name,
          description: basePreset.description,
          ...optionalSwatches(doc.palette, inheritedSwatches),
        },
      };
    }
  }

  if (activeVibe?.font && next.typography?.preset === activeVibe.font) {
    const { typography: _oldTypo, ...withoutTypo } = next;
    next = withoutTypo;
  }
  return next;
}

/** Switches `doc` to a clean static color `presetId` (or `'default'`), clearing Studio effects and imported metadata. */
export function applyThemePreset(doc: ThemeDocumentV1, presetId: string): ThemeDocumentV1 {
  const cleaned = clearThemeEffects(doc);
  const wasImported = isCustomImportedDocument(cleaned);
  const preset = presetId === 'default' ? undefined : findThemePreset(presetId);
  const base: ThemeDocumentV1 = preset
    ? presetToThemeDocument(preset)
    : { ...DEFAULT_THEME_DOCUMENT };

  // Preserve orthogonal user typography & custom CSS unless they came from an imported theme document.
  const keepTypography = !wasImported && cleaned.typography ? cleaned.typography : undefined;
  const keepCustomCss = !wasImported && cleaned.customCss ? cleaned.customCss : undefined;

  return {
    ...base,
    ...(keepTypography ? { typography: keepTypography } : {}),
    ...(keepCustomCss ? { customCss: keepCustomCss } : {}),
  };
}

/** Applies a curated Studio Vibe while preserving orthogonal user custom CSS. */
export function applyStudioVibe(doc: ThemeDocumentV1, vibe: StudioVibe): ThemeDocumentV1 {
  const wasImported = isCustomImportedDocument(doc);
  const keepCustomCss = !wasImported && doc.customCss ? doc.customCss : undefined;
  const vibeDoc = vibeToThemeDocument(vibe);
  return {
    ...vibeDoc,
    ...(keepCustomCss ? { customCss: keepCustomCss } : {}),
  };
}

/** Applies a validated imported `ThemeDocumentV1`, optionally stripping its `customCss`. */
export function applyThemeDocument(
  doc: ThemeDocumentV1,
  options: { readonly includeCustomCss?: boolean } = {},
): ThemeDocumentV1 {
  const includeCustomCss = options.includeCustomCss ?? true;
  if (!includeCustomCss && doc.customCss !== undefined) {
    const { customCss: _dropped, ...rest } = doc;
    return rest;
  }
  return doc;
}

/** Updates one or more palette tokens on `doc`, auto-hydrating polarity flips and refreshing swatches. */
export function updateThemePalette(
  doc: ThemeDocumentV1,
  patch: Partial<ThemePalette>,
): ThemeDocumentV1 {
  const nextPalette = withPalettePatch(doc.palette, patch);
  if (!nextPalette || nextPalette === doc.palette) {
    return doc;
  }
  const fromDefault = doc.id === 'default';
  return {
    ...doc,
    id: fromDefault ? 'custom' : doc.id,
    meta: {
      ...doc.meta,
      ...(fromDefault ? { name: 'Custom theme' } : {}),
      ...optionalSwatches(nextPalette),
    },
    palette: nextPalette,
  };
}

/** Updates built-in typography preset on `doc`, clearing any stale imported `customStack`. */
export function updateThemeTypography(doc: ThemeDocumentV1, font: ThemeFontId): ThemeDocumentV1 {
  const { typography: _old, ...rest } = doc;
  if (font === 'default') {
    return rest;
  }
  return {
    ...rest,
    typography: { preset: font },
  };
}

/** Updates Studio effects on `doc`, reverting vibe identity and dropping `effects` cleanly when inactive. */
export function updateThemeEffects(
  doc: ThemeDocumentV1,
  patch: Partial<ThemeEffectsConfig>,
): ThemeDocumentV1 {
  const current = documentEffectsToConfig(doc.effects) ?? DEFAULT_THEME_EFFECTS;
  const nextEffects: ThemeEffectsConfig = { ...current, ...patch };
  const docEffects = configEffectsToDocument(nextEffects);
  if (!docEffects) {
    return clearThemeEffects(doc);
  }
  return { ...doc, effects: docEffects };
}

/** Updates user custom CSS on `doc`, omitting the field when blank. */
export function updateThemeCustomCss(doc: ThemeDocumentV1, customCss: string): ThemeDocumentV1 {
  const { customCss: _old, ...rest } = doc;
  return customCss.length > 0 ? { ...rest, customCss } : rest;
}
