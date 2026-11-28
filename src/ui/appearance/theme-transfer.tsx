import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type {
  ThemeCapabilities,
  ThemeDocumentFilterOptions,
  ThemeDocumentV1,
  ThemeParseResult,
  ThemeUrlFetcher,
} from '../../core/theming';
import {
  getBackdropDisplayName,
  getClickEffectLabel,
  getSurfaceFinishLabel,
} from '../../core/theme-effects';
import {
  analyzeThemeDocument,
  autoFixDocumentContrast,
  fetchThemeTextFromUrl,
  getPaletteSwatches,
  MAX_THEME_FILE_BYTES,
  parseThemeDocument,
  serializeThemeDocument,
  THEME_FILE_EXTENSION,
  themeParseFailure,
  validateThemeImportUrl,
} from '../../core/theming';
import { Badge, Disclosure, downloadJsonFile, TextInput, UiIcon } from '../primitives';

export type ThemeImportOptions = Required<ThemeDocumentFilterOptions>;

const DEFAULT_IMPORT_OPTIONS: ThemeImportOptions = {
  includeCustomCss: false,
  includeCustomShader: false,
};

function isContrastWarning(warning: string): boolean {
  return warning.toLowerCase().includes('contrast');
}

export interface ThemeTransferDisclosureProps {
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly document: ThemeDocumentV1;
  readonly onImport: (doc: ThemeDocumentV1, options: ThemeImportOptions) => void;
  readonly onSaveToLibrary?: (
    doc: ThemeDocumentV1,
    options: ThemeImportOptions,
  ) => Promise<boolean>;
  readonly fetchThemeUrl?: ThemeUrlFetcher;
  readonly notify?: (message: string, onUndo?: () => void) => void;
}

/** Decorative row of palette preview dots shared across preset, library, and import cards. */
export function ThemeSwatches({ swatches }: { readonly swatches: readonly string[] }) {
  if (swatches.length === 0) {
    return null;
  }
  return (
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
  );
}

/** Triggers a browser download of `doc` as a standalone `.fstheme.json` file. */
export function downloadThemeDocumentFile(doc: ThemeDocumentV1): string {
  const filename = `${doc.id}${THEME_FILE_EXTENSION}`;
  downloadJsonFile(filename, serializeThemeDocument(doc));
  return filename;
}

function describeCapabilities(doc: ThemeDocumentV1, caps: ThemeCapabilities): readonly string[] {
  const items: string[] = [];
  if (caps.hasPalette) {
    items.push(caps.colorScheme === 'light' ? 'Light palette' : 'Dark palette');
  } else {
    items.push('Native site colors');
  }
  if (caps.hasCustomScene) {
    const noun = caps.sceneLayerCount === 1 ? 'layer' : 'layers';
    items.push(`Scene (${caps.sceneLayerCount} ${noun})`);
  } else if (caps.hasCustomShader) {
    items.push('Custom GPU shader');
  } else if (caps.backdropEngine) {
    items.push(`Backdrop: ${getBackdropDisplayName(caps.backdropEngine) ?? caps.backdropEngine}`);
  }
  if (caps.surfaceFinish) {
    items.push(`Surface: ${getSurfaceFinishLabel(caps.surfaceFinish) ?? caps.surfaceFinish}`);
  }
  if (caps.clickEffect) {
    items.push(`Click FX: ${getClickEffectLabel(caps.clickEffect) ?? caps.clickEffect}`);
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

function trustBadgeLabel(trust: ThemeCapabilities['trust']): string {
  switch (trust) {
    case 'data-only':
      return 'Verified data';
    case 'custom-css':
      return 'Includes custom CSS';
    case 'custom-shader':
      return 'Includes GPU shader';
    case 'custom-css-and-shader':
      return 'Custom CSS + GPU shader';
  }
}

interface ThemeImportPreviewProps {
  readonly doc: ThemeDocumentV1;
  readonly parsed: ThemeParseResult;
  readonly sourceHost?: string | null;
  readonly importOptions: ThemeImportOptions;
  readonly onImportOptionsChange: (patch: Partial<ThemeImportOptions>) => void;
  readonly onFixContrast: () => void;
  readonly onApply: () => void;
  readonly onSaveToLibrary?: () => void;
  readonly onCancel: () => void;
}

function ThemeImportPreview({
  doc,
  parsed,
  sourceHost,
  importOptions,
  onImportOptionsChange,
  onFixContrast,
  onApply,
  onSaveToLibrary,
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
  const hasContrastWarning = parsed.warnings.some(isContrastWarning);
  const byline = [
    doc.meta.author ? `by ${doc.meta.author}` : '',
    doc.meta.version ? `v${doc.meta.version}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const customShader =
    parsed.hadCustomShader && doc.effects?.backdrop?.id === 'custom-shader'
      ? doc.effects.backdrop.shader
      : undefined;

  return (
    <div className="theme-transfer-preview" role="region" aria-label="Theme import preview">
      {swatches.length >= 2 && (
        <div
          className="theme-transfer-preview-strip"
          aria-hidden="true"
          style={{
            background: `linear-gradient(90deg, ${swatches.join(', ')})`,
          }}
        />
      )}

      <div className="theme-transfer-preview-head">
        <div className="theme-transfer-preview-title">
          <strong className="theme-card-name">{doc.meta.name}</strong>
          {byline && <span className="theme-studio-hint"> {byline}</span>}
        </div>
        <ThemeSwatches swatches={swatches} />
      </div>

      {doc.meta.description && <p className="theme-card-desc">{doc.meta.description}</p>}

      <div className="theme-transfer-pills">
        <Badge tone={capabilities.trust === 'data-only' ? 'accent' : 'warning'}>
          {trustBadgeLabel(capabilities.trust)}
        </Badge>
        {sourceHost && <Badge tone="neutral">From {sourceHost}</Badge>}
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
            checked={importOptions.includeCustomCss}
            onChange={(event) =>
              onImportOptionsChange({ includeCustomCss: event.currentTarget.checked })
            }
          />
          <span>
            Include custom CSS ({doc.customCss.length} chars; external imports/URLs stripped)
          </span>
        </label>
      )}

      {customShader && (
        <label className="theme-transfer-css-optin">
          <input
            type="checkbox"
            checked={importOptions.includeCustomShader}
            onChange={(event) =>
              onImportOptionsChange({ includeCustomShader: event.currentTarget.checked })
            }
          />
          <span>
            Include custom GPU shader ({customShader.fragment.length} chars; WebGL sandbox with
            slow-frame fallback)
          </span>
        </label>
      )}

      <div className="theme-transfer-actions">
        <button type="button" className="button primary" onClick={onApply}>
          Apply imported theme
        </button>
        {onSaveToLibrary && (
          <button type="button" className="button" onClick={onSaveToLibrary}>
            Save to My Themes
          </button>
        )}
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
  onSaveToLibrary,
  fetchThemeUrl,
  notify,
}: ThemeTransferDisclosureProps) {
  const urlId = useId();
  const pasteId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const readSeqRef = useRef(0);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const [urlDraft, setUrlDraft] = useState('');
  const [fetchingUrl, setFetchingUrl] = useState(false);
  const [sourceHost, setSourceHost] = useState<string | null>(null);
  const [draggingFile, setDraggingFile] = useState(false);
  const [pasteDraft, setPasteDraft] = useState('');
  const [parsed, setParsed] = useState<ThemeParseResult | null>(null);
  const [importOptions, setImportOptions] = useState<ThemeImportOptions>(DEFAULT_IMPORT_OPTIONS);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const activeSwatches = useMemo(
    () => (open ? getPaletteSwatches(activeDoc.palette, activeDoc.meta.swatches, true) : []),
    [open, activeDoc.palette, activeDoc.meta.swatches],
  );

  const abortPendingFetch = (): void => {
    fetchAbortRef.current?.abort();
    fetchAbortRef.current = null;
    setFetchingUrl(false);
  };

  useEffect(
    () => () => {
      readSeqRef.current++;
      fetchAbortRef.current?.abort();
      fetchAbortRef.current = null;
    },
    [],
  );

  const resetPreview = (
    nextParsed: ThemeParseResult | null,
    clearStatus = false,
    nextSourceHost: string | null = null,
  ): void => {
    readSeqRef.current++;
    abortPendingFetch();
    setParsed(nextParsed);
    setSourceHost(nextSourceHost);
    setImportOptions(DEFAULT_IMPORT_OPTIONS);
    if (clearStatus) {
      setStatusMessage(null);
    }
  };

  const clearPreview = (): void => resetPreview(null);
  const setImportError = (message: string): void => resetPreview(themeParseFailure(message), true);
  const inspectRawJson = (rawText: string): void => resetPreview(parseThemeDocument(rawText), true);
  const applyLoadedText = (text: string, host: string | null): void => {
    setPasteDraft(text);
    resetPreview(parseThemeDocument(text), true, host);
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

  const loadThemeFile = (file: File | undefined): void => {
    if (!file) {
      return;
    }
    if (file.size > MAX_THEME_FILE_BYTES) {
      setImportError(`File "${file.name}" exceeds the ${MAX_THEME_FILE_BYTES / 1024} KB limit.`);
      return;
    }
    abortPendingFetch();
    const seq = ++readSeqRef.current;
    void file
      .text()
      .then((text) => {
        if (seq !== readSeqRef.current) {
          return;
        }
        applyLoadedText(text, null);
      })
      .catch(() => {
        if (seq !== readSeqRef.current) {
          return;
        }
        setImportError(`Could not read "${file.name}".`);
      });
  };

  const handleFileChange = (input: HTMLInputElement): void => {
    const file = input.files?.[0];
    input.value = '';
    loadThemeFile(file);
  };

  const handleDragOver = (event: {
    preventDefault: () => void;
    stopPropagation: () => void;
    dataTransfer: DataTransfer | null;
  }): void => {
    const types = event.dataTransfer?.types;
    if (!types || !Array.from(types).includes('Files')) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    if (!draggingFile) {
      setDraggingFile(true);
    }
  };

  const handleFetchUrl = (): void => {
    const checked = validateThemeImportUrl(urlDraft);
    if (!checked.ok) {
      setImportError(checked.error);
      return;
    }
    resetPreview(null, true);
    const seq = readSeqRef.current;
    setFetchingUrl(true);

    let runFetch: Promise<Awaited<ReturnType<ThemeUrlFetcher>>>;
    if (fetchThemeUrl) {
      runFetch = fetchThemeUrl(checked.url);
    } else {
      const controller = new AbortController();
      fetchAbortRef.current = controller;
      runFetch = fetchThemeTextFromUrl(checked.url, { signal: controller.signal });
    }

    void runFetch
      .then((result) => {
        if (seq !== readSeqRef.current) {
          return;
        }
        if (!result.ok) {
          setImportError(result.error);
          return;
        }
        let host = checked.displayHost;
        if (result.finalUrl && result.finalUrl !== checked.url) {
          const finalHost = validateThemeImportUrl(result.finalUrl);
          if (finalHost.ok) {
            host = finalHost.displayHost;
          }
        }
        applyLoadedText(result.text, host);
      })
      .catch(() => {
        if (seq !== readSeqRef.current) {
          return;
        }
        setImportError('Could not fetch theme URL.');
      });
  };

  const previewDoc = parsed?.ok ? parsed.document : undefined;
  const hasPasteDraft = /\S/.test(pasteDraft);
  const hasUrlDraft = /\S/.test(urlDraft);

  const handleFixPreviewContrast = (): void => {
    if (!previewDoc) {
      return;
    }
    const rechecked = parseThemeDocument(autoFixDocumentContrast(previewDoc));
    const preservedWarnings = (parsed?.warnings ?? []).filter(
      (warning) => !isContrastWarning(warning),
    );
    setParsed({
      ...rechecked,
      warnings: [...preservedWarnings, ...rechecked.warnings],
      hadCustomCss: parsed?.hadCustomCss ?? rechecked.hadCustomCss,
      hadCustomShader: parsed?.hadCustomShader ?? rechecked.hadCustomShader,
      strippedCssRules: parsed?.strippedCssRules ?? rechecked.strippedCssRules,
    });
  };

  const handleApplyImport = (): void => {
    if (!previewDoc) {
      return;
    }
    onImport(previewDoc, importOptions);
    clearPreview();
    setPasteDraft('');
    setUrlDraft('');
    setStatusMessage(`Imported "${previewDoc.meta.name}"`);
  };

  const handleSaveImportToLibrary = (): void => {
    if (!previewDoc || !onSaveToLibrary) {
      return;
    }
    const seq = readSeqRef.current;
    const savedName = previewDoc.meta.name;
    void onSaveToLibrary(previewDoc, importOptions).then((ok) => {
      if (ok && seq === readSeqRef.current) {
        setStatusMessage(`Saved "${savedName}" to My Themes`);
      }
    });
  };

  return (
    <Disclosure label="Import / Export theme" open={open} onToggle={onToggle}>
      {open && (
        <div className="theme-drawer-pad">
          <div className="theme-transfer-section">
            <div className="theme-studio-subhead">
              <span className="theme-transfer-section-label">Export current theme</span>
              <span className="theme-transfer-file-ext">{THEME_FILE_EXTENSION}</span>
            </div>
            <div className="theme-transfer-export-row">
              <div className="theme-transfer-active-meta">
                <ThemeSwatches swatches={activeSwatches} />
                <span className="theme-transfer-active-name" title={activeDoc.meta.name}>
                  {activeDoc.meta.name}
                </span>
              </div>
              <div className="theme-transfer-actions">
                <button
                  type="button"
                  className="button primary theme-transfer-btn"
                  onClick={handleExportDownload}
                >
                  <UiIcon name="download" size={13} />
                  Export {THEME_FILE_EXTENSION}
                </button>
                <button
                  type="button"
                  className="button theme-transfer-btn"
                  onClick={handleCopyJson}
                >
                  <UiIcon name="copy" size={13} />
                  Copy JSON
                </button>
              </div>
            </div>
          </div>

          <div className="theme-transfer-section">
            <div className="theme-studio-subhead">
              <span className="theme-transfer-section-label">Import a theme</span>
              <span className="theme-studio-hint">
                Validated locally before applying · max {MAX_THEME_FILE_BYTES / 1024} KB
              </span>
            </div>

            <div
              className="theme-transfer-dropzone"
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
                loadThemeFile(event.dataTransfer?.files?.[0]);
              }}
            >
              <button
                type="button"
                className="button theme-transfer-btn"
                onClick={() => fileInputRef.current?.click()}
              >
                <UiIcon name="upload" size={13} />
                Choose file…
              </button>
              <span className="theme-transfer-drop-hint">
                {draggingFile
                  ? `Drop to preview ${THEME_FILE_EXTENSION}`
                  : `or drag and drop a ${THEME_FILE_EXTENSION} file here`}
              </span>
              <input
                ref={fileInputRef}
                type="file"
                className="theme-transfer-file-input"
                aria-label="Import theme file"
                accept=".fstheme.json,.json,application/json"
                onChange={(event) => handleFileChange(event.currentTarget)}
              />
            </div>

            <div className="theme-transfer-subblock">
              <label className="theme-transfer-sublabel" htmlFor={urlId}>
                Import from HTTPS URL
              </label>
              <div className="theme-transfer-url-row">
                <TextInput
                  id={urlId}
                  type="url"
                  spellCheck={false}
                  className="field"
                  ariaLabel="Theme URL"
                  placeholder="https://example.com/theme.fstheme.json"
                  value={urlDraft}
                  onValueChange={(next) => {
                    setUrlDraft(next);
                    if (fetchingUrl || (parsed && !parsed.ok)) {
                      clearPreview();
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && hasUrlDraft && !fetchingUrl) {
                      event.preventDefault();
                      handleFetchUrl();
                    }
                  }}
                />
                <button
                  type="button"
                  className="button theme-transfer-btn"
                  aria-busy={fetchingUrl || undefined}
                  disabled={!hasUrlDraft || fetchingUrl}
                  onClick={handleFetchUrl}
                >
                  <UiIcon name="link" size={13} />
                  {fetchingUrl ? 'Fetching…' : 'Fetch'}
                </button>
              </div>
            </div>

            <div className="theme-transfer-subblock">
              <label className="theme-transfer-sublabel" htmlFor={pasteId}>
                Or paste .fstheme.json
              </label>
              <textarea
                id={pasteId}
                className="field theme-transfer-textarea"
                rows={4}
                aria-label="Paste theme JSON"
                placeholder='{"format": "feed-sanity-theme", "schemaVersion": 1, ...}'
                spellCheck={false}
                value={pasteDraft}
                onChange={(event) => {
                  setPasteDraft(event.currentTarget.value);
                  if (fetchingUrl || parsed) {
                    clearPreview();
                  } else {
                    readSeqRef.current++;
                  }
                }}
              />
              <div className="theme-transfer-actions">
                <button
                  type="button"
                  className="button"
                  disabled={!hasPasteDraft || fetchingUrl}
                  onClick={() => inspectRawJson(pasteDraft)}
                >
                  Preview import
                </button>
                {(pasteDraft || urlDraft || parsed) && (
                  <button
                    type="button"
                    className="button"
                    onClick={() => {
                      setPasteDraft('');
                      setUrlDraft('');
                      clearPreview();
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>

          {statusMessage && (
            <p className="theme-studio-hint" role="status">
              {statusMessage}
            </p>
          )}

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
              sourceHost={sourceHost}
              importOptions={importOptions}
              onImportOptionsChange={(patch) => setImportOptions((prev) => ({ ...prev, ...patch }))}
              onFixContrast={handleFixPreviewContrast}
              onApply={handleApplyImport}
              {...(onSaveToLibrary ? { onSaveToLibrary: handleSaveImportToLibrary } : {})}
              onCancel={clearPreview}
            />
          )}
        </div>
      )}
    </Disclosure>
  );
}
