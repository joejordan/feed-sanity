import { useEffect, useRef, useState } from 'react';
import type { OptionValue } from '../../core/options';
import type { PopupTabState } from '../../core/platform';
import type { SiteSettingsClient, SiteStatus } from '../../core/site-settings';
import type { Store } from '../../core/storage';
import type { ThemeConfig } from '../../core/theming';
import type { SavedVideoSpeed } from '../../sites/x/features/video-speed-model';
import type { DragHandleProps } from '../primitives';
import type { StarterModeId } from './starter-modes';
import { NAME } from '../../../project';
import { newFilter, newRule, readFilters } from '../../core/filter-types';
import { createLogger } from '../../core/log';
import { createSiteSettings } from '../../core/site-settings';
import { isRecord, readStoreMany, watchStoreKey } from '../../core/storage';
import {
  applyThemePreset,
  findThemePreset,
  readThemeConfig,
  THEME_DATA_KEY,
} from '../../core/theming';
import {
  clampVideoSpeed,
  DEFAULT_VIDEO_SPEED,
  formatSpeedNumber,
  readSavedVideoSpeed,
  X_VIDEO_SPEED_KEY,
} from '../../sites/x/features/video-speed-model';
import {
  Badge,
  getSiteMark,
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
  getSiteQuickConfig,
  QUICK_THEME_PRESET_IDS,
  SITE_QUICK_CONFIGS,
} from './starter-modes';

const log = createLogger('quick-popup');
const TOAST_MS = 3500;
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
  /** Optional callback notified whenever the active site's theme config loads or changes. */
  readonly onThemeChange?: (config: ThemeConfig) => void;
  /** Opens the full Options dialog on the active tab, optionally jumping to `section`. */
  readonly onOpenSettings: (section?: string) => void;
  /** Opens a supported site URL (used in the unsupported-tab launcher). */
  readonly onOpenSiteUrl: (url: string) => void;
  /** Optional drag handle handlers (enabled for the on-page Userscript overlay). */
  readonly headerDragProps?: DragHandleProps;
  /** Optional close callback (rendered in the floating Userscript quick overlay). */
  readonly onClose?: () => void;
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
  readonly onSubmitTerm: (term: string) => Promise<void>;
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
        void onSubmitTerm(term);
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
  onThemeChange,
  onOpenSettings,
  onOpenSiteUrl,
  headerDragProps,
  onClose,
}: QuickPopupProps) {
  const [sites, setSites] = useState<SiteStatus[]>(() => providedSiteSettings?.list() ?? []);
  const siteSettingsRef = useRef<SiteSettingsClient | undefined>(providedSiteSettings);
  const [optionsMap, setOptionsMap] = useState<Record<string, OptionValue>>({});
  const [theme, setTheme] = useState<ThemeConfig>(() => readThemeConfig(undefined));
  const [videoSpeed, setVideoSpeed] = useState<SavedVideoSpeed>(() => ({ ...DEFAULT_VIDEO_SPEED }));
  const { toast, notify } = useToast(TOAST_MS);
  const onThemeChangeRef = useRef(onThemeChange);
  onThemeChangeRef.current = onThemeChange;
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const mutationSeqRef = useRef(0);

  const enqueueWrite = (task: () => Promise<void>): void => {
    mutationSeqRef.current++;
    writeQueueRef.current = writeQueueRef.current
      .then(task)
      .catch((error: unknown) => log.error('could not save quick popup change', error));
  };

  const siteConfig = activeTab ? getSiteQuickConfig(activeTab.siteId) : undefined;
  const optionsKey = activeTab ? `${activeTab.storagePrefix}/options` : null;
  const themeKey = activeTab ? `${activeTab.storagePrefix}/${THEME_DATA_KEY}` : null;
  const filtersKey = activeTab ? `${activeTab.storagePrefix}/filters` : null;
  const speedKey =
    activeTab && siteConfig?.supportsVideoSpeed
      ? `${activeTab.storagePrefix}/${X_VIDEO_SPEED_KEY}`
      : null;

  useEffect(() => {
    let alive = true;
    const owned = !providedSiteSettings;
    const client = providedSiteSettings ?? createSiteSettings(store);
    siteSettingsRef.current = client;
    setSites(client.list());

    const stopWatch = client.onChange(() => {
      if (alive) {
        setSites(client.list());
      }
    });
    void client.ready.then(() => {
      if (alive) {
        setSites(client.list());
      }
    });

    return () => {
      alive = false;
      stopWatch();
      if (owned) {
        client.dispose?.();
      }
      if (siteSettingsRef.current === client) {
        siteSettingsRef.current = undefined;
      }
    };
  }, [providedSiteSettings, store]);

  useEffect(() => {
    if (!optionsKey || !themeKey) {
      return;
    }
    let alive = true;
    const loadSeq = mutationSeqRef.current;
    const keys = speedKey ? [optionsKey, themeKey, speedKey] : [optionsKey, themeKey];

    void readStoreMany(store, keys)
      .then((loaded) => {
        if (!alive || mutationSeqRef.current !== loadSeq) {
          return;
        }
        setOptionsMap(readOptionMap(loaded[optionsKey]));
        const nextTheme = readThemeConfig(loaded[themeKey]);
        setTheme(nextTheme);
        onThemeChangeRef.current?.(nextTheme);
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
          const parsed = readThemeConfig(next);
          setTheme(parsed);
          onThemeChangeRef.current?.(parsed);
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
  }, [optionsKey, themeKey, speedKey, store]);

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
        </div>

        {toast && (
          <Toast message={toast.message} {...(toast.onUndo ? { onUndo: toast.onUndo } : {})} />
        )}

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
      setOptionsMap(next);
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
          setOptionsMap(restored);
        });
      });
    }
  };

  const applyStarterMode = (modeId: StarterModeId): void => {
    const mode = siteConfig.modes.find((m) => m.id === modeId);
    if (mode) {
      patchOptions({ ...siteConfig.modeDefaults, ...mode.patch }, `${mode.label} mode applied`);
    }
  };

  const applyQuickTheme = (preset: string): void => {
    if (!themeKey) {
      return;
    }
    const key = themeKey;
    let previousColors = {
      preset: theme.preset,
      accent: theme.accent,
      background: theme.background,
      surface: theme.surface,
      text: theme.text,
    };
    const optimistic = applyThemePreset(theme, preset);
    setTheme(optimistic);
    onThemeChangeRef.current?.(optimistic);
    enqueueWrite(async () => {
      const latest = readThemeConfig(await store.get(key));
      previousColors = {
        preset: latest.preset,
        accent: latest.accent,
        background: latest.background,
        surface: latest.surface,
        text: latest.text,
      };
      const next = applyThemePreset(latest, preset);
      await store.set(key, next);
      setTheme(next);
      onThemeChangeRef.current?.(next);
    });
    const label = preset === 'default' ? 'Site Default' : (findThemePreset(preset)?.name ?? preset);
    notify(`Theme: ${label}`, () => {
      enqueueWrite(async () => {
        const latest = readThemeConfig(await store.get(key));
        const restored: ThemeConfig = { ...latest, ...previousColors };
        await store.set(key, restored);
        setTheme(restored);
        onThemeChangeRef.current?.(restored);
      });
    });
  };

  const stepVideoSpeed = (delta: number): void => {
    if (!speedKey) {
      return;
    }
    const key = speedKey;
    const optimisticRate = clampVideoSpeed(videoSpeed.rate + delta);
    setVideoSpeed({ rate: optimisticRate, custom: optimisticRate !== 1 });
    enqueueWrite(async () => {
      const latest = readSavedVideoSpeed(await store.get(key));
      const nextRate = clampVideoSpeed(latest.rate + delta);
      const next: SavedVideoSpeed = { rate: nextRate, custom: nextRate !== 1 };
      await store.set(key, next);
      setVideoSpeed(next);
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

  const handleQuickMute = async (term: string): Promise<void> => {
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

  const activeThemeName =
    theme.preset && theme.preset !== 'default'
      ? (findThemePreset(theme.preset)?.name ?? 'Custom')
      : 'Site Default';

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

        <div>
          <div className="fs-kicker-row">
            <h4 className="fs-kicker">Mode</h4>
            {activeMode === null && <Badge>Custom</Badge>}
          </div>
          <SegmentedControl
            ariaLabel={`${activeTab.displayName} starter mode`}
            fullWidth
            value={activeMode}
            options={siteConfig.modes.map((m) => ({ value: m.id, label: m.label }))}
            onChange={applyStarterMode}
          />
          {activeModeSpec && <p className="qp-mode-hint">{activeModeSpec.summary}</p>}
        </div>

        <SettingCard title="Quick Controls">
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
                  onChange={(next) => patchOptions({ [toggle.key]: next })}
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

        <SettingCard title="Quick Theme" action={<Badge>{activeThemeName}</Badge>}>
          <div className="qp-swatches" role="group" aria-label="Quick theme presets">
            <button
              type="button"
              className="qp-swatch-btn"
              title="Site Default"
              aria-label="Site Default theme"
              aria-pressed={!theme.preset || theme.preset === 'default'}
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
                aria-pressed={theme.preset === preset.id}
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
        </SettingCard>

        <SettingCard title="Quick Mute">
          <QuickMuteForm
            placeholder={siteConfig.quickMutePlaceholder}
            onSubmitTerm={handleQuickMute}
          />
        </SettingCard>
      </div>

      {toast && (
        <Toast message={toast.message} {...(toast.onUndo ? { onUndo: toast.onUndo } : {})} />
      )}

      <footer className="qp-footer">
        <button type="button" className="qp-btn" onClick={() => onOpenSettings('Appearance')}>
          <UiIcon name="sparkles" size={13} />
          Audit theme
        </button>
        <button
          type="button"
          className="qp-btn primary"
          onClick={() => onOpenSettings(siteConfig.filterSection)}
        >
          All {activeTab.displayName} settings →
        </button>
      </footer>
    </div>
  );
}
