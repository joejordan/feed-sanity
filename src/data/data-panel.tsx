import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { LocatorOverrides } from '../core/locator';
import type { Options } from '../core/options';
import type { SavedData, SavedValue } from '../core/saved';
import type { SiteSettingsClient } from '../core/site-settings';
import type { ThemeLibraryClient } from '../core/theming';
import type { ReadHistory } from '../facebook/read-history';
import type { SavedVideoSpeed } from '../sites/x/features/video-speed-model';
import type { OptionsPanel } from '../ui/options-dialog/panel';
import type { DataStores, ParsedBackup } from './transfer';
import { NAME } from '../../project';
import { savedFilters } from '../core/filter-types';
import { readThemeDocument, THEME_DATA_KEY } from '../ui/appearance';
import { definePanel } from '../ui/options-dialog/panel';
import { Badge, downloadJsonFile, SettingCard, UiIcon } from '../ui/primitives';
import { watchOptionChanges } from '../ui/use-option-value';
import css from './data-panel.css?inline';
import { applyBackup, exportBackup, parseBackup, resetAllData } from './transfer';

interface Status {
  readonly text: string;
  readonly error?: boolean;
}

const COPY_FEEDBACK_MS = 2200;
const MAX_BACKUP_FILE_BYTES = 5 * 1024 * 1024;

function downloadJson(text: string, siteId?: string): void {
  const date = new Date().toISOString().slice(0, 10);
  const safeSite = siteId ? siteId.replaceAll(/[^a-z0-9_-]/gi, '') : '';
  const filename = safeSite
    ? `feed-sanity-${safeSite}-settings-${date}.json`
    : `feed-sanity-settings-${date}.json`;
  downloadJsonFile(filename, text);
}

function countModifiedOptions(options: Options): {
  readonly modified: number;
  readonly total: number;
} {
  const all = options.list();
  let modified = 0;
  for (const [key, spec] of all) {
    if (options.get(key) !== spec.default) {
      modified++;
    }
  }
  return { modified, total: all.length };
}

/**
 * The Backup & Reset section of the options dialog: live snapshot metrics,
 * one-click JSON export, drag-and-drop / paste backup restore, read history maintenance, and
 * two-step danger-zone reset.
 */
export function DataPanel({
  stores,
  siteName,
  notify,
}: {
  stores: DataStores;
  siteName?: string;
  notify?: (message: string) => void;
}) {
  const importId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mountedRef = useRef(true);
  const busyRef = useRef(false);
  const [importText, setImportText] = useState('');
  const [draggingFile, setDraggingFile] = useState(false);
  const [copiedRecently, setCopiedRecently] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [exportedText, setExportedText] = useState<string | null>(null);
  const [pendingCrossSite, setPendingCrossSite] = useState<{
    readonly parsed: Extract<ParsedBackup, { ok: true }>;
    readonly fromSite: string;
  } | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [metricsTick, setMetricsTick] = useState(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (copyTimerRef.current !== undefined) {
        clearTimeout(copyTimerRef.current);
        copyTimerRef.current = undefined;
      }
    };
  }, []);

  useEffect(() => {
    let pendingTimer: ReturnType<typeof setTimeout> | undefined;
    const bump = (): void => {
      if (pendingTimer !== undefined) {
        return;
      }
      pendingTimer = setTimeout(() => {
        pendingTimer = undefined;
        setMetricsTick((t) => t + 1);
      }, 0);
    };
    const optionKeys = stores.options.list().map(([key]) => key);
    const cleanups: Array<() => void> = [
      watchOptionChanges(stores.options, optionKeys, bump),
      stores.filters.onChange(bump),
      stores.locators.onChange(bump),
    ];
    if (stores.theme) {
      cleanups.push(stores.theme.onChange(bump));
    }
    return () => {
      if (pendingTimer !== undefined) {
        clearTimeout(pendingTimer);
      }
      for (const stop of cleanups) {
        stop();
      }
    };
  }, [stores]);

  const hasGlobalStores = Boolean(stores.themeLibrary || stores.siteSettings);
  const sitePossessive = siteName ? `${siteName}'s` : "this site's";
  let exportScopeBadge = 'Site backup';
  if (siteName) {
    exportScopeBadge = hasGlobalStores ? `${siteName} + Library` : siteName;
  } else if (hasGlobalStores) {
    exportScopeBadge = 'Site + Library';
  }
  const exportDescription = hasGlobalStores
    ? `Save ${sitePossessive} ${NAME} options, filters, theme, custom selectors, My Themes library, and site toggles as a portable JSON file.`
    : `Save ${sitePossessive} ${NAME} options, filters, theme, and custom selectors as a portable JSON file.`;

  const clearedOnReset = stores.readHistory
    ? 'filters, theme, custom selectors and read history'
    : 'filters, theme and custom selectors';

  const reportStatus = (text: string, error = false): void => {
    if (!error && notify) {
      setStatus(null);
      notify(text);
      return;
    }
    setStatus(error ? { text, error: true } : { text });
  };

  const subscribeReadHistory = useCallback(
    (onChange: () => void) => stores.readHistory?.onChange(onChange) ?? (() => undefined),
    [stores.readHistory],
  );
  const readCount = useSyncExternalStore(subscribeReadHistory, () =>
    stores.readHistory ? Object.keys(stores.readHistory.get()).length : 0,
  );

  const { optionStats, filterCount, locatorCount, activeThemeName } = useMemo(() => {
    void metricsTick;
    const activeThemeDoc = stores.theme?.get();
    let themeLabel: string | null = null;
    if (activeThemeDoc) {
      themeLabel = activeThemeDoc.id === 'default' ? 'Site Default' : activeThemeDoc.meta.name;
    }
    return {
      optionStats: countModifiedOptions(stores.options),
      filterCount: stores.filters.get().length,
      locatorCount: Object.keys(stores.locators.get()).length,
      activeThemeName: themeLabel,
    };
  }, [stores, metricsTick]);

  const onClearReadHistory = async () => {
    if (!stores.readHistory) {
      return;
    }
    setBusy(true);
    try {
      await stores.readHistory.set({});
      reportStatus('Read history cleared.');
    } catch {
      reportStatus('Could not clear the read history.', true);
    } finally {
      setBusy(false);
    }
  };

  const onCopyExport = async () => {
    const json = exportBackup(stores);
    try {
      await navigator.clipboard.writeText(json);
      if (!mountedRef.current) {
        return;
      }
      setExportedText(null);
      setCopiedRecently(true);
      if (copyTimerRef.current !== undefined) {
        clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = setTimeout(() => {
        copyTimerRef.current = undefined;
        if (mountedRef.current) {
          setCopiedRecently(false);
        }
      }, COPY_FEEDBACK_MS);
      reportStatus('Settings JSON copied to the clipboard.');
    } catch {
      if (!mountedRef.current) {
        return;
      }
      setExportedText(json);
      reportStatus('Could not copy automatically. Select and copy the JSON below.', true);
    }
  };

  const onDownloadExport = () => {
    downloadJson(exportBackup(stores), stores.siteId);
    reportStatus('Settings backup downloaded.');
  };

  const applyParsedImport = async (parsed: Extract<ParsedBackup, { ok: true }>) => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const summary = await applyBackup(parsed, stores);
      if (!mountedRef.current) {
        return;
      }
      setPendingCrossSite(null);
      setImportText('');
      reportStatus(summary);
    } catch {
      if (mountedRef.current) {
        reportStatus('Could not save the imported settings.', true);
      }
    } finally {
      busyRef.current = false;
      if (mountedRef.current) {
        setBusy(false);
      }
    }
  };

  const handleParsedBackup = async (parsed: ParsedBackup) => {
    if (!parsed.ok) {
      setPendingCrossSite(null);
      reportStatus(parsed.error, true);
      return;
    }
    if (parsed.site && stores.siteId && parsed.site !== stores.siteId) {
      setPendingCrossSite({ parsed, fromSite: parsed.site });
      setStatus(null);
      return;
    }
    await applyParsedImport(parsed);
  };

  const onImport = async (raw = importText) => {
    if (busyRef.current) {
      return;
    }
    await handleParsedBackup(parseBackup(raw, stores.options.list()));
  };

  const onFilePicked = async (file: File | undefined) => {
    if (!file || busyRef.current) {
      return;
    }
    if (file.size > MAX_BACKUP_FILE_BYTES) {
      setPendingCrossSite(null);
      reportStatus('Backup file is too large (maximum 5 MB).', true);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    let text: string;
    try {
      text = await file.text();
    } catch {
      busyRef.current = false;
      if (mountedRef.current) {
        setBusy(false);
        setPendingCrossSite(null);
        reportStatus('Could not read or save that file.', true);
      }
      return;
    }
    if (!mountedRef.current) {
      busyRef.current = false;
      return;
    }
    setImportText(text);
    const parsed = parseBackup(text, stores.options.list());
    if (!parsed.ok) {
      busyRef.current = false;
      setBusy(false);
      setPendingCrossSite(null);
      reportStatus(parsed.error, true);
      return;
    }
    if (parsed.site && stores.siteId && parsed.site !== stores.siteId) {
      busyRef.current = false;
      setBusy(false);
      setPendingCrossSite({ parsed, fromSite: parsed.site });
      setStatus(null);
      return;
    }
    try {
      const summary = await applyBackup(parsed, stores);
      if (!mountedRef.current) {
        return;
      }
      setPendingCrossSite(null);
      setImportText('');
      reportStatus(summary);
    } catch {
      if (mountedRef.current) {
        reportStatus('Could not save the imported settings.', true);
      }
    } finally {
      busyRef.current = false;
      if (mountedRef.current) {
        setBusy(false);
      }
    }
  };

  const handleDragOver = (event: {
    preventDefault: () => void;
    stopPropagation: () => void;
    dataTransfer: DataTransfer | null;
  }): void => {
    const types = event.dataTransfer?.types;
    if (types && !Array.from(types).includes('Files')) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    if (!busy && !draggingFile) {
      setDraggingFile(true);
    }
  };

  const onConfirmReset = async () => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      await resetAllData(stores);
      if (!mountedRef.current) {
        return;
      }
      setConfirmingReset(false);
      reportStatus(`All options, ${clearedOnReset} were reset to defaults.`);
    } catch {
      if (mountedRef.current) {
        reportStatus('Could not reset settings.', true);
      }
    } finally {
      busyRef.current = false;
      if (mountedRef.current) {
        setBusy(false);
      }
    }
  };

  return (
    <section className="data">
      {status && (
        <p role="status" className={status.error ? 'data-status data-error' : 'data-status'}>
          {status.text}
        </p>
      )}

      <div className="data-summary" role="group" aria-label="Current configuration summary">
        <div className="data-metric">
          <span className="data-metric-label">Customized options</span>
          <strong className="data-metric-value">
            {optionStats.modified}
            <span className="data-metric-muted"> / {optionStats.total}</span>
          </strong>
        </div>
        <div className="data-metric">
          <span className="data-metric-label">Filter rules</span>
          <strong className="data-metric-value">{filterCount}</strong>
        </div>
        {activeThemeName !== null && (
          <div className="data-metric">
            <span className="data-metric-label">Active theme</span>
            <strong className="data-metric-value data-metric-truncate" title={activeThemeName}>
              {activeThemeName}
            </strong>
          </div>
        )}
        <div className="data-metric">
          <span className="data-metric-label">Custom selectors</span>
          <strong className="data-metric-value">{locatorCount}</strong>
        </div>
      </div>

      <SettingCard
        title="Export Backup"
        jumpId="export-json"
        action={<Badge tone="neutral">{exportScopeBadge}</Badge>}
      >
        <div className="data-card-body">
          <div className="data-inline-row">
            <p className="description">{exportDescription}</p>
            <div className="data-actions">
              <button
                className="button primary data-btn-icon"
                type="button"
                disabled={busy}
                onClick={onDownloadExport}
              >
                <UiIcon name="download" size={13} />
                Download JSON
              </button>
              <button
                className="button data-btn-icon"
                type="button"
                disabled={busy}
                onClick={() => void onCopyExport()}
              >
                <UiIcon name={copiedRecently ? 'check' : 'copy'} size={13} />
                Copy JSON
              </button>
            </div>
          </div>
          {exportedText !== null && (
            <textarea
              className="field data-code"
              rows={6}
              readOnly
              aria-label="Exported settings JSON"
              value={exportedText}
            />
          )}
        </div>
      </SettingCard>

      <SettingCard title="Restore Backup" jumpId="import-json">
        <div className="data-card-body">
          <p className="description" id={`${importId}-desc`}>
            {`Load a saved ${NAME} JSON backup. Changes apply right away with no reload, and unrecognised keys are skipped.`}
          </p>

          <div
            className="data-dropzone"
            data-dragging={draggingFile ? 'true' : undefined}
            onDragEnter={handleDragOver}
            onDragOver={handleDragOver}
            onDragLeave={(event) => {
              event.stopPropagation();
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setDraggingFile(false);
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setDraggingFile(false);
              void onFilePicked(event.dataTransfer?.files?.[0]);
            }}
          >
            <button
              className="button data-btn-icon"
              type="button"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              <UiIcon name="upload" size={13} />
              Load from file...
            </button>
            <span className="data-drop-hint">
              {draggingFile
                ? 'Drop backup JSON to restore'
                : 'or drag and drop a .json backup file here'}
            </span>
            <input
              ref={fileInput}
              className="data-file"
              type="file"
              accept=".json,application/json"
              aria-label="Import settings file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                void onFilePicked(file);
              }}
            />
          </div>

          <div className="data-paste-block">
            <label className="data-sublabel" htmlFor={importId}>
              Or paste backup JSON
            </label>
            <textarea
              id={importId}
              className="field data-code"
              rows={5}
              aria-label="Settings JSON to import"
              aria-describedby={`${importId}-desc`}
              placeholder='{"options": {...}, "filters": [...]}'
              spellCheck={false}
              value={importText}
              onChange={(event) => {
                setImportText(event.target.value);
                if (pendingCrossSite) {
                  setPendingCrossSite(null);
                }
              }}
            />
          </div>

          {pendingCrossSite && (
            <div className="data-confirm-banner" role="alert">
              <p>
                This backup was exported from <strong>{pendingCrossSite.fromSite}</strong>, not{' '}
                <strong>{siteName ?? stores.siteId}</strong>. Importing will overwrite current
                filters and matching settings.
              </p>
              <div className="data-actions">
                <button
                  className="button primary"
                  type="button"
                  disabled={busy}
                  onClick={() => void applyParsedImport(pendingCrossSite.parsed)}
                >
                  Import anyway
                </button>
                <button
                  className="button"
                  type="button"
                  disabled={busy}
                  onClick={() => setPendingCrossSite(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="data-actions">
            <button
              className="button primary"
              type="button"
              disabled={busy || importText.trim() === ''}
              onClick={() => void onImport()}
            >
              Import JSON
            </button>
            {importText.length > 0 && (
              <button
                className="button"
                type="button"
                disabled={busy}
                onClick={() => {
                  setImportText('');
                  setPendingCrossSite(null);
                }}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </SettingCard>

      {stores.readHistory && (
        <SettingCard title="Read History" action={<Badge tone="neutral">{readCount} stored</Badge>}>
          <div className="data-card-body">
            <div className="data-inline-row">
              <p className="description">
                {readCount === 0
                  ? 'No posts are currently marked as read.'
                  : `${readCount} ${readCount === 1 ? 'post is' : 'posts are'} remembered as read on this account.`}
              </p>
              <button
                className="button"
                type="button"
                disabled={busy || readCount === 0}
                onClick={() => void onClearReadHistory()}
              >
                Clear read history
              </button>
            </div>
          </div>
        </SettingCard>
      )}

      <SettingCard title="Reset" jumpId="reset-site">
        <div className="data-card-body data-reset-body">
          {confirmingReset ? (
            <div className="data-reset-confirm" role="alert">
              <div className="data-reset-confirm-copy">
                <strong>Reset {siteName ? `${siteName} settings` : 'all settings'}?</strong>
                <p className="description">
                  {`Every ${siteName ? `${siteName} ` : ''}option will return to its default, and the saved ${clearedOnReset} for this site will be cleared.`}
                </p>
              </div>
              <div className="data-actions">
                <button
                  className="button data-btn-icon data-danger"
                  type="button"
                  disabled={busy}
                  onClick={() => void onConfirmReset()}
                >
                  <UiIcon name="trash" size={13} />
                  Confirm reset
                </button>
                <button
                  className="button"
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmingReset(false)}
                >
                  Cancel reset
                </button>
              </div>
            </div>
          ) : (
            <div className="data-inline-row">
              <p className="description">
                {`Restore every ${siteName ? `${siteName} ` : ''}option to its default and remove the saved ${clearedOnReset}.`}
              </p>
              <button
                className="button data-danger-outline"
                type="button"
                disabled={busy}
                onClick={() => setConfirmingReset(true)}
              >
                {siteName ? `Reset ${siteName} settings` : 'Reset all settings'}
              </button>
            </div>
          )}
        </div>
      </SettingCard>
    </section>
  );
}

/** The Backup & Reset section of the options dialog. */
export function dataPanel(
  stores: DataStores,
  options: { readonly siteName?: string } = {},
): OptionsPanel {
  const scopeLabel = options.siteName ? `${options.siteName} ` : '';
  return definePanel<null>({
    section: 'Backup & Reset',
    css,
    instant: true,
    ready: Promise.all([
      stores.options.loaded,
      stores.filters.ready,
      stores.locators.ready,
      stores.theme?.ready ?? Promise.resolve(),
      stores.themeLibrary?.ready ?? Promise.resolve(),
      stores.siteSettings?.ready ?? Promise.resolve(),
      stores.readHistory?.ready ?? Promise.resolve(),
      stores.videoSpeed?.ready ?? Promise.resolve(),
    ]).then(() => undefined),
    read: () => null,
    save: () => Promise.resolve(),
    searchItems: () => [
      {
        id: 'export-json',
        title: `Export ${scopeLabel}settings backup`,
        description: 'Download a JSON backup of options, filters, and theme.',
        keywords: ['backup', 'export', 'json', 'download', 'data'],
      },
      {
        id: 'import-json',
        title: `Import ${scopeLabel}settings backup`,
        description: 'Restore a Feed Sanity JSON backup.',
        keywords: ['import', 'restore', 'json', 'data'],
      },
      {
        id: 'reset-site',
        title: `Reset ${scopeLabel}settings`,
        description: 'Restore default options and clear saved filters for this site.',
        keywords: ['reset', 'clear', 'wipe', 'factory'],
      },
    ],
    Panel: ({ notify }) => (
      <DataPanel
        stores={stores}
        {...(options.siteName ? { siteName: options.siteName } : {})}
        {...(notify ? { notify } : {})}
      />
    ),
  });
}

/** Standard site-adapter wiring for `dataPanel` (filters, theme, locators, plus optional extras). */
export function siteDataPanel({
  siteId,
  siteName,
  options,
  data,
  locators,
  themeLibrary,
  siteSettings,
  readHistory,
  videoSpeed,
}: {
  readonly siteId: string;
  readonly siteName: string;
  readonly options: Options;
  readonly data: SavedData;
  readonly locators: SavedValue<LocatorOverrides>;
  readonly themeLibrary?: ThemeLibraryClient | undefined;
  readonly siteSettings?: SiteSettingsClient | undefined;
  readonly readHistory?: SavedValue<ReadHistory> | undefined;
  readonly videoSpeed?: SavedValue<SavedVideoSpeed> | undefined;
}): OptionsPanel {
  return dataPanel(
    {
      siteId,
      options,
      filters: savedFilters(data),
      locators,
      theme: data.value(THEME_DATA_KEY, readThemeDocument),
      ...(themeLibrary ? { themeLibrary } : {}),
      ...(siteSettings ? { siteSettings } : {}),
      ...(readHistory ? { readHistory } : {}),
      ...(videoSpeed ? { videoSpeed } : {}),
    },
    { siteName },
  );
}
