import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OptionSpec, Options, OptionValue } from '../../core/options';
import type { IndexedSearchHit } from './command-jump';
import type { Edit } from './option-row';
import type { OptionsPanel } from './panel';
import type { SiteSwitcherConfig } from './site-switcher';
import { NAME, OPTIONS_TITLE, WEBSITE_URL } from '../../../project';
import { createLogger } from '../../core/log';
import {
  Badge,
  BrandMark,
  BrandWordmark,
  Disclosure,
  getSiteMark,
  SettingCard,
  Switch,
  scrollIntoViewCentered,
  Toast,
  UiIcon,
  useDraggable,
  useToast,
} from '../primitives';
import { watchOptionChanges } from '../use-option-value';
import { CommandJumpOverlay } from './command-jump';
import { groupSectionOptions, OptionRow } from './option-row';
import { getSectionMeta, orderSections } from './sections';
import { SiteSwitcherCard } from './site-switcher';

export type { SiteSwitcherConfig } from './site-switcher';

const log = createLogger('options');
const TOAST_MS = 4000;
const EMPTY_PANELS: readonly OptionsPanel[] = [];

const IS_APPLE_PLATFORM =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
const SEARCH_SHORTCUT_LABEL = IS_APPLE_PLATFORM ? '⌘K' : 'Ctrl K';

export interface SiteIdentity {
  readonly id: string;
  readonly displayName: string;
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
  onToggleSite?: (enabled: boolean) => void | Promise<void>;
  /** Optional subscription keeping the header status synced if `site` is toggled in the Sites panel. */
  onSiteEnabledChange?: (listener: (enabled: boolean) => void) => () => void;
  /** Optional rich site switcher turning the top-left site card into a dropdown menu (standalone mode). */
  siteSwitcher?: SiteSwitcherConfig;
  /** Full-viewport standalone window layout (disables modal backdrop, dragging, and Escape close). */
  standalone?: boolean;
  /** Optional initial section to open (e.g. deep-linked from the Toolbar Popup). */
  initialSection?: string;
  /** Notified whenever the active section changes. */
  onSectionChange?: (section: string) => void;
  /** Registers an imperative section jumper used when `openOptionsDialog` is re-invoked while open. */
  registerSectionJump?: (jump: ((section: string) => void) | undefined) => void;
  /** Called when the user closes the dialog (unused in standalone mode). */
  onClose?: () => void;
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
  siteSwitcher,
  standalone = false,
  initialSection,
  onSectionChange,
  registerSectionJump,
  onClose,
}: OptionsDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const panelsRef = useRef(panels);
  panelsRef.current = panels;
  const drag = useDraggable(dialog);

  const { all, specByKey, dependencyKeys, sections, siteSections, manageSections, panelBySection } =
    useMemo(() => {
      const list = options.list();
      const byKey = new Map<string, OptionSpec>(list);
      const depKeys = [
        ...new Set(list.flatMap(([, spec]) => (spec.dependsOn ? [spec.dependsOn] : []))),
      ];
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
        specByKey: byKey,
        dependencyKeys: depKeys,
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
  const [panelJumpTarget, setPanelJumpTarget] = useState<{
    readonly seq: number;
    readonly jumpId: string;
  } | null>(null);
  const [openDisclosures, setOpenDisclosures] = useState<ReadonlySet<string>>(new Set());
  const [edits, setEdits] = useState<ReadonlyMap<string, Edit>>(new Map());
  const [panelEdits, setPanelEdits] = useState<ReadonlyMap<OptionsPanel, unknown>>(new Map());
  const [saving, setSaving] = useState(false);
  const [enabledHere, setEnabledHere] = useState(siteEnabled);
  const [togglingSite, setTogglingSite] = useState<'enabling' | 'disabling' | null>(null);
  const [, setTick] = useState(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const { toast, notify } = useToast(TOAST_MS);

  // Re-render dependent option rows immediately when a parent toggle changes externally
  // (e.g. from the toolbar Quick Popup or another tab).
  useEffect(() => {
    if (dependencyKeys.length === 0) {
      return;
    }
    return watchOptionChanges(options, dependencyKeys, () => setTick((t) => t + 1));
  }, [options, dependencyKeys]);

  const clearPanelEdit = useCallback((panel: OptionsPanel): void => {
    setPanelEdits((previous) => {
      if (!previous.has(panel)) {
        return previous;
      }
      const next = new Map(previous);
      next.delete(panel);
      return next;
    });
  }, []);

  // Keep custom panels (Appearance, Filtering, etc.) and sidebar swatches/badges synced
  // immediately when storage changes externally (e.g. toggling light/dark or Quick Mute in popup).
  useEffect(() => {
    const stops: Array<() => void> = [];
    for (const panel of panels) {
      if (!panel.subscribe) {
        continue;
      }
      stops.push(
        panel.subscribe(() => {
          if (panel.instant) {
            clearPanelEdit(panel);
          }
          setTick((t) => t + 1);
        }),
      );
    }
    if (stops.length === 0) {
      return;
    }
    return () => {
      for (const stop of stops) {
        stop();
      }
    };
  }, [panels, clearPanelEdit]);

  const pulseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const listRef = useRef<HTMLDivElement>(null);
  const closedRef = useRef(false);
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const sectionButtonsRef = useRef<Map<string, HTMLButtonElement>>(new Map());
  const pillInitializedRef = useRef(false);
  const visualTargetRef = useRef<string | undefined>(undefined);
  const lastPillHeightRef = useRef(0);
  const pointerTargetRef = useRef<string | null>(null);
  const activeSectionRef = useRef(section);
  activeSectionRef.current = section;

  const syncVisualHighlight = useCallback(
    (targetName: string | undefined, animate: boolean): boolean => {
      const pill = pillRef.current;
      const nav = navRef.current;
      const targetBtn = targetName ? sectionButtonsRef.current.get(targetName) : undefined;
      // Read geometry BEFORE mutating button attributes/styles to avoid forced synchronous reflow.
      const offsetTop = targetBtn?.offsetTop ?? 0;
      const offsetHeight = targetBtn?.offsetHeight ?? 0;

      for (const [name, btn] of sectionButtonsRef.current) {
        if (name === targetName) {
          btn.dataset.visualActive = 'true';
        } else {
          btn.removeAttribute('data-visual-active');
        }
      }
      visualTargetRef.current = targetName;

      if (!pill || !nav || !targetBtn || offsetHeight <= 0) {
        return false;
      }
      pill.dataset.animate = animate ? 'true' : 'false';
      pill.style.transform = `translate3d(0, ${offsetTop}px, 0)`;
      if (lastPillHeightRef.current !== offsetHeight) {
        lastPillHeightRef.current = offsetHeight;
        pill.style.height = `${offsetHeight}px`;
      }
      pill.dataset.ready = 'true';
      nav.dataset.pillReady = 'true';
      return true;
    },
    [],
  );

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
    onClose?.();
  };

  // Open the modal dialog before measuring the sidebar pill so `.dialog:not([open])` is visible.
  useEffect(() => {
    if (!standalone) {
      const el = dialog.current;
      if (el && !el.open) {
        el.showModal();
      }
    }
    return () => {
      if (pulseTimer.current !== undefined) {
        clearTimeout(pulseTimer.current);
      }
      closePanelsOnce();
    };
  }, [closePanelsOnce, standalone]);

  const onSectionChangeRef = useRef(onSectionChange);
  onSectionChangeRef.current = onSectionChange;
  useEffect(() => {
    if (section) {
      onSectionChangeRef.current?.(section);
    }
  }, [section]);

  useEffect(() => {
    pointerTargetRef.current = null;
    if (pillInitializedRef.current && visualTargetRef.current === section) {
      return;
    }
    if (syncVisualHighlight(section, pillInitializedRef.current)) {
      pillInitializedRef.current = true;
    }
  }, [section, syncVisualHighlight]);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) {
      return;
    }
    const resync = (): void => {
      if (syncVisualHighlight(pointerTargetRef.current ?? activeSectionRef.current, false)) {
        pillInitializedRef.current = true;
      }
    };
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(resync);
      observer.observe(nav);
      return () => observer.disconnect();
    }
    globalThis.addEventListener('resize', resync, { passive: true });
    return () => globalThis.removeEventListener('resize', resync);
  }, [syncVisualHighlight]);

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
    return onSiteEnabledChange((next) => {
      setEnabledHere(next);
      setTick((t) => t + 1);
    });
  }, [onSiteEnabledChange]);

  // Scroll panel-contributed Command Jump targets into view once the target section & disclosures lay out.
  useEffect(() => {
    if (!panelJumpTarget) {
      return;
    }
    let cancelled = false;
    let clearPulseTimer: ReturnType<typeof setTimeout> | undefined;
    let pulsedEl: HTMLElement | null = null;

    const locateAndScroll = (): void => {
      if (cancelled) {
        return;
      }
      const list = listRef.current;
      if (!list) {
        return;
      }
      const candidates = list.querySelectorAll<HTMLElement>('[data-fs-jump-id]');
      const target = Array.from(candidates).find(
        (el) => el.dataset.fsJumpId === panelJumpTarget.jumpId,
      );
      if (!target) {
        return;
      }
      scrollIntoViewCentered(target);
      pulsedEl = target;
      target.dataset.fsJumpPulse = 'true';
      clearPulseTimer = setTimeout(() => {
        if (pulsedEl) {
          delete pulsedEl.dataset.fsJumpPulse;
          pulsedEl = null;
        }
      }, 1250);
    };

    const rafId =
      typeof globalThis.requestAnimationFrame === 'function'
        ? globalThis.requestAnimationFrame(locateAndScroll)
        : undefined;
    if (rafId === undefined) {
      locateAndScroll();
    }
    return () => {
      cancelled = true;
      if (rafId !== undefined) {
        globalThis.cancelAnimationFrame?.(rafId);
      }
      if (clearPulseTimer !== undefined) {
        clearTimeout(clearPulseTimer);
      }
      if (pulsedEl) {
        delete pulsedEl.dataset.fsJumpPulse;
      }
    };
  }, [panelJumpTarget]);

  const closeCommandJump = useCallback((): void => {
    setCmdOpen(false);
    queueMicrotask(() => {
      searchTriggerRef.current?.focus();
    });
  }, []);

  const openCommandJump = (toggle = false): void => {
    if (toggle && cmdOpen) {
      closeCommandJump();
      return;
    }
    setCmdOpen(true);
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
      closeCommandJump();
    }
  };

  const persistOption = (
    key: string,
    next: OptionValue,
    errorMessage = 'could not save option',
  ): void => {
    void options
      .set(key, next)
      .then(() => setTick((t) => t + 1))
      .catch((error: unknown) => log.error(errorMessage, error));
  };

  const saveOptionWithUndo = (
    key: string,
    previous: OptionValue,
    next: OptionValue,
    label: string,
  ): void => {
    persistOption(key, next);
    notify(label, () => persistOption(key, previous, 'could not undo option'));
  };

  const instantSaveOption = (key: string, spec: OptionSpec, next: OptionValue): void => {
    const previous = options.get(key);
    if (previous === next) {
      return;
    }
    // Simple boolean switches are already 1-click reversible, so save silently without toast clutter.
    if (typeof next === 'boolean') {
      persistOption(key, next);
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
        clearPanelEdit(panel);
        void panel
          .save(nextValue)
          .then(() => {
            if (!panel.subscribe && mountedRef.current) {
              setTick((t) => t + 1);
            }
          })
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
      if (spec.hiddenInList) {
        continue;
      }
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
          panelItemId: item.id,
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
      setPanelJumpTarget(null);
      setPulseKey(hit.optionKey);
      if (pulseTimer.current !== undefined) {
        clearTimeout(pulseTimer.current);
      }
      pulseTimer.current = setTimeout(() => setPulseKey(null), 1200);
    } else if (hit.panelItemId) {
      const targetId = hit.panelItemId;
      setPanelJumpTarget((prev) => ({ seq: (prev?.seq ?? 0) + 1, jumpId: targetId }));
    }
    if (hit.onSelect) {
      hit.onSelect();
      setTick((t) => t + 1);
    }
  };

  const sectionOptions = useMemo(
    () => all.filter(([, spec]) => spec.section === section && !spec.hiddenInList),
    [all, section],
  );
  const sectionGroups = useMemo(() => groupSectionOptions(sectionOptions), [sectionOptions]);
  const shownPanels = panels.filter((panel) => panel.section === section);
  const sectionMeta = section ? getSectionMeta(section, site?.id) : undefined;

  const invalidOptions =
    edits.size === 0
      ? []
      : [...edits].flatMap(([key, edit]) => {
          if (edit.value !== undefined) {
            return [];
          }
          const title = all.find(([k]) => k === key)?.[1].title ?? key;
          return [title];
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
    const isActive = name === section;
    const cancelPointerPreview = (): void => {
      if (pointerTargetRef.current === name && name !== section) {
        pointerTargetRef.current = null;
        syncVisualHighlight(section, true);
      }
    };
    return (
      <button
        key={name}
        ref={(el) => {
          if (el) {
            sectionButtonsRef.current.set(name, el);
          } else {
            sectionButtonsRef.current.delete(name);
          }
        }}
        className="section"
        type="button"
        aria-current={isActive ? 'page' : undefined}
        onPointerDown={(event) => {
          if (event.button === 0 && name !== section) {
            // Start the compositor-driven pill glide immediately on pointerdown, before
            // click fires and mounts heavier tab panels, so the animation never stalls.
            pointerTargetRef.current = name;
            syncVisualHighlight(name, true);
          }
        }}
        onPointerLeave={cancelPointerPreview}
        onPointerCancel={cancelPointerPreview}
        onClick={() => {
          pointerTargetRef.current = null;
          setSection(name);
        }}
      >
        <span className="section-left">
          <span className="section-icon" aria-hidden="true">
            <UiIcon name={meta.icon} size={14} />
          </span>
          <span className="section-label">{name}</span>
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

  const findDisabledAncestor = (spec: OptionSpec): string | undefined => {
    const visited = new Set<string>();
    let cur = spec.dependsOn;
    let blockingKey: string | undefined;
    while (cur && !visited.has(cur)) {
      visited.add(cur);
      if (options.get(cur) === false) {
        blockingKey = cur;
      }
      cur = specByKey.get(cur)?.dependsOn;
    }
    return blockingKey;
  };

  const renderOptionEntries = (entries: readonly [string, OptionSpec][]) =>
    entries.map(([key, spec]) => {
      const blockingKey = findDisabledAncestor(spec);
      const dimmed = blockingKey !== undefined;
      const requiresLabel = blockingKey ? specByKey.get(blockingKey)?.title : undefined;
      return (
        <OptionRow
          key={key}
          optionKey={key}
          spec={spec}
          options={options}
          edit={edits.get(key)}
          dimmed={dimmed}
          {...(requiresLabel ? { requiresLabel } : {})}
          pulse={pulseKey === key}
          onInstantSave={instantSaveOption}
          onDraftEdit={handleDraftEdit}
          onCommitDraft={commitDraftOption}
        />
      );
    });

  const handleSiteToggle = (next: boolean): void => {
    if (togglingSite !== null) {
      return;
    }
    setEnabledHere(next);
    const pending = onToggleSite?.(next);
    if (pending && typeof pending === 'object' && 'then' in pending) {
      setTogglingSite(next ? 'enabling' : 'disabling');
      void Promise.resolve(pending).then(
        () => {
          if (mountedRef.current) {
            setTogglingSite(null);
          }
        },
        () => {
          if (mountedRef.current) {
            setEnabledHere(!next);
            setTogglingSite(null);
          }
        },
      );
    }
  };

  const hasSitesSection = sections.includes('Sites');
  const headerDragAttrs = standalone
    ? undefined
    : {
        title: 'Drag to move · Double-click to center',
        ...drag.handleProps,
      };

  const content = (
    <>
      <div className="shell">
        <aside className="sidebar">
          {site && siteSwitcher ? (
            <SiteSwitcherCard
              site={site}
              enabledHere={enabledHere}
              togglingSite={togglingSite}
              {...(onToggleSite ? { onToggleSite: handleSiteToggle } : {})}
              switcher={siteSwitcher}
              {...(hasSitesSection ? { onManageSites: () => setSection('Sites') } : {})}
            />
          ) : (
            <div
              className={standalone ? 'site-header' : 'site-header drag-handle'}
              {...headerDragAttrs}
            >
              <div className="site-identity">
                {site ? (
                  <span className="site-mark" aria-hidden="true">
                    {getSiteMark(site.id, site.displayName)}
                  </span>
                ) : (
                  <BrandMark size={30} />
                )}
                <div className="site-meta">
                  <h2 className="site-title">
                    {site ? site.displayName : <BrandWordmark height={15} label={NAME} />}
                  </h2>
                  {site && (
                    <span className="site-status" aria-busy={togglingSite !== null || undefined}>
                      {togglingSite === null ? (
                        <span
                          className="site-dot"
                          data-paused={enabledHere ? undefined : 'true'}
                          aria-hidden="true"
                        />
                      ) : (
                        <span className="fs-spinner" aria-hidden="true" />
                      )}
                      {togglingSite === 'enabling' && 'Enabling…'}
                      {togglingSite === 'disabling' && 'Pausing…'}
                      {togglingSite === null &&
                        (enabledHere ? 'Active on this site' : 'Paused here')}
                    </span>
                  )}
                </div>
              </div>
              {site && onToggleSite && (
                <Switch
                  checked={enabledHere}
                  disabled={togglingSite !== null}
                  ariaLabel={`Enable Feed Sanity on ${site.displayName}`}
                  onChange={handleSiteToggle}
                />
              )}
            </div>
          )}

          <button
            ref={searchTriggerRef}
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
              {SEARCH_SHORTCUT_LABEL}
            </span>
          </button>

          <nav ref={navRef} className="sections" aria-label="Sections">
            <span ref={pillRef} className="nav-active-pill" aria-hidden="true" />
            {siteSections.length > 0 && (
              <div className="nav-group">
                {manageSections.length > 0 && <div className="nav-kicker">This Site</div>}
                {siteSections.map(renderSectionNavButton)}
              </div>
            )}
            {manageSections.length > 0 && (
              <div className="nav-group nav-group-manage">
                <div className="nav-kicker">{NAME}</div>
                {manageSections.map(renderSectionNavButton)}
              </div>
            )}
          </nav>

          {site && (
            <a
              className="sidebar-brand"
              href={WEBSITE_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${NAME} — feed-sanity.com`}
            >
              <span className="sidebar-brand-lockup" aria-hidden="true">
                <BrandMark size={28} />
                <BrandWordmark height={21} />
              </span>
              <span className="sidebar-brand-url">feed-sanity.com</span>
            </a>
          )}
        </aside>

        <div className="pane">
          <header
            className={standalone ? 'pane-header' : 'pane-header drag-handle'}
            {...headerDragAttrs}
          >
            <div className="pane-header-title">
              {!standalone && (
                <span className="drag-grip" aria-hidden="true">
                  <UiIcon name="grip" size={14} />
                </span>
              )}
              {sectionMeta && (
                <span className="pane-icon" aria-hidden="true">
                  <UiIcon name={sectionMeta.icon} size={15} />
                </span>
              )}
              <div className="pane-header-copy">
                <h3 className="pane-heading">{section ?? OPTIONS_TITLE}</h3>
                {sectionMeta?.subtitle && <p className="pane-subtitle">{sectionMeta.subtitle}</p>}
              </div>
            </div>
            {!standalone && (
              <button className="close" type="button" aria-label="Close" onClick={closeDialog}>
                <UiIcon name="x" size={16} />
              </button>
            )}
          </header>

          <div ref={listRef} className="list">
            <div key={section ?? '__empty__'} className="pane-content">
              {site && !enabledHere && togglingSite === null && sectionMeta?.group === 'site' && (
                <div className="pane-paused-banner" role="status">
                  <span>
                    {NAME} is paused on {site.displayName}. Settings saved here will apply once
                    resumed.
                  </span>
                  {onToggleSite && (
                    <button
                      type="button"
                      className="button primary"
                      onClick={() => handleSiteToggle(true)}
                    >
                      Resume
                    </button>
                  )}
                </div>
              )}

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
                    options={options}
                  />
                );
              })}
            </div>
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
        <CommandJumpOverlay
          query={cmdQuery}
          activeIndex={cmdIndex}
          hits={searchHits}
          onQueryChange={(nextQuery) => {
            setCmdQuery(nextQuery);
            setCmdIndex(0);
          }}
          onActiveIndexChange={setCmdIndex}
          onSelect={jumpToHit}
          onClose={closeCommandJump}
        />
      )}
    </>
  );

  if (standalone) {
    return (
      <main
        className="dialog"
        data-standalone="true"
        aria-label={OPTIONS_TITLE}
        onKeyDown={handleDialogKeyDown}
      >
        {content}
      </main>
    );
  }

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
          closeCommandJump();
          return;
        }
        closeDialog();
      }}
    >
      {content}
    </dialog>
  );
}
