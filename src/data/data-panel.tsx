import { useCallback, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { OptionsPanel } from '../ui/options-dialog/panel';
import type { DataStores } from './transfer';
import { NAME } from '../../project';
import { definePanel } from '../ui/options-dialog/panel';
import { SettingCard } from '../ui/primitives';
import css from './data-panel.css?inline';
import { applyBackup, exportBackup, parseBackup, resetAllData } from './transfer';

interface Status {
  readonly text: string;
  readonly error?: boolean;
}

function downloadJson(text: string): void {
  const date = new Date().toISOString().slice(0, 10);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `feed-sanity-settings-${date}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The Data section of the options dialog: export and import settings and post
 * filters, or reset everything
 * to defaults.
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
  const [importText, setImportText] = useState('');
  const [status, setStatus] = useState<Status | null>(null);
  const [exportedText, setExportedText] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const reportStatus = (text: string, error = false): void => {
    if (!error && notify) {
      setStatus(null);
      notify(text);
      return;
    }
    setStatus(error ? { text, error: true } : { text });
  };
  const subscribePostdata = useCallback(
    (onChange: () => void) => stores.read_history?.onChange(onChange) ?? (() => undefined),
    [stores.read_history],
  );
  const readCount = useSyncExternalStore(subscribePostdata, () =>
    stores.read_history ? Object.keys(stores.read_history.get()).length : 0,
  );

  const onClearReadHistory = async () => {
    if (!stores.read_history) {
      return;
    }
    setBusy(true);
    try {
      await stores.read_history.set({});
      reportStatus('Read post history cleared.');
    } catch {
      reportStatus('Could not clear read post history.', true);
    } finally {
      setBusy(false);
    }
  };

  const onCopyExport = async () => {
    const json = exportBackup(stores);
    try {
      await navigator.clipboard.writeText(json);
      setExportedText(null);
      reportStatus('Settings JSON copied to the clipboard.');
    } catch {
      setExportedText(json);
      reportStatus('Could not copy automatically. Select and copy the JSON below.', true);
    }
  };

  const onDownloadExport = () => {
    downloadJson(exportBackup(stores));
    reportStatus('Settings backup downloaded.');
  };

  const onImport = async (raw = importText) => {
    const parsed = parseBackup(raw, stores.options.list());
    if (!parsed.ok) {
      reportStatus(parsed.error, true);
      return;
    }
    setBusy(true);
    try {
      const summary = await applyBackup(parsed, stores);
      setImportText('');
      reportStatus(summary);
    } catch {
      reportStatus('Could not save the imported settings.', true);
    } finally {
      setBusy(false);
    }
  };

  const onFilePicked = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      setImportText(text);
      await onImport(text);
    } catch {
      reportStatus('Could not read that file.', true);
    }
  };

  const onConfirmReset = async () => {
    setBusy(true);
    try {
      await resetAllData(stores);
      setConfirmingReset(false);
      reportStatus('All options, filters, theme and custom selectors were reset to defaults.');
    } catch {
      reportStatus('Could not reset settings.', true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="data">
      {status && (
        <p role="status" className={status.error ? 'data-status data-error' : 'data-status'}>
          {status.text}
        </p>
      )}

      <SettingCard title="Export">
        <div className="data-card-body">
          <p className="description">
            Save this site's {NAME} options, filters, theme, and custom selectors as a JSON file.
          </p>
          <div className="data-actions">
            <button className="button primary" type="button" onClick={onDownloadExport}>
              Download JSON
            </button>
            <button className="button" type="button" onClick={() => void onCopyExport()}>
              Copy JSON
            </button>
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

      <SettingCard title="Import">
        <div className="data-card-body">
          <p className="description" id={`${importId}-desc`}>
            Load a saved {NAME} JSON backup. Changes apply right away with no reload, and unknown
            keys are skipped.
          </p>
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
          <textarea
            className="field data-code"
            rows={6}
            aria-label="Settings JSON to import"
            aria-describedby={`${importId}-desc`}
            placeholder='{"options": {...}, "filters": [...]}'
            spellCheck={false}
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
          />
          <div className="data-actions">
            <button
              className="button primary"
              type="button"
              disabled={busy || importText.trim() === ''}
              onClick={() => void onImport()}
            >
              Import JSON
            </button>
            <button
              className="button"
              type="button"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              Load from file...
            </button>
          </div>
        </div>
      </SettingCard>

      {stores.read_history && (
        <SettingCard title="Read Post History">
          <div className="data-card-body">
            <p className="description">
              {readCount === 0
                ? 'No posts are currently marked as read.'
                : `${readCount} ${readCount === 1 ? 'post is' : 'posts are'} remembered as read.`}
            </p>
            <div className="data-actions">
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

      <SettingCard title="Reset">
        <div className="data-card-body">
          <p className="description">
            Restore every {siteName ? `${siteName} ` : ''}option to its default and remove all saved
            filters and custom selectors.
          </p>
          <div className="data-actions">
            {confirmingReset ? (
              <>
                <button
                  className="button data-danger"
                  type="button"
                  disabled={busy}
                  onClick={() => void onConfirmReset()}
                >
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
              </>
            ) : (
              <button
                className="button"
                type="button"
                disabled={busy}
                onClick={() => setConfirmingReset(true)}
              >
                Reset all settings
              </button>
            )}
          </div>
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
      stores.read_history?.ready ?? Promise.resolve(),
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
