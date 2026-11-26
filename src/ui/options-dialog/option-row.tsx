import { useId } from 'react';
import type { ReactNode } from 'react';
import type { OptionSpec, Options, OptionValue } from '../../core/options';
import { SettingRow, Switch, TextInput } from '../primitives';
import { useOptionValue } from '../use-option-value';

export interface Edit {
  input: boolean | string;
  value: OptionValue | undefined;
}

export function toEdit(spec: OptionSpec, input: boolean | string): Edit {
  if (typeof spec.default !== 'number') {
    return { input, value: input };
  }
  const number = typeof input === 'string' && input.trim() !== '' ? Number(input) : Number.NaN;
  return { input, value: Number.isFinite(number) ? number : undefined };
}

export interface OptionGroupBucket {
  readonly group: string;
  readonly primary: Array<[string, OptionSpec]>;
  readonly advanced: Array<[string, OptionSpec]>;
}

export function groupSectionOptions(entries: readonly [string, OptionSpec][]): OptionGroupBucket[] {
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

export interface OptionRowProps {
  readonly optionKey: string;
  readonly spec: OptionSpec;
  readonly options: Options;
  readonly edit: Edit | undefined;
  readonly dimmed: boolean;
  readonly requiresLabel?: string;
  readonly pulse: boolean;
  readonly onInstantSave: (key: string, spec: OptionSpec, next: OptionValue) => void;
  readonly onDraftEdit: (key: string, edit: Edit | undefined) => void;
  readonly onCommitDraft: (key: string, spec: OptionSpec, edit: Edit) => void;
}

export function OptionRow({
  optionKey,
  spec,
  options,
  edit,
  dimmed,
  requiresLabel,
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
        disabled={dimmed}
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
        disabled={dimmed}
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
          disabled={dimmed}
          aria-describedby={descId}
          aria-invalid={isInvalid || undefined}
          value={String(shown)}
          onChange={(event) => onDraftEdit(optionKey, toEdit(spec, event.currentTarget.value))}
          onBlur={handleEditorBlur}
        />
        {isDirty && !dimmed && (
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
        <TextInput
          id={inputId}
          type={typeof spec.default === 'number' ? 'number' : 'text'}
          disabled={dimmed}
          {...(descId ? { ariaDescribedBy: descId } : {})}
          ariaInvalid={isInvalid}
          value={String(shown)}
          onValueChange={(nextVal) => onDraftEdit(optionKey, toEdit(spec, nextVal))}
          onBlur={handleEditorBlur}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitIfValid();
            }
          }}
        />
        {isDirty && !dimmed && (
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
      {...(dimmed && requiresLabel ? { hint: `Requires ${requiresLabel}` } : {})}
      htmlFor={inputId}
      {...(descId ? { descriptionId: descId } : {})}
      stacked={Boolean(spec.multiline)}
      dimmed={dimmed}
      nested={Boolean(spec.dependsOn)}
      pulse={pulse}
    >
      {field}
    </SettingRow>
  );
}
