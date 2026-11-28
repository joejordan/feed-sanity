import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type {
  SavedThemeEntry,
  ThemeCapabilities,
  ThemeDocumentV1,
  ThemeLibraryViewMode,
} from '../../core/theming';
import {
  getBackdropDisplayName,
  getClickEffectLabel,
  getSurfaceFinishLabel,
} from '../../core/theme-effects';
import {
  compileRibbonBackground,
  MAX_LIBRARY_THEMES,
  THEME_FILE_EXTENSION,
} from '../../core/theming';
import { Badge, previewLeaveProps, SettingCard, TextInput, UiIcon } from '../primitives';
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
  readonly viewMode?: ThemeLibraryViewMode;
  readonly onViewModeChange?: (mode: ThemeLibraryViewMode) => void;
  readonly onSaveCurrent: (name: string) => void;
  readonly onApplyEntry: (entry: SavedThemeEntry) => void;
  readonly onPreviewEntry?: (entry: SavedThemeEntry | null) => void;
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

export function handleInlineFormKeyDown(
  event: { key: string; preventDefault: () => void; stopPropagation?: () => void },
  onCommit: () => void,
  onCancel: () => void,
): void {
  if (event.key === 'Enter') {
    event.preventDefault();
    onCommit();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation?.();
    onCancel();
  }
}

/**
 * Inline CSS custom properties that paint a saved theme's own palette and edge ribbon onto its
 * preview stage. Site-default themes (`palette: null`) keep the stylesheet's `--fs-*` defaults.
 */
function themeStageVars(doc: ThemeDocumentV1): Record<string, string> {
  const vars: Record<string, string> = {};
  const palette = doc.palette;
  if (palette) {
    vars['--stage-bg'] = palette.background;
    vars['--stage-surface'] = palette.surface;
    vars['--stage-surface-alt'] = palette.surfaceAlt;
    vars['--stage-text'] = palette.text;
    vars['--stage-muted'] = palette.textMuted;
    vars['--stage-border'] = palette.border;
    vars['--stage-accent'] = palette.accent;
    vars['--stage-accent-2'] = palette.accentSecondary ?? palette.danger;
  }
  const ribbon = compileRibbonBackground(doc.chrome?.ribbon);
  if (ribbon) {
    vars['--stage-ribbon'] = ribbon;
  }
  return vars;
}

interface ThemeStageProps {
  readonly doc: ThemeDocumentV1;
  readonly size?: 'card' | 'thumb';
  readonly tag?: string | null;
  readonly isActive?: boolean;
}

/** Decorative mini mock-up of a theme: canvas wash, accent glow, ribbon, and a tiny post card. */
function ThemeStage({ doc, size = 'card', tag = null, isActive = false }: ThemeStageProps) {
  const vars = useMemo(() => themeStageVars(doc), [doc]);
  return (
    <span className="theme-library-stage" aria-hidden="true" data-size={size} style={vars}>
      {vars['--stage-ribbon'] && (
        <span
          className="theme-library-stage-ribbon"
          data-position={doc.chrome?.ribbon?.position ?? 'top'}
        />
      )}
      <span className="theme-library-stage-mock">
        <span className="theme-library-stage-avatar" />
        <span className="theme-library-stage-lines">
          <span />
          <span />
        </span>
        {size === 'card' && <span className="theme-library-stage-cta" />}
      </span>
      {tag && <span className="theme-library-stage-tag">{tag}</span>}
      {isActive && (
        <span className="theme-library-stage-check">
          <UiIcon name="check" size={11} />
        </span>
      )}
    </span>
  );
}

interface SavedThemeItemProps {
  readonly item: AnalyzedLibraryEntry;
  readonly viewMode: ThemeLibraryViewMode;
  readonly isActive: boolean;
  readonly isRenaming: boolean;
  readonly registerSelectButton: (id: string, el: HTMLButtonElement | null) => void;
  readonly onStartRename: () => void;
  readonly onCommitRename: (nextName: string) => void;
  readonly onCancelRename: () => void;
  readonly onApply: () => void;
  readonly onPreview: () => void;
  readonly onExport: () => void;
  readonly onDelete: () => void;
}

function libraryTrustLabel(trust: Exclude<ThemeCapabilities['trust'], 'data-only'>): string {
  switch (trust) {
    case 'custom-css':
      return 'Custom CSS';
    case 'custom-shader':
      return 'Custom shader';
    case 'custom-css-and-shader':
      return 'CSS + shader';
  }
}

/** Human-friendly live background name for the stage pill (never a raw engine slug). */
function libraryBackdropLabel(caps: ThemeCapabilities): string | null {
  // Custom shaders are already named by the trust badge; skip the duplicate "GPU Shader" pill.
  if (caps.hasCustomShader) {
    return null;
  }
  const name = caps.backdropEngine ? getBackdropDisplayName(caps.backdropEngine) : undefined;
  if (!name) {
    return null;
  }
  if (!caps.hasCustomScene) {
    return name;
  }
  const layers = caps.sceneLayerCount;
  return `${name} · ${layers} ${layers === 1 ? 'layer' : 'layers'}`;
}

function libraryColorSchemeLabel(caps: ThemeCapabilities): string {
  if (caps.colorScheme === 'dark') {
    return 'Dark';
  }
  return caps.colorScheme === 'light' ? 'Light' : 'Site colors';
}

/** Concise "Dark · Glass · Sparks" trait summary built from the theme's capabilities. */
function libraryTraits(caps: ThemeCapabilities): string {
  const surface = caps.surfaceFinish && getSurfaceFinishLabel(caps.surfaceFinish);
  const click = caps.clickEffect && getClickEffectLabel(caps.clickEffect);
  return [libraryColorSchemeLabel(caps), surface, click].filter(Boolean).join(' · ');
}

interface InlineNameFormProps {
  readonly className: string;
  readonly ariaLabel: string;
  readonly initialValue: string;
  readonly placeholder?: string;
  readonly onCommit: (trimmedValue: string) => void;
  readonly onCancel: () => void;
}

/** Name input + Save/Cancel that focuses and selects its text on open (Enter saves, Esc cancels). */
function InlineNameForm({
  className,
  ariaLabel,
  initialValue,
  placeholder,
  onCommit,
  onCancel,
}: InlineNameFormProps) {
  const [draft, setDraft] = useState(initialValue);
  const submit = (): void => {
    const trimmed = draft.trim();
    if (trimmed) {
      onCommit(trimmed);
    }
  };
  return (
    <div className={className}>
      <TextInput
        className="field theme-library-name-input"
        ariaLabel={ariaLabel}
        {...(placeholder ? { placeholder } : {})}
        value={draft}
        selectOnMount
        onValueChange={setDraft}
        onKeyDown={(event) => handleInlineFormKeyDown(event, submit, onCancel)}
      />
      <div className="theme-library-form-buttons">
        <button type="button" className="button primary" disabled={!draft.trim()} onClick={submit}>
          Save
        </button>
        <button type="button" className="button theme-library-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function SavedThemeItem({
  item,
  viewMode,
  isActive,
  isRenaming,
  registerSelectButton,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onApply,
  onPreview,
  onExport,
  onDelete,
}: SavedThemeItemProps) {
  const { entry, capabilities, swatches } = item;
  const selectButtonRef = useCallback(
    (el: HTMLButtonElement | null) => registerSelectButton(entry.id, el),
    [registerSelectButton, entry.id],
  );
  const name = entry.document.meta.name;
  const isCompact = viewMode === 'list';
  const backdropLabel = isCompact ? null : libraryBackdropLabel(capabilities);
  const stage = (
    <ThemeStage
      doc={entry.document}
      size={isCompact ? 'thumb' : 'card'}
      tag={backdropLabel}
      isActive={isActive}
    />
  );
  const iconActions = [
    { icon: 'pencil', verb: 'Rename', title: 'Rename', onClick: onStartRename },
    {
      icon: 'download',
      verb: 'Export',
      title: `Export ${THEME_FILE_EXTENSION}`,
      onClick: onExport,
    },
    { icon: 'trash', verb: 'Delete', title: 'Delete', onClick: onDelete },
  ] as const;

  return (
    <div
      className="theme-library-card"
      data-fs-jump-id={`saved-theme:${entry.id}`}
      data-view={viewMode}
      data-active={isActive ? 'true' : undefined}
      data-renaming={isRenaming ? 'true' : undefined}
    >
      {isRenaming ? (
        <>
          {stage}
          <InlineNameForm
            className={isCompact ? 'theme-library-inline-form' : 'theme-library-rename'}
            ariaLabel="Rename saved theme"
            initialValue={name}
            onCommit={onCommitRename}
            onCancel={onCancelRename}
          />
        </>
      ) : (
        <>
          <button
            ref={selectButtonRef}
            type="button"
            className="theme-library-select"
            aria-pressed={isActive}
            onMouseEnter={onPreview}
            onFocus={onPreview}
            onClick={onApply}
          >
            {stage}
            <span className="theme-library-body">
              <span className="theme-card-name theme-library-name" title={name}>
                {name}
              </span>
              <span className="theme-library-meta">
                <ThemeSwatches swatches={swatches} />
                <span className="theme-library-traits">{libraryTraits(capabilities)}</span>
                {capabilities.trust === 'data-only' ? (
                  <span
                    className="theme-library-verified"
                    title="Verified: colors and effects only"
                  >
                    <UiIcon name="shield" size={12} />
                    <span className="fs-sr-only">Verified</span>
                  </span>
                ) : (
                  <Badge tone="warning">{libraryTrustLabel(capabilities.trust)}</Badge>
                )}
              </span>
            </span>
          </button>
          <div className="theme-library-card-actions">
            <span className="theme-library-icon-actions">
              {iconActions.map((action) => (
                <button
                  key={action.verb}
                  type="button"
                  className="theme-library-icon-button"
                  data-tone={action.icon === 'trash' ? 'danger' : undefined}
                  aria-label={`${action.verb} ${name}`}
                  title={action.title}
                  onClick={action.onClick}
                >
                  <UiIcon name={action.icon} size={13} />
                </button>
              ))}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

const VIEW_MODES = [
  { mode: 'cards', icon: 'layoutGrid', label: 'Card view' },
  { mode: 'list', icon: 'list', label: 'Compact list view' },
] as const;

interface DeleteThemeConfirmDialogProps {
  readonly item: AnalyzedLibraryEntry;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

function DeleteThemeConfirmDialog({ item, onCancel, onConfirm }: DeleteThemeConfirmDialogProps) {
  const titleId = useId();
  const descId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const pointerDownOnBackdropRef = useRef(false);
  const confirmedRef = useRef(false);
  const name = item.entry.document.meta.name;

  useEffect(() => {
    const el = dialogRef.current;
    const root = el?.getRootNode();
    const prevFocus =
      root && 'activeElement' in root ? (root.activeElement as HTMLElement | null) : null;
    if (el && !el.open && typeof el.showModal === 'function') {
      el.showModal();
    }
    cancelRef.current?.focus();
    return () => {
      if (el?.open && typeof el.close === 'function') {
        el.close();
      }
      // Restore focus to the trigger only on cancel; confirmed deletes hand focus to the neighbor item.
      if (!confirmedRef.current && prevFocus?.isConnected) {
        prevFocus.focus();
      }
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="theme-confirm-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      onPointerDown={(event) => {
        pointerDownOnBackdropRef.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (pointerDownOnBackdropRef.current && event.target === event.currentTarget) {
          onCancel();
        }
        pointerDownOnBackdropRef.current = false;
      }}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
          return;
        }
        if (event.key === 'Tab') {
          event.preventDefault();
          const root = dialogRef.current?.getRootNode();
          const active = root && 'activeElement' in root ? root.activeElement : null;
          const next = active === cancelRef.current ? confirmRef.current : cancelRef.current;
          next?.focus();
          return;
        }
        // Keep OptionsDialog shortcuts (`/` and `Cmd/Ctrl+K`) from opening Command Jump underneath.
        if (
          event.key === '/' ||
          ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k')
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <div className="theme-confirm-box">
        <div className="theme-confirm-head">
          <ThemeStage doc={item.entry.document} size="thumb" />
          <div className="theme-confirm-copy">
            <h4 id={titleId} className="theme-confirm-title">
              Delete "{name}"?
            </h4>
            <p id={descId} className="theme-confirm-desc">
              Remove this saved theme from My Themes. You can still undo right after deleting.
            </p>
          </div>
        </div>
        <div className="theme-confirm-actions">
          <button ref={cancelRef} type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="button theme-confirm-danger"
            onClick={() => {
              confirmedRef.current = true;
              onConfirm();
            }}
          >
            Delete theme
          </button>
        </div>
      </div>
    </dialog>
  );
}

export function ThemeLibraryCard({
  items,
  activeDocument,
  activeFingerprint,
  viewMode: controlledViewMode,
  onViewModeChange,
  onSaveCurrent,
  onApplyEntry,
  onPreviewEntry,
  onRenameEntry,
  onDeleteEntry,
  onExportEntry,
}: ThemeLibraryCardProps) {
  const [localViewMode, setLocalViewMode] = useState<ThemeLibraryViewMode>('cards');
  const viewMode = controlledViewMode ?? localViewMode;
  const setViewMode = (next: ThemeLibraryViewMode): void => {
    setLocalViewMode(next);
    onViewModeChange?.(next);
  };
  const [saveForm, setSaveForm] = useState<{
    readonly key: number;
    readonly initialValue: string;
  } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const selectButtonsRef = useRef<Map<string, HTMLButtonElement>>(new Map());
  const pendingFocusAfterDeleteRef = useRef<{
    readonly deletedId: string;
    readonly fallbackId: string | null;
  } | null>(null);
  const activeRenamingId =
    renamingId !== null && items.some((item) => item.entry.id === renamingId) ? renamingId : null;
  const deletingItem =
    deletingId === null ? null : (items.find((item) => item.entry.id === deletingId) ?? null);

  useEffect(() => {
    const pending = pendingFocusAfterDeleteRef.current;
    if (!pending || items.some((item) => item.entry.id === pending.deletedId)) {
      return;
    }
    pendingFocusAfterDeleteRef.current = null;
    const neighborBtn = pending.fallbackId
      ? selectButtonsRef.current.get(pending.fallbackId)
      : undefined;
    if (neighborBtn?.isConnected) {
      neighborBtn.focus();
    } else if (saveButtonRef.current?.isConnected) {
      saveButtonRef.current.focus();
    }
  }, [items]);

  useEffect(() => {
    if (renamingId !== null && activeRenamingId === null) {
      setRenamingId(null);
    }
  }, [renamingId, activeRenamingId]);

  useEffect(() => {
    if (deletingId !== null && deletingItem === null) {
      setDeletingId(null);
    }
  }, [deletingId, deletingItem]);

  const registerSelectButton = useCallback((id: string, el: HTMLButtonElement | null) => {
    if (el) {
      selectButtonsRef.current.set(id, el);
    } else {
      selectButtonsRef.current.delete(id);
    }
  }, []);

  const openSaveForm = (): void => {
    setSaveForm((prev) => ({
      key: (prev?.key ?? 0) + 1,
      initialValue: suggestSaveName(activeDocument, items),
    }));
  };

  const commitSave = (trimmed: string): void => {
    onSaveCurrent(trimmed);
    setSaveForm(null);
  };

  const commitRename = (entryId: string, trimmed: string): void => {
    onRenameEntry(entryId, trimmed);
    setRenamingId(null);
  };

  const isLibraryFull = items.length >= MAX_LIBRARY_THEMES;

  return (
    <SettingCard
      title="My Themes"
      jumpId="theme-library"
      action={
        <div className="theme-library-header-actions">
          {items.length > 0 && <Badge tone="neutral">{items.length}</Badge>}
          <button
            ref={saveButtonRef}
            type="button"
            className="theme-inline-reset"
            disabled={isLibraryFull}
            onClick={openSaveForm}
          >
            Save current
          </button>
          {items.length > 0 && (
            <div className="theme-library-view-toggle" role="group" aria-label="Theme layout">
              <span className="theme-library-view-thumb" aria-hidden="true" data-mode={viewMode} />
              {VIEW_MODES.map((option) => (
                <button
                  key={option.mode}
                  type="button"
                  className="theme-library-view-btn"
                  aria-label={option.label}
                  aria-pressed={viewMode === option.mode}
                  title={option.label}
                  onClick={() => setViewMode(option.mode)}
                >
                  <UiIcon name={option.icon} size={13} />
                </button>
              ))}
            </div>
          )}
        </div>
      }
    >
      <div className="theme-studio-pad">
        {saveForm && (
          <div className="theme-library-save" role="group" aria-label="Save current theme">
            <ThemeStage doc={activeDocument} size="thumb" />
            <InlineNameForm
              key={saveForm.key}
              className="theme-library-inline-form"
              ariaLabel="Saved theme name"
              placeholder="e.g. Midnight Rain"
              initialValue={saveForm.initialValue}
              onCommit={commitSave}
              onCancel={() => setSaveForm(null)}
            />
          </div>
        )}

        {items.length === 0 ? (
          <p className="theme-studio-intro">
            Save customized themes or imported <code>{THEME_FILE_EXTENSION}</code> files here to
            switch in one click.
          </p>
        ) : (
          <div
            className="theme-library-grid"
            data-view={viewMode}
            role="group"
            aria-label="Saved themes"
            {...previewLeaveProps(() => onPreviewEntry?.(null))}
          >
            {items.map((item) => (
              <SavedThemeItem
                key={item.entry.id}
                item={item}
                viewMode={viewMode}
                isActive={item.capabilities.fingerprint === activeFingerprint}
                isRenaming={activeRenamingId === item.entry.id}
                registerSelectButton={registerSelectButton}
                onStartRename={() => {
                  onPreviewEntry?.(null);
                  setRenamingId(item.entry.id);
                }}
                onCommitRename={(nextName) => commitRename(item.entry.id, nextName)}
                onCancelRename={() => setRenamingId(null)}
                onApply={() => onApplyEntry(item.entry)}
                onPreview={() => {
                  if (activeRenamingId === null && deletingId === null) {
                    onPreviewEntry?.(item.entry);
                  }
                }}
                onExport={() => {
                  const filename = downloadThemeDocumentFile(item.entry.document);
                  onExportEntry?.(item.entry, filename);
                }}
                onDelete={() => {
                  onPreviewEntry?.(null);
                  setDeletingId(item.entry.id);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {deletingItem && (
        <DeleteThemeConfirmDialog
          item={deletingItem}
          onCancel={() => setDeletingId(null)}
          onConfirm={() => {
            const target = deletingItem.entry;
            const idx = items.findIndex((item) => item.entry.id === target.id);
            const fallbackEntry = items[idx + 1] ?? items[idx - 1];
            pendingFocusAfterDeleteRef.current = {
              deletedId: target.id,
              fallbackId: fallbackEntry?.entry.id ?? null,
            };
            setDeletingId(null);
            onDeleteEntry(target);
          }}
        />
      )}
    </SettingCard>
  );
}
