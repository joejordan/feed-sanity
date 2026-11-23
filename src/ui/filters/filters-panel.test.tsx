import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { Filter } from '../../core/filter-types';
import type { FilterSchema } from './schema';
import { FACEBOOK_FILTER_SCHEMA } from '../../features/post-filters/schema';
import { GMAIL_FILTER_SCHEMA } from '../../sites/gmail/filter-schema';
import { INSTAGRAM_FILTER_SCHEMA } from '../../sites/instagram/filter-schema';
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
  it('launches a 1-click starter recipe on X in Simple mode, applies highlight presets, previews live, and escalates cleanly to Advanced Test rule', async () => {
    const user = userEvent.setup();
    const filters = renderSitePanel(X_FILTER_SCHEMA, []);

    await user.click(screen.getByRole('button', { name: /Highlight a favorite @handle/i }));
    const valueInput = screen.getByRole<HTMLInputElement>('textbox', { name: 'Text to look for' });
    await user.type(valueInput, 'alexdev');

    // Click Warm highlight swatch in Simple mode -> flushes pending text + updates CSS cleanly.
    await user.click(screen.getByRole('button', { name: /Warm highlight/i }));
    expect(filters()[0]?.actions?.[0]?.content).toContain('#d97706');

    // Default sample item on X has author `Alex Rivera @alexdev` -> matches live in preview!
    expect(screen.getByText('Matches sample')).toBeTruthy();

    // Escalating via More options opens Advanced with the exact same filter and Test rule sandbox.
    await user.click(screen.getByRole('button', { name: /More options/i }));
    const sampleAuthor = screen.getByRole<HTMLInputElement>('textbox', {
      name: /Sample Author or @handle/i,
    });
    fireEvent.change(sampleAuthor, { target: { value: 'other_user' } });
    expect(screen.getByRole('status').textContent).toContain('No match');
  });

  it('supports interactive Reveal bar peek in Simple Live Preview and smart target nudge', async () => {
    const user = userEvent.setup();
    renderSitePanel(X_FILTER_SCHEMA, []);

    await user.click(screen.getByRole('button', { name: 'Create a new filter' }));
    await user.type(screen.getByRole('textbox', { name: 'Text to look for' }), '#airdrop');

    // Smart nudge offers 1-click switch to Hashtag while matching Anything.
    await user.click(screen.getByRole('button', { name: 'Match as Hashtag' }));
    expect(screen.getByRole('button', { name: 'Hashtag' }).getAttribute('aria-pressed')).toBe(
      'true',
    );

    // Default Hide rule shows interactive Reveal bar preview that can peek & re-hide.
    await user.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.getByRole('button', { name: 'Hide again' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Hide again' }));
    expect(screen.getByRole('button', { name: 'Show' })).toBeTruthy();
  });

  it('creates reversible filters via the 1-line Quick Hide bar with Undo and Edit on Gmail', async () => {
    const user = userEvent.setup();
    const filters = renderSitePanel(GMAIL_FILTER_SCHEMA, []);

    const quickInput = screen.getByRole<HTMLInputElement>('textbox', {
      name: 'Quick hide on Gmail',
    });
    await user.type(quickInput, 'newsletter, digest{Enter}');

    expect(filters()).toHaveLength(1);
    expect(filters()[0]?.actions).toEqual([{ action: 'hide', show_note: true }]);
    expect(filters()[0]?.rules?.map((r) => r.condition?.text)).toEqual(['newsletter', 'digest']);
    expect(screen.getByRole('status').textContent).toContain('Added');

    // Edit from toast opens in Simple mode with Gmail inbox-row preview when switched to Highlight.
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: /Highlight/i }));
    expect(document.querySelector('.fr-preview-row')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Done' }));

    // Deleting and undoing works cleanly.
    await user.click(screen.getByRole('button', { name: /Delete/i }));
    expect(filters()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(filters()).toHaveLength(1);
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
    // Regex rule automatically opens in Advanced and shows inline alert.
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

    // Edit Beta on Gmail (whole-word rule without match_partial_words -> opens directly in Advanced):
    // Test rule exposes Gmail's actual sender/subject/snippet fields (not bogus "content"),
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

  it('normalizes Facebook #hashtag and Instagram @account smart nudges, keeps silent Hide unchanged on re-click, and handles Simple <-> Advanced lock/unlock cleanly', async () => {
    const user = userEvent.setup();

    // Facebook smart nudge strips `#` so hashtag rules actually match Facebook's extractor.
    const fbFilters = renderSitePanel(FACEBOOK_FILTER_SCHEMA, []);
    await user.click(screen.getByRole('button', { name: 'Create a new filter' }));
    await user.type(screen.getByRole('textbox', { name: 'Text to look for' }), '#cats');
    await user.click(screen.getByRole('button', { name: 'Match as Hashtag' }));
    expect(fbFilters()[0]?.rules?.[0]).toMatchObject({
      target: 'hashtag',
      condition: { text: 'cats', modifier: 'i' },
    });
    expect(screen.getByText('Matches sample')).toBeTruthy();

    // Switching to Advanced, toggling Post age then back to Any post content unlocks Simple cleanly.
    await user.click(screen.getByRole('button', { name: 'Advanced' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Part of the post' }), 'age');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Simple' }).disabled).toBe(true);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Part of the post' }), 'any');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Simple' }).disabled).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Simple' }));

    // Clicking Escape in inline Title edit stops propagation so an enclosing modal dialog stays open.
    await user.click(screen.getByRole('button', { name: /Rename filter/i }));
    const titleBox = screen.getByRole('textbox', { name: 'Title' });
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    titleBox.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(true);
    cleanup();

    // Instagram smart nudge strips `@` for Account rules, and re-clicking active Hide on a silent-hide recipe preserves `show_note: undefined`.
    const igFilters = renderSitePanel(INSTAGRAM_FILTER_SCHEMA, []);
    await user.click(screen.getByRole('button', { name: /Hide posts by hashtag/i }));
    await user.click(screen.getByRole('button', { name: /Hide Collapse or remove/i }));
    expect(igFilters()).toHaveLength(0); // Re-clicking active tile did not mutate or attach draft.
    await user.click(screen.getByRole('button', { name: 'Anything' }));
    await user.type(screen.getByRole('textbox', { name: 'Text to look for' }), '@barista_daily');
    await user.click(screen.getByRole('button', { name: 'Match as Account' }));
    expect(igFilters()[0]?.rules?.[0]).toMatchObject({
      target: 'author',
      condition: { text: 'barista_daily', modifier: 'i' },
    });
    expect(igFilters()[0]?.actions?.[0]?.show_note).toBeUndefined();
  });

  it('clears Quick Hide toast on reorder/duplicate so Undo never deletes an unrelated filter, and Quick Hide Undo removes the added filter', async () => {
    const user = userEvent.setup();
    const existing: Filter[] = [
      {
        title: 'First',
        enabled: true,
        rules: [
          {
            target: 'any',
            operator: 'contains',
            matcher: 'str',
            match_partial_words: true,
            condition: { text: 'one', modifier: 'i' },
          },
        ],
        actions: [{ action: 'hide' }],
      },
      {
        title: 'Second',
        enabled: true,
        rules: [
          {
            target: 'any',
            operator: 'contains',
            matcher: 'str',
            match_partial_words: true,
            condition: { text: 'two', modifier: 'i' },
          },
        ],
        actions: [{ action: 'hide' }],
      },
    ];
    const filters = renderSitePanel(X_FILTER_SCHEMA, existing);

    // Quick Hide -> Undo removes the added filter cleanly.
    const quick = screen.getByRole('textbox', { name: 'Quick hide on X' });
    await user.type(quick, 'spoilers{Enter}');
    expect(filters()).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(filters().map((f) => f.title)).toEqual(['First', 'Second']);

    // Quick Hide -> Move up clears the toast so no stale index can delete Second.
    await user.type(quick, 'spoilers{Enter}');
    await user.click(screen.getByRole('button', { name: /Move Hide "spoilers" up/i }));
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(filters()).toHaveLength(3);
  });
});
