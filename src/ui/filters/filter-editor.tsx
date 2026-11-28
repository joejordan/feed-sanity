// The filter editor: a header with the name and the Simple / Advanced switch,
// then either the goal-first Simple builder or the Advanced editor (details,
// conditions with the combine toggle, actions, the live tester and the
// filter code box).

import { useMemo, useState } from 'react';
import type { Action, Condition, Filter, FilterJoin } from '../../core/filter-types';
import type { FilterSchema } from './schema';
import { newAction, newCondition, readFilters } from '../../core/filter-types';
import { ActionCard } from './action-card';
import { FilterTester } from './filter-tester';
import { FilterIcon } from './icons';
import { replaced, withField, without } from './list-edit';
import { ConditionCard } from './rule-card';
import { defaultTextPart, JOIN_LABELS } from './schema';
import { PillSwitch, SimpleFilterBuilder } from './simple-editor';
import {
  activeSimpleTarget,
  commitPendingText,
  effectiveSimpleChips,
  isSimpleCompatible,
  normalizeChipsForTarget,
  withSimpleChips,
} from './simple-model';
import { displayFilterTitle, summarizeFilter } from './summary';
import { useStableKeys } from './use-stable-keys';
import { validateAction, validateCondition } from './validate';

export type EditorMode = 'simple' | 'advanced';

export interface FilterEditorProps {
  readonly filter: Filter;
  readonly schema: FilterSchema;
  /** True while creating a filter (the footer says "Add filter"). */
  readonly isCreate: boolean;
  readonly initialMode: EditorMode;
  /** Every edit, as it happens. */
  readonly onChange: (next: Filter) => void;
  /** Done: keep `final` and close. */
  readonly onCommit: (final: Filter) => void;
  /** Cancel: drop the edits and close. */
  readonly onCancel: () => void;
  /** Back arrow: keep `final` and close (a new filter nobody touched is dropped). */
  readonly onBack: (final: Filter) => void;
  /**
   * A list of filters pasted into the code box: the first replaces the one
   * being edited and the rest go after it.
   */
  readonly onPasteList: (filters: readonly Filter[]) => void;
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function InlineTitle({
  filter,
  schema,
  onRename,
}: {
  readonly filter: Filter;
  readonly schema: FilterSchema;
  readonly onRename: (name: string) => void;
}) {
  const [draft, setDraft] = useState<string>();
  if (draft === undefined) {
    return (
      <button
        className="fr-inline-title-btn"
        type="button"
        aria-label="Rename filter"
        title="Rename filter"
        onClick={() => setDraft(filter.name)}
      >
        <span className="fr-inline-title-text">{displayFilterTitle(filter, schema)}</span>
        <FilterIcon name="edit" size={13} />
      </button>
    );
  }
  const finish = () => {
    if (draft !== filter.name) {
      onRename(draft);
    }
    setDraft(undefined);
  };
  return (
    <input
      className="field fr-inline-title-input"
      type="text"
      aria-label="Name"
      placeholder={displayFilterTitle({ ...filter, name: '' }, schema)}
      autoFocus
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={finish}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          finish();
        } else if (event.key === 'Escape') {
          // Keep the options dialog open: Escape only cancels the rename.
          event.preventDefault();
          event.stopPropagation();
          setDraft(undefined);
        }
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Filter code box
// ---------------------------------------------------------------------------

interface CodeDraft {
  readonly text: string;
  /** The filter the draft belongs to. A different filter means the draft is stale. */
  readonly filter: Filter;
  readonly error?: string;
  readonly info?: string;
}

function FilterCode({
  filter,
  onChange,
  onPasteList,
}: {
  readonly filter: Filter;
  readonly onChange: (next: Filter) => void;
  readonly onPasteList: (filters: readonly Filter[]) => void;
}) {
  const formatted = useMemo(() => JSON.stringify(filter, null, 2), [filter]);
  const [stored, setDraft] = useState<CodeDraft>();
  const draft = stored?.filter === filter ? stored : undefined;

  const apply = (text: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'it does not parse';
      setDraft({ text, filter, error: `Not valid JSON yet (${detail}), so not used.` });
      return;
    }
    const list = readFilters(Array.isArray(parsed) ? parsed : [parsed]);
    const [first, ...rest] = list;
    if (!first) {
      setDraft({ text, filter, error: 'No filter in this code yet, so not used.' });
      return;
    }
    const next: Filter = { ...first, id: filter.id };
    if (rest.length > 0) {
      onPasteList([next, ...rest]);
      setDraft({
        text: JSON.stringify(next, null, 2),
        filter: next,
        info: `Added ${rest.length} more ${rest.length === 1 ? 'filter' : 'filters'} after this one.`,
      });
      return;
    }
    onChange(next);
    setDraft({ text, filter: next });
  };

  return (
    <details className="fr-disclosure">
      <summary>
        <FilterIcon name="sliders" size={14} />
        <span>Filter code</span>
      </summary>
      <div className="fr-disclosure-body">
        <p className="fr-section-hint">
          This filter as JSON. Edit it here, or paste a filter or a list of filters.
        </p>
        <textarea
          className="field fr-code-box"
          rows={10}
          spellCheck={false}
          aria-label="Filter code"
          aria-invalid={draft?.error ? true : undefined}
          value={draft?.text ?? formatted}
          onChange={(event) => apply(event.target.value)}
        />
        {draft?.error && (
          <p className="fr-field-error" role="alert">
            {draft.error}
          </p>
        )}
        {draft?.info && (
          <p className="fr-section-hint" role="status">
            {draft.info}
          </p>
        )}
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Advanced editor
// ---------------------------------------------------------------------------

function JoinToggle({
  join,
  onChange,
}: {
  readonly join: FilterJoin;
  readonly onChange: (join: FilterJoin) => void;
}) {
  return (
    <div className="fr-combine-bar">
      <span>Match when</span>
      <div className="fr-segments" role="group" aria-label="Combine conditions">
        {(['all', 'any'] as const).map((value) => (
          <button
            key={value}
            className="fr-segment"
            type="button"
            aria-pressed={join === value}
            onClick={() => onChange(value)}
          >
            {JOIN_LABELS[value]}
          </button>
        ))}
      </div>
      <span>hold.</span>
    </div>
  );
}

function AdvancedEditor({
  filter,
  schema,
  onChange,
  onPasteList,
}: {
  readonly filter: Filter;
  readonly schema: FilterSchema;
  readonly onChange: (next: Filter) => void;
  readonly onPasteList: (filters: readonly Filter[]) => void;
}) {
  const conditionKeys = useStableKeys(filter.conditions.length);
  const actionKeys = useStableKeys(filter.actions.length);
  const set = (changes: Partial<Filter>) => onChange({ ...filter, ...changes });
  const setConditions = (conditions: readonly Condition[]) => set({ conditions });
  const setActions = (actions: readonly Action[]) => set({ actions });
  const connector = filter.join === 'all' ? 'AND' : 'OR';

  return (
    <div className="fr-advanced">
      <div className="fr-identity">
        <label className="fr-field-label">
          Description (optional)
          <input
            className="field"
            type="text"
            placeholder="A note to yourself about this filter"
            value={filter.description ?? ''}
            onChange={(event) => onChange(withField(filter, 'description', event.target.value))}
          />
        </label>
        <div className="fr-chip-row">
          <PillSwitch
            label="Enabled"
            checked={filter.enabled}
            onChange={(enabled) => set({ enabled })}
          />
          <PillSwitch
            label="Stop later filters when this one matches"
            checked={filter.stopAfter}
            onChange={(stopAfter) => set({ stopAfter })}
          />
        </div>
      </div>

      <fieldset className="fr-group">
        <legend>If</legend>
        {filter.conditions.length > 1 && (
          <JoinToggle join={filter.join} onChange={(join) => set({ join })} />
        )}
        {filter.conditions.map((condition, index) => (
          <div key={conditionKeys.keys[index] ?? index} className="fr-action-fields">
            {index > 0 && (
              <div className="fr-connector" aria-hidden="true">
                <span className="fr-connector-pill">{connector}</span>
              </div>
            )}
            <ConditionCard
              condition={condition}
              schema={schema}
              index={index}
              error={validateCondition(condition, schema)}
              onChange={(next) => setConditions(replaced(filter.conditions, index, next))}
              onRemove={
                filter.conditions.length > 1
                  ? () => {
                      conditionKeys.removeAt(index);
                      setConditions(without(filter.conditions, index));
                    }
                  : undefined
              }
            />
          </div>
        ))}
        {filter.conditions.length === 0 && (
          <p className="fr-section-hint">With no conditions this filter never runs.</p>
        )}
        <button
          className="button fr-add-btn"
          type="button"
          onClick={() => {
            conditionKeys.push();
            setConditions([...filter.conditions, newCondition(defaultTextPart(schema))]);
          }}
        >
          <FilterIcon name="plus" size={14} />
          Add condition
        </button>
      </fieldset>

      <fieldset className="fr-group">
        <legend>Then</legend>
        {filter.actions.map((action, index) => (
          <ActionCard
            key={actionKeys.keys[index] ?? index}
            action={action}
            schema={schema}
            index={index}
            error={validateAction(action, schema)}
            onChange={(next) => setActions(replaced(filter.actions, index, next))}
            onRemove={
              filter.actions.length > 1
                ? () => {
                    actionKeys.removeAt(index);
                    setActions(without(filter.actions, index));
                  }
                : undefined
            }
          />
        ))}
        {filter.actions.length === 0 && (
          <p className="fr-section-hint">With no actions this filter never runs.</p>
        )}
        <button
          className="button fr-add-btn"
          type="button"
          onClick={() => {
            actionKeys.push();
            setActions([...filter.actions, newAction('hide')]);
          }}
        >
          <FilterIcon name="plus" size={14} />
          Add action
        </button>
      </fieldset>

      <FilterTester filter={filter} schema={schema} />
      <FilterCode filter={filter} onChange={onChange} onPasteList={onPasteList} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

/** Edits one filter in Simple or Advanced mode. */
export function FilterEditor({
  filter,
  schema,
  isCreate,
  initialMode,
  onChange,
  onCommit,
  onCancel,
  onBack,
  onPasteList,
}: FilterEditorProps) {
  const [mode, setMode] = useState<EditorMode>(initialMode);
  const [pendingText, setPendingText] = useState('');
  const compat = useMemo(() => isSimpleCompatible(filter, schema), [filter, schema]);
  const isSimple = mode === 'simple' && compat.ok;
  const simpleTarget = activeSimpleTarget(filter, schema);

  const words = useMemo(
    () => normalizeChipsForTarget(effectiveSimpleChips(filter, pendingText), simpleTarget, schema),
    [filter, pendingText, schema, simpleTarget],
  );
  const shown = useMemo(
    () => (isSimple ? withSimpleChips(filter, simpleTarget, words) : filter),
    [filter, isSimple, simpleTarget, words],
  );
  const summary = summarizeFilter(shown, schema);

  /** The filter with any half-typed Simple chip added. */
  const flushed = (): Filter =>
    isSimple ? commitPendingText(filter, pendingText, simpleTarget, schema) : filter;

  const switchMode = (next: EditorMode) => {
    if (next === mode) {
      return;
    }
    if (next === 'advanced' && isSimple) {
      const final = flushed();
      if (final !== filter) {
        onChange(final);
      }
      setPendingText('');
    }
    setMode(next);
  };

  return (
    <div className="fr-editor">
      <div className="fr-editor-bar">
        <button
          className="fr-icon-btn"
          type="button"
          aria-label="Back to filters"
          title="Back to filters"
          onClick={() => onBack(flushed())}
        >
          <FilterIcon name="back" />
        </button>
        <div className="fr-title-slot">
          <InlineTitle
            filter={shown}
            schema={schema}
            onRename={(name) => {
              onChange({ ...flushed(), name });
              setPendingText('');
            }}
          />
        </div>
        <div className="fr-segments" role="group" aria-label="Editor mode">
          <button
            className="fr-segment"
            type="button"
            aria-pressed={isSimple}
            disabled={!compat.ok}
            title={compat.ok ? 'Simple mode' : `Simple mode is off: ${compat.reason}`}
            onClick={() => switchMode('simple')}
          >
            Simple
          </button>
          <button
            className="fr-segment"
            type="button"
            aria-pressed={!isSimple}
            onClick={() => switchMode('advanced')}
          >
            Advanced
          </button>
        </div>
      </div>

      <p className="fr-card-summary" title={summary.line}>
        {summary.line}
      </p>

      {isSimple ? (
        <SimpleFilterBuilder
          filter={filter}
          effectiveFilter={shown}
          words={words}
          currentTarget={simpleTarget}
          schema={schema}
          pendingText={pendingText}
          onPendingTextChange={setPendingText}
          onChange={onChange}
          onSwitchAdvanced={() => switchMode('advanced')}
        />
      ) : (
        <AdvancedEditor
          filter={filter}
          schema={schema}
          onChange={onChange}
          onPasteList={onPasteList}
        />
      )}

      <div className="fr-editor-footer">
        {isSimple ? (
          <button className="fr-more-link" type="button" onClick={() => switchMode('advanced')}>
            <FilterIcon name="sliders" size={14} />
            More options
          </button>
        ) : (
          !compat.ok && <span className="fr-section-hint">Advanced only: {compat.reason}.</span>
        )}
        <div className="fr-editor-footer-actions">
          <button className="button" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="button primary" type="button" onClick={() => onCommit(flushed())}>
            {isCreate ? 'Add filter' : 'Done'}
          </button>
        </div>
      </div>
    </div>
  );
}
