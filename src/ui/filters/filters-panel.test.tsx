import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { Filter } from '../../core/filter-types';
import type { FilterSchema } from './schema';
import { GMAIL_FILTER_SCHEMA } from '../../sites/gmail/filter-schema';
import { X_FILTER_SCHEMA } from '../../sites/x/filter-schema';
import { SiteFiltersPanel } from './filters-panel';
import { filtersProblem, validateRule } from './validate';

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

describe('cross-site Filter Rules UI', () => {
  it('launches a 1-click starter recipe on X, applies highlight presets, and evaluates live in the Test rule sandbox', async () => {
    const user = userEvent.setup();
    const filters = renderSitePanel(X_FILTER_SCHEMA, []);

    await user.click(screen.getByRole('button', { name: /Highlight a favorite @handle/i }));
    const valueInput = screen.getByRole<HTMLInputElement>('textbox', { name: 'Text to look for' });
    await user.type(valueInput, 'alexdev');

    // Click Warm highlight preset to replace CSS cleanly.
    await user.click(screen.getByRole('button', { name: /Warm highlight/i }));
    expect(filters()[0]?.actions?.[0]?.content).toContain('#d97706');

    // Default sample item on X has author `Alex Rivera @alexdev` -> matches live!
    expect(screen.getByText('Matches sample')).toBeTruthy();

    // Changing the sample author to someone else immediately flips verdict to No match.
    const sampleAuthor = screen.getByRole<HTMLInputElement>('textbox', {
      name: /Sample Author or @handle/i,
    });
    fireEvent.change(sampleAuthor, { target: { value: 'other_user' } });
    expect(screen.getByRole('status').textContent).toContain('No match');
  });

  it('supports search, status filtering, and duplicate on Gmail when 4+ rules exist', async () => {
    const user = userEvent.setup();
    const initial: Filter[] = [
      {
        title: 'Hide promos',
        enabled: true,
        rules: [
          { target: 'sender', operator: 'contains', matcher: 'str', condition: { text: 'promo' } },
        ],
        actions: [{ action: 'hide' }],
      },
      {
        title: 'Highlight invoices',
        enabled: true,
        rules: [
          {
            target: 'subject',
            operator: 'contains',
            matcher: 'str',
            condition: { text: 'invoice' },
          },
        ],
        actions: [{ action: 'css', content: 'border-left: 3px solid #d97706;' }],
      },
      {
        title: 'Paused rule',
        enabled: false,
        rules: [
          { target: 'any', operator: 'contains', matcher: 'str', condition: { text: 'digest' } },
        ],
        actions: [{ action: 'hide' }],
      },
      {
        title: 'Keep VIP',
        enabled: true,
        stop_on_match: true,
        rules: [
          { target: 'sender', operator: 'contains', matcher: 'str', condition: { text: 'ceo@' } },
        ],
        actions: [{ action: 'unhide' }],
      },
    ];
    const filters = renderSitePanel(GMAIL_FILTER_SCHEMA, initial);

    // Search filters down to matching cards and disables reorder arrows while filtered.
    const search = screen.getByRole('searchbox', { name: 'Search filters' });
    await user.type(search, 'invoice');
    expect(screen.getByText('Highlight invoices')).toBeTruthy();
    expect(screen.queryByText('Hide promos')).toBeNull();
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Move Highlight invoices up' })
        .disabled,
    ).toBe(true);

    // Clear search and filter by Paused status.
    await user.clear(search);
    await user.click(screen.getByRole('button', { name: 'Paused' }));
    expect(screen.getByText('Paused rule')).toBeTruthy();
    expect(screen.queryByText('Highlight invoices')).toBeNull();

    // Switch back to All and duplicate a rule.
    await user.click(screen.getByRole('button', { name: 'All' }));
    await user.click(screen.getByRole('button', { name: 'Duplicate Keep VIP' }));
    expect(filters().map((f) => f.title)).toContain('Keep VIP (copy)');
  });

  it('validates regex syntax, flags, and CSS selectors inline and blocks saving broken enabled rules', async () => {
    const user = userEvent.setup();
    const broken: Filter[] = [
      {
        title: 'Bad regex',
        enabled: true,
        rules: [
          { target: 'any', operator: 'matches', condition: { text: '(unclosed', modifier: 'i' } },
        ],
        actions: [{ action: 'hide' }],
      },
    ];
    expect(filtersProblem(broken, X_FILTER_SCHEMA)).toContain('Bad regex');
    expect(filtersProblem([{ ...broken[0], enabled: false }], X_FILTER_SCHEMA)).toBeNull();
    expect(
      validateRule({ target: 'any', operator: 'contains_selector', condition: { text: 'div[' } }),
    ).toContain('Invalid CSS selector');
    expect(
      validateRule({
        target: 'any',
        operator: 'matches',
        condition: { text: 'abc', modifier: 'zz' },
      }),
    ).toContain('Invalid regex flags');

    renderSitePanel(X_FILTER_SCHEMA, broken);
    expect(screen.getByText('Invalid')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Edit Bad regex' }));
    expect(screen.getByRole('alert').textContent).toContain('Invalid regular expression');
  });

  it('keeps search toolbar reachable after deleting down to < 4 rules, resets incompatible operators on target change, and tests Gmail fields cleanly', async () => {
    const user = userEvent.setup();
    const four: Filter[] = [
      {
        title: 'Alpha',
        enabled: true,
        rules: [{ target: 'any', operator: 'contains', matcher: 'str', condition: { text: 'a' } }],
        actions: [{ action: 'hide' }],
      },
      {
        title: 'Beta',
        enabled: true,
        rules: [{ target: 'any', operator: 'contains', matcher: 'str', condition: { text: 'b' } }],
        actions: [{ action: 'hide' }],
      },
      {
        title: 'Gamma',
        enabled: true,
        rules: [{ target: 'any', operator: 'contains', matcher: 'str', condition: { text: 'c' } }],
        actions: [{ action: 'hide' }],
      },
      {
        title: 'Delta',
        enabled: true,
        rules: [{ target: 'any', operator: 'contains', matcher: 'str', condition: { text: 'd' } }],
        actions: [{ action: 'hide' }],
      },
    ];
    const filters = renderSitePanel(GMAIL_FILTER_SCHEMA, four);

    // Search for "Alpha", then delete it so filters.length drops to 3 -> search box stays visible to clear!
    const search = screen.getByRole('searchbox', { name: 'Search filters' });
    await user.type(search, 'Alpha');
    await user.click(screen.getByRole('button', { name: 'Delete Alpha' }));
    expect(screen.getByRole('searchbox', { name: 'Search filters' })).toBeTruthy();
    await user.clear(search);
    expect(screen.getByText('Beta')).toBeTruthy();

    // Edit Beta on Gmail: Test rule exposes Gmail's actual sender/subject/snippet fields (not bogus "content"),
    // switching from contains_selector on `any` to `sender` resets operator back to `contains`,
    // and toggling Enabled off & back on permanently clears an invalid JSON draft.
    await user.click(screen.getByRole('button', { name: 'Edit Beta' }));
    expect(screen.getByRole('textbox', { name: /Sample Sender/i })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: /Sample content/i })).toBeNull();

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Comparison' }),
      'contains_selector',
    );
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Part of the thread' }),
      'sender',
    );
    expect(filters()[0]?.rules?.[0]?.operator).toBe('contains');

    const code = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Filter code' });
    fireEvent.change(code, { target: { value: '{broken' } });
    expect(screen.getByText('Not a filter yet, so not used.')).toBeTruthy();
    const enabledToggle = screen.getByRole('checkbox', { name: 'Enabled' });
    await user.click(enabledToggle);
    await user.click(enabledToggle);
    expect(screen.queryByText('Not a filter yet, so not used.')).toBeNull();
  });
});
