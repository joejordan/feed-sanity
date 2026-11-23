import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { OptionSpec, Options, OptionValue } from '../../core/options';
import type { OptionsPanel } from './panel';
import { OPTIONS_TITLE } from '../../../project';
import { createLogger } from '../../core/log';
import {
  Badge,
  Disclosure,
  getSiteMark,
  SettingCard,
  SettingRow,
  Switch,
  Toast,
  UiIcon,
  useDraggable,
  useToast,
} from '../primitives';
import { useOptionValue } from '../use-option-value';
import { getSectionMeta, orderSections } from './sections';

const log = createLogger('options');
const TOAST_MS = 4000;
const MAX_SEARCH_HITS = 10;
const EMPTY_PANELS: readonly OptionsPanel[] = [];

interface Edit {
  input: boolean | string;
  value: OptionValue | undefined;
}

function toEdit(spec: OptionSpec, input: boolean | string): Edit {
  if (typeof spec.default !== 'number') {
    return { input, value: input };
  }
  const number = typeof input === 'string' && input.trim() !== '' ? Number(input) : Number.NaN;
  return { input, value: Number.isFinite(number) ? number : undefined };
}

interface IndexedSearchHit {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly section: string;
  readonly haystack: string;
  readonly optionKey?: string;
  readonly groupKey?: string;
  readonly onSelect?: () => void;
}

export interface SiteIdentity {
  readonly id: string;
  readonly displayName: string;
}

interface OptionRowProps {
  readonly optionKey: string;
  readonly spec: OptionSpec;
  readonly options: Options;
  readonly edit: Edit | undefined;
  readonly dimmed: boolean;
  readonly pulse: boolean;
  readonly onInstantSave: (key: string, spec: OptionSpec, next: OptionValue) => void;
  readonly onDraftEdit: (key: string, edit: Edit | undefined) => void;
  readonly onCommitDraft: (key: string, spec: OptionSpec, edit: Edit) => void;
}

function OptionRow({
  optionKey,
  spec,
  options,
  edit,
  dimmed,
  pulse,
  onInstantSave,
  onDraftEdit,
  onCommitDraft,
}: OptionRowProps) {
  const id = useId();
  const saved = useOptionValue(options, optionKey);
  const shown = edit ? edit.input : saved;
  const isInvalid = Boolean(edit && edit.value === undefined);
  const isDirty = Boolean(edit && edit.value !== undefined && edit.value !== saved);
  const inputId = `${id}-input`;
  const descId = spec.description ? `${id}-description` : undefined;

  const commitIfValid = (): void => {
    if (edit && edit.value !== undefined && edit.value !== saved) {
      onCommitDraft(optionKey, spec, edit);
    } else if (edit && edit.value === saved) {
      onDraftEdit(optionKey, undefined);
    }
  };

  const handleEditorBlur = (event: {
    currentTarget: HTMLElement;
    relatedTarget: EventTarget | null;
  }): void => {
    const related = event.relatedTarget as Node | null;
    if (related && event.currentTarget.closest('.inline-editor')?.contains(related)) {
      return;
    }
    commitIfValid();
  };

  let field: ReactNode;
  if (spec.choices) {
    field = (
      <select
        id={inputId}
        className="field"
        aria-describedby={descId}
        value={String(saved)}
        onChange={(event) => onInstantSave(optionKey, spec, event.currentTarget.value)}
      >
        {spec.choices.map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    );
  } else if (typeof spec.default === 'boolean') {
    field = (
      <Switch
        id={inputId}
        checked={saved === true}
        {...(descId ? { ariaDescribedBy: descId } : {})}
        onChange={(checked) => onInstantSave(optionKey, spec, checked)}
      />
    );
  } else if (spec.multiline) {
    field = (
      <div className="inline-editor stacked">
        <textarea
          id={inputId}
          className="field"
          rows={5}
          aria-describedby={descId}
          aria-invalid={isInvalid || undefined}
          value={String(shown)}
          onChange={(event) => onDraftEdit(optionKey, toEdit(spec, event.currentTarget.value))}
          onBlur={handleEditorBlur}
        />
        {isDirty && (
          <div className="inline-editor-actions">
            <button
              type="button"
              className="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onDraftEdit(optionKey, undefined)}
            >
              Reset
            </button>
            <button
              type="button"
              className="button primary"
              onMouseDown={(event) => event.preventDefault()}
              onClick={commitIfValid}
            >
              Apply
            </button>
          </div>
        )}
      </div>
    );
  } else {
    field = (
      <div className="inline-editor">
        <input
          id={inputId}
          className="field"
          type={typeof spec.default === 'number' ? 'number' : 'text'}
          aria-describedby={descId}
          aria-invalid={isInvalid || undefined}
          value={String(shown)}
          onChange={(event) => onDraftEdit(optionKey, toEdit(spec, event.currentTarget.value))}
          onBlur={handleEditorBlur}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitIfValid();
            }
          }}
        />
        {isDirty && (
          <button
            type="button"
            className="button primary"
            onMouseDown={(event) => event.preventDefault()}
            onClick={commitIfValid}
          >
            Apply
          </button>
        )}
      </div>
    );
  }

  return (
    <SettingRow
      title={spec.title}
      {...(spec.description ? { description: spec.description } : {})}
      htmlFor={inputId}
      {...(descId ? { descriptionId: descId } : {})}
      stacked={Boolean(spec.multiline)}
      dimmed={dimmed}
      pulse={pulse}
    >
      {field}
    </SettingRow>
  );
}

interface OptionGroupBucket {
  readonly group: string;
  readonly primary: Array<[string, OptionSpec]>;
  readonly advanced: Array<[string, OptionSpec]>;
}

function groupSectionOptions(entries: readonly [string, OptionSpec][]): OptionGroupBucket[] {
  const buckets = new Map<string, OptionGroupBucket>();
  for (const entry of entries) {
    const group = entry[1].group ?? '';
    let bucket = buckets.get(group);
    if (!bucket) {
      bucket = { group, primary: [], advanced: [] };
      buckets.set(group, bucket);
    }
    if (entry[1].advanced) {
      bucket.advanced.push(entry);
    } else {
      bucket.primary.push(entry);
    }
  }
  return [...buckets.values()];
}

export interface OptionsDialogProps {
  options: Options;
  /** Parts of the dialog that features draw themselves. */
  panels?: readonly OptionsPanel[];
  /** Active host site identity shown in the sidebar header. */
  site?: SiteIdentity;
  /** Whether Feed Sanity is currently enabled on `site`. */
  siteEnabled?: boolean;
  /** Optional pause/resume toggle callback for `site`. */
  onToggleSite?: (enabled: boolean) => void;
  /** Optional subscription keeping the header status synced if `site` is toggled in the Sites panel. */
  onSiteEnabledChange?: (listener: (enabled: boolean) => void) => () => void;
  /** Optional initial section to open (e.g. deep-linked from the Toolbar Popup). */
  initialSection?: string;
  /** Registers an imperative section jumper used when `openOptionsDialog` is re-invoked while open. */
  registerSectionJump?: (jump: ((section: string) => void) | undefined) => void;
  /** Called when the user closes the dialog. */
  onClose: () => void;
}

/**
 * Grouped, instant-apply Settings dialog with a 2-scope sidebar (`THIS SITE` /
 * `FEED SANITY`), collapsible advanced disclosures, floating Undo toasts, and
 * unified `⌘K` Command Jump search across every option and panel.
 */
export function OptionsDialog({
  options,
  panels = EMPTY_PANELS,
  site,
  siteEnabled = true,
  onToggleSite,
  onSiteEnabledChange,
  initialSection,
  registerSectionJump,
  onClose,
}: OptionsDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cmdInputRef = useRef<HTMLInputElement>(null);
  const panelsRef = useRef(panels);
  panelsRef.current = panels;
  const drag = useDraggable(dialog);

  const { all, sections, siteSections, manageSections, panelBySection } = useMemo(() => {
    const list = options.list();
    const ordered = orderSections([
      ...list.map(([, spec]) => spec.section),
      ...panels.map((panel) => panel.section),
    ]);
    const bySection = new Map<string, OptionsPanel>();
    for (const panel of panels) {
      if (!bySection.has(panel.section)) {
        bySection.set(panel.section, panel);
      }
    }
    return {
      all: list,
      sections: ordered,
      siteSections: ordered.filter((name) => getSectionMeta(name).group === 'site'),
      manageSections: ordered.filter((name) => getSectionMeta(name).group === 'manage'),
      panelBySection: bySection,
    };
  }, [options, panels]);

  const [section, setSection] = useState(() =>
    initialSection && sections.includes(initialSection) ? initialSection : sections[0],
  );
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdQuery, setCmdQuery] = useState('');
  const [cmdIndex, setCmdIndex] = useState(0);
  const [pulseKey, setPulseKey] = useState<string | null>(null);
  const [openDisclosures, setOpenDisclosures] = useState<ReadonlySet<string>>(new Set());
  const [edits, setEdits] = useState<ReadonlyMap<string, Edit>>(new Map());
  const [panelEdits, setPanelEdits] = useState<ReadonlyMap<OptionsPanel, unknown>>(new Map());
  const [saving, setSaving] = useState(false);
  const [enabledHere, setEnabledHere] = useState(siteEnabled);
  const [, setTick] = useState(0);
  const { toast, notify } = useToast(TOAST_MS);

  const pulseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closedRef = useRef(false);

  const closePanelsOnce = useCallback(() => {
    if (!closedRef.current) {
      closedRef.current = true;
      for (const panel of panelsRef.current) {
        panel.onClose?.();
      }
    }
  }, []);

  const closeDialog = () => {
    closePanelsOnce();
    onClose();
  };

  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) {
      el.showModal();
    }
    return () => {
      if (pulseTimer.current !== undefined) {
        clearTimeout(pulseTimer.current);
      }
      closePanelsOnce();
    };
  }, [closePanelsOnce]);

  useEffect(() => {
    if (!registerSectionJump) {
      return;
    }
    registerSectionJump((nextSection) => {
      if (sections.includes(nextSection)) {
        setCmdOpen(false);
        setSection(nextSection);
      }
    });
    return () => registerSectionJump(undefined);
  }, [registerSectionJump, sections]);

  useEffect(() => {
    if (!onSiteEnabledChange) {
      return;
    }
    return onSiteEnabledChange((next) => setEnabledHere(next));
  }, [onSiteEnabledChange]);

  useEffect(() => {
    if (cmdOpen) {
      cmdInputRef.current?.focus();
    }
  }, [cmdOpen]);

  const openCommandJump = (toggle = false): void => {
    setCmdOpen((open) => (toggle ? !open : true));
    setCmdQuery('');
    setCmdIndex(0);
  };

  // Global dialog keyboard shortcut: ⌘K / Ctrl+K / `/` opens unified Command Jump.
  const handleDialogKeyDown = (event: {
    key: string;
    metaKey: boolean;
    ctrlKey: boolean;
    target: EventTarget | null;
    preventDefault: () => void;
  }): void => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openCommandJump(true);
      return;
    }
    if (event.key === '/' && !cmdOpen) {
      const target = event.target as HTMLElement | null;
      const tag = target?.localName;
      if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') {
        event.preventDefault();
        openCommandJump();
      }
    } else if (event.key === 'Escape' && cmdOpen) {
      event.preventDefault();
      setCmdOpen(false);
    }
  };

  const saveOptionWithUndo = (
    key: string,
    previous: OptionValue,
    next: OptionValue,
    label: string,
  ): void => {
    void options
      .set(key, next)
      .then(() => setTick((t) => t + 1))
      .catch((error: unknown) => log.error('could not save option', error));
    notify(label, () => {
      void options
        .set(key, previous)
        .then(() => setTick((t) => t + 1))
        .catch((error: unknown) => log.error('could not undo option', error));
    });
  };

  const instantSaveOption = (key: string, spec: OptionSpec, next: OptionValue): void => {
    const previous = options.get(key);
    if (previous === next) {
      return;
    }
    // Simple boolean switches are already 1-click reversible, so save silently without toast clutter.
    if (typeof next === 'boolean') {
      void options
        .set(key, next)
        .then(() => setTick((t) => t + 1))
        .catch((error: unknown) => log.error('could not save option', error));
      return;
    }
    let label = `${spec.title} updated`;
    if (spec.choices) {
      const choiceLabel = spec.choices.find((c) => c.value === next)?.label ?? String(next);
      label = `${spec.title}: ${choiceLabel}`;
    }
    saveOptionWithUndo(key, previous, next, label);
  };

  const handleDraftEdit = (key: string, edit: Edit | undefined): void => {
    setEdits((previous) => {
      const next = new Map(previous);
      if (edit === undefined) {
        next.delete(key);
      } else {
        next.set(key, edit);
      }
      return next;
    });
  };

  const commitDraftOption = (key: string, spec: OptionSpec, edit: Edit): void => {
    if (edit.value === undefined) {
      return;
    }
    const previous = options.get(key);
    const nextValue = edit.value;
    handleDraftEdit(key, undefined);
    saveOptionWithUndo(key, previous, nextValue, `${spec.title} saved`);
  };

  const handlePanelChange = (panel: OptionsPanel, nextValue: unknown): void => {
    if (panel.instant) {
      const problem = panel.problem?.(nextValue) ?? null;
      if (!problem) {
        setPanelEdits((previous) => {
          if (!previous.has(panel)) {
            return previous;
          }
          const next = new Map(previous);
          next.delete(panel);
          return next;
        });
        void panel
          .save(nextValue)
          .then(() => setTick((t) => t + 1))
          .catch((error: unknown) => log.error('could not save panel', error));
        return;
      }
    }
    setPanelEdits((previous) => new Map(previous).set(panel, nextValue));
  };

  // Build unified search index lazily only when Command Jump is open.
  const searchIndex = useMemo((): IndexedSearchHit[] => {
    if (!cmdOpen) {
      return [];
    }
    const hits: IndexedSearchHit[] = [];
    for (const [key, spec] of all) {
      hits.push({
        id: `opt:${key}`,
        title: spec.title,
        description: spec.description,
        section: spec.section,
        haystack: [
          spec.title,
          spec.description,
          spec.section,
          spec.group ?? '',
          ...(spec.keywords ?? []),
        ]
          .join('\n')
          .toLowerCase(),
        optionKey: key,
        ...(spec.advanced ? { groupKey: `${spec.section}:${spec.group ?? ''}` } : {}),
      });
    }
    for (const panel of panels) {
      const items = panel.searchItems?.() ?? [];
      for (const item of items) {
        hits.push({
          id: `panel:${panel.section}:${item.id}`,
          title: item.title,
          ...(item.description ? { description: item.description } : {}),
          section: panel.section,
          haystack: [item.title, item.description ?? '', panel.section, ...(item.keywords ?? [])]
            .join('\n')
            .toLowerCase(),
          ...(item.onSelect ? { onSelect: item.onSelect } : {}),
        });
      }
    }
    return hits;
  }, [cmdOpen, all, panels]);

  const searchHits = useMemo(() => {
    if (!cmdOpen) {
      return [];
    }
    const q = cmdQuery.trim().toLowerCase();
    return q ? searchIndex.filter((hit) => hit.haystack.includes(q)) : searchIndex;
  }, [cmdOpen, cmdQuery, searchIndex]);

  const jumpToHit = (hit: IndexedSearchHit): void => {
    setCmdOpen(false);
    setCmdQuery('');
    setSection(hit.section);
    if (hit.groupKey) {
      const targetGroup = hit.groupKey;
      setOpenDisclosures((prev) => new Set(prev).add(targetGroup));
    }
    if (hit.optionKey) {
      setPulseKey(hit.optionKey);
      if (pulseTimer.current !== undefined) {
        clearTimeout(pulseTimer.current);
      }
      pulseTimer.current = setTimeout(() => setPulseKey(null), 1200);
    }
    if (hit.onSelect) {
      hit.onSelect();
      setTick((t) => t + 1);
    }
  };

  const { sectionOptions, sectionGroups } = useMemo(() => {
    const filtered = all.filter(([, spec]) => spec.section === section);
    return { sectionOptions: filtered, sectionGroups: groupSectionOptions(filtered) };
  }, [all, section]);

  const shownPanels = useMemo(
    () => panels.filter((panel) => panel.section === section),
    [panels, section],
  );
  const sectionMeta = section ? getSectionMeta(section) : undefined;

  const invalidOptions =
    edits.size === 0
      ? []
      : all.flatMap(([key, spec]) => {
          const edit = edits.get(key);
          return edit && edit.value === undefined ? [spec.title] : [];
        });
  const problems = [
    ...(invalidOptions.length > 0
      ? [`Not a number, so not saved yet: ${invalidOptions.join(', ')}.`]
      : []),
    ...[...panelEdits].flatMap(([panel, value]) => panel.problem?.(value) ?? []),
  ];
  const hasBufferedChanges = panelEdits.size > 0 || invalidOptions.length > 0;

  const saveBuffered = async (): Promise<void> => {
    setSaving(true);
    try {
      await Promise.all([
        ...[...edits].map(([key, { value }]) =>
          value === undefined ? undefined : options.set(key, value),
        ),
        ...[...panelEdits].map(([panel, value]) => panel.save(value)),
      ]);
      setEdits(new Map());
      setPanelEdits(new Map());
      setTick((t) => t + 1);
      notify('Changes saved');
    } catch (error) {
      log.error('could not save the options', error);
    } finally {
      setSaving(false);
    }
  };

  const discardBuffered = (): void => {
    setEdits(new Map());
    setPanelEdits(new Map());
    for (const panel of panels) {
      panel.onClose?.();
    }
  };

  const toggleDisclosure = (key: string): void => {
    setOpenDisclosures((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const renderSectionNavButton = (name: string) => {
    const meta = getSectionMeta(name);
    const panel = panelBySection.get(name);
    const badgeText = panel?.badge?.() ?? null;
    const swatch = panel?.swatch?.() ?? null;
    return (
      <button
        key={name}
        className="section"
        type="button"
        aria-current={name === section ? 'page' : undefined}
        onClick={() => setSection(name)}
      >
        <span className="section-left">
          <UiIcon name={meta.icon} size={15} />
          <span>{name}</span>
        </span>
        {swatch && (
          <span
            className="section-swatch"
            aria-hidden="true"
            style={{
              background: `linear-gradient(135deg, ${swatch.bg} 50%, ${swatch.accent} 50%)`,
            }}
          />
        )}
        {!swatch && badgeText && (
          <Badge tone={meta.icon === 'shield' ? 'accent' : 'neutral'}>{badgeText}</Badge>
        )}
      </button>
    );
  };

  const renderOptionEntries = (entries: readonly [string, OptionSpec][]) =>
    entries.map(([key, spec]) => {
      const dimmed = Boolean(spec.dependsOn && options.get(spec.dependsOn) === false);
      return (
        <OptionRow
          key={key}
          optionKey={key}
          spec={spec}
          options={options}
          edit={edits.get(key)}
          dimmed={dimmed}
          pulse={pulseKey === key}
          onInstantSave={instantSaveOption}
          onDraftEdit={handleDraftEdit}
          onCommitDraft={commitDraftOption}
        />
      );
    });

  return (
    <dialog
      ref={dialog}
      className="dialog"
      aria-label={OPTIONS_TITLE}
      data-dragging={drag.dragging ? 'true' : undefined}
      data-moved={drag.moved ? 'true' : undefined}
      style={drag.style}
      onKeyDown={handleDialogKeyDown}
      onCancel={(event) => {
        event.preventDefault();
        if (cmdOpen) {
          setCmdOpen(false);
          return;
        }
        closeDialog();
      }}
    >
      <div className="shell">
        <aside className="sidebar">
          <div
            className="site-header drag-handle"
            title="Drag to move · Double-click to center"
            {...drag.handleProps}
          >
            <div className="site-identity">
              <span className="site-mark" aria-hidden="true">
                {site ? getSiteMark(site.id, site.displayName) : 'FS'}
              </span>
              <div className="site-meta">
                <h2 className="site-title">{site ? site.displayName : OPTIONS_TITLE}</h2>
                {site && (
                  <span className="site-status">
                    <span
                      className="site-dot"
                      data-paused={enabledHere ? undefined : 'true'}
                      aria-hidden="true"
                    />
                    {enabledHere ? 'Active on this site' : 'Paused on this site'}
                  </span>
                )}
              </div>
            </div>
            {site && onToggleSite && (
              <Switch
                checked={enabledHere}
                ariaLabel={`Enable Feed Sanity on ${site.displayName}`}
                onChange={(next) => {
                  setEnabledHere(next);
                  onToggleSite(next);
                }}
              />
            )}
          </div>

          <button
            type="button"
            className="search-trigger"
            aria-label="Search options"
            onClick={() => openCommandJump()}
          >
            <span className="search-trigger-left">
              <UiIcon name="search" size={14} />
              <span>Search…</span>
            </span>
            <span className="kbd" aria-hidden="true">
              ⌘K
            </span>
          </button>

          <nav className="sections" aria-label="Sections">
            {siteSections.length > 0 && (
              <div className="nav-group">
                {manageSections.length > 0 && <div className="nav-kicker">This Site</div>}
                {siteSections.map(renderSectionNavButton)}
              </div>
            )}
            {manageSections.length > 0 && (
              <div className="nav-group">
                <div className="nav-kicker">Feed Sanity</div>
                {manageSections.map(renderSectionNavButton)}
              </div>
            )}
          </nav>
        </aside>

        <div className="pane">
          <header
            className="pane-header drag-handle"
            title="Drag to move · Double-click to center"
            {...drag.handleProps}
          >
            <div className="pane-header-title">
              <span className="drag-grip" aria-hidden="true">
                <UiIcon name="grip" size={14} />
              </span>
              <div>
                <h3 className="pane-heading">{section ?? OPTIONS_TITLE}</h3>
                {sectionMeta?.subtitle && <p className="pane-subtitle">{sectionMeta.subtitle}</p>}
              </div>
            </div>
            <button className="close" type="button" aria-label="Close" onClick={closeDialog}>
              <UiIcon name="x" size={16} />
            </button>
          </header>

          <div className="list">
            {sectionOptions.length === 0 && shownPanels.length === 0 && (
              <p className="empty">Nothing to set here yet.</p>
            )}

            {sectionGroups.map((bucket) => {
              const discKey = `${section ?? ''}:${bucket.group}`;
              const isOpen = openDisclosures.has(discKey);
              const advLabel =
                bucket.primary.length === 0 && bucket.group
                  ? bucket.group
                  : `More options (${bucket.advanced.length})`;
              return (
                <SettingCard
                  key={discKey}
                  {...(bucket.primary.length > 0 && bucket.group ? { title: bucket.group } : {})}
                >
                  {renderOptionEntries(bucket.primary)}
                  {bucket.advanced.length > 0 && (
                    <Disclosure
                      label={advLabel}
                      badge={
                        bucket.primary.length === 0 ? (
                          <Badge>{bucket.advanced.length}</Badge>
                        ) : undefined
                      }
                      open={isOpen}
                      onToggle={() => toggleDisclosure(discKey)}
                    >
                      {renderOptionEntries(bucket.advanced)}
                    </Disclosure>
                  )}
                </SettingCard>
              );
            })}

            {shownPanels.map((panel) => {
              const Panel = panel.Panel;
              const value = panelEdits.has(panel) ? panelEdits.get(panel) : panel.read();
              return (
                <Panel
                  key={panel.section}
                  value={value}
                  onChange={(next) => handlePanelChange(panel, next)}
                  notify={notify}
                />
              );
            })}
          </div>

          {hasBufferedChanges && (
            <div className="dirty-bar" role="status">
              <span className={problems.length > 0 ? 'error' : 'dirty-bar-text'}>
                {problems.length > 0 ? problems.join(' ') : 'You have unsaved changes.'}
              </span>
              <div className="dirty-bar-actions">
                <button
                  type="button"
                  className="button"
                  disabled={saving}
                  onClick={discardBuffered}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="button primary"
                  disabled={saving || problems.length > 0}
                  onClick={() => void saveBuffered()}
                >
                  Save
                </button>
              </div>
            </div>
          )}

          {toast && !hasBufferedChanges && (
            <Toast message={toast.message} {...(toast.onUndo ? { onUndo: toast.onUndo } : {})} />
          )}
        </div>
      </div>

      {cmdOpen && (
        <div
          className="cmd-backdrop"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setCmdOpen(false);
            }
          }}
        >
          <div className="cmd-box" role="dialog" aria-label="Search settings">
            <div className="cmd-input-row">
              <UiIcon name="search" size={15} />
              <input
                ref={cmdInputRef}
                className="cmd-input"
                type="search"
                aria-label="Jump to setting"
                placeholder="Search settings, themes, rules, sites, or actions…"
                value={cmdQuery}
                onChange={(event) => {
                  setCmdQuery(event.currentTarget.value);
                  setCmdIndex(0);
                }}
                onKeyDown={(event) => {
                  const max = Math.min(searchHits.length, MAX_SEARCH_HITS);
                  if (event.key === 'ArrowDown' && max > 0) {
                    event.preventDefault();
                    setCmdIndex((i) => (i + 1) % max);
                  } else if (event.key === 'ArrowUp' && max > 0) {
                    event.preventDefault();
                    setCmdIndex((i) => (i - 1 + max) % max);
                  } else if (event.key === 'Enter' && searchHits[cmdIndex]) {
                    event.preventDefault();
                    jumpToHit(searchHits[cmdIndex]);
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    setCmdOpen(false);
                  }
                }}
              />
            </div>
            <div className="cmd-list">
              {searchHits.length === 0 ? (
                <div className="cmd-empty">No options match.</div>
              ) : (
                searchHits.slice(0, MAX_SEARCH_HITS).map((hit, idx) => (
                  <button
                    key={hit.id}
                    type="button"
                    className="cmd-item"
                    data-active={idx === cmdIndex ? 'true' : undefined}
                    onClick={() => jumpToHit(hit)}
                  >
                    <span className="cmd-item-main">
                      <span className="cmd-item-title">{hit.title}</span>
                      {hit.description && <span className="cmd-item-desc">{hit.description}</span>}
                    </span>
                    <Badge>{hit.section}</Badge>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}
