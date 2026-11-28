// The Advanced editor's card for one action: what to do with a matching item
// and the fields that action needs.

import type {
  Action,
  AddClassAction,
  HideAction,
  ReplaceAction,
  StyleAction,
} from '../../core/filter-types';
import type { FilterSchema } from './schema';
import { newAction } from '../../core/filter-types';
import { GroupedSelect, RemoveButton, UnsupportedCard } from './grouped-select';
import { withField } from './list-edit';
import { findActionOption } from './schema';
import { HighlightPresetButtons, PillSwitch } from './simple-editor';
import { highlightPresetForAction } from './simple-model';

export interface ActionCardProps {
  readonly action: Action;
  readonly schema: FilterSchema;
  /** Position in the filter, for accessible names (`Action 2`). */
  readonly index: number;
  readonly error?: string | null;
  readonly onChange: (next: Action) => void;
  readonly onRemove?: (() => void) | undefined;
}

function SelectorField({
  value,
  schema,
  onChange,
}: {
  readonly value: string | undefined;
  readonly schema: FilterSchema;
  readonly onChange: (value: string) => void;
}) {
  return (
    <label className="fr-field-label">
      Only inside elements matching (optional)
      <input
        className="field fr-mono"
        type="text"
        placeholder={
          schema.selectorPlaceholder ?? `Leave empty for the whole ${schema.itemSingular}`
        }
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function HideFields({
  action,
  schema,
  onChange,
}: {
  readonly action: HideAction;
  readonly schema: FilterSchema;
  readonly onChange: (next: Action) => void;
}) {
  const showNote = action.note !== false;
  return (
    <div className="fr-action-fields">
      <PillSwitch
        label="Show a note in its place"
        checked={showNote}
        onChange={(on) =>
          onChange(on ? withField(action, 'note', undefined) : { ...action, note: false })
        }
      />
      {showNote && (
        <>
          <label className="fr-field-label">
            Note text (optional)
            <input
              className="field"
              type="text"
              placeholder="e.g. Hidden: mentions {match}"
              value={action.noteText ?? ''}
              onChange={(event) => onChange(withField(action, 'noteText', event.target.value))}
            />
          </label>
          <span className="fr-section-hint">
            {'{match}'} inserts the words that matched. Leave it empty for the default note on the
            hidden {schema.itemSingular}.
          </span>
        </>
      )}
    </div>
  );
}

function StyleFields({
  action,
  schema,
  onChange,
}: {
  readonly action: StyleAction;
  readonly schema: FilterSchema;
  readonly onChange: (next: Action) => void;
}) {
  const preset = highlightPresetForAction(action);
  return (
    <div className="fr-action-fields">
      <HighlightPresetButtons
        activeId={preset.css === action.css ? preset.id : ''}
        onSelect={(css) => onChange({ ...action, css })}
      />
      <label className="fr-field-label">
        CSS declarations
        <textarea
          className="field fr-mono"
          rows={2}
          placeholder="e.g. background: #fff3c4; border-left: 3px solid orange"
          value={action.css}
          onChange={(event) => onChange({ ...action, css: event.target.value })}
        />
      </label>
      <SelectorField
        value={action.selector}
        schema={schema}
        onChange={(value) => onChange(withField(action, 'selector', value))}
      />
    </div>
  );
}

function ClassFields({
  action,
  schema,
  onChange,
}: {
  readonly action: AddClassAction;
  readonly schema: FilterSchema;
  readonly onChange: (next: Action) => void;
}) {
  return (
    <div className="fr-action-fields">
      <label className="fr-field-label">
        Class names
        <input
          className="field fr-mono"
          type="text"
          placeholder="e.g. my-muted my-flagged"
          value={action.className}
          onChange={(event) => onChange({ ...action, className: event.target.value })}
        />
      </label>
      <SelectorField
        value={action.selector}
        schema={schema}
        onChange={(value) => onChange(withField(action, 'selector', value))}
      />
    </div>
  );
}

function ReplaceFields({
  action,
  onChange,
}: {
  readonly action: ReplaceAction;
  readonly onChange: (next: Action) => void;
}) {
  return (
    <div className="fr-two-col">
      <label className="fr-field-label">
        Find (regex)
        <input
          className="field fr-mono"
          type="text"
          placeholder="e.g. \bcrypto\b"
          value={action.find}
          onChange={(event) => onChange({ ...action, find: event.target.value })}
        />
      </label>
      <label className="fr-field-label">
        Replace with
        <input
          className="field"
          type="text"
          placeholder="e.g. [muted]"
          value={action.replaceWith}
          onChange={(event) => onChange({ ...action, replaceWith: event.target.value })}
        />
      </label>
    </div>
  );
}

function ActionFields({
  action,
  schema,
  onChange,
}: {
  readonly action: Action;
  readonly schema: FilterSchema;
  readonly onChange: (next: Action) => void;
}) {
  switch (action.kind) {
    case 'hide':
      return <HideFields action={action} schema={schema} onChange={onChange} />;
    case 'style':
      return <StyleFields action={action} schema={schema} onChange={onChange} />;
    case 'add_class':
      return <ClassFields action={action} schema={schema} onChange={onChange} />;
    case 'replace':
      return <ReplaceFields action={action} onChange={onChange} />;
    case 'unknown':
      return null;
    default: {
      const hint = findActionOption(schema, action.kind)?.hint;
      return hint ? <p className="fr-section-hint">{hint}</p> : null;
    }
  }
}

/** Editor for one action. */
export function ActionCard({ action, schema, index, error, onChange, onRemove }: ActionCardProps) {
  if (action.kind === 'unknown') {
    return <UnsupportedCard noun="action" index={index} onRemove={onRemove} />;
  }

  return (
    <div className="fr-block-card" data-kind={action.kind}>
      <div className="fr-action-top">
        <GroupedSelect
          label="Action"
          value={action.kind}
          options={schema.actions}
          onChange={(value) => {
            const kind = findActionOption(schema, value)?.value;
            if (kind && kind !== action.kind) {
              onChange(newAction(kind));
            }
          }}
        />
        <RemoveButton noun="action" index={index} onRemove={onRemove} />
      </div>
      <ActionFields action={action} schema={schema} onChange={onChange} />
      {error && (
        <p className="fr-field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
