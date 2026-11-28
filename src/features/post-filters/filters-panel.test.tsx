import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import type { Filter } from '../../core/filter-types';
import type { OptionsPanel } from '../../ui/options-dialog/panel';
import { CUSTOM_FILTERS_KEY, newCondition, newFilter, readFilters } from '../../core/filter-types';
import { SavedData } from '../../core/saved';
import { inMemoryStore } from '../../core/testing';
import { filtersPanel } from './filters-panel';
import { FACEBOOK_FILTER_SCHEMA } from './schema';

afterEach(cleanup);

const PREFIX = 'v2/facebook/1';

async function openPanel(saved: unknown[] = []) {
  const store = inMemoryStore({ [`${PREFIX}/${CUSTOM_FILTERS_KEY}`]: saved });
  const data = new SavedData(store, PREFIX);
  const panel = filtersPanel(data) as OptionsPanel<Filter[]>;
  await panel.ready;
  let current = panel.read();
  function Host(): ReactNode {
    const [filters, setFilters] = useState(current);
    current = filters;
    return panel.Panel({ value: filters, onChange: setFilters });
  }
  render(<Host />);
  return { panel, value: () => current, store };
}

describe('Facebook filters panel', () => {
  it('is in the Filtering section, counts enabled filters and saves the list', async () => {
    const { panel, store, value } = await openPanel([
      {
        id: 'a',
        name: 'Hide spoilers',
        conditions: [{ kind: 'text', part: 'text', values: ['spoiler'] }],
        actions: [{ kind: 'hide' }],
      },
      { id: 'b', name: 'Paused', enabled: false },
    ]);
    expect(panel.section).toBe('Filtering');
    expect(panel.badge?.()).toBe('1');
    expect(screen.getByText('Hide spoilers')).toBeTruthy();
    expect(screen.getByText(/Anything in the post contains "spoiler"/)).toBeTruthy();
    expect(panel.searchItems?.().map((item) => item.id)).toEqual([
      'create-filter',
      'filter:a',
      'filter:b',
    ]);

    await panel.save(value());
    expect(readFilters(await store.get(`${PREFIX}/${CUSTOM_FILTERS_KEY}`))).toEqual(value());
  });

  it('builds a Simple filter on a Facebook part from the target pills', async () => {
    const user = userEvent.setup();
    const { value } = await openPanel();

    await user.click(screen.getByRole('button', { name: 'Create a new filter' }));
    expect(
      ['Anything', 'Author', 'Group', 'Hashtag'].map((name) =>
        screen.getByRole('button', { name }),
      ),
    ).toHaveLength(4);
    await user.click(screen.getByRole('button', { name: 'Group' }));
    await user.type(screen.getByRole('textbox', { name: 'Text to look for' }), 'Cat Club{Enter}');
    expect(screen.getByText('Matches sample')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Add filter' }));

    expect(value()).toHaveLength(1);
    expect(value()[0]?.conditions).toEqual([
      { kind: 'text', part: 'group', test: 'contains', values: ['Cat Club'] },
    ]);
  });

  it('starts the mark-read recipe in Advanced mode with the Facebook-only action', async () => {
    const user = userEvent.setup();
    const { value } = await openPanel();

    await user.click(screen.getByRole('button', { name: /Mark posts read by keyword/ }));
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Action' }).value).toBe(
      'set_read',
    );
    await user.type(screen.getByRole('textbox', { name: 'Value' }), 'recipe');
    expect(value()[0]).toMatchObject({
      name: 'Mark read by keyword',
      actions: [{ kind: 'set_read' }],
    });
  });

  it('edits an existing filter and pastes a list of filters into the code box', async () => {
    const user = userEvent.setup();
    const first = newFilter({
      name: 'First',
      conditions: [{ ...newCondition('body'), values: ['a'] }],
    });
    const last = newFilter({
      name: 'Last',
      conditions: [{ ...newCondition('body'), values: ['z'] }],
    });
    const { value } = await openPanel([first, last]);

    await user.click(screen.getByRole('button', { name: 'Edit First' }));
    // `body` is not a Simple pill on Facebook, so the editor opens in Advanced.
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Simple' }).disabled).toBe(true);

    const pasted = [
      { name: 'Pasted one', conditions: [{ kind: 'text', part: 'author', values: ['Sam'] }] },
      { id: last.id, name: 'Pasted two', conditions: [{ kind: 'weekday', days: [0] }] },
    ];
    fireEvent.input(screen.getByRole('textbox', { name: 'Filter code' }), {
      target: { value: JSON.stringify(pasted) },
    });
    expect(value().map((filter) => filter.name)).toEqual(['Pasted one', 'Pasted two', 'Last']);
    expect(value()[0]?.id).toBe(first.id);
    // A pasted id that is already in the list is renewed.
    expect(new Set(value().map((filter) => filter.id)).size).toBe(3);

    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByText('Pasted two')).toBeTruthy();
  });

  it('blocks saving while an enabled filter has an invalid regex or selector', async () => {
    const user = userEvent.setup();
    const { panel, value } = await openPanel([
      newFilter({ name: 'Video posts', conditions: [{ kind: 'element', selector: 'video' }] }),
    ]);
    expect(panel.problem?.(value())).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Edit Video posts' }));
    const selector = screen.getByRole('textbox', { name: 'CSS selector' });
    await user.type(selector, '[[');
    expect(screen.getByRole('alert').textContent).toContain('CSS selector');
    expect(panel.problem?.(value())).toContain('Video posts');

    await user.click(screen.getByRole('checkbox', { name: 'Enabled' }));
    expect(panel.problem?.(value())).toBeNull();

    const regex = newFilter({
      name: 'Bad pattern',
      conditions: [{ ...newCondition('text'), test: 'regex', values: ['(open'] }],
    });
    expect(panel.problem?.([regex])).toContain('Bad pattern');
  });

  it('offers every Facebook part, grouped, plus the day of the week', () => {
    const parts = FACEBOOK_FILTER_SCHEMA.targets.map((target) => target.value);
    expect(parts).toEqual([
      'text',
      'text_with_images',
      'body',
      'header',
      'author',
      'group',
      'hashtags',
      'link_urls',
      'link_texts',
      'image_text',
      'suggested',
      'sponsored',
      'weekday',
      'age',
    ]);
    expect(FACEBOOK_FILTER_SCHEMA.actions.map((action) => action.value)).toEqual([
      'hide',
      'style',
      'keep',
      'add_class',
      'replace',
      'set_read',
      'set_unread',
    ]);
    for (const recipe of FACEBOOK_FILTER_SCHEMA.recipes) {
      expect(readFilters([recipe.create()])).toHaveLength(1);
    }
  });
});
