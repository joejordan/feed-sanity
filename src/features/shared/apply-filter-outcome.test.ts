import { afterEach, describe, expect, it } from 'vitest';
import type { Filter } from '../../core/filter-types';
import { runFilterList } from '../../core/filter-engine';
import { Scope } from '../../core/scope';
import { HIDDEN_ATTR, OWN_ATTR } from '../../core/surface';
import { applyFilterOutcome } from './apply-filter-outcome';

describe('cross-site filter-engine & applyFilterOutcome', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('tracks unhidden allowlist state and evaluates generic contains_selector rules', () => {
    const post = document.createElement('article');
    const badge = document.createElement('span');
    badge.className = 'vip-badge';
    post.append(badge);
    document.body.append(post);

    const map: Record<string, string> = { author: 'Alice', all_content: 'Promo' };
    const fields = { get: (name: string) => map[name] ?? null };

    const allowlistFilters: Filter[] = [
      {
        enabled: true,
        match: 'ALL',
        stop_on_match: true,
        rules: [
          {
            target: 'any',
            operator: 'contains_selector',
            condition: { text: '.vip-badge' },
          },
        ],
        actions: [{ action: 'unhide' }],
      },
      {
        enabled: true,
        match: 'ALL',
        rules: [
          { target: 'any', operator: 'contains', matcher: 'str', condition: { text: 'Promo' } },
        ],
        actions: [{ action: 'hide' }],
      },
    ];

    const outcome = runFilterList(allowlistFilters, { fields, element: post });
    expect(outcome.hiding).toBeNull();
    expect(outcome.unhidden).toBe(true);

    // Allowlist suppresses a built-in hide fallback.
    const scope = new Scope();
    expect(applyFilterOutcome(scope, post, outcome, true)).toBeNull();
    expect(post.hasAttribute(HIDDEN_ATTR)).toBe(false);
    scope.dispose();
  });

  it('applies !important inline styles and classes reversibly, and wraps table-row hide notes in <tr><td colspan>', () => {
    const table = document.createElement('table');
    const tbody = document.createElement('tbody');
    const row = document.createElement('tr');
    row.className = 'existing-cls';
    row.style.setProperty('color', 'red', 'important');
    tbody.append(row);
    table.append(tbody);
    document.body.append(table);

    const scope = new Scope();
    const outcome = runFilterList(
      [
        {
          title: 'Mute row',
          enabled: true,
          match: 'ALL',
          rules: [
            { target: 'any', operator: 'contains', matcher: 'str', condition: { text: 'x' } },
          ],
          actions: [
            { action: 'hide', show_note: true, custom_note: 'Hidden thread' },
            { action: 'class', content: 'existing-cls fs-muted' },
            { action: 'css', content: 'color: blue !important; opacity: 0.5' },
          ],
        },
      ],
      {
        fields: { get: () => 'x' },
        element: row,
        itemLabel: 'Thread',
      },
    );

    const state = applyFilterOutcome(scope, row, outcome, false);
    expect(state?.hidden).toBe(true);
    expect(row.getAttribute(HIDDEN_ATTR)).toBe('none');
    expect(row.classList.contains('fs-muted')).toBe(true);
    expect(row.style.getPropertyValue('color')).toBe('blue');
    expect(row.style.getPropertyPriority('color')).toBe('important');
    expect(row.style.getPropertyValue('opacity')).toBe('0.5');

    // Note is wrapped in a full-width `<tr data-feed-sanity="filter-note-row"><td colspan="100">`.
    const noteRow = row.previousElementSibling as HTMLTableRowElement | null;
    expect(noteRow?.localName).toBe('tr');
    expect(noteRow?.getAttribute(OWN_ATTR)).toBe('filter-note-row');
    const noteButton = noteRow?.querySelector('button') as HTMLButtonElement | null;
    expect(noteButton?.textContent).toBe('Hidden thread');

    // Clicking the note toggles reveal/rehide cleanly.
    noteButton?.click();
    expect(row.hasAttribute(HIDDEN_ATTR)).toBe(false);
    noteButton?.click();
    expect(row.getAttribute(HIDDEN_ATTR)).toBe('none');

    // Disposing restores original classes, !important inline style, visibility, and removes the note row.
    state?.dispose();
    expect(row.hasAttribute(HIDDEN_ATTR)).toBe(false);
    expect(row.classList.contains('existing-cls')).toBe(true);
    expect(row.classList.contains('fs-muted')).toBe(false);
    expect(row.style.getPropertyValue('color')).toBe('red');
    expect(row.style.getPropertyPriority('color')).toBe('important');
    expect(row.style.getPropertyValue('opacity')).toBe('');
    expect(tbody.querySelector(`[${OWN_ATTR}]`)).toBeNull();
    scope.dispose();
  });

  it('applies reversible text replacements across text nodes while skipping scripts and own UI', () => {
    const post = document.createElement('article');
    const body = document.createElement('p');
    body.textContent = 'Check out this spoiler about the finale!';
    const script = document.createElement('script');
    script.textContent = 'const spoiler = true;';
    const own = document.createElement('span');
    own.setAttribute(OWN_ATTR, 'badge');
    own.textContent = 'spoiler badge';
    post.append(body, script, own);
    document.body.append(post);

    const scope = new Scope();
    const outcome = runFilterList(
      [
        {
          title: 'Redact spoilers',
          enabled: true,
          rules: [
            { target: 'any', operator: 'contains', matcher: 'str', condition: { text: 'spoiler' } },
          ],
          actions: [{ action: 'replace', find: 'spoiler', replace: '[redacted]' }],
        },
      ],
      { fields: { get: () => body.textContent ?? '' }, element: post },
    );

    const state = applyFilterOutcome(scope, post, outcome, false);
    expect(state?.hidden).toBe(false);
    expect(body.textContent).toBe('Check out this [redacted] about the finale!');
    expect(script.textContent).toBe('const spoiler = true;');
    expect(own.textContent).toBe('spoiler badge');

    state?.dispose();
    expect(body.textContent).toBe('Check out this spoiler about the finale!');
    scope.dispose();
  });
});
