import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { Filter } from './types';
import { FiltersPanel } from './filters-panel';

afterEach(cleanup);

/** Renders the panel the way the dialog does, keeping the edited list. */
function renderPanel(initial: Filter[]) {
  let current = initial;
  function Host() {
    const [filters, setFilters] = useState(initial);
    current = filters;
    return <FiltersPanel value={filters} onChange={setFilters} />;
  }
  render(<Host />);
  return () => current;
}

const button = (name: string | RegExp) => screen.getByRole<HTMLButtonElement>('button', { name });
const box = (name: string) => screen.getByRole<HTMLInputElement>('textbox', { name });
const list = (name: string) => screen.getByRole<HTMLSelectElement>('combobox', { name });
const check = (name: string | RegExp) => screen.getByRole<HTMLInputElement>('checkbox', { name });

const filter = (title: string, changes: Filter = {}): Filter => ({
  title,
  match: 'ALL',
  enabled: true,
  stop_on_match: true,
  rules: [{ target: 'any', operator: 'contains', matcher: 're', condition: { modifier: 'i' } }],
  actions: [{ action: 'hide' }],
  ...changes,
});

describe('FiltersPanel', () => {
  it('says when there are no filters', () => {
    renderPanel([]);

    expect(screen.getByText('No filters yet.')).toBeTruthy();
  });

  it('creates a filter and opens it for editing', async () => {
    const user = userEvent.setup();
    const filters = renderPanel([]);

    await user.click(button('Create a new filter'));
    await user.type(box('Title'), 'Cats');
    await user.type(box('Text to look for'), 'kittens');
    await user.selectOptions(list('Action'), 'move-to-tab');
    await user.type(box('Tab name'), 'Cat posts');
    await user.click(button('← All filters'));

    expect(filters()).toEqual([
      filter('Cats', {
        rules: [
          {
            target: 'any',
            operator: 'contains',
            matcher: 're',
            condition: { modifier: 'i', text: 'kittens' },
          },
        ],
        actions: [{ action: 'move-to-tab', tab: 'Cat posts' }],
      }),
    ]);
    expect(screen.getByText('Cats')).toBeTruthy();
  });

  it('turns filters on and off, reorders and deletes them from the list', async () => {
    const user = userEvent.setup();
    const filters = renderPanel([filter('One'), filter('Two'), filter('Three')]);

    expect(button('Move One up').disabled).toBe(true);
    await user.click(button('Move Three up'));
    await user.click(button('Delete One'));
    await user.click(screen.getAllByRole('checkbox', { name: 'Enabled' })[0] as HTMLElement);
    await user.click(screen.getAllByRole('checkbox', { name: 'Stop' })[1] as HTMLElement);

    expect(filters()).toEqual([
      filter('Three', { enabled: false }),
      filter('Two', { stop_on_match: false }),
    ]);
  });

  it('adds and removes conditions and actions, and sets how conditions combine', async () => {
    const user = userEvent.setup();
    const filters = renderPanel([filter('One')]);

    await user.click(button('Edit One'));
    expect(screen.queryByRole('button', { name: 'Delete condition' })).toBeNull();
    await user.click(button('Add a condition'));
    await user.selectOptions(list('Combine with'), 'ANY');
    await user.selectOptions(
      screen.getAllByRole('combobox', { name: 'Part of the post' })[1] as HTMLElement,
      'author',
    );
    await user.click(screen.getAllByRole('checkbox', { name: 'not' })[1] as HTMLElement);
    await user.click(button('Add an action'));
    await user.click(screen.getAllByRole('button', { name: 'Delete action' })[0] as HTMLElement);
    await user.click(check('leave a note'));

    const [edited] = filters();
    expect(edited?.match).toBe('ANY');
    expect(edited?.rules?.[1]).toMatchObject({ target: 'author', not: true });
    expect(edited?.actions).toEqual([{ action: 'hide', show_note: true }]);
  });

  it('shows the inputs that fit the comparison', async () => {
    const user = userEvent.setup();
    renderPanel([filter('One')]);
    await user.click(button('Edit One'));

    expect(check('partial words')).toBeTruthy();
    await user.selectOptions(list('Comparison'), 'matches');
    expect(box('Regex flags')).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Case' })).toBeNull();
    await user.selectOptions(list('Comparison'), 'contains_selector');
    expect(box('CSS selector')).toBeTruthy();
  });

  it('keeps a saved choice it does not offer', async () => {
    const user = userEvent.setup();
    const filters = renderPanel([
      filter('One', {
        rules: [{ target: 'page', operator: 'contains', condition: {} }],
        actions: [{ action: 'read' }],
      }),
    ]);

    await user.click(button('Edit One'));

    expect(list('Part of the post').value).toBe('page');
    expect(list('Action').selectedOptions[0]?.textContent).toBe('read (not supported yet)');
    expect(filters()[0]?.actions).toEqual([{ action: 'read' }]);
  });

  it('takes a filter pasted in as code, once it is valid', async () => {
    const user = userEvent.setup();
    const filters = renderPanel([filter('One')]);
    await user.click(button('Edit One'));
    const code = box('Filter code');

    fireEvent.change(code, { target: { value: '{"title": "Pasted"' } });
    expect(screen.getByText('Not a filter yet, so not used.')).toBeTruthy();
    expect(filters()[0]?.title).toBe('One');

    fireEvent.change(code, { target: { value: '{"title": "Pasted", "rules": []}' } });
    expect(filters()).toEqual([{ title: 'Pasted', rules: [] }]);
    expect(box('Title').value).toBe('Pasted');
  });

  it('leaves the code as typed until the box is left', async () => {
    const user = userEvent.setup();
    renderPanel([filter('One')]);
    await user.click(button('Edit One'));
    const code = box('Filter code');
    const typed = '{"title":   "Spaced"}\n';

    fireEvent.change(code, { target: { value: typed } });
    expect(code.value).toBe(typed);
    expect(box('Title').value).toBe('Spaced');

    fireEvent.focusOut(code);
    expect(code.value).toBe(JSON.stringify({ title: 'Spaced' }, null, 2));
  });

  it('reads pasted rules and actions that are not lists of objects as lists', async () => {
    const user = userEvent.setup();
    const filters = renderPanel([filter('One')]);
    await user.click(button('Edit One'));

    fireEvent.change(box('Filter code'), {
      target: { value: '{"rules": {"0": {"target": "author"}, "1": null}, "actions": "hide"}' },
    });

    expect(filters()).toEqual([{ rules: [{ target: 'author' }], actions: [] }]);
    expect(list('Part of the post').value).toBe('author');
  });

  it('shows a filter saved without a way to combine as the engine runs it', async () => {
    const user = userEvent.setup();
    const { match: _match, ...unset } = filter('One', {
      rules: [
        { target: 'any', condition: {} },
        { target: 'author', condition: {} },
      ],
    });
    renderPanel([unset]);

    await user.click(button('Edit One'));

    expect(list('Combine with').value).toBe('ANY');
  });
});
