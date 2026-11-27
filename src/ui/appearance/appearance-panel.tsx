import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import type { SavedValue } from '../../core/saved';
import type { StudioVibe, ThemeEffectsConfig } from '../../core/theme-effects/model';
import type {
  SavedThemeEntry,
  SaveLibraryThemeOptions,
  ThemeCapabilities,
  ThemeController,
  ThemeDocumentFilterOptions,
  ThemeDocumentV1,
  ThemeFontId,
  ThemeLibraryClient,
  ThemeLibraryViewMode,
} from '../../core/theming';
import type { OptionsPanel, PanelProps, PanelSearchItem } from '../options-dialog/panel';
import type { AuditState } from './health-disclosure';
import { DEFAULT_THEME_EFFECTS } from '../../core/theme-effects/model';
import { STUDIO_VIBES } from '../../core/theme-effects/vibes';
import {
  analyzeThemeDocument,
  applyStudioVibe,
  applyThemeDocument,
  applyThemePreset,
  BUILTIN_THEMES,
  clearThemeEffects,
  DEFAULT_THEME_DOCUMENT,
  documentEffectsToConfig,
  findActiveStudioVibe,
  findActiveThemePreset,
  getPaletteSwatches,
  isCustomImportedDocument,
  isThemeFontId,
  resolveTheme,
  sanitizeFontStack,
  updateThemeCustomCss,
  updateThemeCustomFontStack,
  updateThemeEffects,
  updateThemeTypography,
} from '../../core/theming';
import { definePanel } from '../options-dialog/panel';
import {
  Badge,
  previewLeaveProps,
  SegmentedControl,
  SettingCard,
  SettingRow,
  Switch,
  TextInput,
} from '../primitives';
import { useThemePreview } from '../use-theme-preview';
import css from './appearance-panel.css?inline';
import { CustomCssDisclosure } from './custom-css-disclosure';
import { ThemeHealthDisclosure } from './health-disclosure';
import { PaletteCustomizationDisclosure } from './palette-section';
import { CreativeStudioCard, StudioVibesCard } from './studio-section';
import { handleInlineFormKeyDown, ThemeLibraryCard } from './theme-library-card';
import {
  downloadThemeDocumentFile,
  ThemeSwatches,
  ThemeTransferDisclosure,
} from './theme-transfer';

export { readThemeDocument, THEME_DATA_KEY } from '../../core/theming';

const FONT_LABELS: Record<ThemeFontId, string> = {
  default: 'Site default',
  system: 'System Sans',
  rounded: 'Rounded Sans',
  serif: 'Editorial Serif',
  mono: 'Monospace',
};

const FONT_IDS = Object.keys(FONT_LABELS) as readonly ThemeFontId[];
const CUSTOM_FONT_OPTION = '__custom__';

type SchemeFilter = 'all' | 'dark' | 'light';

const SCHEME_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
] as const;

const BUILTIN_PRESET_SWATCHES: ReadonlyMap<string, readonly string[]> = new Map(
  BUILTIN_THEMES.map((preset) => [preset.id, getPaletteSwatches(preset.palette, preset.swatches)]),
);

interface LibraryDocAnalysis {
  readonly capabilities: ThemeCapabilities;
  readonly swatches: readonly string[];
}

/** WeakMap cache keyed by immutable ThemeDocumentV1 object identity so switching tabs skips re-hashing unchanged library items. */
const LIBRARY_ANALYSIS_CACHE = new WeakMap<ThemeDocumentV1, LibraryDocAnalysis>();

function analyzeLibraryDocument(doc: ThemeDocumentV1): LibraryDocAnalysis {
  let cached = LIBRARY_ANALYSIS_CACHE.get(doc);
  if (!cached) {
    cached = {
      capabilities: analyzeThemeDocument(doc),
      swatches: getPaletteSwatches(doc.palette, doc.meta.swatches, true),
    };
    LIBRARY_ANALYSIS_CACHE.set(doc, cached);
  }
  return cached;
}

function formatScanTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

type AppearanceDisclosureId = 'transfer' | 'health' | 'css';

function AppearancePanelView({
  value,
  onChange,
  notify,
  options,
  controller,
  library,
  consumePendingDisclosure,
  registerDisclosureOpener,
}: PanelProps<ThemeDocumentV1> & {
  controller: ThemeController;
  library?: ThemeLibraryClient;
  consumePendingDisclosure: () => AppearanceDisclosureId | null;
  registerDisclosureOpener: (fn: ((id: AppearanceDisclosureId) => void) | undefined) => void;
}) {
  const fontId = useId();
  const hoverPreviewId = useId();
  const [draftResetKey, setDraftResetKey] = useState(0);
  const [libraryEntries, setLibraryEntries] = useState<readonly SavedThemeEntry[]>(() =>
    library ? library.list() : [],
  );
  const [hoverPreviewEnabled, setHoverPreviewEnabled] = useState<boolean>(
    () => library?.getHoverPreview() ?? false,
  );
  const [libraryViewMode, setLibraryViewMode] = useState<ThemeLibraryViewMode>(
    () => library?.getLibraryView() ?? 'cards',
  );
  useEffect(() => {
    if (!library) {
      return;
    }
    const syncLibraryState = (): void => {
      setLibraryEntries(library.list());
      setHoverPreviewEnabled(library.getHoverPreview());
      setLibraryViewMode(library.getLibraryView());
    };
    syncLibraryState();
    return library.onChange(syncLibraryState);
  }, [library]);
  const activeFingerprint = useMemo(
    () => (library ? analyzeLibraryDocument(value).capabilities.fingerprint : ''),
    [library, value],
  );
  const analyzedLibrary = useMemo(() => {
    const items = libraryEntries.map((entry) => {
      const { capabilities, swatches } = analyzeLibraryDocument(entry.document);
      return { entry, capabilities, swatches };
    });
    const fingerprints = new Set(items.map((item) => item.capabilities.fingerprint));
    return { items, fingerprints };
  }, [libraryEntries]);
  const savedInLibrary = Boolean(library && analyzedLibrary.fingerprints.has(activeFingerprint));
  const [auditState, setAuditState] = useState<AuditState | null>(null);
  const [schemeFilter, setSchemeFilter] = useState<SchemeFilter>('all');

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

  const isImported = useMemo(() => isCustomImportedDocument(value), [value]);
  const [initialDisclosure] = useState<AppearanceDisclosureId | null>(() =>
    consumePendingDisclosure(),
  );
  const [transferOpen, setTransferOpen] = useState(
    () => isImported || initialDisclosure === 'transfer',
  );
  const [cssOpen, setCssOpen] = useState(
    () =>
      Boolean((value.customCss ?? '').trim() || savedExternalCssUrl.trim()) ||
      initialDisclosure === 'css',
  );
  const [healthOpen, setHealthOpen] = useState(() => initialDisclosure === 'health');

  useEffect(() => {
    const openTarget = (id: AppearanceDisclosureId): void => {
      if (id === 'transfer') {
        setTransferOpen(true);
      } else if (id === 'health') {
        setHealthOpen(true);
      } else if (id === 'css') {
        setCssOpen(true);
      }
    };
    registerDisclosureOpener(openTarget);
    return () => registerDisclosureOpener(undefined);
  }, [registerDisclosureOpener]);

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

  const clearColorDrafts = (): void => {
    setDraftResetKey((k) => k + 1);
  };

  const handlePreview = useCallback(
    (doc: ThemeDocumentV1 | null): void => {
      if (doc === null) {
        controller.clearPreview();
      } else {
        controller.preview(resolveTheme(doc));
      }
    },
    [controller],
  );
  const hoverPreview = useThemePreview(value, handlePreview, hoverPreviewEnabled);

  const updateLibraryPreference = <T,>(
    next: T,
    setState: (value: T) => void,
    persist: (client: ThemeLibraryClient) => Promise<void>,
    readCurrent: (client: ThemeLibraryClient) => T,
    fallbackError: string,
  ): void => {
    setState(next);
    if (!library) {
      return;
    }
    void runLibraryAction(persist, undefined, fallbackError).then((ok) => {
      if (!ok) {
        setState(readCurrent(library));
      }
    });
  };

  const handleToggleHoverPreview = (next: boolean): void =>
    updateLibraryPreference(
      next,
      setHoverPreviewEnabled,
      (client) => client.setHoverPreview(next),
      (client) => client.getHoverPreview(),
      'Could not save hover preview preference',
    );

  const handleLibraryViewChange = (next: ThemeLibraryViewMode): void =>
    updateLibraryPreference(
      next,
      setLibraryViewMode,
      (client) => client.setLibraryView(next),
      (client) => client.getLibraryView(),
      'Could not save theme layout preference',
    );

  const commitDocument = (next: ThemeDocumentV1): void => {
    hoverPreview.markCommitted();
    controller.preview(resolveTheme(next));
    onChange(next);
    setAuditState(null);
  };

  const applyEdit = (next: ThemeDocumentV1, toastLabel?: string): void => {
    const previous = value;
    commitDocument(next);
    if (toastLabel && notify) {
      notify(toastLabel, () => {
        clearColorDrafts();
        commitDocument(previous);
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
    applyEdit(applyStudioVibe(value, vibe), `${vibe.name} theme applied`);
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

  const handleImportDocument = (
    doc: ThemeDocumentV1,
    options: ThemeDocumentFilterOptions,
  ): void => {
    clearColorDrafts();
    applyEdit(applyThemeDocument(doc, options), `Imported theme "${doc.meta.name}"`);
  };

  const runLibraryAction = <R,>(
    run: (client: ThemeLibraryClient) => Promise<R>,
    onSuccess: ((result: R) => void) | undefined,
    fallbackError: string,
  ): Promise<boolean> => {
    if (!library) {
      return Promise.resolve(false);
    }
    return run(library).then(
      (result) => {
        onSuccess?.(result);
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
    saveOptions: SaveLibraryThemeOptions = {},
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
    hoverPreview.clear();
    void runLibraryAction(
      (client) => client.removeTheme(entry.id),
      (removed) => {
        if (removed) {
          notify?.(`Deleted "${removed.document.meta.name}"`, () => {
            void runLibraryAction(
              (client) => client.restoreTheme(removed),
              undefined,
              'Could not restore deleted theme',
            );
          });
        }
      },
      'Could not delete saved theme',
    );
  };

  const recordAudit = (
    lastAction: 'audit' | 'heal',
    extra?: { readonly healedCount: number; readonly beforeScore?: number },
  ): void => {
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
      lastAction,
      ...(extra ?? {}),
    }));
  };

  const runAudit = (): void => recordAudit('audit');

  const runHealAndAudit = (): void => {
    const beforeScore = auditState?.report.score;
    const healedCount = controller.healNow?.() ?? 0;
    recordAudit('heal', {
      healedCount,
      ...(beforeScore === undefined ? {} : { beforeScore }),
    });
  };

  const filteredPresets = useMemo(
    () =>
      BUILTIN_THEMES.filter(
        (preset) => schemeFilter === 'all' || preset.palette.colorScheme === schemeFilter,
      ),
    [schemeFilter],
  );

  const previewPreset = (presetId: string): void => {
    hoverPreview.preview(`preset:${presetId}`, () => applyThemePreset(value, presetId));
  };

  const fontPreset: ThemeFontId = value.typography?.preset ?? 'default';
  const savedCustomStack = fontPreset === 'default' ? (value.typography?.customStack ?? '') : '';
  const [customFontMode, setCustomFontMode] = useState(false);
  const [customFontDraft, setCustomFontDraft] = useState(savedCustomStack);
  const [customFontError, setCustomFontError] = useState<string | null>(null);
  useEffect(() => {
    setCustomFontDraft(savedCustomStack);
    setCustomFontError(null);
    if (fontPreset !== 'default' || savedCustomStack || draftResetKey > 0) {
      setCustomFontMode(false);
    }
  }, [savedCustomStack, fontPreset, draftResetKey]);
  const isCustomFontActive = Boolean(savedCustomStack) || customFontMode;
  const selectFont = (nextFont: string): void => {
    if (nextFont === CUSTOM_FONT_OPTION) {
      setCustomFontMode(true);
      setCustomFontError(null);
      return;
    }
    if (!isThemeFontId(nextFont)) {
      return;
    }
    setCustomFontMode(false);
    setCustomFontError(null);
    const fontLabel = FONT_LABELS[nextFont];
    applyEdit(updateThemeTypography(value, nextFont), `Typography set to ${fontLabel}`);
  };
  const commitCustomFontStack = (raw: string): void => {
    const trimmed = raw.trim();
    if (!trimmed) {
      setCustomFontError(null);
      if (savedCustomStack) {
        setCustomFontMode(false);
        applyEdit(updateThemeCustomFontStack(value, ''), 'Typography reset to Site default');
      }
      return;
    }
    const sanitized = sanitizeFontStack(trimmed);
    if (!sanitized) {
      setCustomFontError(
        'Use comma-separated font names (letters, numbers, quotes, spaces, hyphens).',
      );
      return;
    }
    setCustomFontError(null);
    setCustomFontMode(false);
    if (sanitized !== savedCustomStack) {
      applyEdit(updateThemeCustomFontStack(value, sanitized), 'Updated custom font stack');
    }
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
          viewMode={libraryViewMode}
          onViewModeChange={handleLibraryViewChange}
          onSaveCurrent={(name) => {
            void handleSaveToLibrary(value, { name });
          }}
          onApplyEntry={handleApplyLibraryEntry}
          onPreviewEntry={(entry) => {
            if (entry) {
              hoverPreview.previewDocument(`saved:${entry.id}`, entry.document);
            } else {
              hoverPreview.clear();
            }
          }}
          onApplyAllSites={handleApplyAllSites}
          onRenameEntry={handleRenameLibraryEntry}
          onDeleteEntry={handleDeleteLibraryEntry}
          onExportEntry={(_entry, filename) => notify?.(`Exported ${filename}`)}
        />
      )}

      <StudioVibesCard
        activeVibe={activeVibe}
        hoverPreviewEnabled={hoverPreviewEnabled}
        onApplyVibe={applyVibe}
        onPreviewVibe={(vibe) => {
          if (vibe) {
            hoverPreview.preview(`vibe:${vibe.id}`, () => applyStudioVibe(value, vibe));
          } else {
            hoverPreview.clear();
          }
        }}
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
              Static palettes without live motion. Picking one clears active background effects.
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
            {...previewLeaveProps(hoverPreview.clear)}
          >
            <button
              type="button"
              className="theme-card"
              aria-pressed={!effectsActive && value.id === 'default'}
              onMouseEnter={() => previewPreset('default')}
              onFocus={() => previewPreset('default')}
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
                onMouseEnter={() => previewPreset(preset.id)}
                onFocus={() => previewPreset(preset.id)}
                onClick={() => selectColorTheme(preset.id, preset.name)}
              >
                <ThemeSwatches swatches={BUILTIN_PRESET_SWATCHES.get(preset.id) ?? []} />
                <span className="theme-card-name">{preset.name}</span>
                <p className="theme-card-desc">{preset.description}</p>
              </button>
            ))}
          </div>
        </div>
        <SettingRow
          title="Live hover preview"
          description="Preview color and live themes when hovering or focusing cards."
          htmlFor={hoverPreviewId}
        >
          <Switch
            id={hoverPreviewId}
            checked={hoverPreviewEnabled}
            ariaLabel="Live hover preview"
            onChange={handleToggleHoverPreview}
          />
        </SettingRow>
      </SettingCard>

      <CreativeStudioCard
        effects={effects}
        effectsActive={effectsActive}
        activeVibe={activeVibe}
        onPreviewEffects={previewEffects}
        onUpdateEffects={updateEffects}
        onResetEffects={resetEffects}
      />

      <SettingCard title="Typography & Advanced">
        <SettingRow
          title="Typography"
          description="Applies across site text and Feed Sanity controls."
          htmlFor={fontId}
          stacked={isCustomFontActive}
        >
          <div className={isCustomFontActive ? 'theme-studio-stack' : undefined}>
            <select
              id={fontId}
              className="field"
              aria-label="Typography"
              value={isCustomFontActive ? CUSTOM_FONT_OPTION : fontPreset}
              onChange={(event) => selectFont(event.currentTarget.value)}
            >
              {FONT_IDS.map((id) => (
                <option key={id} value={id}>
                  {FONT_LABELS[id]}
                </option>
              ))}
              <option value={CUSTOM_FONT_OPTION}>Custom font stack…</option>
            </select>
            {isCustomFontActive && (
              <>
                <div className="theme-external-css-row">
                  <TextInput
                    className="field"
                    ariaLabel="Custom font stack"
                    placeholder='"Inter", "Segoe UI", sans-serif'
                    value={customFontDraft}
                    onValueChange={(next) => {
                      setCustomFontDraft(next);
                      setCustomFontError(null);
                    }}
                    onBlur={() => commitCustomFontStack(customFontDraft)}
                    onKeyDown={(event) =>
                      handleInlineFormKeyDown(
                        event,
                        () => commitCustomFontStack(customFontDraft),
                        () => {
                          setCustomFontDraft(savedCustomStack);
                          setCustomFontError(null);
                          if (!savedCustomStack) {
                            setCustomFontMode(false);
                          }
                        },
                      )
                    }
                  />
                  <button
                    type="button"
                    className="button"
                    onClick={() => commitCustomFontStack(customFontDraft)}
                  >
                    Apply
                  </button>
                </div>
                {customFontError && (
                  <div className="theme-contrast-warn" role="alert">
                    <span>{customFontError}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </SettingRow>

        <PaletteCustomizationDisclosure
          value={value}
          activePreset={activePreset}
          draftResetKey={draftResetKey}
          onPreviewEdit={(next) => controller.preview(resolveTheme(next))}
          onApplyEdit={applyEdit}
        />

        <ThemeTransferDisclosure
          open={transferOpen}
          onToggle={() => setTransferOpen((open) => !open)}
          document={value}
          onImport={handleImportDocument}
          {...(library ? { onSaveToLibrary: handleSaveToLibrary } : {})}
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
  let pendingDisclosure: AppearanceDisclosureId | null = null;
  let activeDisclosureOpener: ((id: AppearanceDisclosureId) => void) | undefined;
  const requestDisclosure = (id: AppearanceDisclosureId): void => {
    if (activeDisclosureOpener) {
      activeDisclosureOpener(id);
    } else {
      pendingDisclosure = id;
    }
  };
  const consumePendingDisclosure = (): AppearanceDisclosureId | null => {
    const next = pendingDisclosure;
    pendingDisclosure = null;
    return next;
  };
  const registerDisclosureOpener = (
    fn: ((id: AppearanceDisclosureId) => void) | undefined,
  ): void => {
    activeDisclosureOpener = fn;
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
        id: 'hover-preview',
        title: 'Live hover preview',
        description: 'Preview color and live themes when hovering or focusing cards.',
        keywords: ['hover', 'preview', 'live', 'theme', 'focus'],
      },
      {
        id: 'import-export-theme',
        title: 'Import / Export theme (.fstheme.json)',
        description: 'Export your active theme to a single file or import a shared .fstheme.json.',
        keywords: ['import', 'export', 'share', 'json', 'fstheme', 'backup', 'file'],
        onSelect: () => requestDisclosure('transfer'),
      },
      {
        id: 'custom-css',
        title: 'Custom CSS & External stylesheet',
        description: 'Write inline CSS rules or link an external HTTPS stylesheet.',
        keywords: ['style', 'stylesheet', 'css', 'external', 'url', 'link'],
        onSelect: () => requestDisclosure('css'),
      },
      {
        id: 'theme-health',
        title: 'Theme health & layout audit',
        description: 'Scan contrast, unthemed surfaces, layout shifts, and header overlaps.',
        keywords: ['audit', 'auto-heal', 'contrast', 'wcag'],
        onSelect: () => requestDisclosure('health'),
      },
      {
        id: 'creative-studio',
        title: 'Creative Studio (Backgrounds, Glass, Prism & Click FX)',
        description:
          'Add Luminous Tide glowing surf, Event Horizon black hole, Matrix Rain, Vice City sunset, Aurora, Silk, Prism sheen, and click effects.',
        keywords: [
          'luminous tide',
          'ocean',
          'moon',
          'bioluminescent',
          'moonlit',
          'tide',
          'event horizon',
          'black hole',
          'shader',
          'prism',
          'supernova',
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
        title: `Live Theme: ${vibe.name}`,
        description: vibe.tagline,
        keywords: [
          'live',
          'vibe',
          'studio',
          'effect',
          vibe.id,
          vibe.preset,
          vibe.effects.backdrop ?? '',
        ],
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
    onClose: () => {
      pendingDisclosure = null;
      controller.clearPreview();
    },
    Panel: (props) => (
      <AppearancePanelView
        {...props}
        controller={controller}
        {...(library ? { library } : {})}
        consumePendingDisclosure={consumePendingDisclosure}
        registerDisclosureOpener={registerDisclosureOpener}
      />
    ),
  });
}
