import { useMemo } from 'react';
import type { ThemeDocumentV1 } from '../../core/theming/document';
import type { SavedThemeEntry } from '../../core/theming/library';
import { findBackdropOption, getBackdropDisplayName } from '../../core/theme-effects/model';
import {
  describeThemeDocument,
  findActiveStudioVibe,
  findActiveThemePreset,
  hasPaletteOverrides,
} from '../../core/theming/config';
import { analyzeThemeDocument, documentEffectsToConfig } from '../../core/theming/document';
import { findThemePreset } from '../../core/theming/presets';
import { Badge, previewLeaveProps, SettingCard, UiIcon } from '../primitives';
import { QUICK_THEME_PRESET_IDS } from './starter-modes';

export const QUICK_THEMES = QUICK_THEME_PRESET_IDS.flatMap((id) => {
  const found = findThemePreset(id);
  return found ? [found] : [];
});

export interface AnalyzedSavedTheme {
  readonly entry: SavedThemeEntry;
  readonly fingerprint: string;
  readonly hasEffects: boolean;
  readonly backdropName?: string;
  readonly dotBackground: string;
}

function getSavedThemeDotStyle(doc: ThemeDocumentV1): string {
  const swatches = doc.meta.swatches;
  if (swatches && swatches.length >= 3) {
    return `linear-gradient(135deg, ${swatches.slice(0, 4).join(', ')})`;
  }
  if (doc.palette) {
    return `linear-gradient(135deg, ${doc.palette.background} 50%, ${doc.palette.accent} 50%)`;
  }
  const backdropId = doc.effects?.backdrop?.id;
  if (backdropId && backdropId !== 'none') {
    const backdrop = findBackdropOption(backdropId);
    if (backdrop) {
      return backdrop.preview;
    }
  }
  return 'linear-gradient(135deg, #f3f4f6 50%, #1f2937 50%)';
}

/** Pre-computes fingerprints, badges, and swatch dots for saved library entries. */
export function useAnalyzedSavedThemes(
  savedThemes: readonly SavedThemeEntry[],
): readonly AnalyzedSavedTheme[] {
  return useMemo<readonly AnalyzedSavedTheme[]>(
    () =>
      savedThemes.map((entry) => {
        const caps = analyzeThemeDocument(entry.document);
        const backdropName = caps.backdropEngine
          ? getBackdropDisplayName(caps.backdropEngine)
          : undefined;
        return {
          entry,
          fingerprint: caps.fingerprint,
          hasEffects: Boolean(caps.backdropEngine || caps.surfaceFinish || caps.clickEffect),
          ...(backdropName ? { backdropName } : {}),
          dotBackground: getSavedThemeDotStyle(entry.document),
        };
      }),
    [savedThemes],
  );
}

export interface SavedThemesStripProps {
  readonly items: readonly AnalyzedSavedTheme[];
  readonly activeFingerprint: string;
  readonly ariaLabel: string;
  readonly onSelect: (entry: SavedThemeEntry) => void;
  readonly onPreview?: (item: AnalyzedSavedTheme) => void;
  readonly onClearPreview?: () => void;
}

/** Horizontal scrollable My Themes pill strip shared by active and unsupported popup tabs. */
export function SavedThemesStrip({
  items,
  activeFingerprint,
  ariaLabel,
  onSelect,
  onPreview,
  onClearPreview,
}: SavedThemesStripProps) {
  return (
    <div
      className="qp-saved-list"
      role="group"
      aria-label={ariaLabel}
      {...(onClearPreview ? previewLeaveProps(onClearPreview) : {})}
    >
      {items.map((item) => {
        const name = item.entry.document.meta.name;
        const tooltip = item.backdropName ? `${name} · ${item.backdropName}` : name;
        return (
          <button
            key={item.entry.id}
            type="button"
            className="qp-saved-chip"
            title={tooltip}
            aria-pressed={activeFingerprint !== '' && item.fingerprint === activeFingerprint}
            onMouseEnter={onPreview ? () => onPreview(item) : undefined}
            onFocus={onPreview ? () => onPreview(item) : undefined}
            onClick={() => onSelect(item.entry)}
          >
            <span
              className="qp-saved-dot"
              aria-hidden="true"
              style={{ background: item.dotBackground }}
            />
            <span className="qp-saved-name">{name}</span>
            {item.hasEffects && <UiIcon name="sparkles" size={10} className="qp-saved-fx" />}
          </button>
        );
      })}
    </div>
  );
}

export interface PopupThemeCardProps {
  readonly theme: ThemeDocumentV1;
  readonly savedThemes: readonly AnalyzedSavedTheme[];
  readonly activeFingerprint: string;
  readonly onApplyQuickTheme: (presetId: string) => void;
  readonly onPreviewQuickTheme: (presetId: string) => void;
  readonly onApplySavedTheme: (entry: SavedThemeEntry) => void;
  readonly onPreviewSavedTheme: (item: AnalyzedSavedTheme) => void;
  readonly onClearPreview: () => void;
  readonly onFlipPolarity: () => void;
  readonly onApplyToAllSites: (doc: ThemeDocumentV1, label: string) => void;
  readonly onToggleMotion: () => void;
  readonly onClearEffects: () => void;
}

/** Theme card rendered inside the supported-tab Quick Control Center. */
export function PopupThemeCard({
  theme,
  savedThemes,
  activeFingerprint,
  onApplyQuickTheme,
  onPreviewQuickTheme,
  onApplySavedTheme,
  onPreviewSavedTheme,
  onClearPreview,
  onFlipPolarity,
  onApplyToAllSites,
  onToggleMotion,
  onClearEffects,
}: PopupThemeCardProps) {
  const {
    activeEffects,
    effectsActive,
    activeVibe,
    activePreset,
    activeBackdrop,
    paletteCustomized,
    themeSummaryLabel,
    themeBadgeLabel,
  } = useMemo(() => {
    const resolvedEffects = documentEffectsToConfig(theme.effects);
    const hasEffects = Boolean(resolvedEffects);
    const vibe = findActiveStudioVibe(theme);
    const preset = findActiveThemePreset(theme);
    const backdrop =
      resolvedEffects && resolvedEffects.backdrop !== 'none'
        ? findBackdropOption(resolvedEffects.backdrop)
        : undefined;
    const summaryLabel = describeThemeDocument(theme).label;
    return {
      activeEffects: resolvedEffects,
      effectsActive: hasEffects,
      activeVibe: vibe,
      activePreset: preset,
      activeBackdrop: backdrop,
      paletteCustomized: hasPaletteOverrides(theme),
      themeSummaryLabel: summaryLabel,
      themeBadgeLabel: hasEffects && !vibe ? `${summaryLabel} · FX` : summaryLabel,
    };
  }, [theme]);

  let studioBarLabel = 'Studio FX';
  const activeBackdropName =
    activeEffects && activeEffects.backdrop !== 'none'
      ? getBackdropDisplayName(activeEffects.backdrop)
      : undefined;
  if (activeBackdropName) {
    studioBarLabel = activeEffects?.paused ? `${activeBackdropName} · Paused` : activeBackdropName;
  } else if (activeEffects?.paused) {
    studioBarLabel = 'Motion paused';
  }

  return (
    <SettingCard
      title="Theme"
      action={<Badge tone={effectsActive ? 'accent' : 'neutral'}>{themeBadgeLabel}</Badge>}
    >
      {activeEffects && (
        <div className="qp-studio-bar">
          <span className="qp-studio-info">
            <span
              className="qp-studio-dot"
              aria-hidden="true"
              style={{
                background:
                  activeVibe?.swatch ??
                  activeBackdrop?.preview ??
                  'linear-gradient(135deg, var(--fs-accent), var(--fs-card-bg))',
              }}
            />
            <span className="qp-studio-label">{studioBarLabel}</span>
          </span>
          <span className="qp-studio-actions">
            {activeEffects.backdrop !== 'none' && (
              <button
                type="button"
                className="qp-mini-btn"
                title={
                  activeEffects.paused
                    ? 'Resume background animation'
                    : 'Pause background animation'
                }
                aria-pressed={activeEffects.paused}
                onClick={onToggleMotion}
              >
                <UiIcon name={activeEffects.paused ? 'play' : 'pause'} size={10} />
                {activeEffects.paused ? 'Play' : 'Pause'}
              </button>
            )}
            <button
              type="button"
              className="qp-mini-btn"
              title="Turn off Studio effects and keep color palette"
              onClick={onClearEffects}
            >
              FX off
            </button>
          </span>
        </div>
      )}
      <div className="qp-swatches-row">
        <div
          className="qp-swatches"
          role="group"
          aria-label="Quick theme presets"
          {...previewLeaveProps(onClearPreview)}
        >
          <button
            type="button"
            className="qp-swatch-btn"
            title="Site Default"
            aria-label="Site Default theme"
            aria-pressed={!effectsActive && theme.id === 'default'}
            onMouseEnter={() => onPreviewQuickTheme('default')}
            onFocus={() => onPreviewQuickTheme('default')}
            onClick={() => onApplyQuickTheme('default')}
          >
            <span className="qp-swatch-fill qp-swatch-default" aria-hidden="true" />
          </button>
          {QUICK_THEMES.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="qp-swatch-btn"
              title={preset.name}
              aria-label={`${preset.name} theme`}
              aria-pressed={!effectsActive && !paletteCustomized && activePreset?.id === preset.id}
              onMouseEnter={() => onPreviewQuickTheme(preset.id)}
              onFocus={() => onPreviewQuickTheme(preset.id)}
              onClick={() => onApplyQuickTheme(preset.id)}
            >
              <span
                className="qp-swatch-fill"
                aria-hidden="true"
                style={{
                  background:
                    preset.swatchGradient ??
                    `linear-gradient(135deg, ${preset.palette.background} 50%, ${preset.palette.accent} 50%)`,
                }}
              />
            </button>
          ))}
        </div>
        <div className="qp-swatch-actions">
          {theme.palette && (
            <button
              type="button"
              className="qp-swatch-action"
              aria-label={
                theme.palette.colorScheme === 'dark'
                  ? 'Switch to light palette'
                  : 'Switch to dark palette'
              }
              title={
                theme.palette.colorScheme === 'dark'
                  ? 'Flip to light palette'
                  : 'Flip to dark palette'
              }
              onClick={onFlipPolarity}
            >
              <UiIcon name={theme.palette.colorScheme === 'dark' ? 'sun' : 'moon'} size={13} />
            </button>
          )}
          <button
            type="button"
            className="qp-swatch-action"
            aria-label="Apply theme to all sites"
            title={`Apply "${themeSummaryLabel}" to all sites`}
            onClick={() => onApplyToAllSites(theme, themeSummaryLabel)}
          >
            <UiIcon name="globe" size={13} />
          </button>
        </div>
      </div>
      {savedThemes.length > 0 && (
        <div className="qp-saved-section">
          <span className="qp-saved-kicker">My Themes</span>
          <SavedThemesStrip
            items={savedThemes}
            activeFingerprint={activeFingerprint}
            ariaLabel="My Themes"
            onSelect={onApplySavedTheme}
            onPreview={onPreviewSavedTheme}
            onClearPreview={onClearPreview}
          />
        </div>
      )}
    </SettingCard>
  );
}
