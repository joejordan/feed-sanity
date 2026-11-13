import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { OptionSpec, Options, OptionValue } from '../../core/options';
import { OPTIONS_TITLE } from '../../../project';
import { createLogger } from '../../core/log';
import { useOptionValue } from '../use-option-value';

const log = createLogger('options');

/**
 * Something the user has typed or ticked but not saved. `input` is what the
 * control shows. `value` is what Save stores, or undefined when the input is
 * not a valid number.
 */
interface Edit {
  input: boolean | string;
  value: OptionValue | undefined;
}

/** What an input saves as for this option. Number options keep their text as typed until then. */
function toEdit(spec: OptionSpec, input: boolean | string): Edit {
  if (typeof spec.default !== 'number') {
    return { input, value: input };
  }
  const number = typeof input === 'string' && input.trim() !== '' ? Number(input) : Number.NaN;
  return { input, value: Number.isFinite(number) ? number : undefined };
}

function matches(spec: OptionSpec, query: string): boolean {
  return `${spec.title}\n${spec.description}`.toLowerCase().includes(query);
}

interface OptionRowProps {
  optionKey: string;
  spec: OptionSpec;
  options: Options;
  edit: Edit | undefined;
  onEdit: (key: string, edit: Edit) => void;
}

function OptionRow({ optionKey, spec, options, edit, onEdit }: OptionRowProps) {
  const id = useId();
  const saved = useOptionValue(options, optionKey);
  const shown = edit ? edit.input : saved;
  const control = {
    'id': `${id}-input`,
    'aria-describedby': spec.description ? `${id}-description` : undefined,
    'aria-invalid': (edit && edit.value === undefined) || undefined,
  };
  const onText = (event: { target: HTMLInputElement | HTMLTextAreaElement }) =>
    onEdit(optionKey, toEdit(spec, event.target.value));

  let field: ReactNode;
  if (typeof spec.default === 'boolean') {
    field = (
      <input
        {...control}
        type="checkbox"
        checked={shown === true}
        onChange={(event) => onEdit(optionKey, toEdit(spec, event.target.checked))}
      />
    );
  } else if (spec.multiline) {
    field = (
      <textarea {...control} className="field" rows={6} value={String(shown)} onChange={onText} />
    );
  } else {
    field = (
      <input
        {...control}
        className="field"
        type={typeof spec.default === 'number' ? 'number' : 'text'}
        value={String(shown)}
        onChange={onText}
      />
    );
  }

  return (
    <div className={spec.multiline ? 'row stacked' : 'row'}>
      <div className="text">
        <label className="title" htmlFor={control.id}>
          {spec.title}
        </label>
        {spec.description && (
          <p className="description" id={`${id}-description`}>
            {spec.description}
          </p>
        )}
      </div>
      {field}
    </div>
  );
}

export interface OptionsDialogProps {
  options: Options;
  /** Called when the user closes the dialog, after any save has finished. */
  onClose: () => void;
}

/**
 * Lists every registered option by section. Changes are kept aside until the
 * user saves them, as in Social Fixer. Cancel, Escape and the close button
 * drop them.
 */
export function OptionsDialog({ options, onClose }: OptionsDialogProps) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const { all, sections } = useMemo(() => {
    const list = options.list();
    return { all: list, sections: [...new Set(list.map(([, spec]) => spec.section))] };
  }, [options]);
  const [section, setSection] = useState(sections[0]);
  const [search, setSearch] = useState('');
  const [edits, setEdits] = useState<ReadonlyMap<string, Edit>>(new Map());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const query = search.trim().toLowerCase();
  const shown = all.filter(([, spec]) => (query ? matches(spec, query) : spec.section === section));
  // Named, because the option can be in a section that is not shown.
  const invalid = all.flatMap(([key, spec]) => {
    const edit = edits.get(key);
    return edit && edit.value === undefined ? [spec.title] : [];
  });

  const onEdit = (key: string, edit: Edit) => {
    setEdits((previous) => new Map(previous).set(key, edit));
  };

  const save = async () => {
    setSaving(true);
    try {
      await Promise.all(
        [...edits].map(([key, { value }]) =>
          value === undefined ? undefined : options.set(key, value),
        ),
      );
    } catch (error) {
      log.error('could not save the options', error);
    } finally {
      onClose();
    }
  };

  return (
    <dialog
      ref={dialog}
      className="dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Escape. Close through the same path as the buttons.
        event.preventDefault();
        onClose();
      }}
    >
      <header className="header">
        <h2 className="heading" id={titleId}>
          {OPTIONS_TITLE}
        </h2>
        <input
          className="field search"
          type="search"
          placeholder="Search options"
          aria-label="Search options"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <button className="close" type="button" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="body">
        <nav className="sections" aria-label="Sections">
          {sections.map((name) => (
            <button
              key={name}
              className="section"
              type="button"
              aria-current={!query && name === section ? 'page' : undefined}
              onClick={() => {
                setSearch('');
                setSection(name);
              }}
            >
              {name}
            </button>
          ))}
        </nav>
        <div className="list">
          {shown.length === 0 && (
            <p className="empty">{query ? 'No options match.' : 'Nothing to set here yet.'}</p>
          )}
          {shown.map(([key, spec]) => (
            <OptionRow
              key={key}
              optionKey={key}
              spec={spec}
              options={options}
              edit={edits.get(key)}
              onEdit={onEdit}
            />
          ))}
        </div>
      </div>
      <footer className="footer">
        {invalid.length > 0 && (
          <p className="error">Not a number, so not saved yet: {invalid.join(', ')}.</p>
        )}
        <button className="button" type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button primary"
          type="button"
          disabled={edits.size === 0 || invalid.length > 0 || saving}
          onClick={() => void save()}
        >
          Save
        </button>
      </footer>
    </dialog>
  );
}
