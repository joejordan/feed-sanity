import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OptionValue } from '../../core/options';
import type { PopupTabState } from '../../core/platform';
import type { SiteSettingsClient, SiteStatus } from '../../core/site-settings';
import type { Store } from '../../core/storage';
import type { ThemeDocumentV1 } from '../../core/theming/document';
import type {
  GlobalThemeOverride,
  SavedThemeEntry,
  ThemeLibraryClient,
} from '../../core/theming/library';
import type { SavedVideoSpeed } from '../../sites/x/features/video-speed-model';
import type { DragHandleProps } from '../primitives';
import type { StarterModeId } from './starter-modes';
import { NAME } from '../../../project';
import { newFilter, newRule, readFilters } from '../../core/filter-types';
import { createLogger } from '../../core/log';
import { createSiteSettings } from '../../core/site-settings';
import { isRecord, readStoreMany, watchStoreKey } from '../../core/storage';
import { findBackdropOption } from '../../core/theme-effects/model';
import {
  applyThemeDocument,
  applyThemePreset,
  clearThemeEffects,
  describeThemeDocument,
  findActiveStudioVibe,
  findActiveThemePreset,
  flipThemeColorScheme,
  hasPaletteOverrides,
  readThemeDocument,
  updateThemeEffects,
} from '../../core/theming/config';
import { analyzeThemeDocument, documentEffectsToConfig } from '../../core/theming/document';
import { createThemeLibrary, EMPTY_THEME_LIBRARY } from '../../core/theming/library';
import { findThemePreset } from '../../core/theming/presets';
import { THEME_DATA_KEY } from '../../core/theming/types';
import {
  clampVideoSpeed,
  DEFAULT_VIDEO_SPEED,
  formatSpeedNumber,
  isNativeXSpeed,
  readSavedVideoSpeed,
  X_VIDEO_SPEED_KEY,
} from '../../sites/x/features/video-speed-model';
import {
  Badge,
  getSiteMark,
  previewLeaveProps,
  SegmentedControl,
  SettingCard,
  SettingRow,
  Switch,
  Toast,
  UiIcon,
  useToast,
} from '../primitives';
import {
  detectActiveMode,
  diffStarterMode,
  getSiteQuickConfig,
  isCustomizedSetup,
  QUICK_THEME_PRESET_IDS,
  SITE_QUICK_CONFIGS,
} from './starter-modes';

const log = createLogger('quick-popup');
const TOAST_MS = 4500;
const SPEED_STEP = 0.05;

const QUICK_THEMES = QUICK_THEME_PRESET_IDS.flatMap((id) => {
  const found = findThemePreset(id);
  return found ? [found] : [];
});

export interface QuickPopupProps {
  readonly store: Store;
  /** Active supported tab state, or `null` when opened on an unsupported page. */
  readonly activeTab: PopupTabState | null;
  /** Optional caller-owned site settings client (reused by userscript runtime). */
  readonly siteSettings?: SiteSettingsClient;
  /** Optional caller-owned cross-site theme library client (reused by userscript runtime). */
  readonly themeLibrary?: ThemeLibraryClient;
  /** Optional callback notified whenever the active site's theme config loads or changes. */
  readonly onThemeChange?: (doc: ThemeDocumentV1) => void;
  /** Optional callback for live hover/focus theme previews (`null` ends preview). */
  readonly onPreviewTheme?: (doc: ThemeDocumentV1 | null) => void;
  /** Opens the full Options dialog on the active tab, optionally jumping to `section`. */
  readonly onOpenSettings: (section?: string) => void;
  /** Opens a supported site URL (used in the unsupported-tab launcher). */
  readonly onOpenSiteUrl: (url: string) => void;
  /** Optional drag handle handlers (enabled for the on-page Userscript overlay). */
  readonly headerDragProps?: DragHandleProps;
  /** Optional close callback (rendered in the floating Userscript quick overlay). */
  readonly onClose?: () => void;
}

interface AnalyzedSavedTheme {
  readonly entry: SavedThemeEntry;
  readonly fingerprint: string;
  readonly hasEffects: boolean;
  readonly backdropName?: string;
  readonly dotBackground: string;
}

function getSavedThemeDotStyle(doc: ThemeDocumentV1): string {
  const swatches = doc.meta.swatches;
  if (swatches && swatches.length >= 3) {
    const stops = swatches.slice(0, 4);
    return `linear-gradient(135deg, ${stops.join(', ')})`;
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

function sameSiteStatuses(a: readonly SiteStatus[], b: readonly SiteStatus[]): boolean {
  return (
    a.length === b.length &&
    a.every((site, i) => site.id === b[i]?.id && site.enabled === b[i]?.enabled)
  );
}

interface ManagedClient {
  readonly ready: Promise<void>;
  readonly onChange: (listener: () => void) => () => void;
  readonly dispose?: () => void;
}

/** Subscribes to a caller-provided or self-owned reactive store client and disposes owned instances on unmount. */
function useOwnedClient<C extends ManagedClient>(
  store: Store,
  provided: C | undefined,
  create: (store: Store) => C,
  onSync: (client: C) => void,
) {
  const clientRef = useRef<C | undefined>(provided);
  const onSyncRef = useRef(onSync);
  onSyncRef.current = onSync;

  useEffect(() => {
    let alive = true;
    const owned = !provided;
    const client = provided ?? create(store);
    clientRef.current = client;
    if (owned) {
      onSyncRef.current(client);
    }

    const sync = (): void => {
      if (alive) {
        onSyncRef.current(client);
      }
    };
    const stopWatch = client.onChange(sync);
    void client.ready.then(sync);

    return () => {
      alive = false;
      stopWatch();
      if (owned) {
        client.dispose?.();
      }
      if (clientRef.current === client) {
        clientRef.current = undefined;
      }
    };
  }, [provided, store, create]);

  return clientRef;
}

interface SavedThemesStripProps {
  readonly items: readonly AnalyzedSavedTheme[];
  readonly activeFingerprint: string;
  readonly ariaLabel: string;
  readonly onSelect: (entry: SavedThemeEntry) => void;
  readonly onPreview?: (item: AnalyzedSavedTheme) => void;
  readonly onClearPreview?: () => void;
}

function SavedThemesStrip({
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

function readOptionMap(raw: unknown): Record<string, OptionValue> {
  if (!isRecord(raw)) {
    return {};
  }
  const out: Record<string, OptionValue> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number') {
      out[key] = value;
    }
  }
  return out;
}

interface QuickMuteFormProps {
  readonly placeholder: string;
  readonly onSubmitTerm: (term: string) => void;
}

/** Isolated 1-line Quick Mute input so typing never re-renders the rest of the popup. */
function QuickMuteForm({ placeholder, onSubmitTerm }: QuickMuteFormProps) {
  const [draft, setDraft] = useState('');
  return (
    <form
      className="qp-mute-form"
      onSubmit={(event) => {
        event.preventDefault();
        const term = draft.trim();
        if (!term) {
          return;
        }
        setDraft('');
        onSubmitTerm(term);
      }}
    >
      <input
        type="text"
        className="qp-mute-input"
        aria-label="Quick mute keyword"
        placeholder={placeholder}
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
      />
      <button type="submit" className="qp-btn primary" disabled={draft.trim() === ''}>
        Hide
      </button>
    </form>
  );
}

/**
 * Shared Quick Control Center rendered inside both the browser extension
 * toolbar popup (`popup.html`) and the Userscript quick-controls overlay.
 */
export function QuickPopup({
  store,
  activeTab,
  siteSettings: providedSiteSettings,
  themeLibrary: providedThemeLibrary,
  onThemeChange,
  onPreviewTheme,
  onOpenSettings,
  onOpenSiteUrl,
  headerDragProps,
  onClose,
}: QuickPopupProps) {
  const [sites, setSites] = useState<SiteStatus[]>(() => providedSiteSettings?.list() ?? []);
  const [savedThemes, setSavedThemes] = useState<readonly SavedThemeEntry[]>(
    () => providedThemeLibrary?.list() ?? EMPTY_THEME_LIBRARY.themes,
  );
  const [globalTheme, setGlobalTheme] = useState<GlobalThemeOverride | undefined>(() =>
    providedThemeLibrary?.getGlobalTheme(),
  );
  const [optionsMap, setOptionsMap] = useState<Record<string, OptionValue>>({});
  const [theme, setTheme] = useState<ThemeDocumentV1>(() => readThemeDocument(undefined));
  const [videoSpeed, setVideoSpeed] = useState<SavedVideoSpeed>(() => ({ ...DEFAULT_VIDEO_SPEED }));
  const [presetsOpen, setPresetsOpen] = useState(true);
  const [pendingMode, setPendingMode] = useState<StarterModeId | null>(null);
  const { toast, notify } = useToast(TOAST_MS);
  const mountedRef = useRef(true);
  const onThemeChangeRef = useRef(onThemeChange);
  onThemeChangeRef.current = onThemeChange;
  const onPreviewThemeRef = useRef(onPreviewTheme);
  onPreviewThemeRef.current = onPreviewTheme;
  const hoverPreviewKeyRef = useRef<string | null>(null);
  const themeJsonCacheRef = useRef<{ doc: ThemeDocumentV1; json: string } | null>(null);
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const mutationSeqRef = useRef(0);

  const syncTheme = useCallback((next: ThemeDocumentV1): void => {
    if (!mountedRef.current) {
      return;
    }
    setTheme(next);
    onThemeChangeRef.current?.(next);
  }, []);

  const clearHoverPreview = useCallback((): void => {
    if (hoverPreviewKeyRef.current === null) {
      return;
    }
    hoverPreviewKeyRef.current = null;
    onPreviewThemeRef.current?.(null);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearHoverPreview();
    };
  }, [clearHoverPreview]);

  const enqueueWrite = (task: () => Promise<void>): void => {
    mutationSeqRef.current++;
    writeQueueRef.current = writeQueueRef.current
      .then(task)
      .catch((error: unknown) => log.error('could not save quick popup change', error));
  };

  const siteConfig = activeTab ? getSiteQuickConfig(activeTab.siteId) : undefined;
  const isSupportedTab = Boolean(activeTab && siteConfig);
  const optionsKey = activeTab ? `${activeTab.storagePrefix}/options` : null;
  const themeKey = activeTab ? `${activeTab.storagePrefix}/${THEME_DATA_KEY}` : null;
  const filtersKey = activeTab ? `${activeTab.storagePrefix}/filters` : null;
  const speedKey =
    activeTab && siteConfig?.supportsVideoSpeed
      ? `${activeTab.storagePrefix}/${X_VIDEO_SPEED_KEY}`
      : null;

  const siteSettingsRef = useOwnedClient(
    store,
    providedSiteSettings,
    createSiteSettings,
    (client) => {
      const next = client.list();
      setSites((prev) => (sameSiteStatuses(prev, next) ? prev : next));
    },
  );

  const themeLibraryRef = useOwnedClient(
    store,
    providedThemeLibrary,
    createThemeLibrary,
    (client) => {
      setSavedThemes(client.list());
      setGlobalTheme(client.getGlobalTheme());
    },
  );

  useEffect(() => {
    if (!optionsKey || !themeKey) {
      return;
    }
    let alive = true;
    const loadSeq = mutationSeqRef.current;
    const keys = speedKey ? [optionsKey, themeKey, speedKey] : [optionsKey, themeKey];
    setPendingMode(null);

    void readStoreMany(store, keys)
      .then((loaded) => {
        if (!alive || mutationSeqRef.current !== loadSeq) {
          return;
        }
        const loadedOptions = readOptionMap(loaded[optionsKey]);
        setOptionsMap(loadedOptions);
        if (siteConfig) {
          setPresetsOpen(
            !isCustomizedSetup(siteConfig.modes, loadedOptions, siteConfig.modeDefaults),
          );
        }
        const nextTheme = readThemeDocument(loaded[themeKey]);
        syncTheme(nextTheme);
        if (speedKey) {
          setVideoSpeed(readSavedVideoSpeed(loaded[speedKey]));
        }
      })
      .catch((error: unknown) => log.error('could not load quick popup state', error));

    const unsubs = [
      watchStoreKey(store, optionsKey, (next) => {
        if (alive) {
          mutationSeqRef.current++;
          setOptionsMap(readOptionMap(next));
        }
      }),
      watchStoreKey(store, themeKey, (next) => {
        if (alive) {
          mutationSeqRef.current++;
          syncTheme(readThemeDocument(next));
        }
      }),
      ...(speedKey
        ? [
            watchStoreKey(store, speedKey, (next) => {
              if (alive) {
                mutationSeqRef.current++;
                setVideoSpeed(readSavedVideoSpeed(next));
              }
            }),
          ]
        : []),
    ];

    return () => {
      alive = false;
      for (const unsub of unsubs) {
        unsub();
      }
    };
  }, [optionsKey, themeKey, speedKey, siteConfig, store, syncTheme]);

  const visibleToggleKeys = useMemo(
    () => new Set(siteConfig?.toggles.map((t) => t.key) ?? []),
    [siteConfig],
  );

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

  const analyzedSavedThemes = useMemo<readonly AnalyzedSavedTheme[]>(
    () =>
      savedThemes.map((entry) => {
        const caps = analyzeThemeDocument(entry.document);
        const backdropName = caps.backdropEngine
          ? findBackdropOption(caps.backdropEngine)?.name
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

  const activeThemeFingerprint = useMemo(
    () => (isSupportedTab && savedThemes.length > 0 ? analyzeThemeDocument(theme).fingerprint : ''),
    [isSupportedTab, savedThemes.length, theme],
  );

  const globalThemeFingerprint = useMemo(
    () =>
      !isSupportedTab && savedThemes.length > 0 && globalTheme
        ? analyzeThemeDocument(globalTheme.document).fingerprint
        : '',
    [isSupportedTab, savedThemes.length, globalTheme],
  );

  const applyDocumentToAllSites = (doc: ThemeDocumentV1, displayName?: string): void => {
    const client = themeLibraryRef.current;
    if (!client) {
      return;
    }
    const label = displayName ?? doc.meta.name;
    void client.applyToAllSites(doc).then(
      () => {
        notify(`Applied "${label}" to all sites`);
      },
      (error: unknown) => {
        log.error('could not apply theme to all sites', error);
        notify(error instanceof Error ? error.message : 'Could not apply theme to all sites');
      },
    );
  };

  const setSiteEnabled = (siteId: string, enabled: boolean): void => {
    const client = siteSettingsRef.current;
    if (!client) {
      return;
    }
    void client
      .setEnabled(siteId, enabled)
      .catch((error: unknown) => log.error('could not toggle site state', error));
  };

  const closeButton = onClose ? (
    <button type="button" className="qp-close" aria-label="Close" onClick={onClose}>
      <UiIcon name="x" size={15} />
    </button>
  ) : null;

  const toastEl = toast ? (
    <Toast message={toast.message} {...(toast.onUndo ? { onUndo: toast.onUndo } : {})} />
  ) : null;

  if (!activeTab || !siteConfig) {
    return (
      <div className="qp-root" role="region" aria-label={`${NAME} quick controls`}>
        <header className="qp-header">
          <div className="qp-identity">
            <span className="qp-mark" aria-hidden="true">
              FS
            </span>
            <div className="qp-meta">
              <h1 className="qp-title">{NAME}</h1>
              <span className="qp-status">Not active on this page</span>
            </div>
          </div>
          {closeButton}
        </header>

        <div className="qp-body">
          <SettingCard title="Supported sites">
            {sites.map((site) => {
              const cfg = SITE_QUICK_CONFIGS[site.id];
              return (
                <div key={site.id} className="qp-site-row">
                  <div className="qp-site-left">
                    <span className="qp-site-badge" aria-hidden="true">
                      {getSiteMark(site.id, site.displayName)}
                    </span>
                    <span className="qp-site-name">{site.displayName}</span>
                  </div>
                  <div className="qp-site-controls">
                    <Switch
                      checked={site.enabled}
                      ariaLabel={`Enable ${NAME} on ${site.displayName}`}
                      onChange={(next) => setSiteEnabled(site.id, next)}
                    />
                    {cfg && (
                      <button
                        type="button"
                        className="qp-open-link"
                        onClick={() => onOpenSiteUrl(cfg.launchUrl)}
                      >
                        Open
                        <UiIcon name="externalLink" size={11} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </SettingCard>

          {analyzedSavedThemes.length > 0 && (
            <SettingCard title="My Themes" action={<Badge tone="neutral">All sites</Badge>}>
              <div className="qp-saved-card-pad">
                <SavedThemesStrip
                  items={analyzedSavedThemes}
                  activeFingerprint={globalThemeFingerprint}
                  ariaLabel="My Themes"
                  onSelect={(entry) => applyDocumentToAllSites(entry.document)}
                />
              </div>
            </SettingCard>
          )}
        </div>

        {toastEl}

        <footer className="qp-footer">
          <p className="qp-footer-tip">
            Open any supported site above to access filters, themes, and quick modes.
          </p>
        </footer>
      </div>
    );
  }

  const siteEnabled = sites.find((s) => s.id === activeTab.siteId)?.enabled ?? activeTab.enabled;
  const activeMode = detectActiveMode(siteConfig.modes, optionsMap, siteConfig.modeDefaults);
  const activeModeSpec = siteConfig.modes.find((m) => m.id === activeMode);
  const isCustomized = isCustomizedSetup(siteConfig.modes, optionsMap, siteConfig.modeDefaults);
  const pendingModeSpec =
    isCustomized && pendingMode ? siteConfig.modes.find((m) => m.id === pendingMode) : undefined;
  const pendingDiff = pendingModeSpec
    ? diffStarterMode(pendingModeSpec, optionsMap, siteConfig.modeDefaults, visibleToggleKeys)
    : null;

  const patchOptions = (
    patch: Readonly<Record<string, OptionValue>>,
    toastLabel?: string,
  ): void => {
    if (!optionsKey) {
      return;
    }
    const key = optionsKey;
    const patchKeys = Object.keys(patch);
    let previousValues: Record<string, OptionValue | undefined> = {};
    setOptionsMap((current) => ({ ...current, ...patch }));
    enqueueWrite(async () => {
      const latest = readOptionMap(await store.get(key));
      previousValues = {};
      for (const k of patchKeys) {
        previousValues[k] = Object.hasOwn(latest, k) ? latest[k] : undefined;
      }
      const next = { ...latest, ...patch };
      await store.set(key, next);
      if (mountedRef.current) {
        setOptionsMap(next);
      }
    });
    if (toastLabel) {
      notify(toastLabel, () => {
        enqueueWrite(async () => {
          const latest = readOptionMap(await store.get(key));
          const restored = { ...latest };
          for (const k of patchKeys) {
            const prev = previousValues[k];
            if (prev === undefined) {
              delete restored[k];
            } else {
              restored[k] = prev;
            }
          }
          await store.set(key, restored);
          if (mountedRef.current) {
            setOptionsMap(restored);
          }
        });
      });
    }
  };

  const applyStarterMode = (modeId: StarterModeId): void => {
    const mode = siteConfig.modes.find((m) => m.id === modeId);
    if (mode) {
      setPendingMode(null);
      patchOptions({ ...siteConfig.modeDefaults, ...mode.patch }, `${mode.label} mode applied`);
    }
  };

  const handleModeSelect = (modeId: StarterModeId): void => {
    if (!isCustomized || pendingMode === modeId) {
      applyStarterMode(modeId);
      return;
    }
    setPendingMode(modeId);
  };

  const getCurrentThemeJson = (): string => {
    if (themeJsonCacheRef.current?.doc !== theme) {
      themeJsonCacheRef.current = { doc: theme, json: JSON.stringify(theme) };
    }
    return themeJsonCacheRef.current.json;
  };

  const previewCandidate = (previewKey: string, buildCandidate: () => ThemeDocumentV1): void => {
    if (!siteEnabled || !onPreviewThemeRef.current || hoverPreviewKeyRef.current === previewKey) {
      return;
    }
    const candidate = buildCandidate();
    if (candidate === theme || JSON.stringify(candidate) === getCurrentThemeJson()) {
      clearHoverPreview();
      return;
    }
    hoverPreviewKeyRef.current = previewKey;
    onPreviewThemeRef.current(candidate);
  };

  const previewSavedTheme = (item: AnalyzedSavedTheme): void => {
    if (!siteEnabled || !onPreviewThemeRef.current) {
      return;
    }
    const previewKey = `saved:${item.entry.id}`;
    if (hoverPreviewKeyRef.current === previewKey) {
      return;
    }
    if (activeThemeFingerprint !== '' && item.fingerprint === activeThemeFingerprint) {
      clearHoverPreview();
      return;
    }
    hoverPreviewKeyRef.current = previewKey;
    onPreviewThemeRef.current(item.entry.document);
  };

  const updateThemeDocument = (
    transform: (current: ThemeDocumentV1) => ThemeDocumentV1,
    toastLabel: string,
  ): void => {
    if (!themeKey) {
      return;
    }
    const hadPreview = hoverPreviewKeyRef.current !== null;
    hoverPreviewKeyRef.current = null;
    const key = themeKey;
    let previous: ThemeDocumentV1 = theme;
    syncTheme(transform(theme));
    enqueueWrite(async () => {
      try {
        const latest = readThemeDocument(await store.get(key));
        previous = latest;
        const next = transform(latest);
        const unchanged = JSON.stringify(next) === JSON.stringify(latest);
        await store.set(key, next);
        syncTheme(next);
        if (hadPreview && unchanged && hoverPreviewKeyRef.current === null) {
          onPreviewThemeRef.current?.(null);
        }
      } catch (error: unknown) {
        syncTheme(previous);
        if (hadPreview && hoverPreviewKeyRef.current === null) {
          onPreviewThemeRef.current?.(null);
        }
        throw error;
      }
    });
    notify(toastLabel, () => {
      hoverPreviewKeyRef.current = null;
      enqueueWrite(async () => {
        await store.set(key, previous);
        syncTheme(previous);
      });
    });
  };

  const applyQuickTheme = (preset: string): void => {
    const label = preset === 'default' ? 'Site Default' : (findThemePreset(preset)?.name ?? preset);
    const suffix = effectsActive ? ' (FX cleared)' : '';
    updateThemeDocument((current) => applyThemePreset(current, preset), `Theme: ${label}${suffix}`);
  };

  const applySavedTheme = (entry: SavedThemeEntry): void => {
    updateThemeDocument(
      () => applyThemeDocument(entry.document),
      `Theme: ${entry.document.meta.name}`,
    );
  };

  const flipPalettePolarity = (): void => {
    if (!theme.palette) {
      return;
    }
    const nextScheme = theme.palette.colorScheme === 'dark' ? 'light' : 'dark';
    updateThemeDocument(
      (current) => flipThemeColorScheme(current),
      nextScheme === 'light' ? 'Switched to light palette' : 'Switched to dark palette',
    );
  };

  const toggleBackdropMotion = (): void => {
    if (!activeEffects) {
      return;
    }
    const nextPaused = !activeEffects.paused;
    updateThemeDocument(
      (current) => {
        if (!documentEffectsToConfig(current.effects)) {
          return current;
        }
        return updateThemeEffects(current, { paused: nextPaused });
      },
      nextPaused ? 'Background motion paused' : 'Background motion resumed',
    );
  };

  const clearStudioEffects = (): void => {
    if (!effectsActive) {
      return;
    }
    updateThemeDocument((current) => clearThemeEffects(current), 'Studio effects off');
  };

  const stepVideoSpeed = (delta: number): void => {
    if (!speedKey) {
      return;
    }
    const key = speedKey;
    const optimisticRate = clampVideoSpeed(videoSpeed.rate + delta);
    setVideoSpeed({ rate: optimisticRate, custom: !isNativeXSpeed(optimisticRate) });
    enqueueWrite(async () => {
      const latest = readSavedVideoSpeed(await store.get(key));
      const nextRate = clampVideoSpeed(latest.rate + delta);
      const next: SavedVideoSpeed = { rate: nextRate, custom: !isNativeXSpeed(nextRate) };
      await store.set(key, next);
      if (mountedRef.current) {
        setVideoSpeed(next);
      }
    });
  };

  const resetVideoSpeed = (): void => {
    if (!speedKey || videoSpeed.rate === 1) {
      return;
    }
    const key = speedKey;
    let previous = videoSpeed;
    const next: SavedVideoSpeed = { rate: 1, custom: false };
    setVideoSpeed(next);
    enqueueWrite(async () => {
      previous = readSavedVideoSpeed(await store.get(key));
      await store.set(key, next);
    });
    notify('Video speed reset to 1×', () => {
      setVideoSpeed(previous);
      enqueueWrite(async () => {
        await store.set(key, previous);
      });
    });
  };

  const handleQuickMute = (term: string): void => {
    if (!filtersKey) {
      return;
    }
    const key = filtersKey;
    const created = newFilter({
      title: `Hide "${term}"`,
      match: 'ANY',
      enabled: true,
      rules: [{ ...newRule('any'), condition: { text: term, modifier: 'i' } }],
      actions: [{ action: 'hide', show_note: true }],
    });
    const createdJson = JSON.stringify(created);
    enqueueWrite(async () => {
      const existing = readFilters(await store.get(key));
      await store.set(key, [created, ...existing]);
    });
    notify(`Muted "${term}"`, () => {
      enqueueWrite(async () => {
        const current = readFilters(await store.get(key));
        const idx = current.findIndex((item) => JSON.stringify(item) === createdJson);
        if (idx !== -1) {
          const next = [...current.slice(0, idx), ...current.slice(idx + 1)];
          await store.set(key, next);
        }
      });
    });
  };

  let idleModeHint = `Pick a starter mode for ${activeTab.displayName}`;
  if (activeModeSpec) {
    idleModeHint = activeModeSpec.summary;
  } else if (isCustomized) {
    idleModeHint = 'Custom settings · Pick a preset to apply';
  }
  let modeHintContent = <span className="qp-mode-hint-text">{idleModeHint}</span>;
  if (pendingModeSpec && pendingDiff) {
    const noun = pendingDiff.totalChanges === 1 ? 'setting' : 'settings';
    const hiddenNote =
      pendingDiff.hiddenChanges > 0 ? ` (${pendingDiff.hiddenChanges} hidden)` : '';
    modeHintContent = (
      <>
        <span className="qp-mode-hint-text">
          {pendingModeSpec.label}: changes {pendingDiff.totalChanges} {noun}
          {hiddenNote}
        </span>
        <span className="qp-mode-confirm-actions">
          <button
            type="button"
            className="qp-link-btn accent"
            onClick={() => applyStarterMode(pendingModeSpec.id)}
          >
            Apply
          </button>
          <button type="button" className="qp-link-btn" onClick={() => setPendingMode(null)}>
            Cancel
          </button>
        </span>
      </>
    );
  }

  const presetsToggleButton =
    isCustomized || !presetsOpen ? (
      <button
        type="button"
        className="qp-presets-btn"
        aria-expanded={presetsOpen}
        onClick={() => {
          setPresetsOpen((open) => !open);
          setPendingMode(null);
        }}
      >
        {presetsOpen ? 'Presets ▴' : 'Custom · Presets ▾'}
      </button>
    ) : undefined;

  let studioBarLabel = 'Studio FX';
  if (activeBackdrop) {
    studioBarLabel = activeEffects?.paused
      ? `${activeBackdrop.name} · Paused`
      : activeBackdrop.name;
  } else if (activeEffects?.paused) {
    studioBarLabel = 'Motion paused';
  }

  let statusText = 'Paused on this site';
  if (siteEnabled) {
    statusText =
      activeTab.hiddenCount > 0
        ? `Active · ${activeTab.hiddenCount} hidden here`
        : 'Active on this tab';
  }

  return (
    <div className="qp-root" role="region" aria-label={`${activeTab.displayName} quick controls`}>
      <header
        className="qp-header"
        data-draggable={headerDragProps ? 'true' : undefined}
        title={headerDragProps ? 'Drag to move · Double-click to reset' : undefined}
        {...headerDragProps}
      >
        <div className="qp-identity">
          {headerDragProps && (
            <span className="qp-grip" aria-hidden="true">
              <UiIcon name="grip" size={13} />
            </span>
          )}
          <span className="qp-mark" aria-hidden="true">
            {getSiteMark(activeTab.siteId, activeTab.displayName)}
          </span>
          <div className="qp-meta">
            <h1 className="qp-title">{activeTab.displayName}</h1>
            <span className="qp-status">
              <span
                className="qp-dot"
                data-paused={siteEnabled ? undefined : 'true'}
                aria-hidden="true"
              />
              {statusText}
            </span>
          </div>
        </div>
        <div className="qp-header-actions">
          <Switch
            checked={siteEnabled}
            ariaLabel={`Enable ${NAME} on ${activeTab.displayName}`}
            onChange={(next) => setSiteEnabled(activeTab.siteId, next)}
          />
          {closeButton}
        </div>
      </header>

      <div className="qp-body">
        {!siteEnabled && (
          <div className="qp-paused-banner" role="status">
            {NAME} is paused on {activeTab.displayName}. Turn the switch above back on to resume
            filtering and theming.
          </div>
        )}

        {presetsOpen && (
          <div className="qp-mode-wrap" data-custom={isCustomized ? 'true' : undefined}>
            <div className="fs-kicker-row">
              <h4 className="fs-kicker">Mode</h4>
              {isCustomized && <Badge tone="accent">Custom</Badge>}
            </div>
            <SegmentedControl
              ariaLabel={`${activeTab.displayName} starter mode`}
              fullWidth
              value={activeMode}
              armedValue={pendingModeSpec?.id ?? null}
              options={siteConfig.modes.map((m) => ({ value: m.id, label: m.label }))}
              onChange={handleModeSelect}
            />
            <div className="qp-mode-hint" role={pendingModeSpec ? 'status' : undefined}>
              {modeHintContent}
            </div>
          </div>
        )}

        <SettingCard title="Quick Controls" action={presetsToggleButton}>
          {siteConfig.toggles.map((toggle) => {
            const checked =
              typeof optionsMap[toggle.key] === 'boolean'
                ? (optionsMap[toggle.key] as boolean)
                : toggle.defaultValue;
            return (
              <SettingRow key={toggle.key} title={toggle.label}>
                <Switch
                  checked={checked}
                  ariaLabel={toggle.label}
                  onChange={(next) => {
                    setPendingMode(null);
                    patchOptions({ [toggle.key]: next });
                  }}
                />
              </SettingRow>
            );
          })}
          {siteConfig.supportsVideoSpeed && (
            <SettingRow title="Video speed">
              <div className="qp-stepper" role="group" aria-label="Video playback speed">
                <button
                  type="button"
                  className="qp-stepper-btn"
                  aria-label="Decrease video speed"
                  onClick={() => stepVideoSpeed(-SPEED_STEP)}
                >
                  −
                </button>
                <button
                  type="button"
                  className="qp-stepper-val"
                  title="Click to reset to 1×"
                  onClick={resetVideoSpeed}
                >
                  {formatSpeedNumber(videoSpeed.rate)}×
                </button>
                <button
                  type="button"
                  className="qp-stepper-btn"
                  aria-label="Increase video speed"
                  onClick={() => stepVideoSpeed(SPEED_STEP)}
                >
                  +
                </button>
              </div>
            </SettingRow>
          )}
        </SettingCard>

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
                    onClick={toggleBackdropMotion}
                  >
                    <UiIcon name={activeEffects.paused ? 'play' : 'pause'} size={10} />
                    {activeEffects.paused ? 'Play' : 'Pause'}
                  </button>
                )}
                <button
                  type="button"
                  className="qp-mini-btn"
                  title="Turn off Studio effects and keep color palette"
                  onClick={clearStudioEffects}
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
              {...previewLeaveProps(clearHoverPreview)}
            >
              <button
                type="button"
                className="qp-swatch-btn"
                title="Site Default"
                aria-label="Site Default theme"
                aria-pressed={!effectsActive && theme.id === 'default'}
                onMouseEnter={() =>
                  previewCandidate('preset:default', () => applyThemePreset(theme, 'default'))
                }
                onFocus={() =>
                  previewCandidate('preset:default', () => applyThemePreset(theme, 'default'))
                }
                onClick={() => applyQuickTheme('default')}
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
                  aria-pressed={
                    !effectsActive && !paletteCustomized && activePreset?.id === preset.id
                  }
                  onMouseEnter={() =>
                    previewCandidate(`preset:${preset.id}`, () =>
                      applyThemePreset(theme, preset.id),
                    )
                  }
                  onFocus={() =>
                    previewCandidate(`preset:${preset.id}`, () =>
                      applyThemePreset(theme, preset.id),
                    )
                  }
                  onClick={() => applyQuickTheme(preset.id)}
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
                  onClick={flipPalettePolarity}
                >
                  <UiIcon name={theme.palette.colorScheme === 'dark' ? 'sun' : 'moon'} size={13} />
                </button>
              )}
              <button
                type="button"
                className="qp-swatch-action"
                aria-label="Apply theme to all sites"
                title={`Apply "${themeSummaryLabel}" to all sites`}
                onClick={() => applyDocumentToAllSites(theme, themeSummaryLabel)}
              >
                <UiIcon name="globe" size={13} />
              </button>
            </div>
          </div>
          {analyzedSavedThemes.length > 0 && (
            <div className="qp-saved-section">
              <span className="qp-saved-kicker">My Themes</span>
              <SavedThemesStrip
                items={analyzedSavedThemes}
                activeFingerprint={activeThemeFingerprint}
                ariaLabel="My Themes"
                onSelect={applySavedTheme}
                onPreview={previewSavedTheme}
                onClearPreview={clearHoverPreview}
              />
            </div>
          )}
        </SettingCard>

        <SettingCard title="Quick Mute">
          <QuickMuteForm
            placeholder={siteConfig.quickMutePlaceholder}
            onSubmitTerm={handleQuickMute}
          />
        </SettingCard>
      </div>

      {toastEl}

      <footer className="qp-footer">
        <button
          type="button"
          className="qp-btn qp-btn-ghost"
          onClick={() => onOpenSettings('Appearance')}
        >
          <UiIcon name="sparkles" size={13} />
          Theme Studio
        </button>
        <button
          type="button"
          className="qp-btn primary qp-btn-grow"
          onClick={() => onOpenSettings(siteConfig.filterSection)}
        >
          All {activeTab.displayName} settings →
        </button>
      </footer>
    </div>
  );
}
