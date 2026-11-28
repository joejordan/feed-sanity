import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { Filter } from '../../core/filter-types';
import type { FilterSchema } from './schema';
import { newAction, newCondition, newFilter } from '../../core/filter-types';
import { GMAIL_FILTER_SCHEMA } from '../../sites/gmail/filter-schema';
import { INSTAGRAM_FILTER_SCHEMA } from '../../sites/instagram/filter-schema';
import { X_FILTER_SCHEMA } from '../../sites/x/filter-schema';
import { SiteFiltersPanel } from './filters-panel';

afterEach(cleanup);

function renderSitePanel(schema: FilterSchema, initial: Filter[]) {
  let current = initial;
  function Host() {
    const [filters, setFilters] = useState(initial);
    current = filters;
    return <SiteFiltersPanel value={filters} onChange={setFilters} schema={schema} />;
  }
  render(<Host />);
  return () => current;
}

function wordFilter(name: string, part: string, word: string, extra: Partial<Filter> = {}) {
  return newFilter({
    name,
    conditions: [{ ...newCondition(part), values: [word] }],
    ...extra,
  });
}

describe('SiteFiltersPanel', () => {
  it('starts a recipe in Simple mode, applies a highlight preset and previews it live', async () => {
    const user = userEvent.setup();
    const filters = renderSitePanel(X_FILTER_SCHEMA, []);

    await user.click(screen.getByRole('button', { name: /Highlight a favorite @handle/i }));
    await user.type(screen.getByRole('textbox', { name: 'Text to look for' }), 'alexdev');
    await user.click(screen.getByRole('button', { name: /Warm highlight/i }));

    const [created] = filters();
    expect(created?.name).toBe('Highlight account');
    expect(created?.conditions).toEqual([
      { kind: 'text', part: 'author', test: 'contains', values: ['alexdev'] },
    ]);
    expect(created?.actions[0]).toMatchObject({
      kind: 'style',
      css: expect.stringContaining('#d97706'),
    });
    // X's sample author is `Alex Rivera @alexdev`.
    expect(screen.getByText('Matches sample')).toBeTruthy();

    // More options opens Advanced with the same filter and the tester.
    await user.click(screen.getByRole('button', { name: 'More options' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Sample Author or @handle' }), {
      target: { value: 'someone else' },
    });
    expect(screen.getByRole('status').textContent).toContain('No match');
  });

  it('offers a smart target switch and previews the note bar', async () => {
    const user = userEvent.setup();
    const filters = renderSitePanel(X_FILTER_SCHEMA, []);

    await user.click(screen.getByRole('button', { name: 'Create a new filter' }));
    await user.type(screen.getByRole('textbox', { name: 'Text to look for' }), '#airdrop');
    await user.click(screen.getByRole('button', { name: 'Match as Hashtag' }));
    expect(screen.getByRole('button', { name: 'Hashtag' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(filters()[0]?.conditions[0]).toMatchObject({ part: 'hashtags', values: ['airdrop'] });

    await user.click(screen.getByRole('button', { name: 'Show' }));
    await user.click(screen.getByRole('button', { name: 'Hide again' }));
    expect(screen.getByRole('button', { name: 'Show' })).toBeTruthy();
  });

  it('adds a filter from the Quick Hide bar with Undo and Edit', async () => {
    const user = userEvent.setup();
    const filters = renderSitePanel(GMAIL_FILTER_SCHEMA, []);

    await user.type(
      screen.getByRole('textbox', { name: 'Quick hide on Gmail' }),
      'newsletter, digest{Enter}',
    );
    expect(filters()).toHaveLength(1);
    expect(filters()[0]?.conditions).toEqual([
      { kind: 'text', part: 'text', test: 'contains', values: ['newsletter', 'digest'] },
    ]);
    expect(filters()[0]?.actions).toEqual([{ kind: 'hide' }]);
    expect(screen.getByRole('status').textContent).toContain('Added');

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: /Highlight/ }));
    expect(document.querySelector('.fr-preview-row')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(filters()[0]?.actions[0]?.kind).toBe('style');

    await user.click(screen.getByRole('button', { name: /^Delete/ }));
    expect(filters()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(filters()).toHaveLength(1);
  });

  it('searches, filters by status, duplicates with a new id and marks stop filters', async () => {
    const user = userEvent.setup();
    const initial = [
      wordFilter('Hide promos', 'sender', 'promo'),
      wordFilter('Highlight invoices', 'subject', 'invoice', {
        actions: [{ kind: 'style', css: 'border-left: 3px solid #d97706;' }],
      }),
      wordFilter('Paused filter', 'text', 'digest', { enabled: false }),
      wordFilter('Keep VIP', 'sender', 'ceo@', { stopAfter: true, actions: [newAction('keep')] }),
    ];
    const filters = renderSitePanel(GMAIL_FILTER_SCHEMA, initial);

    expect(screen.getByText('3 active / 4')).toBeTruthy();
    expect(screen.getByText('Stop')).toBeTruthy();

    const search = screen.getByRole('searchbox', { name: 'Search filters' });
    await user.type(search, 'invoice');
    expect(screen.getByText('Highlight invoices')).toBeTruthy();
    expect(screen.queryByText('Hide promos')).toBeNull();
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Move Highlight invoices up' })
        .disabled,
    ).toBe(true);

    await user.clear(search);
    await user.click(screen.getByRole('button', { name: 'Paused' }));
    expect(screen.getByText('Paused filter')).toBeTruthy();
    expect(screen.queryByText('Highlight invoices')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'All' }));
    await user.click(screen.getByRole('button', { name: 'Duplicate Keep VIP' }));
    const copy = filters()[4];
    expect(copy?.name).toBe('Keep VIP (copy)');
    expect(copy?.id).not.toBe(initial[3]?.id);
    expect(new Set(filters().map((filter) => filter.id)).size).toBe(5);

    await user.click(screen.getByRole('checkbox', { name: 'Enable Hide promos' }));
    expect(filters()[0]?.enabled).toBe(false);
  });

  it('marks invalid filters and opens them in Advanced with the error shown', async () => {
    const user = userEvent.setup();
    const broken = newFilter({
      name: 'Bad regex',
      conditions: [{ ...newCondition('text'), test: 'regex', values: ['(unclosed'] }],
    });
    renderSitePanel(X_FILTER_SCHEMA, [broken]);
    expect(screen.getByText('Invalid')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Edit Bad regex' }));
    expect(screen.getByRole('alert').textContent).toContain('Invalid regular expression');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Simple' }).disabled).toBe(true);
  });

  it('keeps the search box while filtered below four filters and reorders by id keys', async () => {
    const user = userEvent.setup();
    const four = ['Alpha', 'Beta', 'Gamma', 'Delta'].map((name) =>
      wordFilter(name, 'text', name.toLowerCase()),
    );
    const filters = renderSitePanel(GMAIL_FILTER_SCHEMA, four);

    const search = screen.getByRole('searchbox', { name: 'Search filters' });
    await user.type(search, 'Alpha');
    await user.click(screen.getByRole('button', { name: 'Delete Alpha' }));
    expect(screen.getByRole('searchbox', { name: 'Search filters' })).toBeTruthy();
    await user.clear(search);

    await user.click(screen.getByRole('button', { name: 'Move Delta up' }));
    expect(filters().map((filter) => filter.name)).toEqual(['Beta', 'Delta', 'Gamma']);
    expect(
      [...document.querySelectorAll('.fr-card-title')].map((node) => node.textContent),
    ).toEqual(['Beta', 'Delta', 'Gamma']);
  });

  it('clears the Quick Hide toast on reorder so Undo never removes another filter', async () => {
    const user = userEvent.setup();
    const filters = renderSitePanel(X_FILTER_SCHEMA, [
      wordFilter('First', 'text', 'one'),
      wordFilter('Second', 'text', 'two'),
    ]);

    const quick = screen.getByRole('textbox', { name: 'Quick hide on X' });
    await user.type(quick, 'spoilers{Enter}');
    expect(filters()).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(filters().map((filter) => filter.name)).toEqual(['First', 'Second']);

    await user.type(quick, 'spoilers{Enter}');
    await user.click(screen.getByRole('button', { name: /Move Hide "spoilers" up/ }));
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(filters()).toHaveLength(3);
  });

  it('normalises an @account chip and leaves an untouched recipe draft unsaved', async () => {
    const user = userEvent.setup();
    const filters = renderSitePanel(INSTAGRAM_FILTER_SCHEMA, []);

    await user.click(screen.getByRole('button', { name: /Hide posts by hashtag/i }));
    // Clicking the goal that is already chosen changes nothing.
    await user.click(screen.getByRole('button', { name: /Hide Collapse or remove/i }));
    expect(filters()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Back to filters' }));
    expect(filters()).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Create a new filter' }));
    await user.type(screen.getByRole('textbox', { name: 'Text to look for' }), '@barista_daily');
    await user.click(screen.getByRole('button', { name: 'Match as Account' }));
    expect(filters()[0]?.conditions[0]).toMatchObject({
      part: 'author',
      values: ['barista_daily'],
    });
  });

  it('restores the list on Cancel after editing', async () => {
    const user = userEvent.setup();
    const original = wordFilter('Mute', 'text', 'spoilers');
    const filters = renderSitePanel(X_FILTER_SCHEMA, [original]);

    await user.click(screen.getByRole('button', { name: 'Edit Mute' }));
    await user.type(screen.getByRole('textbox', { name: 'Text to look for' }), 'finale{Enter}');
    expect(filters()[0]).not.toEqual(original);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(filters()).toEqual([original]);
  });
});
