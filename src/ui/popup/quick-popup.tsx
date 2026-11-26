import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
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
import type { AnalyzedSavedTheme } from './popup-theme-card';
import type { SiteQuickConfig, StarterModeId } from './starter-modes';
import { NAME } from '../../../project';
import { newFilter, newRule, readFilters } from '../../core/filter-types';
import { createLogger } from '../../core/log';
import { createSiteSettings, isSiteVisible } from '../../core/site-settings';
import { isRecord, readStoreMany, watchStoreKey } from '../../core/storage';
import {
  applyThemeDocument,
  applyThemePreset,
  clearThemeEffects,
  flipThemeColorScheme,
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
  BrandMark,
  BrandWordmark,
  getSiteMark,
  SegmentedControl,
  SettingCard,
  SettingRow,
  Switch,
  Toast,
  UiIcon,
  useToast,
} from '../primitives';
import { useThemePreview } from '../use-theme-preview';
import { PopupThemeCard, SavedThemesStrip, useAnalyzedSavedThemes } from './popup-theme-card';
import {
  detectActiveMode,
  diffStarterMode,
  getSiteQuickConfig,
  isCustomizedSetup,
  SITE_QUICK_CONFIGS,
} from './starter-modes';

const log = createLogger('quick-popup');
const TOAST_MS = 4500;
const SPEED_STEP = 0.05;

export interface QuickPopupProps {
  readonly store: Store;
  /** Active supported tab state, or `null` when opened on an unsupported page. */
  readonly activeTab: PopupTabState | null;
  /** Optional caller-owned site settings client (reused by userscript runtime). */
  readonly siteSettings?: SiteSettingsClient;
  /** Optional caller-owned cross-site theme library client (reused by userscript runtime). */
  readonly themeLibrary?: ThemeLibraryClient;
  /** Optional callback notified whenever the active site's theme config loads or changes. */
  readonly onThemeChange?: (doc: ThemeDocumentV1, meta?: { readonly committed?: boolean }) => void;
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

function sameOptionMap(
  a: Readonly<Record<string, OptionValue>>,
  b: Readonly<Record<string, OptionValue>>,
): boolean {
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) {
    return false;
  }
  return keysA.every((k) => a[k] === b[k]);
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

interface UnsupportedTabViewProps {
  readonly sites: readonly SiteStatus[];
  readonly savedThemes: readonly AnalyzedSavedTheme[];
  readonly globalTheme: GlobalThemeOverride | undefined;
  readonly closeButton: ReactNode;
  readonly toastEl: ReactNode;
  readonly onSetSiteEnabled: (siteId: string, enabled: boolean) => void;
  readonly onApplyAllSites: (doc: ThemeDocumentV1, displayName?: string) => void;
  readonly onOpenSiteUrl: (url: string) => void;
}

function UnsupportedTabView({
  sites,
  savedThemes,
  globalTheme,
  closeButton,
  toastEl,
  onSetSiteEnabled,
  onApplyAllSites,
  onOpenSiteUrl,
}: UnsupportedTabViewProps) {
  // Keep experimental rows visible for the rest of the current popup session if
  // they were enabled when opened so toggling one off doesn't drop focus or trap undo.
  const seenEnabledRef = useRef<Set<string>>(new Set());
  for (const site of sites) {
    if (site.experimental && site.enabled) {
      seenEnabledRef.current.add(site.id);
    }
  }
  const visibleSites = sites.filter(
    (site) => isSiteVisible(site) || seenEnabledRef.current.has(site.id),
  );

  const globalThemeFingerprint = useMemo(
    () =>
      savedThemes.length > 0 && globalTheme
        ? analyzeThemeDocument(globalTheme.document).fingerprint
        : '',
    [savedThemes.length, globalTheme],
  );

  return (
    <div className="qp-root" role="region" aria-label={`${NAME} quick controls`}>
      <header className="qp-header qp-header-brand">
        <div className="qp-brand-stack">
          <div className="qp-brand-lockup">
            <BrandMark size={26} />
            <h1 className="qp-title">
              <BrandWordmark height={19} label={NAME} />
            </h1>
          </div>
          <span className="qp-status">Not active on this page</span>
        </div>
        {closeButton}
      </header>

      <div className="qp-body">
        <SettingCard title="Supported sites">
          {visibleSites.map((site) => {
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
                    onChange={(next) => onSetSiteEnabled(site.id, next)}
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

        {savedThemes.length > 0 && (
          <SettingCard title="My Themes" action={<Badge tone="neutral">All sites</Badge>}>
            <div className="qp-saved-card-pad">
              <SavedThemesStrip
                items={savedThemes}
                activeFingerprint={globalThemeFingerprint}
                ariaLabel="My Themes"
                onSelect={(entry) => onApplyAllSites(entry.document)}
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

interface ActiveTabViewProps {
  readonly store: Store;
  readonly activeTab: PopupTabState;
  readonly siteConfig: SiteQuickConfig;
  readonly siteEnabled: boolean;
  readonly hoverPreviewEnabled: boolean;
  readonly savedThemes: readonly AnalyzedSavedTheme[];
  readonly closeButton: ReactNode;
  readonly toastEl: ReactNode;
  readonly notify: (message: string, onUndo?: () => void) => void;
  readonly onThemeChange?: QuickPopupProps['onThemeChange'];
  readonly onPreviewTheme?: QuickPopupProps['onPreviewTheme'];
  readonly onSetSiteEnabled: (siteId: string, enabled: boolean) => void;
  readonly onApplyAllSites: (doc: ThemeDocumentV1, displayName?: string) => void;
  readonly onOpenSettings: (section?: string) => void;
  readonly headerDragProps?: DragHandleProps;
}

function ActiveTabView({
  store,
  activeTab,
  siteConfig,
  siteEnabled,
  hoverPreviewEnabled,
  savedThemes,
  closeButton,
  toastEl,
  notify,
  onThemeChange,
  onPreviewTheme,
  onSetSiteEnabled,
  onApplyAllSites,
  onOpenSettings,
  headerDragProps,
}: ActiveTabViewProps) {
  const [optionsMap, setOptionsMap] = useState<Record<string, OptionValue>>({});
  const [theme, setTheme] = useState<ThemeDocumentV1>(() => readThemeDocument(undefined));
  const [videoSpeed, setVideoSpeed] = useState<SavedVideoSpeed>(() => ({ ...DEFAULT_VIDEO_SPEED }));
  const [presetsOpen, setPresetsOpen] = useState(true);
  const [pendingMode, setPendingMode] = useState<StarterModeId | null>(null);

  const mountedRef = useRef(true);
  const onThemeChangeRef = useRef(onThemeChange);
  onThemeChangeRef.current = onThemeChange;
  const onPreviewThemeRef = useRef(onPreviewTheme);
  onPreviewThemeRef.current = onPreviewTheme;
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingSavesRef = useRef(new Map<string, number>());
  const dirtyKeysRef = useRef(new Set<string>());

  const optionsKey = `${activeTab.storagePrefix}/options`;
  const themeKey = `${activeTab.storagePrefix}/${THEME_DATA_KEY}`;
  const filtersKey = `${activeTab.storagePrefix}/filters`;
  const speedKey = siteConfig.supportsVideoSpeed
    ? `${activeTab.storagePrefix}/${X_VIDEO_SPEED_KEY}`
    : null;

  const syncTheme = useCallback((next: ThemeDocumentV1, committed = false): void => {
    if (!mountedRef.current) {
      return;
    }
    setTheme(next);
    onThemeChangeRef.current?.(next, committed ? { committed: true } : undefined);
  }, []);

  const hoverPreview = useThemePreview(theme, onPreviewTheme, siteEnabled && hoverPreviewEnabled);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** Serializes writes per popup while suppressing self-echoes on `key` and isolating per-key hydration. */
  const enqueueWrite = (key: string, task: () => Promise<void>): void => {
    dirtyKeysRef.current.add(key);
    const saves = pendingSavesRef.current;
    saves.set(key, (saves.get(key) ?? 0) + 1);
    writeQueueRef.current = writeQueueRef.current
      .then(async () => {
        try {
          await task();
        } finally {
          const remaining = (saves.get(key) ?? 1) - 1;
          if (remaining <= 0) {
            saves.delete(key);
          } else {
            saves.set(key, remaining);
          }
        }
      })
      .catch((error: unknown) => log.error('could not save quick popup change', error));
  };

  useEffect(() => {
    let alive = true;
    const dirtyKeys = new Set<string>();
    dirtyKeysRef.current = dirtyKeys;
    const keys = speedKey ? [optionsKey, themeKey, speedKey] : [optionsKey, themeKey];
    setPendingMode(null);

    void readStoreMany(store, keys)
      .then((loaded) => {
        if (!alive) {
          return;
        }
        if (!dirtyKeys.has(optionsKey)) {
          const loadedOptions = readOptionMap(loaded[optionsKey]);
          setOptionsMap(loadedOptions);
          setPresetsOpen(
            !isCustomizedSetup(siteConfig.modes, loadedOptions, siteConfig.modeDefaults),
          );
        }
        if (!dirtyKeys.has(themeKey)) {
          syncTheme(readThemeDocument(loaded[themeKey]));
        }
        if (speedKey && !dirtyKeys.has(speedKey)) {
          setVideoSpeed(readSavedVideoSpeed(loaded[speedKey]));
        }
      })
      .catch((error: unknown) => log.error('could not load quick popup state', error));

    const watchKey = (key: string, onExternal: (next: unknown) => void): (() => void) =>
      watchStoreKey(store, key, (next) => {
        if (alive && (pendingSavesRef.current.get(key) ?? 0) === 0) {
          dirtyKeys.add(key);
          onExternal(next);
        }
      });

    const unsubs = [
      watchKey(optionsKey, (next) => setOptionsMap(readOptionMap(next))),
      watchKey(themeKey, (next) => syncTheme(readThemeDocument(next))),
      ...(speedKey ? [watchKey(speedKey, (next) => setVideoSpeed(readSavedVideoSpeed(next)))] : []),
    ];

    return () => {
      alive = false;
      for (const unsub of unsubs) {
        unsub();
      }
    };
  }, [optionsKey, themeKey, speedKey, siteConfig, store, syncTheme]);

  const visibleToggleKeys = useMemo(
    () => new Set(siteConfig.toggles.map((t) => t.key)),
    [siteConfig],
  );

  const modeOptions = useMemo(
    () => siteConfig.modes.map((m) => ({ value: m.id, label: m.label })),
    [siteConfig],
  );

  const activeThemeFingerprint = useMemo(
    () => (savedThemes.length > 0 ? analyzeThemeDocument(theme).fingerprint : ''),
    [savedThemes.length, theme],
  );

  const activeMode = detectActiveMode(siteConfig.modes, optionsMap, siteConfig.modeDefaults);
  const activeModeSpec = siteConfig.modes.find((m) => m.id === activeMode);
  const isCustomized =
    activeMode === null &&
    Object.keys(siteConfig.modeDefaults).some(
      (key) => optionsMap[key] !== undefined && optionsMap[key] !== siteConfig.modeDefaults[key],
    );
  const pendingModeSpec =
    isCustomized && pendingMode ? siteConfig.modes.find((m) => m.id === pendingMode) : undefined;
  const pendingDiff = pendingModeSpec
    ? diffStarterMode(pendingModeSpec, optionsMap, siteConfig.modeDefaults, visibleToggleKeys)
    : null;

  const patchOptions = (
    patch: Readonly<Record<string, OptionValue>>,
    toastLabel?: string,
  ): void => {
    const patchKeys = Object.keys(patch);
    let previousValues: Record<string, OptionValue | undefined> = {};
    setOptionsMap((current) => ({ ...current, ...patch }));
    enqueueWrite(optionsKey, async () => {
      const latest = readOptionMap(await store.get(optionsKey));
      previousValues = {};
      for (const k of patchKeys) {
        previousValues[k] = Object.hasOwn(latest, k) ? latest[k] : undefined;
      }
      const next = { ...latest, ...patch };
      await store.set(optionsKey, next);
      if (mountedRef.current) {
        setOptionsMap((prev) => (sameOptionMap(prev, next) ? prev : next));
      }
    });
    if (toastLabel) {
      notify(toastLabel, () => {
        enqueueWrite(optionsKey, async () => {
          const latest = readOptionMap(await store.get(optionsKey));
          const restored: Record<string, OptionValue> = {};
          for (const [k, v] of Object.entries(latest)) {
            if (!Object.hasOwn(previousValues, k)) {
              restored[k] = v;
            }
          }
          for (const k of patchKeys) {
            const prev = previousValues[k];
            if (prev !== undefined) {
              restored[k] = prev;
            }
          }
          await store.set(optionsKey, restored);
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

  const updateThemeDocument = (
    transform: (current: ThemeDocumentV1) => ThemeDocumentV1,
    toastLabel: string,
  ): void => {
    const hadPreview = hoverPreview.markCommitted();
    let previous: ThemeDocumentV1 = theme;
    const optimistic = transform(theme);
    const optimisticJson = JSON.stringify(optimistic);
    syncTheme(optimistic, true);
    enqueueWrite(themeKey, async () => {
      try {
        const latest = readThemeDocument(await store.get(themeKey));
        previous = latest;
        const next = transform(latest);
        const nextJson = JSON.stringify(next);
        const unchanged = nextJson === JSON.stringify(latest);
        await store.set(themeKey, next);
        if (nextJson !== optimisticJson) {
          syncTheme(next, true);
        }
        if (hadPreview && unchanged && !hoverPreview.isActive()) {
          onPreviewThemeRef.current?.(null);
        }
      } catch (error: unknown) {
        syncTheme(previous, true);
        if (hadPreview && !hoverPreview.isActive()) {
          onPreviewThemeRef.current?.(null);
        }
        throw error;
      }
    });
    notify(toastLabel, () => {
      hoverPreview.markCommitted();
      enqueueWrite(themeKey, async () => {
        await store.set(themeKey, previous);
        syncTheme(previous, true);
      });
    });
  };

  const applyQuickTheme = (presetId: string): void => {
    const label =
      presetId === 'default' ? 'Site Default' : (findThemePreset(presetId)?.name ?? presetId);
    const suffix = documentEffectsToConfig(theme.effects) ? ' (FX cleared)' : '';
    updateThemeDocument(
      (current) => applyThemePreset(current, presetId),
      `Theme: ${label}${suffix}`,
    );
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
    const activeEffects = documentEffectsToConfig(theme.effects);
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
    if (!documentEffectsToConfig(theme.effects)) {
      return;
    }
    updateThemeDocument((current) => clearThemeEffects(current), 'Studio effects off');
  };

  const stepVideoSpeed = (delta: number): void => {
    if (!speedKey) {
      return;
    }
    const optimisticRate = clampVideoSpeed(videoSpeed.rate + delta);
    setVideoSpeed({ rate: optimisticRate, custom: !isNativeXSpeed(optimisticRate) });
    enqueueWrite(speedKey, async () => {
      const latest = readSavedVideoSpeed(await store.get(speedKey));
      const nextRate = clampVideoSpeed(latest.rate + delta);
      const next: SavedVideoSpeed = { rate: nextRate, custom: !isNativeXSpeed(nextRate) };
      await store.set(speedKey, next);
      if (mountedRef.current) {
        setVideoSpeed((prev) =>
          prev.rate === next.rate && prev.custom === next.custom ? prev : next,
        );
      }
    });
  };

  const resetVideoSpeed = (): void => {
    if (!speedKey || videoSpeed.rate === 1) {
      return;
    }
    let previous = videoSpeed;
    const next: SavedVideoSpeed = { rate: 1, custom: false };
    setVideoSpeed(next);
    enqueueWrite(speedKey, async () => {
      previous = readSavedVideoSpeed(await store.get(speedKey));
      await store.set(speedKey, next);
    });
    notify('Video speed reset to 1×', () => {
      setVideoSpeed(previous);
      enqueueWrite(speedKey, async () => {
        await store.set(speedKey, previous);
      });
    });
  };

  const handleQuickMute = (term: string): void => {
    const created = newFilter({
      title: `Hide "${term}"`,
      match: 'ANY',
      enabled: true,
      rules: [{ ...newRule('any'), condition: { text: term, modifier: 'i' } }],
      actions: [{ action: 'hide', show_note: true }],
    });
    const createdJson = JSON.stringify(created);
    enqueueWrite(filtersKey, async () => {
      const existing = readFilters(await store.get(filtersKey));
      await store.set(filtersKey, [created, ...existing]);
    });
    notify(`Muted "${term}"`, () => {
      enqueueWrite(filtersKey, async () => {
        const current = readFilters(await store.get(filtersKey));
        const idx = current.findIndex((item) => JSON.stringify(item) === createdJson);
        if (idx !== -1) {
          const next = [...current.slice(0, idx), ...current.slice(idx + 1)];
          await store.set(filtersKey, next);
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

  let statusText = 'Paused here';
  if (siteEnabled) {
    statusText =
      activeTab.hiddenCount > 0
        ? `Active · ${activeTab.hiddenCount} hidden here`
        : 'Active on this tab';
  }

  const dragAttrs = headerDragProps
    ? {
        'data-draggable': 'true' as const,
        title: 'Drag to move · Double-click to reset',
        ...headerDragProps,
      }
    : undefined;

  return (
    <div className="qp-root" role="region" aria-label={`${activeTab.displayName} quick controls`}>
      <div className="qp-brand-bar" {...dragAttrs}>
        {headerDragProps && (
          <span className="qp-grip" aria-hidden="true">
            <UiIcon name="grip" size={12} />
          </span>
        )}
        <div className="qp-brand-lockup">
          <BrandMark size={24} />
          <BrandWordmark height={18} />
        </div>
        {closeButton}
      </div>

      <header className="qp-header" {...dragAttrs}>
        <div className="qp-identity">
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
        <Switch
          checked={siteEnabled}
          ariaLabel={`Enable ${NAME} on ${activeTab.displayName}`}
          onChange={(next) => onSetSiteEnabled(activeTab.siteId, next)}
        />
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
              options={modeOptions}
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

        <PopupThemeCard
          theme={theme}
          savedThemes={savedThemes}
          activeFingerprint={activeThemeFingerprint}
          onApplyQuickTheme={applyQuickTheme}
          onPreviewQuickTheme={(presetId) =>
            hoverPreview.preview(`preset:${presetId}`, () => applyThemePreset(theme, presetId))
          }
          onApplySavedTheme={applySavedTheme}
          onPreviewSavedTheme={(item) =>
            hoverPreview.previewDocument(
              `saved:${item.entry.id}`,
              item.entry.document,
              activeThemeFingerprint !== '' && item.fingerprint === activeThemeFingerprint,
            )
          }
          onClearPreview={hoverPreview.clear}
          onFlipPolarity={flipPalettePolarity}
          onApplyToAllSites={onApplyAllSites}
          onToggleMotion={toggleBackdropMotion}
          onClearEffects={clearStudioEffects}
        />

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
  const [hoverPreviewEnabled, setHoverPreviewEnabled] = useState<boolean>(
    () => providedThemeLibrary?.getHoverPreview() ?? false,
  );
  const { toast, notify } = useToast(TOAST_MS);

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
      setHoverPreviewEnabled(client.getHoverPreview());
    },
  );

  const analyzedSavedThemes = useAnalyzedSavedThemes(savedThemes);

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

  const siteConfig = activeTab ? getSiteQuickConfig(activeTab.siteId) : undefined;
  if (!activeTab || !siteConfig) {
    return (
      <UnsupportedTabView
        sites={sites}
        savedThemes={analyzedSavedThemes}
        globalTheme={globalTheme}
        closeButton={closeButton}
        toastEl={toastEl}
        onSetSiteEnabled={setSiteEnabled}
        onApplyAllSites={applyDocumentToAllSites}
        onOpenSiteUrl={onOpenSiteUrl}
      />
    );
  }

  const siteEnabled = sites.find((s) => s.id === activeTab.siteId)?.enabled ?? activeTab.enabled;
  return (
    <ActiveTabView
      key={activeTab.storagePrefix}
      store={store}
      activeTab={activeTab}
      siteConfig={siteConfig}
      siteEnabled={siteEnabled}
      hoverPreviewEnabled={hoverPreviewEnabled}
      savedThemes={analyzedSavedThemes}
      closeButton={closeButton}
      toastEl={toastEl}
      notify={notify}
      {...(onThemeChange ? { onThemeChange } : {})}
      {...(onPreviewTheme ? { onPreviewTheme } : {})}
      onSetSiteEnabled={setSiteEnabled}
      onApplyAllSites={applyDocumentToAllSites}
      onOpenSettings={onOpenSettings}
      {...(headerDragProps ? { headerDragProps } : {})}
    />
  );
}
