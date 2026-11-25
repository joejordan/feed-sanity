import { useState } from 'react';
import type { SavedThemeEntry, ThemeCapabilities, ThemeDocumentV1 } from '../../core/theming';
import { MAX_LIBRARY_THEMES } from '../../core/theming';
import { Badge, previewLeaveProps, SettingCard, TextInput } from '../primitives';
import { downloadThemeDocumentFile, ThemeSwatches } from './theme-transfer';

export interface AnalyzedLibraryEntry {
  readonly entry: SavedThemeEntry;
  readonly capabilities: ThemeCapabilities;
  readonly swatches: readonly string[];
}

export interface ThemeLibraryCardProps {
  readonly items: readonly AnalyzedLibraryEntry[];
  readonly activeDocument: ThemeDocumentV1;
  readonly activeFingerprint: string;
  readonly onSaveCurrent: (name: string) => void;
  readonly onApplyEntry: (entry: SavedThemeEntry) => void;
  readonly onPreviewEntry?: (entry: SavedThemeEntry | null) => void;
  readonly onApplyAllSites: (doc: ThemeDocumentV1) => void;
  readonly onRenameEntry: (entryId: string, nextName: string) => void;
  readonly onDeleteEntry: (entry: SavedThemeEntry) => void;
  readonly onExportEntry?: (entry: SavedThemeEntry, filename: string) => void;
}

function suggestSaveName(doc: ThemeDocumentV1, items: readonly AnalyzedLibraryEntry[]): string {
  const base = doc.meta.name.trim() || 'Custom Theme';
  const existingNames = new Set(items.map((item) => item.entry.document.meta.name.toLowerCase()));
  if (!existingNames.has(base.toLowerCase())) {
    return base;
  }
  for (let idx = 2; ; idx++) {
    const candidate = `${base} ${idx}`;
    if (!existingNames.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
}

function handleInlineFormKeyDown(
  event: { key: string; preventDefault: () => void },
  onCommit: () => void,
  onCancel: () => void,
): void {
  if (event.key === 'Enter') {
    event.preventDefault();
    onCommit();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    onCancel();
  }
}

interface SavedThemeItemProps {
  readonly item: AnalyzedLibraryEntry;
  readonly isActive: boolean;
  readonly isRenaming: boolean;
  readonly renameDraft: string;
  readonly onRenameDraftChange: (value: string) => void;
  readonly onStartRename: () => void;
  readonly onCommitRename: () => void;
  readonly onCancelRename: () => void;
  readonly onApply: () => void;
  readonly onPreview: () => void;
  readonly onApplyAllSites: () => void;
  readonly onExport: () => void;
  readonly onDelete: () => void;
}

function libraryTrustLabel(trust: ThemeCapabilities['trust']): string {
  switch (trust) {
    case 'data-only':
      return 'Verified';
    case 'custom-css':
      return 'Custom CSS';
    case 'custom-shader':
      return 'GPU Shader';
    case 'custom-css-and-shader':
      return 'CSS + Shader';
  }
}

function libraryBackdropLabel(caps: ThemeCapabilities): string | null {
  if (caps.hasCustomScene) {
    return `Scene · ${caps.sceneLayerCount}L`;
  }
  if (caps.hasCustomShader) {
    return 'GPU Shader';
  }
  return caps.backdropEngine;
}

function SavedThemeItem({
  item,
  isActive,
  isRenaming,
  renameDraft,
  onRenameDraftChange,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onApply,
  onPreview,
  onApplyAllSites,
  onExport,
  onDelete,
}: SavedThemeItemProps) {
  const { entry, capabilities, swatches } = item;
  const name = entry.document.meta.name;
  const backdropLabel = libraryBackdropLabel(capabilities);

  return (
    <div className="theme-library-card" data-active={isActive ? 'true' : undefined}>
      {isRenaming ? (
        <div className="theme-library-rename">
          <TextInput
            className="field"
            ariaLabel="Rename saved theme"
            value={renameDraft}
            onValueChange={onRenameDraftChange}
            onKeyDown={(event) => handleInlineFormKeyDown(event, onCommitRename, onCancelRename)}
          />
          <div className="theme-transfer-actions">
            <button
              type="button"
              className="button primary"
              disabled={!renameDraft.trim()}
              onClick={onCommitRename}
            >
              Save
            </button>
            <button type="button" className="button" onClick={onCancelRename}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <button
            type="button"
            className="theme-library-select"
            aria-pressed={isActive}
            onMouseEnter={onPreview}
            onFocus={onPreview}
            onClick={onApply}
          >
            <ThemeSwatches swatches={swatches} />
            <span className="theme-card-name">{name}</span>
            <span className="theme-transfer-pills">
              <Badge tone={capabilities.trust === 'data-only' ? 'accent' : 'warning'}>
                {libraryTrustLabel(capabilities.trust)}
              </Badge>
              {backdropLabel && <Badge tone="neutral">{backdropLabel}</Badge>}
            </span>
          </button>
          <div className="theme-library-card-actions">
            <button
              type="button"
              className="theme-inline-reset"
              aria-label={`Apply ${name} to all sites`}
              onClick={onApplyAllSites}
            >
              All sites
            </button>
            <button
              type="button"
              className="theme-inline-reset"
              aria-label={`Rename ${name}`}
              onClick={onStartRename}
            >
              Rename
            </button>
            <button
              type="button"
              className="theme-inline-reset"
              aria-label={`Export ${name}`}
              onClick={onExport}
            >
              Export
            </button>
            <button
              type="button"
              className="theme-inline-reset"
              aria-label={`Delete ${name}`}
              onClick={onDelete}
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function ThemeLibraryCard({
  items,
  activeDocument,
  activeFingerprint,
  onSaveCurrent,
  onApplyEntry,
  onPreviewEntry,
  onApplyAllSites,
  onRenameEntry,
  onDeleteEntry,
  onExportEntry,
}: ThemeLibraryCardProps) {
  const [savingOpen, setSavingOpen] = useState(false);
  const [saveNameDraft, setSaveNameDraft] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const openSaveForm = (): void => {
    setSaveNameDraft(suggestSaveName(activeDocument, items));
    setSavingOpen(true);
  };

  const commitSave = (): void => {
    const trimmed = saveNameDraft.trim();
    if (!trimmed) {
      return;
    }
    onSaveCurrent(trimmed);
    setSavingOpen(false);
    setSaveNameDraft('');
  };

  const commitRename = (entryId: string): void => {
    const trimmed = renameDraft.trim();
    if (!trimmed) {
      return;
    }
    onRenameEntry(entryId, trimmed);
    setRenamingId(null);
    setRenameDraft('');
  };

  const isLibraryFull = items.length >= MAX_LIBRARY_THEMES;

  return (
    <SettingCard
      title="My Themes"
      action={
        <div className="theme-library-header-actions">
          {items.length > 0 && <Badge tone="neutral">{items.length}</Badge>}
          <button
            type="button"
            className="theme-inline-reset"
            onClick={() => onApplyAllSites(activeDocument)}
          >
            Apply to all sites
          </button>
          <button
            type="button"
            className="theme-inline-reset"
            disabled={isLibraryFull}
            onClick={openSaveForm}
          >
            Save current
          </button>
        </div>
      }
    >
      <div className="theme-studio-pad">
        {savingOpen && (
          <div className="theme-library-inline-form" role="group" aria-label="Save current theme">
            <TextInput
              className="field theme-library-name-input"
              ariaLabel="Saved theme name"
              placeholder="e.g. Midnight Rain"
              value={saveNameDraft}
              onValueChange={setSaveNameDraft}
              onKeyDown={(event) =>
                handleInlineFormKeyDown(event, commitSave, () => setSavingOpen(false))
              }
            />
            <button
              type="button"
              className="button primary"
              disabled={!saveNameDraft.trim()}
              onClick={commitSave}
            >
              Save
            </button>
            <button type="button" className="button" onClick={() => setSavingOpen(false)}>
              Cancel
            </button>
          </div>
        )}

        {items.length === 0 ? (
          <p className="theme-studio-intro">
            Save customized themes or imported <code>.fstheme.json</code> files here to switch in
            one click or apply across every site.
          </p>
        ) : (
          <div
            className="theme-grid"
            role="group"
            aria-label="Saved themes"
            {...previewLeaveProps(() => onPreviewEntry?.(null))}
          >
            {items.map((item) => (
              <SavedThemeItem
                key={item.entry.id}
                item={item}
                isActive={item.capabilities.fingerprint === activeFingerprint}
                isRenaming={renamingId === item.entry.id}
                renameDraft={renameDraft}
                onRenameDraftChange={setRenameDraft}
                onStartRename={() => {
                  onPreviewEntry?.(null);
                  setRenamingId(item.entry.id);
                  setRenameDraft(item.entry.document.meta.name);
                }}
                onCommitRename={() => commitRename(item.entry.id)}
                onCancelRename={() => setRenamingId(null)}
                onApply={() => onApplyEntry(item.entry)}
                onPreview={() => {
                  if (renamingId === null) {
                    onPreviewEntry?.(item.entry);
                  }
                }}
                onApplyAllSites={() => onApplyAllSites(item.entry.document)}
                onExport={() => {
                  const filename = downloadThemeDocumentFile(item.entry.document);
                  onExportEntry?.(item.entry, filename);
                }}
                onDelete={() => {
                  onPreviewEntry?.(null);
                  onDeleteEntry(item.entry);
                }}
              />
            ))}
          </div>
        )}
      </div>
    </SettingCard>
  );
}
