import type { StudioVibe } from '../theme-effects';
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
import { contrastingText, normalizeHex, relativeLuminance } from './color-utils';
import { findThemePreset } from './presets';
import { DEFAULT_THEME_CONFIG, THEME_FONT_STACKS } from './types';

export function readThemeConfig(raw: unknown): ThemeConfig {
  if (!isRecord(raw)) {
    return { ...DEFAULT_THEME_CONFIG };
  }
  const str = (key: string, fallback = ''): string =>
    typeof raw[key] === 'string' ? raw[key] : fallback;
  const parsedEffects = raw.effects === undefined ? undefined : readThemeEffectsConfig(raw.effects);
  return {
    preset: str('preset', 'default'),
    accent: str('accent'),
    background: str('background'),
    surface: str('surface'),
    text: str('text'),
    font: str('font', 'default'),
    customCss: str('customCss'),
    ...(parsedEffects && hasActiveEffects(parsedEffects) ? { effects: parsedEffects } : {}),
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

/** Switches `config` to a clean static color `preset`, clearing color overrides and Studio effects. */
export function applyThemePreset(config: ThemeConfig, preset: string): ThemeConfig {
  const cleaned = clearThemeEffects(config);
  return {
    ...cleaned,
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
 * set to `'default'` with no color, font, or custom CSS overrides).
 * Color overrides (`palette`) stay `null` when only `font` or `customCss` is set.
 */
export function resolveTheme(config: ThemeConfig): ResolvedTheme | null {
  const preset = findThemePreset(config.preset);
  const accent = normalizeHex(config.accent);
  const background = normalizeHex(config.background);
  const surface = normalizeHex(config.surface);
  const text = normalizeHex(config.text);
  const fontKey: ThemeFontId = Object.hasOwn(THEME_FONT_STACKS, config.font)
    ? (config.font as ThemeFontId)
    : 'default';
  const fontFamily = THEME_FONT_STACKS[fontKey];
  const customCss = config.customCss.trim();
  const normalizedEffects = config.effects ? readThemeEffectsConfig(config.effects) : undefined;
  const activeEffects =
    normalizedEffects && hasActiveEffects(normalizedEffects) ? normalizedEffects : undefined;

  const hasColorOverride = Boolean(preset || accent || background || surface || text);
  if (!hasColorOverride && !fontFamily && !customCss && !activeEffects) {
    return null;
  }

  let palette: ThemePalette | null = null;
  if (hasColorOverride) {
    const inferredLight = background !== null && relativeLuminance(background) > 0.45;
    const fallbackBase = inferredLight
      ? (findThemePreset('warm-paper')?.palette as ThemePalette)
      : (findThemePreset('midnight')?.palette as ThemePalette);
    const base = preset?.palette ?? fallbackBase;

    const resolvedBg = background ?? base.background;
    const resolvedSurface = surface ?? base.surface;
    const resolvedText = text ?? base.text;
    const resolvedAccent = accent ?? base.accent;
    let resolvedScheme: ThemeColorScheme = base.colorScheme;
    if (background !== null) {
      resolvedScheme = inferredLight ? 'light' : 'dark';
    }

    palette = {
      ...base,
      colorScheme: resolvedScheme,
      background: resolvedBg,
      surface: resolvedSurface,
      text: resolvedText,
      accent: resolvedAccent,
      accentText: accent ? contrastingText(resolvedAccent) : base.accentText,
    };
  }

  return {
    palette,
    ...(fontFamily ? { fontFamily } : {}),
    ...(customCss ? { customCss } : {}),
    ...(preset?.hostCss ? { presetHostCss: preset.hostCss } : {}),
    ...(preset?.uiCss ? { presetUiCss: preset.uiCss } : {}),
    ...(activeEffects ? { effects: activeEffects } : {}),
  };
}
