import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { Filter } from '../../core/filter-types';
import type { FilterSchema } from './schema';
import { newCondition, newFilter } from '../../core/filter-types';
import { FACEBOOK_FILTER_SCHEMA } from '../../features/post-filters/schema';
import { X_FILTER_SCHEMA } from '../../sites/x/filter-schema';
import { FilterEditor } from './filter-editor';

afterEach(cleanup);

function renderEditor(initial: Filter, schema: FilterSchema = FACEBOOK_FILTER_SCHEMA) {
  let current = initial;
  const pasted: (readonly Filter[])[] = [];
  function Host() {
    const [filter, setFilter] = useState(initial);
    current = filter;
    return (
      <FilterEditor
        filter={filter}
        schema={schema}
        isCreate={false}
        initialMode="advanced"
        onChange={setFilter}
        onCommit={setFilter}
        onCancel={() => undefined}
        onBack={setFilter}
        onPasteList={(list) => {
          pasted.push(list);
          if (list[0]) {
            setFilter(list[0]);
          }
        }}
      />
    );
  }
  render(<Host />);
  return { filter: () => current, pasted };
}

const card = (kind: string) =>
  document.querySelector<HTMLElement>(`.fr-block-card[data-kind="${kind}"]`) as HTMLElement;

describe('condition card', () => {
  it('switches tests and keeps only the options each test uses', async () => {
    const user = userEvent.setup();
    const editor = renderEditor(
      newFilter({ conditions: [{ ...newCondition('text'), values: ['cat'], wholeWords: true }] }),
    );

    // Whole words is for "contains" only; it goes when the test changes.
    expect(screen.getByRole('checkbox', { name: /Whole words only/ })).toBeTruthy();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Test' }), 'regex');
    expect(editor.filter().conditions[0]).toEqual({
      kind: 'text',
      part: 'text',
      test: 'regex',
      values: ['cat'],
    });
    expect(screen.queryByRole('checkbox', { name: /Whole words only/ })).toBeNull();

    // Flags: only valid, non-repeated flags other than the case flag.
    const flags = screen.getByRole('textbox', { name: 'Regex flags' });
    await user.type(flags, 'mm');
    expect(screen.getByRole('alert').textContent).toContain('twice');
    await user.clear(flags);
    await user.type(flags, 'i');
    expect(screen.getByRole('alert').textContent).toContain('Match case');
    await user.clear(flags);
    await user.type(flags, 's');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(editor.filter().conditions[0]).toMatchObject({ regexFlags: 's' });

    // A regex that does not compile is reported on the card.
    const pattern = screen.getByRole('textbox', { name: 'Pattern' });
    await user.clear(pattern);
    fireEvent.input(pattern, { target: { value: '(open' } });
    expect(screen.getByRole('alert').textContent).toContain('Invalid regular expression');

    // Back to a literal test drops the flags.
    await user.selectOptions(screen.getByRole('combobox', { name: 'Test' }), 'starts');
    expect(editor.filter().conditions[0]).toEqual({
      kind: 'text',
      part: 'text',
      test: 'starts',
      values: ['(open'],
    });
  });

  it('negates, matches case and edits several values', async () => {
    const user = userEvent.setup();
    const editor = renderEditor(newFilter({ conditions: [newCondition('author')] }));

    await user.type(screen.getByRole('textbox', { name: 'Value' }), 'Sam');
    await user.click(screen.getByRole('button', { name: '+ Or another value' }));
    await user.type(screen.getByRole('textbox', { name: 'Value 2' }), 'Alex');
    expect(editor.filter().conditions[0]).toMatchObject({ values: ['Sam', 'Alex'] });

    await user.click(screen.getByRole('checkbox', { name: /does not contain/ }));
    await user.click(screen.getByRole('checkbox', { name: /Match case/ }));
    expect(editor.filter().conditions[0]).toMatchObject({ negate: true, matchCase: true });
    await user.click(screen.getByRole('checkbox', { name: /does not contain/ }));
    expect(editor.filter().conditions[0]).not.toHaveProperty('negate');

    await user.click(screen.getByRole('button', { name: 'Remove value 1' }));
    expect(editor.filter().conditions[0]).toMatchObject({ values: ['Alex'] });
  });

  it('offers the element test only on the whole-item part', async () => {
    const user = userEvent.setup();
    const editor = renderEditor(
      newFilter({ conditions: [{ ...newCondition(), values: ['video'] }] }),
    );
    const test = () => screen.getByRole<HTMLSelectElement>('combobox', { name: 'Test' });

    await user.selectOptions(test(), 'element');
    expect(editor.filter().conditions[0]).toEqual({ kind: 'element', selector: 'video' });
    await user.type(screen.getByRole('textbox', { name: 'CSS selector' }), '[[');
    expect(screen.getByRole('alert').textContent).toContain('CSS selector');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Part of the post' }), 'author');
    expect(editor.filter().conditions[0]).toEqual(newCondition('author'));
    expect([...test().options].map((option) => option.value)).not.toContain('element');
  });

  it('edits weekday conditions and combines conditions with all or any', async () => {
    const user = userEvent.setup();
    const editor = renderEditor(newFilter());

    expect(screen.queryByRole('group', { name: 'Combine conditions' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add condition' }));
    await user.click(screen.getByRole('button', { name: 'all conditions' }));
    expect(editor.filter().join).toBe('all');
    expect(screen.getByText('AND')).toBeTruthy();

    const second = screen.getAllByRole('combobox', { name: 'Part of the post' })[1] as HTMLElement;
    await user.selectOptions(second, 'weekday');
    expect(editor.filter().conditions[1]).toEqual({ kind: 'weekday', days: [] });
    await user.click(within(card('weekday')).getByRole('checkbox', { name: 'Sat' }));
    await user.click(within(card('weekday')).getByRole('checkbox', { name: 'Mon' }));
    expect(editor.filter().conditions[1]).toEqual({ kind: 'weekday', days: [1, 6] });

    await user.click(screen.getByRole('button', { name: 'Remove condition 1' }));
    expect(editor.filter().conditions).toEqual([{ kind: 'weekday', days: [1, 6] }]);
  });

  it('edits age conditions saved in a filter', async () => {
    const user = userEvent.setup();
    const editor = renderEditor(
      newFilter({ conditions: [{ kind: 'age', olderThan: true, amount: 2, unit: 'days' }] }),
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Older or newer' }), 'newer');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Unit' }), 'hours');
    fireEvent.input(screen.getByRole('spinbutton', { name: 'Amount' }), { target: { value: '6' } });
    expect(editor.filter().conditions[0]).toEqual({
      kind: 'age',
      olderThan: false,
      amount: 6,
      unit: 'hours',
    });
  });
});

describe('action card and filter details', () => {
  it('edits each action kind', async () => {
    const user = userEvent.setup();
    const editor = renderEditor(newFilter());

    await user.click(screen.getByRole('checkbox', { name: 'Show a note in its place' }));
    expect(editor.filter().actions[0]).toEqual({ kind: 'hide', note: false });
    await user.click(screen.getByRole('checkbox', { name: 'Show a note in its place' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Note text (optional)' }),
      'About {{match}',
    );
    // Turning the note back on returns to the default (follow the site's setting).
    expect(editor.filter().actions[0]).toEqual({ kind: 'hide', noteText: 'About {match}' });

    const action = () => screen.getByRole('combobox', { name: 'Action' });
    await user.selectOptions(action(), 'style');
    await user.click(screen.getByRole('button', { name: /Green tint/ }));
    await user.type(
      screen.getByRole('textbox', { name: 'Only inside elements matching (optional)' }),
      'a',
    );
    expect(editor.filter().actions[0]).toMatchObject({
      kind: 'style',
      css: expect.stringContaining('#16a34a'),
      selector: 'a',
    });

    await user.selectOptions(action(), 'add_class');
    await user.type(screen.getByRole('textbox', { name: 'Class names' }), 'muted');
    expect(editor.filter().actions[0]).toEqual({ kind: 'add_class', className: 'muted' });

    await user.selectOptions(action(), 'replace');
    await user.type(screen.getByRole('textbox', { name: 'Find (regex)' }), '(');
    expect(screen.getByRole('alert').textContent).toContain('Invalid find pattern');
    await user.type(screen.getByRole('textbox', { name: 'Replace with' }), 'x');
    expect(editor.filter().actions[0]).toEqual({ kind: 'replace', find: '(', replaceWith: 'x' });

    await user.click(screen.getByRole('button', { name: 'Add action' }));
    const second = screen.getAllByRole('combobox', { name: 'Action' })[1] as HTMLElement;
    await user.selectOptions(second, 'set_read');
    expect(editor.filter().actions[1]).toEqual({ kind: 'set_read' });
    expect(screen.getByText('Marks the post as read.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Remove action 1' }));
    expect(editor.filter().actions).toEqual([{ kind: 'set_read' }]);
  });

  it('sets the name, description, enabled and stop switches', async () => {
    const user = userEvent.setup();
    const editor = renderEditor(newFilter());

    await user.click(screen.getByRole('button', { name: 'Rename filter' }));
    const name = screen.getByRole('textbox', { name: 'Name' });
    const escapeKey = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    name.dispatchEvent(escapeKey);
    expect(escapeKey.defaultPrevented).toBe(true);
    await user.click(await screen.findByRole('button', { name: 'Rename filter' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'No spoilers{Enter}');
    expect(editor.filter().name).toBe('No spoilers');

    await user.type(screen.getByRole('textbox', { name: 'Description (optional)' }), 'tv');
    await user.click(screen.getByRole('checkbox', { name: 'Enabled' }));
    await user.click(
      screen.getByRole('checkbox', { name: 'Stop later filters when this one matches' }),
    );
    expect(editor.filter()).toMatchObject({ description: 'tv', enabled: false, stopAfter: true });
  });
});

describe('filter code box', () => {
  const code = () => screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Filter code' });

  it('shows the filter as JSON and reads an edited filter back, keeping its id', () => {
    const start = newFilter({ name: 'Start' });
    const editor = renderEditor(start);
    expect(JSON.parse(code().value)).toEqual(start);

    const pasted = { ...newFilter({ name: 'Pasted', join: 'all' }), id: 'other' };
    fireEvent.input(code(), { target: { value: JSON.stringify(pasted) } });
    expect(editor.filter()).toEqual({ ...pasted, id: start.id });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports invalid input inline and drops the draft after another edit', async () => {
    const user = userEvent.setup();
    const start = newFilter({ name: 'Start' });
    const editor = renderEditor(start);

    fireEvent.input(code(), { target: { value: '{broken' } });
    expect(screen.getByRole('alert').textContent).toContain('Not valid JSON yet');
    expect(code().value).toBe('{broken');
    expect(editor.filter()).toBe(start);

    fireEvent.input(code(), { target: { value: '[1, "x"]' } });
    expect(screen.getByRole('alert').textContent).toContain('No filter in this code');

    await user.click(screen.getByRole('checkbox', { name: 'Enabled' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(JSON.parse(code().value)).toMatchObject({ name: 'Start', enabled: false });
  });

  it('hands a pasted list to the panel and keeps unknown kinds', () => {
    const start = newFilter();
    const editor = renderEditor(start);
    const list = [
      { name: 'One', conditions: [{ kind: 'colour', value: 'red' }], actions: [{ kind: 'hide' }] },
      { name: 'Two' },
    ];
    fireEvent.input(code(), { target: { value: JSON.stringify(list) } });

    expect(editor.pasted).toHaveLength(1);
    expect(editor.pasted[0]?.map((filter) => filter.name)).toEqual(['One', 'Two']);
    expect(editor.filter().id).toBe(start.id);
    expect(editor.filter().conditions[0]).toEqual({
      kind: 'unknown',
      original: { kind: 'colour', value: 'red' },
    });
    expect(screen.getByText('Added 1 more filter after this one.')).toBeTruthy();
    expect(screen.getByText(/saved by another version/)).toBeTruthy();
  });
});

describe('mode switch', () => {
  it('locks Simple mode while the filter needs Advanced, and unlocks it again', async () => {
    const user = userEvent.setup();
    renderEditor(
      newFilter({ conditions: [{ ...newCondition('text'), values: ['x'] }] }),
      X_FILTER_SCHEMA,
    );
    const simple = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Simple' });

    expect(simple().disabled).toBe(false);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Part of the post' }), 'weekday');
    expect(simple().disabled).toBe(true);
    expect(screen.getByText(/Advanced only/)).toBeTruthy();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Part of the post' }), 'text');
    expect(simple().disabled).toBe(false);
    await user.click(simple());
    expect(screen.getByRole('textbox', { name: 'Text to look for' })).toBeTruthy();
  });
});
