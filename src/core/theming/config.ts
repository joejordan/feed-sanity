import type { StudioVibe } from '../theme-effects';
import type { ThemeDocumentMeta, ThemeDocumentTypography, ThemeDocumentV1 } from './document';
import type {
  ResolvedTheme,
  ThemeColorScheme,
  ThemeConfig,
  ThemeFontId,
  ThemePalette,
} from './types';
import { isRecord } from '../storage';
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
  cleanDocumentText,
  configEffectsToDocument,
  documentEffectsToConfig,
  parseThemeDocument,
  slugifyThemeId,
  THEME_FILE_FORMAT,
  THEME_SCHEMA_VERSION,
} from './document';
import { findThemePreset } from './presets';
import { DEFAULT_THEME_CONFIG, isThemeFontId, THEME_FONT_STACKS } from './types';

export function readThemeConfig(raw: unknown): ThemeConfig {
  if (!isRecord(raw)) {
    return { ...DEFAULT_THEME_CONFIG };
  }
  const str = (key: string, fallback = ''): string =>
    typeof raw[key] === 'string' ? raw[key] : fallback;
  const parsedEffects = raw.effects === undefined ? undefined : readThemeEffectsConfig(raw.effects);
  const parsedDoc = raw.document === undefined ? undefined : parseThemeDocument(raw.document);
  const validDocument = parsedDoc?.ok ? parsedDoc.document : undefined;
  return {
    preset: str('preset', 'default'),
    accent: str('accent'),
    background: str('background'),
    surface: str('surface'),
    text: str('text'),
    font: str('font', 'default'),
    customCss: str('customCss'),
    ...(parsedEffects && hasActiveEffects(parsedEffects) ? { effects: parsedEffects } : {}),
    ...(validDocument ? { document: validDocument } : {}),
  };
}

/** Returns the matching curated Studio Vibe when `config` matches its preset and active effects. */
export function findActiveStudioVibe(config: ThemeConfig): StudioVibe | undefined {
  if (!hasActiveEffects(config.effects)) {
    return undefined;
  }
  const effects = readThemeEffectsConfig(config.effects);
  return STUDIO_VIBES.find(
    (vibe) =>
      config.preset === vibe.preset &&
      effects.backdrop === (vibe.effects.backdrop ?? 'none') &&
      effects.surface === (vibe.effects.surface ?? 'default') &&
      effects.click === (vibe.effects.click ?? 'none'),
  );
}

/** Removes active Studio effects (and any vibe-owned font) while keeping the current palette. */
export function clearThemeEffects(config: ThemeConfig): ThemeConfig {
  const activeVibe = findActiveStudioVibe(config);
  const { effects: _removed, ...rest } = config;
  const resetFont = Boolean(activeVibe?.font && config.font === activeVibe.font);
  return resetFont ? { ...rest, font: 'default' } : rest;
}

/** Switches `config` to a clean static color `preset`, clearing color overrides, imported doc, and Studio effects. */
export function applyThemePreset(config: ThemeConfig, preset: string): ThemeConfig {
  const { document: clearedDoc, ...cleaned } = clearThemeEffects(config);
  const resetDocFont = Boolean(
    clearedDoc?.typography?.preset && cleaned.font === clearedDoc.typography.preset,
  );
  const resetDocCss = Boolean(
    clearedDoc?.customCss && cleaned.customCss.trim() === clearedDoc.customCss.trim(),
  );
  return {
    ...cleaned,
    ...(resetDocFont ? { font: 'default' } : {}),
    ...(resetDocCss ? { customCss: '' } : {}),
    preset,
    accent: '',
    background: '',
    surface: '',
    text: '',
  };
}

/** Applies a curated Studio Vibe (palette preset, optional font, and live effects). */
export function applyStudioVibe(config: ThemeConfig, vibe: StudioVibe): ThemeConfig {
  return {
    ...applyThemePreset(config, vibe.preset),
    font: vibe.font ?? 'default',
    effects: {
      ...DEFAULT_THEME_EFFECTS,
      ...vibe.effects,
    },
  };
}

/**
 * Resolves a `ThemeConfig` into an active `ResolvedTheme` (or `null` when
 * set to `'default'` with no color, font, chrome, effects, or custom CSS overrides).
 * Color overrides (`palette`) stay `null` when only `font` or `customCss` is set.
 */
export function resolveTheme(config: ThemeConfig): ResolvedTheme | null {
  const doc = config.document;
  const preset = doc ? undefined : findThemePreset(config.preset);
  const accent = normalizeHex(config.accent);
  const background = normalizeHex(config.background);
  const surface = normalizeHex(config.surface);
  const text = normalizeHex(config.text);
  const fontKey: ThemeFontId = isThemeFontId(config.font) ? config.font : 'default';
  const fontFamily =
    (fontKey === 'default' ? '' : THEME_FONT_STACKS[fontKey]) ||
    (doc?.typography?.customStack ?? '');
  const customCss = config.customCss.trim();
  const normalizedEffects = config.effects ? readThemeEffectsConfig(config.effects) : undefined;
  const activeEffects =
    normalizedEffects && hasActiveEffects(normalizedEffects) ? normalizedEffects : undefined;
  const chrome = doc?.chrome ?? preset?.chrome;

  const basePalette = doc ? doc.palette : (preset?.palette ?? null);
  const hasColorOverride = Boolean(basePalette || accent || background || surface || text);
  if (!hasColorOverride && !fontFamily && !customCss && !activeEffects && !chrome) {
    return null;
  }

  let palette: ThemePalette | null = null;
  if (hasColorOverride) {
    const inferredLight = background !== null && relativeLuminance(background) > 0.45;
    const base =
      basePalette ??
      (inferredLight
        ? (findThemePreset('warm-paper')?.palette as ThemePalette)
        : (findThemePreset('midnight')?.palette as ThemePalette));

    const resolvedBg = background ?? base.background;
    const resolvedSurface = surface ?? base.surface;
    const resolvedText = text ?? base.text;
    const resolvedAccent = accent ?? base.accent;
    let resolvedScheme: ThemeColorScheme = base.colorScheme;
    if (background !== null) {
      resolvedScheme = inferredLight ? 'light' : 'dark';
    }

    if (resolvedScheme === base.colorScheme) {
      palette = {
        ...base,
        colorScheme: resolvedScheme,
        background: resolvedBg,
        surface: resolvedSurface,
        text: resolvedText,
        accent: resolvedAccent,
        accentText: accent ? contrastingText(resolvedAccent) : base.accentText,
      };
    } else {
      // Polarity flipped (e.g. dark preset with light background override): re-derive
      // surfaceAlt, textMuted, border, and danger so secondary tokens keep clean contrast.
      palette = hydratePalette({
        colorScheme: resolvedScheme,
        background: resolvedBg,
        surface: resolvedSurface,
        text: resolvedText,
        accent: resolvedAccent,
        ...(base.accentSecondary ? { accentSecondary: base.accentSecondary } : {}),
      });
    }
  }

  return {
    palette,
    ...(fontFamily ? { fontFamily } : {}),
    ...(customCss ? { customCss } : {}),
    ...(chrome ? { chrome } : {}),
    ...(activeEffects ? { effects: activeEffects } : {}),
  };
}

/** Materializes any active `ThemeConfig` into a self-contained, exportable `ThemeDocumentV1`. */
export function themeConfigToDocument(
  config: ThemeConfig,
  metaOverride?: Partial<ThemeDocumentMeta>,
): ThemeDocumentV1 {
  const resolved = resolveTheme(config);
  const baseDoc = config.document;
  const activeVibe = baseDoc ? undefined : findActiveStudioVibe(config);
  const activePreset = baseDoc ? undefined : findThemePreset(config.preset);

  let defaultName = 'Site Default';
  let defaultDescription: string | undefined;
  if (baseDoc) {
    defaultName = baseDoc.meta.name;
    defaultDescription = baseDoc.meta.description;
  } else if (activeVibe) {
    defaultName = activeVibe.name;
    defaultDescription = activeVibe.tagline;
  } else if (activePreset) {
    defaultName = activePreset.name;
    defaultDescription = activePreset.description;
  }

  const name = cleanDocumentText(metaOverride?.name, 64) ?? defaultName;
  const description = cleanDocumentText(metaOverride?.description, 200) ?? defaultDescription;
  const hasColorOverrides = Boolean(
    normalizeHex(config.accent) ||
      normalizeHex(config.background) ||
      normalizeHex(config.surface) ||
      normalizeHex(config.text),
  );
  const inheritedSwatches = hasColorOverrides
    ? undefined
    : (baseDoc?.meta.swatches ?? activePreset?.swatches);
  const swatches = getPaletteSwatches(
    resolved?.palette ?? null,
    metaOverride?.swatches ?? inheritedSwatches,
  );
  const author = metaOverride?.author ?? baseDoc?.meta.author;
  const version = metaOverride?.version ?? baseDoc?.meta.version;
  const license = metaOverride?.license ?? baseDoc?.meta.license;
  const homepage = metaOverride?.homepage ?? baseDoc?.meta.homepage;
  const tags = metaOverride?.tags ?? baseDoc?.meta.tags;

  const meta: ThemeDocumentMeta = {
    name,
    ...(description ? { description } : {}),
    ...(author ? { author } : {}),
    ...(version ? { version } : {}),
    ...(license ? { license } : {}),
    ...(homepage ? { homepage } : {}),
    ...(tags ? { tags } : {}),
    ...(swatches.length >= 2 ? { swatches } : {}),
  };

  const fontPreset =
    isThemeFontId(config.font) && config.font !== 'default' ? config.font : undefined;
  const customStack = fontPreset ? undefined : baseDoc?.typography?.customStack;
  let typography: ThemeDocumentTypography | undefined;
  if (fontPreset || customStack) {
    typography = {
      ...(fontPreset ? { preset: fontPreset } : {}),
      ...(customStack ? { customStack } : {}),
    };
  }

  const effects = configEffectsToDocument(resolved?.effects);
  const chrome = resolved?.chrome;
  const customCss = config.customCss.trim() || undefined;

  return {
    format: THEME_FILE_FORMAT,
    schemaVersion: THEME_SCHEMA_VERSION,
    id: slugifyThemeId(baseDoc?.id ?? activeVibe?.id ?? activePreset?.id ?? name),
    meta,
    palette: resolved?.palette ?? null,
    ...(typography ? { typography } : {}),
    ...(chrome ? { chrome } : {}),
    ...(effects ? { effects } : {}),
    ...(customCss ? { customCss } : {}),
  };
}

/** Applies a validated `ThemeDocumentV1` onto a site's `ThemeConfig`. */
export function applyThemeDocument(
  _config: ThemeConfig,
  doc: ThemeDocumentV1,
  options: { readonly includeCustomCss?: boolean } = {},
): ThemeConfig {
  const includeCustomCss = options.includeCustomCss ?? true;
  let storedDoc = doc;
  if (!includeCustomCss && doc.customCss !== undefined) {
    const { customCss: _dropped, ...rest } = doc;
    storedDoc = rest;
  }
  const effects = documentEffectsToConfig(storedDoc.effects);
  const font: ThemeFontId = storedDoc.typography?.preset ?? 'default';

  return {
    preset: 'custom',
    accent: '',
    background: '',
    surface: '',
    text: '',
    font,
    customCss: includeCustomCss ? (storedDoc.customCss ?? '') : '',
    ...(effects ? { effects } : {}),
    document: storedDoc,
  };
}
