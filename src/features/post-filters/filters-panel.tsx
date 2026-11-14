import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { SavedData } from '../../core/saved';
import type { OptionsPanel, PanelProps } from '../../ui/options-dialog/panel';
import type { Action, Filter, Rule } from './types';
import { definePanel } from '../../ui/options-dialog/panel';
import css from './filters-panel.css?inline';
import { isTabAction, newAction, newFilter, newRule, readFilters, savedFilters } from './types';

type Choices = readonly (readonly [value: string, label: string])[];

const TARGETS: Choices = [
  ['any', 'Any post content'],
  ['any+image', 'Post text and photo descriptions'],
  ['content', 'Post text'],
  ['action', 'Post header'],
  ['author', 'Author'],
  ['group', 'Group posted in'],
  ['app', 'App or game name'],
  ['link_url', 'Link address'],
  ['link_text', 'Link text'],
  ['image', 'Photo description'],
  ['hashtag', 'Any hashtag'],
];

const OPERATORS: Choices = [
  ['contains', 'contains'],
  ['equals', 'equals exactly'],
  ['startswith', 'starts with'],
  ['endswith', 'ends with'],
  ['matches', 'matches regex'],
];

const SELECTOR_OPERATOR: Choices = [['contains_selector', 'matches CSS selector']];

const ACTIONS: Choices = [
  ['hide', 'Hide post'],
  ['unhide', 'Unhide post'],
  ['css', 'Add CSS'],
  ['class', 'Add CSS class'],
  ['replace', 'Replace text'],
  ['move-to-tab', 'Move post to tab'],
  ['copy-to-tab', 'Copy post to tab'],
];

/** The list with the item at `index` replaced. */
const replaced = <T,>(list: readonly T[], index: number, item: T): T[] =>
  list.map((existing, at) => (at === index ? item : existing));

const without = <T,>(list: readonly T[], index: number): T[] =>
  list.filter((_item, at) => at !== index);

/** The list with the item at `from` moved to `to`. */
function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const result = [...list];
  result.splice(to, 0, ...result.splice(from, 1));
  return result;
}

interface IconButtonProps {
  label: string;
  icon: string;
  disabled?: boolean | undefined;
  onClick: () => void;
}

function IconButton({ label, icon, disabled, onClick }: IconButtonProps) {
  return (
    <button className="icon" type="button" aria-label={label} disabled={disabled} onClick={onClick}>
      {icon}
    </button>
  );
}

interface SelectProps {
  label: string;
  value: string;
  choices: Choices;
  onChange: (value: string) => void;
}

/** A drop-down. A saved value that is not among the choices is still shown, so opening a filter does not change it. */
function Select({ label, value, choices, onChange }: SelectProps) {
  const known = choices.some(([choice]) => choice === value);
  return (
    <select
      className="field"
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {!known && <option value={value}>{value ? `${value} (not supported yet)` : ''}</option>}
      {choices.map(([choice, text]) => (
        <option key={choice} value={choice}>
          {text}
        </option>
      ))}
    </select>
  );
}

interface TextProps {
  label: string;
  value: string | undefined;
  onChange: (value: string) => void;
  /** Shows the label beside the input. Otherwise it is only read out. */
  visibleLabel?: boolean;
  grow?: boolean;
}

function Text({ label, value, onChange, visibleLabel, grow }: TextProps) {
  const input = (
    <input
      className={grow ? 'field grow' : 'field'}
      type="text"
      aria-label={visibleLabel ? undefined : label}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value)}
    />
  );
  return visibleLabel ? (
    <label className={grow ? 'labelled grow' : 'labelled'}>
      {label}
      {input}
    </label>
  ) : (
    input
  );
}

interface CheckProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function Check({ label, checked, onChange }: CheckProps) {
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

interface RuleEditorProps {
  rule: Rule;
  /** For every rule but the first: how it combines with the ones before. */
  match?: string | undefined;
  onMatch: (match: string) => void;
  onChange: (rule: Rule) => void;
  /** Missing when this is the only rule. */
  onDelete?: (() => void) | undefined;
}

function RuleEditor({ rule, match, onMatch, onChange, onDelete }: RuleEditorProps) {
  const operator = rule.operator ?? '';
  const condition = (changes: Rule['condition']) =>
    onChange({ ...rule, condition: { ...rule.condition, ...changes } });
  const usesText = operator !== 'matches' && operator !== 'contains_selector';

  return (
    <div className="line">
      {match !== undefined && (
        <Select
          label="Combine with"
          value={match}
          choices={[
            ['ALL', 'and'],
            ['ANY', 'or'],
          ]}
          onChange={onMatch}
        />
      )}
      <Select
        label="Part of the post"
        value={rule.target ?? ''}
        choices={TARGETS}
        onChange={(target) => onChange({ ...rule, target })}
      />
      <Check
        label="not"
        checked={rule.not === true}
        onChange={(not) => onChange({ ...rule, not })}
      />
      <Select
        label="Comparison"
        value={operator}
        choices={rule.target === 'any' ? [...OPERATORS, ...SELECTOR_OPERATOR] : OPERATORS}
        onChange={(value) => onChange({ ...rule, operator: value })}
      />
      <Text
        label={operator === 'contains_selector' ? 'CSS selector' : 'Text to look for'}
        value={rule.condition?.text}
        grow
        onChange={(text) => condition({ text })}
      />
      {operator === 'matches' && (
        <Text
          label="Regex flags"
          value={rule.condition?.modifier}
          onChange={(modifier) => condition({ modifier })}
        />
      )}
      {usesText && (
        <>
          <Select
            label="Case"
            value={rule.condition?.modifier ?? 'i'}
            choices={[
              ['i', 'ignore case'],
              ['I', 'match case'],
            ]}
            onChange={(modifier) => condition({ modifier })}
          />
          <Select
            label="How to read the text"
            value={rule.matcher ?? 're'}
            choices={[
              ['re', 'regular expression'],
              ['str', 'plain text'],
            ]}
            onChange={(matcher) => onChange({ ...rule, matcher })}
          />
        </>
      )}
      {operator === 'contains' && (
        <Check
          label="partial words"
          checked={rule.match_partial_words === true}
          onChange={(partial) => onChange({ ...rule, match_partial_words: partial })}
        />
      )}
      {onDelete && <IconButton label="Delete condition" icon="×" onClick={onDelete} />}
    </div>
  );
}

interface ActionEditorProps {
  action: Action;
  onChange: (action: Action) => void;
  onDelete?: (() => void) | undefined;
}

function ActionEditor({ action, onChange, onDelete }: ActionEditorProps) {
  const kind = action.action ?? '';
  const set = (changes: Action) => onChange({ ...action, ...changes });
  let fields: ReactNode = null;
  if (kind === 'hide') {
    fields = (
      <>
        <Check
          label="leave a note"
          checked={action.show_note === true}
          onChange={(showNote) => set({ show_note: showNote })}
        />
        {action.show_note && (
          <Text
            label="Note"
            visibleLabel
            grow
            value={action.custom_note}
            onChange={(note) => set({ custom_note: note })}
          />
        )}
      </>
    );
  } else if (kind === 'css' || kind === 'class') {
    fields = (
      <>
        <Text
          label={kind === 'css' ? 'CSS' : 'Class'}
          visibleLabel
          grow
          value={action.content}
          onChange={(content) => set({ content })}
        />
        <Text
          label="To selector"
          visibleLabel
          value={action.selector}
          onChange={(selector) => set({ selector })}
        />
      </>
    );
  } else if (kind === 'replace') {
    fields = (
      <>
        <Text
          label="Find"
          visibleLabel
          grow
          value={action.find}
          onChange={(find) => set({ find })}
        />
        <Text
          label="Replace with"
          visibleLabel
          grow
          value={action.replace}
          onChange={(replace) => set({ replace })}
        />
      </>
    );
  } else if (isTabAction(action)) {
    fields = (
      <Text
        label="Tab name"
        visibleLabel
        grow
        value={action.tab}
        onChange={(tab) => set({ tab })}
      />
    );
  }

  return (
    <div className="line">
      <Select
        label="Action"
        value={kind}
        choices={ACTIONS}
        onChange={(value) => set({ action: value })}
      />
      {fields}
      {onDelete && <IconButton label="Delete action" icon="×" onClick={onDelete} />}
    </div>
  );
}

interface FilterCodeProps {
  filter: Filter;
  onChange: (filter: Filter) => void;
}

/** The filter as JSON, for pasting in a filter written elsewhere. */
function FilterCode({ filter, onChange }: FilterCodeProps) {
  // What the user is typing. It is shown as typed until the user leaves the
  // box: laying it out again on every key would move the cursor to the end
  // and take out the spaces and line breaks just typed.
  const [draft, setDraft] = useState<{ text: string; valid: boolean }>();
  const invalid = draft?.valid === false;
  return (
    <details className="code">
      <summary>Filter code</summary>
      <textarea
        className="field"
        rows={8}
        aria-label="Filter code"
        aria-invalid={invalid || undefined}
        value={draft?.text ?? JSON.stringify(filter, null, 2)}
        onChange={(event) => {
          const text = event.target.value;
          const [parsed] = parseFilters(`[${text}]`);
          setDraft({ text, valid: parsed !== undefined });
          if (parsed) {
            onChange(parsed);
          }
        }}
        // Text that is not a filter yet stays, so it can be finished later.
        onBlur={() => setDraft((current) => (current?.valid ? undefined : current))}
      />
      {invalid && <p className="error">Not a filter yet, so not used.</p>}
    </details>
  );
}

function parseFilters(json: string): Filter[] {
  try {
    return readFilters(JSON.parse(json));
  } catch {
    return [];
  }
}

interface FilterEditorProps {
  filter: Filter;
  onChange: (filter: Filter) => void;
  onDone: () => void;
}

function FilterEditor({ filter, onChange, onDone }: FilterEditorProps) {
  const rules = filter.rules ?? [];
  const actions = filter.actions ?? [];
  const set = (changes: Filter) => onChange({ ...filter, ...changes });
  const top = useRef<HTMLDivElement>(null);

  // The editor opens below the section's options, which can fill the dialog.
  useEffect(() => {
    top.current?.scrollIntoView?.({ block: 'start' });
  }, []);

  return (
    <div className="editor" ref={top}>
      <button className="button" type="button" onClick={onDone}>
        ← All filters
      </button>
      <Text
        label="Title"
        visibleLabel
        grow
        value={filter.title}
        onChange={(title) => set({ title })}
      />
      <Text
        label="Description"
        visibleLabel
        grow
        value={filter.description}
        onChange={(description) => set({ description })}
      />

      <fieldset className="group">
        <legend>If</legend>
        {rules.map((rule, index) => (
          <RuleEditor
            // Rules have no identity of their own, and the list only changes at the end or by deletion.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            key={index}
            rule={rule}
            // A filter saved without `match` runs as ANY, so that is what is shown.
            match={index > 0 ? (filter.match ?? 'ANY') : undefined}
            onMatch={(match) => set({ match })}
            onChange={(changed) => set({ rules: replaced(rules, index, changed) })}
            onDelete={rules.length > 1 ? () => set({ rules: without(rules, index) }) : undefined}
          />
        ))}
        <button
          className="button"
          type="button"
          onClick={() => set({ rules: [...rules, newRule()] })}
        >
          Add a condition
        </button>
      </fieldset>

      <fieldset className="group">
        <legend>Then</legend>
        {actions.map((action, index) => (
          <ActionEditor
            // biome-ignore lint/suspicious/noArrayIndexKey: as for the rules
            key={index}
            action={action}
            onChange={(changed) => set({ actions: replaced(actions, index, changed) })}
            onDelete={
              actions.length > 1 ? () => set({ actions: without(actions, index) }) : undefined
            }
          />
        ))}
        <button
          className="button"
          type="button"
          onClick={() => set({ actions: [...actions, newAction()] })}
        >
          Add an action
        </button>
      </fieldset>

      <div className="line">
        <Check
          label="Stop on match: do not try the filters after this one"
          checked={filter.stop_on_match === true}
          onChange={(stop) => set({ stop_on_match: stop })}
        />
        <Check
          label="Enabled"
          checked={filter.enabled !== false}
          onChange={(enabled) => set({ enabled })}
        />
      </div>
      <FilterCode filter={filter} onChange={onChange} />
    </div>
  );
}

/**
 * The filter list and the filter editor, for the Filters section of the
 * options dialog. Not ported from Social Fixer: filter subscriptions, which
 * were downloaded from its server.
 */
export function FiltersPanel({ value: filters, onChange }: PanelProps<Filter[]>) {
  const [editing, setEditing] = useState<number>();
  const edited = editing === undefined ? undefined : filters[editing];

  if (editing !== undefined && edited) {
    return (
      <FilterEditor
        filter={edited}
        onChange={(filter) => onChange(replaced(filters, editing, filter))}
        onDone={() => setEditing(undefined)}
      />
    );
  }

  return (
    <section className="filters">
      <div className="line">
        <h3 className="subheading">Filters</h3>
        <button
          className="button primary"
          type="button"
          onClick={() => {
            onChange([...filters, newFilter()]);
            setEditing(filters.length);
          }}
        >
          Create a new filter
        </button>
      </div>
      <p className="description">
        Every post is tested against the filters from the top down. A filter that matches does what
        it says, and with "stop" ticked the filters below it are skipped.
      </p>
      {filters.length === 0 && <p className="empty">No filters yet.</p>}
      <ul className="filter-list">
        {filters.map((filter, index) => {
          const title = filter.title || 'Untitled filter';
          const set = (changes: Filter) =>
            onChange(replaced(filters, index, { ...filter, ...changes }));
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: filters have no identity of their own
            <li key={index} className={filter.enabled === false ? 'filter off' : 'filter'}>
              <div className="text">
                <span className="title">{title}</span>
                {filter.description && <p className="description">{filter.description}</p>}
              </div>
              <Check
                label="Stop"
                checked={filter.stop_on_match === true}
                onChange={(stop) => set({ stop_on_match: stop })}
              />
              <Check
                label="Enabled"
                checked={filter.enabled !== false}
                onChange={(enabled) => set({ enabled })}
              />
              <IconButton label={`Edit ${title}`} icon="✎" onClick={() => setEditing(index)} />
              <IconButton
                label={`Move ${title} up`}
                icon="▲"
                disabled={index === 0}
                onClick={() => onChange(moved(filters, index, index - 1))}
              />
              <IconButton
                label={`Move ${title} down`}
                icon="▼"
                disabled={index === filters.length - 1}
                onClick={() => onChange(moved(filters, index, index + 1))}
              />
              <IconButton
                label={`Delete ${title}`}
                icon="×"
                onClick={() => onChange(without(filters, index))}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The Filters part of the options dialog, editing the saved filter list. */
export function filtersPanel(data: SavedData): OptionsPanel {
  const saved = savedFilters(data);
  return definePanel<Filter[]>({
    section: 'Filters',
    css,
    ready: saved.ready,
    read: () => saved.get(),
    save: (filters) => saved.set(filters),
    Panel: FiltersPanel,
  });
}
