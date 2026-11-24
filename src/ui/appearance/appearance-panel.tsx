import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { SavedValue } from '../../core/saved';
import type { StudioVibe, ThemeEffectsConfig } from '../../core/theme-effects';
import type {
  PaletteMood,
  SavedThemeEntry,
  THEME_FONT_STACKS,
  ThemeController,
  ThemeDocumentV1,
  ThemeFontId,
  ThemeLibraryClient,
} from '../../core/theming';
import type { OptionsPanel, PanelProps, PanelSearchItem } from '../options-dialog/panel';
import type { AuditState } from './health-disclosure';
import { DEFAULT_THEME_EFFECTS, STUDIO_VIBES } from '../../core/theme-effects';
import {
  analyzeThemeDocument,
  applyGeneratedPalette,
  applyStudioVibe,
  applyThemeDocument,
  applyThemePreset,
  BUILTIN_THEMES,
  clearThemeEffects,
  DEFAULT_THEME_DOCUMENT,
  documentEffectsToConfig,
  findActiveStudioVibe,
  findActiveThemePreset,
  flipThemeColorScheme,
  getPaletteSwatches,
  hasPaletteOverrides,
  isCustomImportedDocument,
  isThemeFontId,
  minTextContrast,
  normalizeHex,
  PALETTE_MOODS,
  pickAccessibleText,
  resolveTheme,
  updateThemeChrome,
  updateThemeCustomCss,
  updateThemeEffects,
  updateThemePalette,
  updateThemeTypography,
  WCAG_AA_TEXT_CONTRAST,
} from '../../core/theming';
import { definePanel } from '../options-dialog/panel';
import {
  Badge,
  Disclosure,
  previewLeaveProps,
  SegmentedControl,
  SettingCard,
  SettingRow,
  Switch,
  TextInput,
} from '../primitives';
import css from './appearance-panel.css?inline';
import { CustomCssDisclosure } from './custom-css-disclosure';
import { ThemeHealthDisclosure } from './health-disclosure';
import { CreativeStudioCard, StudioVibesCard } from './studio-section';
import { ThemeLibraryCard } from './theme-library-card';
import {
  downloadThemeDocumentFile,
  ThemeSwatches,
  ThemeTransferDisclosure,
} from './theme-transfer';

export { readThemeDocument, THEME_DATA_KEY } from '../../core/theming';

const FONT_LABELS: Record<keyof typeof THEME_FONT_STACKS, string> = {
  default: 'Site default',
  system: 'System Sans',
  rounded: 'Rounded Sans',
  serif: 'Editorial Serif',
  mono: 'Monospace',
};

type ColorFieldKey = 'accent' | 'accentSecondary' | 'background' | 'surface' | 'text';

const COLOR_FIELDS: ReadonlyArray<{
  readonly key: ColorFieldKey;
  readonly label: string;
}> = [
  { key: 'accent', label: 'Accent' },
  { key: 'accentSecondary', label: 'Secondary accent' },
  { key: 'background', label: 'Canvas background' },
  { key: 'surface', label: 'Card surface' },
  { key: 'text', label: 'Primary text' },
];

const MOOD_LABELS: Record<PaletteMood, string> = {
  midnight: 'Midnight',
  'soft-dark': 'Soft Dark',
  neon: 'Neon',
  'warm-paper': 'Warm Paper',
  'crisp-light': 'Crisp Light',
  pastel: 'Pastel',
};

type SchemeFilter = 'all' | 'dark' | 'light';

const SCHEME_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
] as const;

function formatScanTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

function AppearancePanelView({
  value,
  onChange,
  notify,
  options,
  controller,
  library,
}: PanelProps<ThemeDocumentV1> & {
  controller: ThemeController;
  library?: ThemeLibraryClient;
}) {
  const fontId = useId();
  const hoverPreviewActiveRef = useRef(false);
  const [seedColor, setSeedColor] = useState(() => value.palette?.accent ?? '#3b82f6');
  const [seedMood, setSeedMood] = useState<PaletteMood>('midnight');
  const [libraryEntries, setLibraryEntries] = useState<readonly SavedThemeEntry[]>(() =>
    library ? library.list() : [],
  );
  useEffect(() => {
    if (!library) {
      return;
    }
    setLibraryEntries(library.list());
    return library.onChange((next) => setLibraryEntries(next.themes));
  }, [library]);
  const activeFingerprint = useMemo(
    () => (library ? analyzeThemeDocument(value).fingerprint : ''),
    [library, value],
  );
  const analyzedLibrary = useMemo(() => {
    const items = libraryEntries.map((entry) => ({
      entry,
      capabilities: analyzeThemeDocument(entry.document),
      swatches: getPaletteSwatches(entry.document.palette, entry.document.meta.swatches, true),
    }));
    const fingerprints = new Set(items.map((item) => item.capabilities.fingerprint));
    return { items, fingerprints };
  }, [libraryEntries]);
  const savedInLibrary = Boolean(library && analyzedLibrary.fingerprints.has(activeFingerprint));
  const [auditState, setAuditState] = useState<AuditState | null>(null);
  const [schemeFilter, setSchemeFilter] = useState<SchemeFilter>('all');
  const [colorDrafts, setColorDrafts] = useState<Partial<Record<ColorFieldKey, string>>>({});
  const colorError = useMemo(() => {
    for (const { key, label } of COLOR_FIELDS) {
      const draft = colorDrafts[key];
      if (draft !== undefined) {
        const trimmed = draft.trim();
        if (trimmed && !normalizeHex(trimmed)) {
          return `${label} must be a hex color like #3b82f6.`;
        }
      }
    }
    return null;
  }, [colorDrafts]);

  const hasExternalCssOption = useMemo(
    () => Boolean(options?.list().some(([key]) => key === 'custom_stylesheet_url')),
    [options],
  );
  const [savedExternalCssUrl, setSavedExternalCssUrl] = useState(() =>
    hasExternalCssOption && options ? String(options.get('custom_stylesheet_url')) : '',
  );
  const [externalCssDraft, setExternalCssDraft] = useState(savedExternalCssUrl);

  useEffect(() => {
    if (!hasExternalCssOption || !options) {
      return;
    }
    return options.watch('custom_stylesheet_url', (next) => {
      const url = String(next);
      setSavedExternalCssUrl(url);
      setExternalCssDraft(url);
    });
  }, [hasExternalCssOption, options]);

  const hasCustomColors = useMemo(() => hasPaletteOverrides(value), [value]);
  const isImported = useMemo(() => isCustomImportedDocument(value), [value]);
  const [colorsOpen, setColorsOpen] = useState(hasCustomColors);
  const [transferOpen, setTransferOpen] = useState(isImported);
  const [cssOpen, setCssOpen] = useState(
    Boolean((value.customCss ?? '').trim() || savedExternalCssUrl.trim()),
  );
  const [healthOpen, setHealthOpen] = useState(false);

  const commitExternalCssUrl = (raw: string): void => {
    if (!hasExternalCssOption || !options) {
      return;
    }
    const nextUrl = raw.trim();
    if (nextUrl === savedExternalCssUrl) {
      setExternalCssDraft(nextUrl);
      return;
    }
    const previousUrl = savedExternalCssUrl;
    setExternalCssDraft(nextUrl);
    setSavedExternalCssUrl(nextUrl);
    void options.set('custom_stylesheet_url', nextUrl);
    notify?.(nextUrl ? 'External stylesheet saved' : 'External stylesheet cleared', () => {
      setExternalCssDraft(previousUrl);
      setSavedExternalCssUrl(previousUrl);
      void options.set('custom_stylesheet_url', previousUrl);
    });
  };

  const effective = value.palette;
  const activePreset = useMemo(() => findActiveThemePreset(value), [value]);
  const minContrast = useMemo(
    () =>
      effective ? minTextContrast(effective.text, effective.background, effective.surface) : null,
    [effective],
  );
  const lowContrast = minContrast !== null && minContrast < WCAG_AA_TEXT_CONTRAST;

  useEffect(() => {
    if (lowContrast) {
      setColorsOpen(true);
    }
  }, [lowContrast]);

  const clearColorDrafts = (): void => {
    setColorDrafts({});
  };

  const valueJson = useMemo(() => JSON.stringify(value), [value]);

  useEffect(
    () => () => {
      if (hoverPreviewActiveRef.current) {
        hoverPreviewActiveRef.current = false;
        controller.clearPreview();
      }
    },
    [controller],
  );

  const clearHoverPreview = (): void => {
    if (!hoverPreviewActiveRef.current) {
      return;
    }
    hoverPreviewActiveRef.current = false;
    controller.clearPreview();
  };

  const previewCandidate = (candidate: ThemeDocumentV1 | null): void => {
    if (!candidate) {
      clearHoverPreview();
      return;
    }
    if (
      candidate === value ||
      (candidate.id === value.id && JSON.stringify(candidate) === valueJson)
    ) {
      clearHoverPreview();
      return;
    }
    hoverPreviewActiveRef.current = true;
    controller.preview(resolveTheme(candidate));
  };

  const applyEdit = (next: ThemeDocumentV1, toastLabel?: string): void => {
    const previous = value;
    hoverPreviewActiveRef.current = false;
    controller.preview(resolveTheme(next));
    onChange(next);
    setAuditState(null);
    if (toastLabel && notify) {
      notify(toastLabel, () => {
        clearColorDrafts();
        hoverPreviewActiveRef.current = false;
        controller.preview(resolveTheme(previous));
        onChange(previous);
        setAuditState(null);
      });
    }
  };

  const activeEffects = useMemo(() => documentEffectsToConfig(value.effects), [value.effects]);
  const effects: ThemeEffectsConfig = activeEffects ?? DEFAULT_THEME_EFFECTS;
  const effectsActive = Boolean(activeEffects);

  const previewEffects = (patch: Partial<ThemeEffectsConfig>): void => {
    controller.preview(resolveTheme(updateThemeEffects(value, patch)));
  };

  const updateEffects = (patch: Partial<ThemeEffectsConfig>, toastLabel?: string): void => {
    applyEdit(updateThemeEffects(value, patch), toastLabel);
  };

  const applyVibe = (vibe: StudioVibe): void => {
    clearColorDrafts();
    applyEdit(applyStudioVibe(value, vibe), `${vibe.name} vibe applied`);
  };

  const activeVibe = useMemo(() => findActiveStudioVibe(value), [value]);

  const selectColorTheme = (presetId: string, label: string): void => {
    clearColorDrafts();
    const suffix = effectsActive ? ' (effects cleared)' : '';
    applyEdit(applyThemePreset(value, presetId), `Theme set to ${label}${suffix}`);
  };

  const resetEffects = (): void => {
    applyEdit(clearThemeEffects(value), 'Cleared studio effects');
  };

  const handleImportDocument = (doc: ThemeDocumentV1, includeCustomCss: boolean): void => {
    clearColorDrafts();
    applyEdit(applyThemeDocument(doc, { includeCustomCss }), `Imported theme "${doc.meta.name}"`);
  };

  const runLibraryAction = <R,>(
    run: (client: ThemeLibraryClient) => Promise<R>,
    onSuccess: (result: R, client: ThemeLibraryClient) => void,
    fallbackError: string,
  ): Promise<boolean> => {
    if (!library) {
      return Promise.resolve(false);
    }
    return run(library).then(
      (result) => {
        onSuccess(result, library);
        return true;
      },
      (error: unknown) => {
        notify?.(error instanceof Error ? error.message : fallbackError);
        return false;
      },
    );
  };

  const handleSaveToLibrary = (
    doc: ThemeDocumentV1,
    saveOptions: { readonly name?: string; readonly includeCustomCss?: boolean } = {},
  ): Promise<boolean> =>
    runLibraryAction(
      (client) => client.saveTheme(doc, saveOptions),
      (entry) => notify?.(`Saved "${entry.document.meta.name}" to My Themes`),
      'Could not save theme to My Themes',
    );

  const handleApplyLibraryEntry = (entry: SavedThemeEntry): void => {
    clearColorDrafts();
    applyEdit(entry.document, `Applied "${entry.document.meta.name}"`);
  };

  const handleApplyAllSites = (doc: ThemeDocumentV1): void => {
    if (!library) {
      return;
    }
    if (doc !== value) {
      clearColorDrafts();
      applyEdit(doc);
    }
    void runLibraryAction(
      (client) => client.applyToAllSites(doc),
      (override) => notify?.(`Applied "${override.document.meta.name}" to all sites`),
      'Could not apply theme across all sites',
    );
  };

  const handleRenameLibraryEntry = (entryId: string, nextName: string): void => {
    void runLibraryAction(
      (client) => client.renameTheme(entryId, nextName),
      (updated) => {
        if (updated) {
          notify?.(`Renamed theme to "${updated.document.meta.name}"`);
        }
      },
      'Could not rename saved theme',
    );
  };

  const handleDeleteLibraryEntry = (entry: SavedThemeEntry): void => {
    clearHoverPreview();
    void runLibraryAction(
      (client) => client.removeTheme(entry.id),
      (removed) => {
        if (removed) {
          notify?.(`Deleted "${removed.document.meta.name}"`, () => {
            void runLibraryAction(
              (client) => client.restoreTheme(removed),
              () => undefined,
              'Could not restore deleted theme',
            );
          });
        }
      },
      'Could not delete saved theme',
    );
  };

  const clearDraftKey = (key: ColorFieldKey): void => {
    setColorDrafts((prev) => {
      if (!(key in prev)) {
        return prev;
      }
      const { [key]: _removed, ...next } = prev;
      return next;
    });
  };

  const handleColorHexInput = (key: ColorFieldKey, raw: string): void => {
    const trimmed = raw.trim();
    if (!trimmed) {
      if (key === 'accentSecondary') {
        clearDraftKey(key);
        const presetSecondary = activePreset?.palette.accentSecondary;
        applyEdit(updateThemePalette(value, { accentSecondary: presetSecondary ?? '' }));
        return;
      }
      if (activePreset) {
        clearDraftKey(key);
        applyEdit(updateThemePalette(value, { [key]: activePreset.palette[key] }));
      } else {
        setColorDrafts((prev) => ({ ...prev, [key]: '' }));
      }
      return;
    }
    const normalized = normalizeHex(trimmed);
    if (!normalized) {
      setColorDrafts((prev) => ({ ...prev, [key]: raw }));
      return;
    }
    if (trimmed.toLowerCase() === normalized) {
      clearDraftKey(key);
    } else {
      setColorDrafts((prev) => ({ ...prev, [key]: raw }));
    }
    applyEdit(updateThemePalette(value, { [key]: normalized }));
  };

  const runAudit = (): void => {
    setHealthOpen(true);
    const report = controller.audit?.() ?? null;
    if (!report) {
      setAuditState(null);
      return;
    }
    setAuditState((prev) => ({
      report,
      runCount: (prev?.runCount ?? 0) + 1,
      ranAt: formatScanTime(new Date()),
      lastAction: 'audit',
    }));
  };

  const runHealAndAudit = (): void => {
    setHealthOpen(true);
    const beforeScore = auditState?.report.score;
    const healedCount = controller.healNow?.() ?? 0;
    const report = controller.audit?.() ?? null;
    if (!report) {
      setAuditState(null);
      return;
    }
    setAuditState((prev) => ({
      report,
      runCount: (prev?.runCount ?? 0) + 1,
      ranAt: formatScanTime(new Date()),
      lastAction: 'heal',
      healedCount,
      ...(beforeScore === undefined ? {} : { beforeScore }),
    }));
  };

  const filteredPresets = BUILTIN_THEMES.filter(
    (preset) => schemeFilter === 'all' || preset.palette.colorScheme === schemeFilter,
  );

  let colorsBadge;
  if (lowContrast) {
    colorsBadge = <Badge tone="warning">Low contrast</Badge>;
  } else if (hasCustomColors) {
    colorsBadge = <Badge tone="accent">Customized</Badge>;
  }

  const fontPreset: ThemeFontId = value.typography?.preset ?? 'default';
  const hasImportedCustomStack = Boolean(fontPreset === 'default' && value.typography?.customStack);
  const selectFont = (nextFont: string): void => {
    if (nextFont === '__imported__' || !isThemeFontId(nextFont)) {
      return;
    }
    const fontLabel = FONT_LABELS[nextFont];
    applyEdit(updateThemeTypography(value, nextFont), `Typography set to ${fontLabel}`);
  };

  return (
    <section className="theme-panel">
      {isImported && (
        <div className="theme-imported-banner" role="region" aria-label="Active imported theme">
          <div className="theme-imported-info">
            <Badge tone="accent">Imported</Badge>
            <strong className="theme-card-name">{value.meta.name}</strong>
            {value.meta.author && <span className="theme-studio-hint">by {value.meta.author}</span>}
          </div>
          <div className="theme-audit-buttons">
            {library && !savedInLibrary && (
              <button
                type="button"
                className="theme-inline-reset"
                onClick={() => {
                  void handleSaveToLibrary(value);
                }}
              >
                Save to My Themes
              </button>
            )}
            <button
              type="button"
              className="theme-inline-reset"
              onClick={() => {
                const filename = downloadThemeDocumentFile(value);
                notify?.(`Exported ${filename}`);
              }}
            >
              Export
            </button>
            <button
              type="button"
              className="theme-inline-reset"
              onClick={() => {
                clearColorDrafts();
                applyEdit({ ...DEFAULT_THEME_DOCUMENT }, 'Cleared imported theme');
              }}
            >
              Reset
            </button>
          </div>
        </div>
      )}

      {library && (
        <ThemeLibraryCard
          items={analyzedLibrary.items}
          activeDocument={value}
          activeFingerprint={activeFingerprint}
          onSaveCurrent={(name) => {
            void handleSaveToLibrary(value, { name });
          }}
          onApplyEntry={handleApplyLibraryEntry}
          onPreviewEntry={(entry) => previewCandidate(entry ? entry.document : null)}
          onApplyAllSites={handleApplyAllSites}
          onRenameEntry={handleRenameLibraryEntry}
          onDeleteEntry={handleDeleteLibraryEntry}
          onExportEntry={(_entry, filename) => notify?.(`Exported ${filename}`)}
        />
      )}

      <StudioVibesCard
        activeVibe={activeVibe}
        onApplyVibe={applyVibe}
        onPreviewVibe={(vibe) => previewCandidate(vibe ? applyStudioVibe(value, vibe) : null)}
      />

      <SettingCard
        title="Color Themes"
        action={
          <button
            className="theme-inline-reset"
            type="button"
            onClick={() => {
              clearColorDrafts();
              applyEdit({ ...DEFAULT_THEME_DOCUMENT }, 'Reset theme to site default');
            }}
          >
            Reset to site default
          </button>
        }
      >
        <div className="theme-studio-pad">
          <div className="theme-actions">
            <p className="theme-studio-intro">
              Clean static palettes — picking one turns off live effects.
            </p>
            <SegmentedControl
              options={SCHEME_FILTERS}
              value={schemeFilter}
              ariaLabel="Filter theme presets"
              onChange={setSchemeFilter}
            />
          </div>

          <div
            className="theme-grid"
            role="group"
            aria-label="Theme presets"
            {...previewLeaveProps(clearHoverPreview)}
          >
            <button
              type="button"
              className="theme-card"
              aria-pressed={!effectsActive && value.id === 'default'}
              onMouseEnter={() => previewCandidate(applyThemePreset(value, 'default'))}
              onFocus={() => previewCandidate(applyThemePreset(value, 'default'))}
              onClick={() => selectColorTheme('default', 'Site Default')}
            >
              <span className="theme-card-name">Site Default</span>
              <p className="theme-card-desc">Use the host site's built-in light or dark theme.</p>
            </button>
            {filteredPresets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="theme-card"
                aria-pressed={!effectsActive && activePreset?.id === preset.id}
                data-base={effectsActive && activePreset?.id === preset.id ? 'true' : undefined}
                onMouseEnter={() => previewCandidate(applyThemePreset(value, preset.id))}
                onFocus={() => previewCandidate(applyThemePreset(value, preset.id))}
                onClick={() => selectColorTheme(preset.id, preset.name)}
              >
                <ThemeSwatches swatches={getPaletteSwatches(preset.palette, preset.swatches)} />
                <span className="theme-card-name">{preset.name}</span>
                <p className="theme-card-desc">{preset.description}</p>
              </button>
            ))}
          </div>
        </div>
      </SettingCard>

      <CreativeStudioCard
        effects={effects}
        effectsActive={effectsActive}
        onPreviewEffects={previewEffects}
        onUpdateEffects={updateEffects}
        onResetEffects={resetEffects}
      />

      <SettingCard title="Typography & Advanced">
        <SettingRow
          title="Typography"
          description="Applies across site text and Feed Sanity controls."
          htmlFor={fontId}
        >
          <select
            id={fontId}
            className="field"
            aria-label="Typography"
            value={hasImportedCustomStack ? '__imported__' : fontPreset}
            onChange={(event) => selectFont(event.currentTarget.value)}
          >
            {hasImportedCustomStack && <option value="__imported__">Custom (imported)</option>}
            {(Object.keys(FONT_LABELS) as Array<keyof typeof FONT_LABELS>).map((id) => (
              <option key={id} value={id}>
                {FONT_LABELS[id]}
              </option>
            ))}
          </select>
        </SettingRow>

        <Disclosure
          label="Customize colors"
          badge={colorsBadge}
          open={colorsOpen}
          onToggle={() => setColorsOpen((open) => !open)}
        >
          <div className="theme-drawer-pad">
            <div className="theme-palette-gen" role="group" aria-label="Palette generator">
              <span className="theme-palette-gen-label">Generate palette</span>
              <input
                type="color"
                className="theme-picker"
                aria-label="Palette seed color"
                value={seedColor}
                onChange={(event) => setSeedColor(event.currentTarget.value)}
              />
              <select
                className="field"
                aria-label="Palette mood"
                value={seedMood}
                onChange={(event) => setSeedMood(event.currentTarget.value as PaletteMood)}
              >
                {PALETTE_MOODS.map((mood) => (
                  <option key={mood} value={mood}>
                    {MOOD_LABELS[mood]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="button primary"
                onClick={() => {
                  clearColorDrafts();
                  applyEdit(
                    applyGeneratedPalette(value, seedColor, seedMood),
                    `Generated ${MOOD_LABELS[seedMood]} palette`,
                  );
                }}
              >
                Generate
              </button>
              {effective && (
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    clearColorDrafts();
                    const nextScheme = effective.colorScheme === 'dark' ? 'light' : 'dark';
                    applyEdit(flipThemeColorScheme(value), `Flipped to ${nextScheme} mode`);
                  }}
                >
                  Flip {effective.colorScheme === 'dark' ? 'Light' : 'Dark'}
                </button>
              )}
            </div>

            <div className="theme-controls">
              {COLOR_FIELDS.map(({ key, label }) => {
                const defaultFallback =
                  key === 'accentSecondary' ? (effective?.danger ?? '#a855f7') : '#3b82f6';
                const fallbackHex = effective?.[key] ?? defaultFallback;
                const currentToken = effective?.[key] ?? '';
                const presetToken = activePreset?.palette[key] ?? '';
                const savedOverride =
                  effective && (!activePreset || currentToken !== presetToken) ? currentToken : '';
                const inputVal = colorDrafts[key] ?? savedOverride;
                const pickerValue = normalizeHex(inputVal) ?? fallbackHex;
                return (
                  <label key={key} className="theme-color-row">
                    <span>{label}</span>
                    <span className="theme-color-inputs">
                      <input
                        type="color"
                        className="theme-picker"
                        aria-label={`${label} picker`}
                        value={pickerValue}
                        onChange={(event) => handleColorHexInput(key, event.currentTarget.value)}
                      />
                      <TextInput
                        className="field theme-hex"
                        ariaLabel={label}
                        placeholder={fallbackHex}
                        value={inputVal}
                        onValueChange={(nextHex) => handleColorHexInput(key, nextHex)}
                      />
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="theme-chrome-row" role="group" aria-label="Chrome accents">
              <span className="theme-inline-toggle">
                <span>Top accent ribbon</span>
                <Switch
                  checked={Boolean(value.chrome?.ribbon?.enabled)}
                  ariaLabel="Top accent ribbon"
                  onChange={(enabled) =>
                    applyEdit(
                      updateThemeChrome(value, { ribbon: enabled }),
                      enabled ? 'Top accent ribbon on' : 'Top accent ribbon off',
                    )
                  }
                />
              </span>
              <span className="theme-inline-toggle">
                <span>Ambient corner glow</span>
                <Switch
                  checked={Boolean(value.chrome?.ambientGlow?.enabled)}
                  ariaLabel="Ambient corner glow"
                  onChange={(enabled) =>
                    applyEdit(
                      updateThemeChrome(value, { ambientGlow: enabled }),
                      enabled ? 'Ambient corner glow on' : 'Ambient corner glow off',
                    )
                  }
                />
              </span>
            </div>
            {colorError && (
              <div className="theme-contrast-warn" role="alert">
                <span>{colorError}</span>
              </div>
            )}
            {lowContrast && effective && (
              <div className="theme-contrast-warn" role="status">
                <span>
                  Low text contrast ({minContrast.toFixed(1)}:1 — WCAG AA recommends 4.5:1+).
                </span>
                <button
                  className="button"
                  type="button"
                  onClick={() => {
                    clearDraftKey('text');
                    applyEdit(
                      updateThemePalette(value, {
                        text: pickAccessibleText(effective.background, effective.surface),
                      }),
                      'Fixed text contrast',
                    );
                  }}
                >
                  Fix contrast
                </button>
              </div>
            )}
          </div>
        </Disclosure>

        <ThemeTransferDisclosure
          open={transferOpen}
          onToggle={() => setTransferOpen((open) => !open)}
          document={value}
          onImport={handleImportDocument}
          {...(library
            ? {
                onSaveToLibrary: (doc: ThemeDocumentV1, includeCustomCss: boolean) =>
                  handleSaveToLibrary(doc, { includeCustomCss }),
              }
            : {})}
          {...(notify ? { notify } : {})}
        />

        {effective && controller.audit && (
          <ThemeHealthDisclosure
            open={healthOpen}
            onToggle={() => setHealthOpen((open) => !open)}
            auditState={auditState}
            hasHeal={Boolean(controller.healNow)}
            onRunAudit={runAudit}
            onRunHeal={runHealAndAudit}
          />
        )}

        <CustomCssDisclosure
          open={cssOpen}
          onToggle={() => setCssOpen((open) => !open)}
          customCss={value.customCss ?? ''}
          onCustomCssChange={(nextCss) => applyEdit(updateThemeCustomCss(value, nextCss))}
          hasExternalCssOption={hasExternalCssOption}
          savedExternalCssUrl={savedExternalCssUrl}
          externalCssDraft={externalCssDraft}
          onExternalCssDraftChange={setExternalCssDraft}
          onCommitExternalCssUrl={commitExternalCssUrl}
        />
      </SettingCard>
    </section>
  );
}

/**
 * First-class Appearance panel automatically attached to every `SiteAdapter`
 * that declares a `themeMapping`. Instant-applies valid `ThemeDocumentV1` edits
 * with Undo support and contributes all presets & styling controls to unified search.
 */
export function appearancePanel(
  saved: SavedValue<ThemeDocumentV1>,
  controller: ThemeController,
  onApply: (doc: ThemeDocumentV1) => void = (next) => controller.apply(resolveTheme(next)),
  library?: ThemeLibraryClient,
  extraReady?: Promise<void>,
): OptionsPanel {
  const baseReady = library
    ? Promise.all([saved.ready, library.ready]).then(() => undefined)
    : saved.ready;
  const ready = extraReady ? Promise.all([baseReady, extraReady]).then(() => undefined) : baseReady;
  const saveDocument = async (next: ThemeDocumentV1): Promise<void> => {
    await saved.set(next);
    onApply(next);
    controller.clearPreview();
  };
  const selectDocument = (next: ThemeDocumentV1): void => {
    controller.preview(resolveTheme(next));
    void saveDocument(next);
  };
  return definePanel<ThemeDocumentV1>({
    section: 'Appearance',
    css,
    instant: true,
    ready,
    read: () => saved.get(),
    save: saveDocument,
    swatch: () => {
      const palette = saved.get().palette;
      return palette ? { bg: palette.background, accent: palette.accent } : null;
    },
    searchItems: (): PanelSearchItem[] => [
      ...(library
        ? [
            {
              id: 'theme-library',
              title: 'My Themes library / Apply to all sites',
              description:
                'Save customized or imported themes and apply any theme across every site.',
              keywords: ['library', 'saved', 'my themes', 'all sites', 'sync', 'global'],
            },
            ...library.list().map((entry) => ({
              id: `saved-theme:${entry.id}`,
              title: `My Theme: ${entry.document.meta.name}`,
              description: entry.document.meta.description ?? 'Saved theme in My Themes library.',
              keywords: ['saved', 'library', 'theme', entry.id, entry.document.id],
              onSelect: () => selectDocument(entry.document),
            })),
          ]
        : []),
      {
        id: 'typography',
        title: 'Typography / Site font',
        description: 'Change the font family across this site and Feed Sanity controls.',
        keywords: ['font', 'serif', 'mono', 'rounded', 'sans'],
      },
      {
        id: 'import-export-theme',
        title: 'Import / Export theme (.fstheme.json)',
        description: 'Export your active theme to a single file or import a shared .fstheme.json.',
        keywords: ['import', 'export', 'share', 'json', 'fstheme', 'backup', 'file'],
      },
      {
        id: 'custom-css',
        title: 'Custom CSS & External stylesheet',
        description: 'Write inline CSS rules or link an external HTTPS stylesheet.',
        keywords: ['style', 'stylesheet', 'css', 'external', 'url', 'link'],
      },
      {
        id: 'theme-health',
        title: 'Theme health & layout audit',
        description: 'Scan contrast, unthemed surfaces, layout shifts, and header overlaps.',
        keywords: ['audit', 'auto-heal', 'contrast', 'wcag'],
      },
      {
        id: 'creative-studio',
        title: 'Creative Studio (Backgrounds, Glass, Gradients & Click FX)',
        description:
          'Add Matrix Rain, Vice City sunset, Aurora, Silk, glass cards, and click sparks.',
        keywords: [
          'matrix',
          'gta',
          'vice',
          'rain',
          'aurora',
          'silk',
          'stars',
          'grid',
          'glass',
          'gradient',
          'neon',
          'click',
        ],
      },
      ...STUDIO_VIBES.map((vibe) => ({
        id: `vibe:${vibe.id}`,
        title: `Studio Vibe: ${vibe.name}`,
        description: vibe.tagline,
        keywords: ['vibe', 'studio', 'effect', vibe.id, vibe.preset, vibe.effects.backdrop ?? ''],
        onSelect: () => selectDocument(applyStudioVibe(saved.get(), vibe)),
      })),
      ...BUILTIN_THEMES.map((preset) => ({
        id: `preset:${preset.id}`,
        title: `Theme: ${preset.name}`,
        description: preset.description,
        keywords: ['theme', 'preset', preset.palette.colorScheme, preset.id],
        onSelect: () => selectDocument(applyThemePreset(saved.get(), preset.id)),
      })),
    ],
    onClose: () => controller.clearPreview(),
    Panel: (props) => (
      <AppearancePanelView {...props} controller={controller} {...(library ? { library } : {})} />
    ),
  });
}
