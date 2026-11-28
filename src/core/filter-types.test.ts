import { describe, expect, it } from 'vitest';
import {
  CUSTOM_FILTERS_KEY,
  conditionOfKind,
  isRunnable,
  newAction,
  newCondition,
  newFilter,
  readFilters,
  savedFilters,
} from './filter-types';
import { SavedData } from './saved';
import { inMemoryStore } from './testing';

describe('filter constructors', () => {
  it('builds an enabled any-join filter with one blank contains condition and a hide action', () => {
    const filter = newFilter();
    expect(filter.id).toMatch(/^f[0-9a-f]{18}$/);
    expect(filter).toMatchObject({
      name: '',
      enabled: true,
      join: 'any',
      stopAfter: false,
      conditions: [{ kind: 'text', part: 'text', test: 'contains', values: [''] }],
      actions: [{ kind: 'hide' }],
    });
    expect(newFilter().id).not.toBe(filter.id);
    expect(newFilter({ name: 'Cats', join: 'all' })).toMatchObject({ name: 'Cats', join: 'all' });
  });

  it('builds blank conditions and actions of each kind', () => {
    expect(newCondition('author')).toEqual({
      kind: 'text',
      part: 'author',
      test: 'contains',
      values: [''],
    });
    expect(conditionOfKind('element')).toEqual({ kind: 'element', selector: '' });
    expect(conditionOfKind('weekday')).toEqual({ kind: 'weekday', days: [] });
    expect(conditionOfKind('age').kind).toBe('age');
    expect(newAction()).toEqual({ kind: 'hide' });
    expect(newAction('replace')).toEqual({ kind: 'replace', find: '', replaceWith: '' });
    expect(newAction('style')).toEqual({ kind: 'style', css: '' });
    expect(newAction('add_class')).toEqual({ kind: 'add_class', className: '' });
    expect(newAction('set_read')).toEqual({ kind: 'set_read' });
  });

  it('runs only enabled filters with at least one condition and one action', () => {
    expect(isRunnable(newFilter())).toBe(true);
    expect(isRunnable(newFilter({ enabled: false }))).toBe(false);
    expect(isRunnable(newFilter({ conditions: [] }))).toBe(false);
    expect(isRunnable(newFilter({ actions: [] }))).toBe(false);
  });
});

describe('readFilters', () => {
  it('returns [] for anything that is not an array', () => {
    for (const stored of [undefined, null, 'x', 42, { 0: {} }]) {
      expect(readFilters(stored)).toEqual([]);
    }
  });

  it('drops holes and non-objects, fills missing lists, and gives missing ids fresh ones', () => {
    // biome-ignore lint/suspicious/noSparseArray: a sparse array is the point of this test.
    const filters = readFilters([, null, 'text', 7, [], { name: 'Bare' }]);
    expect(filters).toHaveLength(1);
    expect(filters[0]).toMatchObject({
      name: 'Bare',
      enabled: true,
      join: 'any',
      stopAfter: false,
      conditions: [],
      actions: [],
    });
    expect(filters[0]?.id).toMatch(/^f/);
  });

  it('keeps ids, renews duplicates, and normalises every known kind', () => {
    const [first, second] = readFilters([
      {
        id: 'a1',
        name: 'Full',
        description: 'Desc',
        enabled: false,
        join: 'all',
        stopAfter: true,
        conditions: [
          { kind: 'text', part: 'author', test: 'is', values: ['Al', 3], matchCase: true },
          { kind: 'text', values: 'solo' },
          { kind: 'element', selector: '.x', negate: true },
          { kind: 'weekday', days: [1, 1, 9, 2.5, 6] },
          { kind: 'age', amount: -1, unit: 'weeks' },
        ],
        actions: [
          { kind: 'hide', note: false, noteText: 'Gone: {match}' },
          { kind: 'style', css: 'color: red', selector: '  ' },
          { kind: 'add_class', className: 'muted', selector: ' .body ' },
          { kind: 'replace', find: 'a' },
          { kind: 'set_unread', extra: true },
        ],
      },
      { id: 'a1', name: 'Copy' },
    ]);
    expect(first).toEqual({
      id: 'a1',
      name: 'Full',
      description: 'Desc',
      enabled: false,
      join: 'all',
      stopAfter: true,
      conditions: [
        { kind: 'text', part: 'author', test: 'is', values: ['Al'], matchCase: true },
        { kind: 'text', part: 'text', test: 'contains', values: ['solo'] },
        { kind: 'element', selector: '.x', negate: true },
        { kind: 'weekday', days: [1, 6] },
        { kind: 'age', olderThan: true, amount: 0, unit: 'days' },
      ],
      actions: [
        { kind: 'hide', note: false, noteText: 'Gone: {match}' },
        { kind: 'style', css: 'color: red' },
        { kind: 'add_class', className: 'muted', selector: '.body' },
        { kind: 'replace', find: 'a', replaceWith: '' },
        { kind: 'set_unread' },
      ],
    });
    expect(second?.id).not.toBe('a1');
  });

  it('keeps unknown kinds as inert wrappers that survive a second read', () => {
    const stored = [
      {
        id: 'u',
        conditions: [
          { kind: 'moon_phase', phase: 'full' },
          { kind: 'text', test: 'fuzzy' },
        ],
        actions: [{ kind: 'teleport', to: 'mars' }],
      },
    ];
    const once = readFilters(stored);
    expect(once[0]?.conditions).toEqual([
      { kind: 'unknown', original: { kind: 'moon_phase', phase: 'full' } },
      { kind: 'unknown', original: { kind: 'text', test: 'fuzzy' } },
    ]);
    expect(once[0]?.actions).toEqual([
      { kind: 'unknown', original: { kind: 'teleport', to: 'mars' } },
    ]);
    expect(readFilters(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });

  it('round-trips constructor output unchanged', () => {
    const filter = newFilter({ name: 'Round', stopAfter: true });
    expect(readFilters([filter])).toEqual([filter]);
  });
});

describe('savedFilters', () => {
  it('returns the same saved value per SavedData under the custom_filters key', async () => {
    const store = inMemoryStore({ [`v2/x/1/${CUSTOM_FILTERS_KEY}`]: [{ id: 'k', name: 'Kept' }] });
    const data = new SavedData(store, 'v2/x/1');
    const saved = savedFilters(data);
    expect(savedFilters(data)).toBe(saved);
    await saved.ready;
    expect(saved.get().map((filter) => filter.name)).toEqual(['Kept']);
    data.dispose();
  });
});
