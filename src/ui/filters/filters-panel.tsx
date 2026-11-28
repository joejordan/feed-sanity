// The Filters panel of the options dialog, shared by every site through a
// `FilterSchema`: the filter list (search, status segments, hit counts,
// reorder, duplicate, delete with undo, the Quick Hide bar and recipes) and
// the editor for one filter.
//
// A new filter is attached to the list on its first real edit, so the
// dialog saves work in progress; Cancel restores the list as it was.

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { FilterHitTracker } from '../../core/filter-hits';
import type { Filter } from '../../core/filter-types';
import type { SavedData } from '../../core/saved';
import type { OptionsPanel, PanelProps } from '../options-dialog/panel';
import type { FilterSchema } from './schema';
import { getFilterHitTracker } from '../../core/filter-hits';
import { newFilterId, savedFilters } from '../../core/filter-types';
import { definePanel } from '../options-dialog/panel';
import { FilterEditor } from './filter-editor';
import css from './filters-panel.css?inline';
import { pillClassFor } from './grouped-select';
import { FilterIcon } from './icons';
import { inserted, moved, replaced, without } from './list-edit';
import { QuickHideBar } from './quick-hide-bar';
import { RecipesGrid } from './recipes-grid';
import { PillSwitch } from './simple-editor';
import { isSimpleCompatible, newSimpleFilter } from './simple-model';
import { displayFilterTitle, summarizeFilter } from './summary';
import { filtersProblem, validateFilter } from './validate';

const STATUS_LABELS = { all: 'All', active: 'Active', paused: 'Paused' } as const;

type EditorSession =
  | {
      readonly kind: 'create';
      readonly draft: Filter;
      readonly snapshot: readonly Filter[];
      readonly initialMode: 'simple' | 'advanced';
    }
  | {
      readonly kind: 'create-attached';
      readonly index: number;
      readonly snapshot: readonly Filter[];
      readonly initialMode: 'simple' | 'advanced';
    }
  | {
      readonly kind: 'edit';
      readonly index: number;
      readonly original: Filter;
      /** Filters pasted from the code box after this one; Cancel removes them. */
      readonly pasted?: number;
      readonly initialMode: 'simple' | 'advanced';
    };

type ListToast =
  | {
      readonly kind: 'deleted';
      readonly filter: Filter;
      readonly index: number;
      readonly title: string;
    }
  | { readonly kind: 'added'; readonly index: number; readonly title: string };

export interface SiteFiltersPanelProps extends PanelProps<Filter[]> {
  readonly schema: FilterSchema;
  readonly hitTracker?: FilterHitTracker | undefined;
}

const NOOP_SUBSCRIBE = () => () => undefined;

/** `list` with every id that is repeated or already in `taken` renewed. */
function withUniqueIds(list: readonly Filter[], taken: readonly Filter[]): Filter[] {
  const seen = new Set(taken.map((filter) => filter.id));
  return list.map((filter) => {
    const unique = seen.has(filter.id) ? { ...filter, id: newFilterId() } : filter;
    seen.add(unique.id);
    return unique;
  });
}

/** The jump-to id of a filter's list card. */
const jumpIdOf = (filter: Filter) => `filter:${filter.id}`;

/** The filter list and editor for one site. */
export function SiteFiltersPanel({
  value: filters,
  onChange,
  schema,
  hitTracker,
}: SiteFiltersPanelProps) {
  const [session, setSession] = useState<EditorSession>();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'paused'>('all');
  const [showRecipes, setShowRecipes] = useState(false);
  const [toast, setToast] = useState<ListToast>();
  const subscribeHits = useCallback(
    (listener: () => void) => (hitTracker ? hitTracker.onChange(listener) : NOOP_SUBSCRIBE()),
    [hitTracker],
  );
  const getHitsSnapshot = useCallback(() => hitTracker?.version() ?? 0, [hitTracker]);
  useSyncExternalStore(subscribeHits, getHitsSnapshot);

  let activeFilter: Filter | undefined;
  if (session) {
    activeFilter = session.kind === 'create' ? session.draft : filters[session.index];
  }
  const isEditing = activeFilter !== undefined;

  // Clear orphaned editor session if an external write shrinks `filters` past `session.index`.
  useEffect(() => {
    if (session !== undefined && activeFilter === undefined) {
      setSession(undefined);
    }
  }, [session, activeFilter]);

  const enrichedEntries = useMemo(
    () =>
      isEditing
        ? []
        : filters.map((filter, index) => ({
            filter,
            index,
            summary: summarizeFilter(filter, schema),
            issues: validateFilter(filter, schema),
          })),
    [filters, isEditing, schema],
  );

  const openEdit = (index: number) => {
    const target = filters[index];
    if (!target) {
      return;
    }
    const compat = isSimpleCompatible(target, schema);
    setToast(undefined);
    setSession({
      kind: 'edit',
      index,
      original: structuredClone(target),
      initialMode: compat.ok ? 'simple' : 'advanced',
    });
  };

  const openCreate = (draft: Filter) => {
    const compat = isSimpleCompatible(draft, schema);
    setShowRecipes(false);
    setToast(undefined);
    setSession({
      kind: 'create',
      draft,
      snapshot: [...filters],
      initialMode: compat.ok ? 'simple' : 'advanced',
    });
  };

  if (session && activeFilter) {
    const handleEditorChange = (next: Filter) => {
      if (session.kind === 'create') {
        // Attach on the first real edit so the dialog saves work in progress.
        const nextIndex = filters.length;
        onChange([...filters, next]);
        setSession({
          kind: 'create-attached',
          index: nextIndex,
          snapshot: session.snapshot,
          initialMode: session.initialMode,
        });
        return;
      }
      onChange(replaced(filters, session.index, next));
    };

    const handleCommit = (finalFilter: Filter) => {
      if (session.kind === 'create') {
        onChange([...filters, finalFilter]);
      } else if (finalFilter !== activeFilter) {
        onChange(replaced(filters, session.index, finalFilter));
      }
      setSession(undefined);
    };

    const handleBack = (finalFilter: Filter) => {
      if (session.kind === 'create' && finalFilter === session.draft) {
        // Untouched new draft: discard cleanly with zero orphan filter.
        setSession(undefined);
        return;
      }
      handleCommit(finalFilter);
    };

    const handleCancel = () => {
      if (session.kind === 'edit') {
        const after = session.index + 1 + (session.pasted ?? 0);
        onChange([...filters.slice(0, session.index), session.original, ...filters.slice(after)]);
      } else if (session.kind === 'create-attached') {
        onChange([...session.snapshot]);
      }
      setSession(undefined);
    };

    const handlePasteList = (pasted: readonly Filter[]) => {
      const [first, ...rest] = pasted;
      if (!first) {
        return;
      }
      const others = session.kind === 'create' ? filters : without(filters, session.index);
      const list = [first, ...withUniqueIds(rest, [first, ...others])];
      if (session.kind === 'create') {
        onChange([...filters, ...list]);
        setSession({
          kind: 'create-attached',
          index: filters.length,
          snapshot: session.snapshot,
          initialMode: session.initialMode,
        });
        return;
      }
      onChange([...filters.slice(0, session.index), ...list, ...filters.slice(session.index + 1)]);
      if (session.kind === 'edit') {
        setSession({ ...session, pasted: (session.pasted ?? 0) + rest.length });
      }
    };

    return (
      <FilterEditor
        filter={activeFilter}
        schema={schema}
        isCreate={session.kind !== 'edit'}
        initialMode={session.initialMode}
        onChange={handleEditorChange}
        onCommit={handleCommit}
        onCancel={handleCancel}
        onBack={handleBack}
        onPasteList={handlePasteList}
      />
    );
  }

  const normalizedQuery = query.trim().toLowerCase();
  const isFiltered = normalizedQuery.length > 0 || statusFilter !== 'all';
  const activeCount = filters.filter((item) => item.enabled).length;

  const visibleEntries = enrichedEntries.filter(({ filter, summary }) => {
    if (statusFilter === 'active' && !filter.enabled) {
      return false;
    }
    if (statusFilter === 'paused' && filter.enabled) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }
    const haystack = `${summary.title} ${summary.line} ${filter.description ?? ''}`.toLowerCase();
    return haystack.includes(normalizedQuery);
  });

  const handleQuickHide = (created: Filter) => {
    const nextIndex = filters.length;
    onChange([...filters, created]);
    setToast({
      kind: 'added',
      index: nextIndex,
      title: displayFilterTitle(created, schema),
    });
  };

  const handleDuplicate = (index: number) => {
    const source = filters[index];
    if (!source) {
      return;
    }
    const copy: Filter = {
      ...structuredClone(source),
      id: newFilterId(),
      name: `${displayFilterTitle(source, schema)} (copy)`,
    };
    onChange(inserted(filters, index + 1, copy));
    setToast(undefined);
  };

  const handleDelete = (index: number) => {
    const target = filters[index];
    if (!target) {
      return;
    }
    const title = displayFilterTitle(target, schema);
    onChange(without(filters, index));
    setToast({ kind: 'deleted', filter: target, index, title });
  };

  const handleUndo = () => {
    if (!toast) {
      return;
    }
    if (toast.kind === 'deleted') {
      const at = Math.min(toast.index, filters.length);
      const [restored = toast.filter] = withUniqueIds([toast.filter], filters);
      onChange(inserted(filters, at, restored));
    } else if (toast.index < filters.length) {
      onChange(without(filters, toast.index));
    }
    setToast(undefined);
  };

  const handleMove = (from: number, to: number) => {
    onChange(moved(filters, from, to));
    setToast(undefined);
  };

  return (
    <section className="fr-root">
      <div className="fr-header">
        <div className="fr-heading-group">
          <h3 className="fr-subheading">Custom filters</h3>
          {filters.length > 0 && (
            <span className="fr-count">
              {activeCount} active / {filters.length}
            </span>
          )}
        </div>
        <div className="fr-header-actions">
          {filters.length > 0 && schema.recipes.length > 0 && (
            <button
              className="button fr-btn-inline"
              type="button"
              aria-expanded={showRecipes}
              onClick={() => setShowRecipes((open) => !open)}
            >
              <FilterIcon name="sparkle" size={14} />
              Recipes
            </button>
          )}
          <button
            className="button primary fr-btn-inline"
            type="button"
            data-fs-jump-id="create-filter"
            onClick={() => openCreate(newSimpleFilter(schema))}
          >
            <FilterIcon name="plus" size={14} />
            Create a new filter
          </button>
        </div>
      </div>

      <p className="fr-intro">
        Every {schema.itemSingular} on {schema.siteName} goes through these filters from top to
        bottom. Filters can hide, keep, highlight or restyle {schema.itemPlural}.
      </p>

      <QuickHideBar schema={schema} onQuickHide={handleQuickHide} />

      {toast && (
        <div className="fr-toast" role="status">
          <span className="fr-toast-text">
            {toast.kind === 'deleted' ? `Deleted “${toast.title}”.` : `Added “${toast.title}”.`}
          </span>
          {toast.kind === 'added' && (
            <button className="fr-toast-undo" type="button" onClick={() => openEdit(toast.index)}>
              Edit
            </button>
          )}
          <button className="fr-toast-undo" type="button" onClick={handleUndo}>
            Undo
          </button>
          <button
            className="fr-icon-btn"
            type="button"
            aria-label="Dismiss notification"
            onClick={() => setToast(undefined)}
          >
            <FilterIcon name="close" size={14} />
          </button>
        </div>
      )}

      {showRecipes && filters.length > 0 && (
        <RecipesGrid
          recipes={schema.recipes}
          onPick={(recipe) => openCreate(recipe.create())}
          onClose={() => setShowRecipes(false)}
        />
      )}

      {(filters.length >= 4 || isFiltered) && (
        <div className="fr-toolbar">
          <input
            className="field fr-search"
            type="search"
            aria-label="Search filters"
            placeholder="Search filters..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="fr-segments" role="group" aria-label="Filter status">
            {(['all', 'active', 'paused'] as const).map((status) => (
              <button
                key={status}
                className="fr-segment"
                type="button"
                aria-pressed={statusFilter === status}
                onClick={() => setStatusFilter(status)}
              >
                {STATUS_LABELS[status]}
              </button>
            ))}
          </div>
        </div>
      )}

      {filters.length === 0 && (
        <>
          <p className="empty">No filters yet.</p>
          <RecipesGrid recipes={schema.recipes} onPick={(recipe) => openCreate(recipe.create())} />
        </>
      )}

      {filters.length > 0 && visibleEntries.length === 0 && (
        <p className="empty">No filters match your current search.</p>
      )}

      {visibleEntries.length > 0 && (
        <ul className="fr-list">
          {visibleEntries.map(({ filter, index, summary, issues }) => {
            const title = summary.title;
            const hits = hitTracker ? hitTracker.countFor(filter) : 0;
            const set = (changes: Partial<Filter>) =>
              onChange(replaced(filters, index, { ...filter, ...changes }));
            return (
              <li
                key={filter.id}
                data-fs-jump-id={jumpIdOf(filter)}
                className={filter.enabled ? 'fr-card' : 'fr-card fr-off'}
              >
                <div className="fr-card-main">
                  <div className="fr-card-top">
                    <button className="fr-card-title" type="button" onClick={() => openEdit(index)}>
                      {title}
                    </button>
                    {summary.primaryAction && (
                      <span className={pillClassFor(summary.primaryAction)}>
                        {summary.primaryAction.badge}
                        {summary.extraActionCount > 0 ? ` +${summary.extraActionCount}` : ''}
                      </span>
                    )}
                    {hits > 0 && (
                      <span
                        className="fr-pill fr-pill--match"
                        title={`Matched ${hits} ${hits === 1 ? schema.itemSingular : schema.itemPlural} on this page`}
                      >
                        {hits} matched
                      </span>
                    )}
                    {filter.stopAfter && (
                      <span
                        className="fr-pill fr-pill--stop"
                        title="When this filter matches, the filters below it are skipped"
                      >
                        Stop
                      </span>
                    )}
                    {issues.length > 0 && (
                      <span className="fr-pill fr-pill--error" title={issues[0]}>
                        <FilterIcon name="alert" size={12} />
                        Invalid
                      </span>
                    )}
                  </div>
                  <p className="fr-card-summary" title={summary.line}>
                    {summary.line}
                  </p>
                  {filter.description && <p className="fr-card-desc">{filter.description}</p>}
                </div>

                <div className="fr-card-controls">
                  <button
                    className="fr-icon-btn"
                    type="button"
                    aria-label={`Edit ${title}`}
                    title="Edit"
                    onClick={() => openEdit(index)}
                  >
                    <FilterIcon name="edit" />
                  </button>
                  <button
                    className="fr-icon-btn"
                    type="button"
                    aria-label={`Duplicate ${title}`}
                    title="Duplicate"
                    onClick={() => handleDuplicate(index)}
                  >
                    <FilterIcon name="copy" />
                  </button>
                  <button
                    className="fr-icon-btn"
                    type="button"
                    aria-label={`Move ${title} up`}
                    title={isFiltered ? 'Clear search/status filter to reorder' : 'Move up'}
                    disabled={isFiltered || index === 0}
                    onClick={() => handleMove(index, index - 1)}
                  >
                    <FilterIcon name="up" />
                  </button>
                  <button
                    className="fr-icon-btn"
                    type="button"
                    aria-label={`Move ${title} down`}
                    title={isFiltered ? 'Clear search/status filter to reorder' : 'Move down'}
                    disabled={isFiltered || index === filters.length - 1}
                    onClick={() => handleMove(index, index + 1)}
                  >
                    <FilterIcon name="down" />
                  </button>
                  <button
                    className="fr-icon-btn fr-icon-btn--danger"
                    type="button"
                    aria-label={`Delete ${title}`}
                    title="Delete"
                    onClick={() => handleDelete(index)}
                  >
                    <FilterIcon name="trash" />
                  </button>
                  <PillSwitch
                    label={`Enable ${title}`}
                    hideLabel
                    checked={filter.enabled}
                    onChange={(enabled) => set({ enabled })}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Creates an Options dialog Filtering panel configured for any site's `FilterSchema`. */
export function createFiltersPanel(
  data: SavedData,
  schema: FilterSchema,
  options: { readonly section?: string } = {},
): OptionsPanel {
  const saved = savedFilters(data);
  const hitTracker = getFilterHitTracker(data);
  return definePanel<Filter[]>({
    section: options.section ?? 'Filtering',
    css,
    instant: true,
    ready: saved.ready,
    read: () => saved.get(),
    save: (filters) => saved.set(filters),
    subscribe: (listener) => saved.onChange(() => listener()),
    badge: () => {
      const enabledCount = saved.get().filter((filter) => filter.enabled).length;
      return enabledCount > 0 ? String(enabledCount) : null;
    },
    searchItems: () => [
      {
        id: 'create-filter',
        title: 'Create a filter',
        description: `Add a filter that hides, keeps or highlights ${schema.itemPlural} on ${schema.siteName}.`,
        keywords: ['filter', 'rule', 'mute', 'hide', 'highlight', 'regex'],
      },
      ...saved.get().map((filter) => {
        const title = displayFilterTitle(filter, schema);
        const count = filter.conditions.length;
        return {
          id: jumpIdOf(filter),
          title: `Filter: ${title}`,
          description: filter.description || `${count} ${count === 1 ? 'condition' : 'conditions'}`,
          keywords: ['filter', 'rule', title],
        };
      }),
    ],
    problem: (filters) => filtersProblem(filters, schema),
    Panel: (props) => <SiteFiltersPanel {...props} schema={schema} hitTracker={hitTracker} />,
  });
}
