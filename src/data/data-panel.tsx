import { useId, useRef, useState, useSyncExternalStore } from 'react';
import type { OptionsPanel } from '../ui/options-dialog/panel';
import type { DataStores } from './transfer';
import { NAME } from '../../project';
import { definePanel } from '../ui/options-dialog/panel';
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
export function DataPanel({ stores }: { stores: DataStores }) {
  const importId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [importText, setImportText] = useState('');
  const [status, setStatus] = useState<Status | null>(null);
  const [exportedText, setExportedText] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const readCount = useSyncExternalStore(
    (onChange) => stores.read_history?.onChange(onChange) ?? (() => undefined),
    () => (stores.read_history ? Object.keys(stores.read_history.get()).length : 0),
  );

  const onClearReadHistory = async () => {
    if (!stores.read_history) {
      return;
    }
    setBusy(true);
    try {
      await stores.read_history.set({});
      setStatus({ text: 'Read post history cleared.' });
    } catch {
      setStatus({ text: 'Could not clear read post history.', error: true });
    } finally {
      setBusy(false);
    }
  };

  const onCopyExport = async () => {
    const json = exportBackup(stores);
    try {
      await navigator.clipboard.writeText(json);
      setExportedText(null);
      setStatus({ text: 'Settings JSON copied to the clipboard.' });
    } catch {
      setExportedText(json);
      setStatus({
        text: 'Could not copy automatically. Select and copy the JSON below.',
        error: true,
      });
    }
  };

  const onDownloadExport = () => {
    downloadJson(exportBackup(stores));
    setStatus({ text: 'Settings backup downloaded.' });
  };

  const onImport = async (raw = importText) => {
    const parsed = parseBackup(raw, stores.options.list());
    if (!parsed.ok) {
      setStatus({ text: parsed.error, error: true });
      return;
    }
    setBusy(true);
    try {
      const summary = await applyBackup(parsed, stores);
      setImportText('');
      setStatus({ text: summary });
    } catch {
      setStatus({ text: 'Could not save the imported settings.', error: true });
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
      setStatus({ text: 'Could not read that file.', error: true });
    }
  };

  const onConfirmReset = async () => {
    setBusy(true);
    try {
      await resetAllData(stores);
      setConfirmingReset(false);
      setStatus({
        text: 'All options, filters, theme and custom selectors were reset to defaults.',
      });
    } catch {
      setStatus({ text: 'Could not reset settings.', error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="data">
      <h3 className="data-heading">Backup &amp; Restore</h3>
      <p className="description">
        Export your {NAME} options, filters, theme and custom selectors as JSON, or import a backup
        from {NAME}. Changes apply right away with no page reload.
      </p>

      {status && (
        <p role="status" className={status.error ? 'data-status data-error' : 'data-status'}>
          {status.text}
        </p>
      )}

      <h4 className="data-subheading">Export</h4>
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

      <h4 className="data-subheading">Import</h4>
      <p className="description" id={`${importId}-desc`}>
        Choose a saved JSON file or paste JSON below. Unrecognised options are
        skipped automatically.
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

      {stores.read_history && (
        <>
          <h4 className="data-subheading">Read post history</h4>
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
        </>
      )}

      <h4 className="data-subheading">Reset</h4>
      <p className="description">
        Restore every option to its default and remove all saved filters and custom selectors.
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
    </section>
  );
}

/** The Data section of the options dialog. */
export function dataPanel(stores: DataStores): OptionsPanel {
  return definePanel<null>({
    section: 'Data',
    css,
    ready: Promise.all([
      stores.options.loaded,
      stores.filters.ready,
      stores.locators.ready,
      stores.theme?.ready ?? Promise.resolve(),
      stores.read_history?.ready ?? Promise.resolve(),
    ]).then(() => undefined),
    read: () => null,
    save: () => Promise.resolve(),
    Panel: () => <DataPanel stores={stores} />,
  });
}
