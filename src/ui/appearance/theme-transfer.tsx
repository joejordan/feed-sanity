import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ThemeCapabilities, ThemeDocumentV1, ThemeParseResult } from '../../core/theming';
import {
  analyzeThemeDocument,
  autoFixDocumentContrast,
  getPaletteSwatches,
  isCustomImportedDocument,
  MAX_THEME_FILE_BYTES,
  parseThemeDocument,
  serializeThemeDocument,
  THEME_FILE_EXTENSION,
  themeParseFailure,
} from '../../core/theming';
import { Badge, Disclosure } from '../primitives';

export interface ThemeTransferDisclosureProps {
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly document: ThemeDocumentV1;
  readonly onImport: (doc: ThemeDocumentV1, includeCustomCss: boolean) => void;
  readonly notify?: (message: string, onUndo?: () => void) => void;
}

/** Triggers a browser download of `doc` as a standalone `.fstheme.json` file. */
export function downloadThemeDocumentFile(doc: ThemeDocumentV1): string {
  const filename = `${doc.id}${THEME_FILE_EXTENSION}`;
  const json = serializeThemeDocument(doc);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    globalThis.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return filename;
}

function describeCapabilities(doc: ThemeDocumentV1, caps: ThemeCapabilities): readonly string[] {
  const items: string[] = [];
  if (caps.hasPalette) {
    items.push(caps.colorScheme === 'light' ? 'Light palette' : 'Dark palette');
  } else {
    items.push('Native site colors');
  }
  if (caps.backdropEngine) {
    items.push(`Backdrop: ${caps.backdropEngine}`);
  }
  if (caps.surfaceFinish) {
    items.push(`Surface: ${caps.surfaceFinish}`);
  }
  if (caps.clickEffect) {
    items.push(`Click FX: ${caps.clickEffect}`);
  }
  if (caps.hasChrome) {
    items.push('Chrome accents');
  }
  if (doc.typography?.preset && doc.typography.preset !== 'default') {
    items.push(`Font: ${doc.typography.preset}`);
  } else if (doc.typography?.customStack) {
    items.push('Custom font');
  }
  return items;
}

interface ThemeImportPreviewProps {
  readonly doc: ThemeDocumentV1;
  readonly parsed: ThemeParseResult;
  readonly includeCustomCss: boolean;
  readonly onIncludeCustomCssChange: (checked: boolean) => void;
  readonly onFixContrast: () => void;
  readonly onApply: () => void;
  readonly onCancel: () => void;
}

function ThemeImportPreview({
  doc,
  parsed,
  includeCustomCss,
  onIncludeCustomCssChange,
  onFixContrast,
  onApply,
  onCancel,
}: ThemeImportPreviewProps) {
  const swatches = useMemo(
    () => getPaletteSwatches(doc.palette, doc.meta.swatches, true),
    [doc.palette, doc.meta.swatches],
  );
  const capabilities = useMemo(
    () => parsed.capabilities ?? analyzeThemeDocument(doc),
    [parsed.capabilities, doc],
  );
  const features = useMemo(() => describeCapabilities(doc, capabilities), [doc, capabilities]);
  const hasContrastWarning = parsed.warnings.some((warning) =>
    warning.toLowerCase().includes('contrast'),
  );
  const byline = [
    doc.meta.author ? `by ${doc.meta.author}` : '',
    doc.meta.version ? `v${doc.meta.version}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="theme-transfer-preview" role="region" aria-label="Theme import preview">
      <div className="theme-transfer-preview-head">
        <div>
          <strong className="theme-card-name">{doc.meta.name}</strong>
          {byline && <span className="theme-studio-hint"> {byline}</span>}
        </div>
        {swatches.length > 0 && (
          <span className="theme-swatches" aria-hidden="true">
            {swatches.map((color, idx) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: static preview swatch list
                key={idx}
                className="theme-dot"
                style={{ background: color }}
              />
            ))}
          </span>
        )}
      </div>

      {doc.meta.description && <p className="theme-card-desc">{doc.meta.description}</p>}

      <div className="theme-transfer-pills">
        <Badge tone={capabilities.trust === 'data-only' ? 'accent' : 'warning'}>
          {capabilities.trust === 'data-only' ? 'Verified data' : 'Includes custom CSS'}
        </Badge>
        {features.map((item) => (
          <Badge key={item} tone="neutral">
            {item}
          </Badge>
        ))}
      </div>

      {parsed.warnings.length > 0 && (
        <div className="theme-contrast-warn" role="status">
          <ul className="theme-audit-list">
            {parsed.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
          {hasContrastWarning && doc.palette && (
            <button type="button" className="button" onClick={onFixContrast}>
              Fix contrast
            </button>
          )}
        </div>
      )}

      {parsed.hadCustomCss && doc.customCss && (
        <label className="theme-transfer-css-optin">
          <input
            type="checkbox"
            checked={includeCustomCss}
            onChange={(event) => onIncludeCustomCssChange(event.currentTarget.checked)}
          />
          <span>
            Include custom CSS ({doc.customCss.length} chars; external imports/URLs stripped)
          </span>
        </label>
      )}

      <div className="theme-transfer-actions">
        <button type="button" className="button primary" onClick={onApply}>
          Apply imported theme
        </button>
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function ThemeTransferDisclosure({
  open,
  onToggle,
  document: activeDoc,
  onImport,
  notify,
}: ThemeTransferDisclosureProps) {
  const pasteId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const readSeqRef = useRef(0);
  const [pasteDraft, setPasteDraft] = useState('');
  const [parsed, setParsed] = useState<ThemeParseResult | null>(null);
  const [includeCustomCss, setIncludeCustomCss] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(
    () => () => {
      readSeqRef.current++;
    },
    [],
  );

  const clearPreview = (): void => {
    readSeqRef.current++;
    setParsed(null);
    setIncludeCustomCss(false);
  };

  const setImportError = (message: string): void => {
    readSeqRef.current++;
    setParsed(themeParseFailure(message));
    setIncludeCustomCss(false);
    setStatusMessage(null);
  };

  const inspectRawJson = (rawText: string): void => {
    readSeqRef.current++;
    setParsed(parseThemeDocument(rawText));
    setIncludeCustomCss(false);
    setStatusMessage(null);
  };

  const handleExportDownload = (): void => {
    const filename = downloadThemeDocumentFile(activeDoc);
    setStatusMessage(`Exported ${filename}`);
    notify?.(`Exported ${filename}`);
  };

  const handleCopyJson = (): void => {
    const json = serializeThemeDocument(activeDoc);
    const clipboard = globalThis.navigator?.clipboard;
    if (!clipboard?.writeText) {
      setStatusMessage('Clipboard unavailable — use Export file instead.');
      return;
    }
    void clipboard
      .writeText(json)
      .then(() => {
        setStatusMessage(`Copied "${activeDoc.meta.name}" JSON to clipboard.`);
        notify?.('Copied theme JSON');
      })
      .catch(() => {
        setStatusMessage('Could not copy to clipboard — use Export file instead.');
      });
  };

  const handleFileChange = (input: HTMLInputElement): void => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    if (file.size > MAX_THEME_FILE_BYTES) {
      setImportError(`File "${file.name}" exceeds the ${MAX_THEME_FILE_BYTES / 1024} KB limit.`);
      return;
    }
    const seq = ++readSeqRef.current;
    void file
      .text()
      .then((text) => {
        if (seq !== readSeqRef.current) {
          return;
        }
        setPasteDraft(text);
        setParsed(parseThemeDocument(text));
        setIncludeCustomCss(false);
        setStatusMessage(null);
      })
      .catch(() => {
        if (seq !== readSeqRef.current) {
          return;
        }
        setImportError(`Could not read "${file.name}".`);
      });
  };

  const previewDoc = parsed?.ok ? parsed.document : undefined;
  const hasPasteDraft = /\S/.test(pasteDraft);

  const handleFixPreviewContrast = (): void => {
    if (!previewDoc) {
      return;
    }
    const rechecked = parseThemeDocument(autoFixDocumentContrast(previewDoc));
    const preservedWarnings = (parsed?.warnings ?? []).filter(
      (warning) => !warning.toLowerCase().includes('contrast'),
    );
    setParsed({
      ...rechecked,
      warnings: [...preservedWarnings, ...rechecked.warnings],
      hadCustomCss: parsed?.hadCustomCss ?? rechecked.hadCustomCss,
      strippedCssRules: parsed?.strippedCssRules ?? rechecked.strippedCssRules,
    });
  };

  const handleApplyImport = (): void => {
    if (!previewDoc) {
      return;
    }
    onImport(previewDoc, includeCustomCss);
    clearPreview();
    setPasteDraft('');
    setStatusMessage(`Imported "${previewDoc.meta.name}"`);
  };

  return (
    <Disclosure
      label="Import / Export theme"
      badge={
        isCustomImportedDocument(activeDoc) ? <Badge tone="accent">Imported</Badge> : undefined
      }
      open={open}
      onToggle={onToggle}
    >
      {open && (
        <div className="theme-drawer-pad">
          <p className="theme-studio-intro">
            Save or share your full theme (colors, font, Studio effects, and chrome) as a single{' '}
            <code>{THEME_FILE_EXTENSION}</code> file.
          </p>

          <div className="theme-transfer-actions">
            <button type="button" className="button primary" onClick={handleExportDownload}>
              Export {THEME_FILE_EXTENSION}
            </button>
            <button type="button" className="button" onClick={handleCopyJson}>
              Copy JSON
            </button>
            <button type="button" className="button" onClick={() => fileInputRef.current?.click()}>
              Choose file…
            </button>
            <input
              ref={fileInputRef}
              type="file"
              className="theme-transfer-file-input"
              aria-label="Import theme file"
              accept=".fstheme.json,.json,application/json"
              onChange={(event) => handleFileChange(event.currentTarget)}
            />
          </div>

          {statusMessage && (
            <p className="theme-studio-hint" role="status">
              {statusMessage}
            </p>
          )}

          <div className="theme-color-row">
            <label htmlFor={pasteId}>Or paste .fstheme.json</label>
            <textarea
              id={pasteId}
              className="field"
              rows={4}
              aria-label="Paste theme JSON"
              placeholder='{"format": "feed-sanity-theme", "schemaVersion": 1, ...}'
              spellCheck={false}
              value={pasteDraft}
              onChange={(event) => {
                readSeqRef.current++;
                setPasteDraft(event.currentTarget.value);
                if (parsed) {
                  clearPreview();
                }
              }}
            />
            <div className="theme-transfer-actions">
              <button
                type="button"
                className="button"
                disabled={!hasPasteDraft}
                onClick={() => inspectRawJson(pasteDraft)}
              >
                Preview import
              </button>
              {(pasteDraft || parsed) && (
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    setPasteDraft('');
                    clearPreview();
                  }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {parsed && !parsed.ok && (
            <div className="theme-transfer-error" role="alert">
              <strong>Could not import theme</strong>
              <ul className="theme-audit-list">
                {parsed.errors.map((err) => (
                  <li key={err}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          {parsed && previewDoc && (
            <ThemeImportPreview
              doc={previewDoc}
              parsed={parsed}
              includeCustomCss={includeCustomCss}
              onIncludeCustomCssChange={setIncludeCustomCss}
              onFixContrast={handleFixPreviewContrast}
              onApply={handleApplyImport}
              onCancel={clearPreview}
            />
          )}
        </div>
      )}
    </Disclosure>
  );
}
