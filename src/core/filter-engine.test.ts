import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FilterContext, FilterFields, FilterFieldValue } from './filter-engine';
import type { Action, Condition, Filter, TextCondition } from './filter-types';
import {
  compileTextCondition,
  dropEmptyAlternatives,
  EMPTY_OUTCOME,
  listPart,
  parseStyleDeclarations,
  runFilters,
  testCondition,
} from './filter-engine';
import { newCondition, newFilter } from './filter-types';

function fieldsOf(parts: Record<string, FilterFieldValue>): FilterFields {
  return { get: (name) => (Object.hasOwn(parts, name) ? (parts[name] ?? null) : null) };
}

function text(values: string[], extra: Partial<TextCondition> = {}): TextCondition {
  return { ...newCondition(extra.part ?? 'text'), values, ...extra };
}

function filter(conditions: Condition[], actions: Action[], extra: Partial<Filter> = {}): Filter {
  return newFilter({ conditions, actions, ...extra });
}

const hide: Action = { kind: 'hide' };

function matches(condition: Condition, parts: Record<string, FilterFieldValue>): boolean {
  return testCondition(condition, { fields: fieldsOf(parts) }).matched;
}

describe('text conditions', () => {
  it('runs each test, ignoring case unless matchCase is set', () => {
    const value = { text: '  Hello World  ' };
    expect(matches(text(['world']), value)).toBe(true);
    expect(matches(text(['world'], { matchCase: true }), value)).toBe(false);
    expect(matches(text(['hello world'], { test: 'is' }), value)).toBe(true);
    expect(matches(text(['hello'], { test: 'is' }), value)).toBe(false);
    expect(matches(text(['hello'], { test: 'starts' }), value)).toBe(true);
    expect(matches(text(['world'], { test: 'starts' }), value)).toBe(false);
    expect(matches(text(['world'], { test: 'ends' }), value)).toBe(true);
    expect(matches(text(['hello'], { test: 'ends' }), value)).toBe(false);
    expect(matches(text(['h.llo\\s+w'], { test: 'regex' }), value)).toBe(true);
    expect(matches(text(['H.LLO'], { test: 'regex', matchCase: true }), value)).toBe(false);
  });

  it('treats literal values literally, including regex syntax characters and dashes', () => {
    expect(matches(text(['a.c']), { text: 'abc' })).toBe(false);
    expect(matches(text(['a.c']), { text: 'xa.cx' })).toBe(true);
    expect(matches(text(['x-y (z)?']), { text: 'see x-y (z)? now' })).toBe(true);
  });

  it('honours whole words, including non-English letters', () => {
    expect(matches(text(['cat'], { wholeWords: true }), { text: 'a cat sat' })).toBe(true);
    expect(matches(text(['cat'], { wholeWords: true }), { text: 'concatenate' })).toBe(false);
    expect(matches(text(['cat']), { text: 'concatenate' })).toBe(true);
    expect(matches(text(['sé'], { wholeWords: true }), { text: 'pasé' })).toBe(false);
    expect(matches(text(['sé'], { wholeWords: true }), { text: 'je sé.' })).toBe(true);
  });

  it('matches when any value matches, and reports the caught text', () => {
    const condition = text(['dog', 'Cat']);
    const result = testCondition(condition, { fields: fieldsOf({ text: 'my CAT' }) });
    expect(result).toEqual({ matched: true, caught: 'CAT' });
  });

  it('negates, matching only when no value matches', () => {
    expect(matches(text(['cat'], { negate: true }), { text: 'dog' })).toBe(true);
    expect(matches(text(['cat'], { negate: true }), { text: 'cat' })).toBe(false);
  });

  it('never matches empty values or a condition without non-empty values', () => {
    expect(matches(text(['']), { text: 'anything' })).toBe(false);
    expect(matches(text(['', '  ']), { text: 'anything' })).toBe(false);
    expect(matches(text([''], { negate: true }), { text: 'anything' })).toBe(false);
    expect(matches(text(['|'], { test: 'regex' }), { text: 'anything' })).toBe(false);
  });

  it('tests lists item by item', () => {
    const tags = { hashtags: ['news', 'cats'] };
    expect(matches(text(['cats'], { part: 'hashtags', test: 'is' }), tags)).toBe(true);
    expect(matches(text(['news cats'], { part: 'hashtags', test: 'is' }), tags)).toBe(false);
    expect(matches(text(['dogs'], { part: 'hashtags', negate: true }), tags)).toBe(true);
    expect(matches(text(['cats'], { part: 'hashtags', negate: true }), tags)).toBe(false);
  });

  it('never matches a null part, negated or not', () => {
    expect(matches(text(['x'], { part: 'author' }), {})).toBe(false);
    expect(matches(text(['x'], { part: 'author', negate: true }), {})).toBe(false);
  });

  it('counts a bad regex as not matching, negated or not, and reports it once', () => {
    const report = vi.fn();
    const bad = text(['(unclosed'], { test: 'regex' });
    const badNegated = text(['(unclosed'], { test: 'regex', negate: true });
    const ctx: FilterContext = { fields: fieldsOf({ text: '(unclosed' }), report };
    expect(testCondition(bad, ctx).matched).toBe(false);
    expect(testCondition(bad, ctx).matched).toBe(false);
    expect(testCondition(badNegated, ctx).matched).toBe(false);
    expect(report).toHaveBeenCalledTimes(2);
    expect(() => compileTextCondition(bad)).toThrow();
  });

  it('keeps only valid, distinct user regex flags and leaves case to matchCase', () => {
    const condition = text(['a.b'], { test: 'regex', regexFlags: 'sgiyxs' });
    expect(compileTextCondition(condition)?.flags).toBe('is');
    expect(matches(condition, { text: 'A\nB' })).toBe(true);
    expect(() => compileTextCondition(text(['a'], { test: 'regex', regexFlags: 'uv' }))).toThrow();
    expect(compileTextCondition(text(['']))).toBeNull();
  });

  it('drops stray empty alternatives but keeps escaped pipes, classes and groups', () => {
    expect(dropEmptyAlternatives('|cat|')).toBe('cat');
    expect(dropEmptyAlternatives('cat||dog')).toBe('cat|dog');
    expect(dropEmptyAlternatives(String.raw`a\|b|`)).toBe(String.raw`a\|b`);
    expect(dropEmptyAlternatives('[|]x|')).toBe('[|]x');
    expect(dropEmptyAlternatives('(a|)b')).toBe('(a|)b');
    expect(matches(text(['cat|'], { test: 'regex' }), { text: 'dog' })).toBe(false);
    expect(matches(text(['|cat||dog'], { test: 'regex' }), { text: 'hotdog' })).toBe(true);
    expect(matches(text([String.raw`a\|b`], { test: 'regex' }), { text: 'a|b' })).toBe(true);
  });
});

describe('element, weekday and age conditions', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('finds selectors through open shadow roots and skips Feed Sanity elements', () => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const player = document.createElement('video-player');
    shadow.append(player);
    const own = document.createElement('span');
    own.className = 'badge';
    own.setAttribute('data-feed-sanity', 'note');
    host.append(own);

    const ctx: FilterContext = { fields: fieldsOf({}), element: host };
    expect(testCondition({ kind: 'element', selector: 'video-player' }, ctx).matched).toBe(true);
    expect(testCondition({ kind: 'element', selector: '.badge' }, ctx).matched).toBe(false);
    expect(testCondition({ kind: 'element', selector: '.badge', negate: true }, ctx).matched).toBe(
      true,
    );
    expect(
      testCondition({ kind: 'element', selector: 'x' }, { fields: fieldsOf({}) }).matched,
    ).toBe(false);
  });

  it('counts a bad selector as not matching, negated or not, and reports it', () => {
    const report = vi.fn();
    const ctx: FilterContext = {
      fields: fieldsOf({}),
      element: document.createElement('div'),
      report,
    };
    expect(testCondition({ kind: 'element', selector: '[[bad' }, ctx).matched).toBe(false);
    expect(testCondition({ kind: 'element', selector: '[[bad', negate: true }, ctx).matched).toBe(
      false,
    );
    expect(report).toHaveBeenCalled();
  });

  it('holds on the listed local weekdays', () => {
    const wednesday = (): Date => new Date(2026, 10, 25, 12);
    const ctx: FilterContext = { fields: fieldsOf({}), now: wednesday };
    expect(testCondition({ kind: 'weekday', days: [3] }, ctx).matched).toBe(true);
    expect(testCondition({ kind: 'weekday', days: [0, 6] }, ctx).matched).toBe(false);
  });

  it('leaves age to the site hook, and lets the hook take any condition', () => {
    const age: Condition = { kind: 'age', olderThan: true, amount: 2, unit: 'days' };
    expect(testCondition(age, { fields: fieldsOf({}) }).matched).toBe(false);
    const hook = vi.fn((condition: Condition) =>
      condition.kind === 'age' ? { matched: true } : undefined,
    );
    const ctx: FilterContext = { fields: fieldsOf({ text: 'cat' }), testCondition: hook };
    expect(testCondition(age, ctx).matched).toBe(true);
    expect(testCondition(text(['cat']), ctx).matched).toBe(true);
    expect(hook).toHaveBeenCalledTimes(2);
  });

  it('never matches unknown conditions', () => {
    const unknown: Condition = { kind: 'unknown', original: { kind: 'later' } };
    expect(testCondition(unknown, { fields: fieldsOf({ text: 'x' }) }).matched).toBe(false);
  });
});

describe('runFilters', () => {
  const ctxFor = (parts: Record<string, FilterFieldValue>, extra: Partial<FilterContext> = {}) => ({
    fields: fieldsOf(parts),
    ...extra,
  });

  it('returns the shared empty outcome when nothing matches', () => {
    expect(runFilters([filter([text(['x'])], [hide])], ctxFor({ text: 'y' }))).toBe(EMPTY_OUTCOME);
    expect(runFilters([], ctxFor({}))).toBe(EMPTY_OUTCOME);
  });

  it('joins with all (stopping at the first failure) or any (stopping at the first hold)', () => {
    const hook = vi.fn(() => undefined);
    const conditions = [text(['a']), text(['b']), text(['c'])];
    const all = filter(conditions, [hide], { join: 'all' });
    const any = filter(conditions, [hide], { join: 'any' });

    expect(runFilters([all], ctxFor({ text: 'a c' }, { testCondition: hook })).hiding).toBeNull();
    expect(hook).toHaveBeenCalledTimes(2);
    expect(runFilters([all], ctxFor({ text: 'a b c' })).hiding).not.toBeNull();

    hook.mockClear();
    expect(runFilters([any], ctxFor({ text: 'b' }, { testCondition: hook })).hiding).not.toBeNull();
    expect(hook).toHaveBeenCalledTimes(2);
    expect(runFilters([any], ctxFor({ text: 'z' })).hiding).toBeNull();
  });

  it('skips filters that are not runnable and stops after a stopAfter match', () => {
    const onFilterMatch = vi.fn();
    const off = filter([text(['a'])], [hide], { enabled: false });
    const stop = filter([text(['a'])], [{ kind: 'add_class', className: 'one' }], {
      stopAfter: true,
    });
    const later = filter([text(['a'])], [hide]);
    const outcome = runFilters([off, stop, later], ctxFor({ text: 'a' }, { onFilterMatch }));
    expect(outcome.hiding).toBeNull();
    expect(outcome.classes).toEqual([{ name: 'one' }]);
    expect(onFilterMatch.mock.calls).toEqual([[stop]]);
  });

  it('lets keep beat earlier hides, and a later hide hide again', () => {
    const hider = filter([text(['a'])], [{ kind: 'hide', noteText: 'first' }]);
    const keeper = filter([text(['a'])], [{ kind: 'keep' }]);
    const rehider = filter([text(['a'])], [{ kind: 'hide', noteText: 'again' }]);

    const kept = runFilters([hider, keeper], ctxFor({ text: 'a' }));
    expect(kept.hiding).toBeNull();
    expect(kept.kept).toBe(true);

    const rehidden = runFilters([hider, keeper, rehider], ctxFor({ text: 'a' }));
    expect(rehidden.hiding?.label).toBe('again');
    expect(rehidden.kept).toBe(false);

    const firstWins = runFilters([hider, rehider], ctxFor({ text: 'a' }));
    expect(firstWins.hiding?.label).toBe('first');
  });

  it('writes note labels with {match} and defaults, and carries the note switches', () => {
    const run = (action: Action, name = '', parts = { text: 'Buy CRYPTO now' }) =>
      runFilters(
        [filter([text(['crypto'])], [action], { name })],
        ctxFor(parts, { itemNoun: 'post' }),
      ).hiding;

    expect(run({ kind: 'hide', noteText: 'Muted {match} here' })?.label).toBe('Muted CRYPTO here');
    expect(run({ kind: 'hide' }, 'Coins')).toEqual({
      label: 'Post hidden by your “Coins” filter',
      showNote: true,
      forceNote: false,
    });
    expect(run({ kind: 'hide' })?.label).toBe('Post hidden by one of your filters');
    expect(run({ kind: 'hide', note: false })?.showNote).toBe(false);
    expect(run({ kind: 'hide', note: true })?.forceNote).toBe(true);

    const negated = filter(
      [text(['dogs'], { negate: true })],
      [{ kind: 'hide', noteText: 'No {match} dogs' }],
    );
    expect(runFilters([negated], ctxFor({ text: 'cats' })).hiding?.label).toBe('No dogs');
    const plain = runFilters([filter([text(['x'])], [hide])], ctxFor({ text: 'x' }));
    expect(plain.hiding?.label).toBe('Hidden by one of your filters');
  });

  it('accumulates classes, styles and replacements, and the last read action wins', () => {
    const outcome = runFilters(
      [
        filter(
          [text(['a'])],
          [
            { kind: 'add_class', className: ' muted ', selector: '.body' },
            { kind: 'add_class', className: '  ' },
            { kind: 'style', css: 'opacity: .5' },
            { kind: 'set_read' },
          ],
        ),
        filter(
          [text(['a'])],
          [
            { kind: 'style', css: 'color: red !important', selector: 'p' },
            { kind: 'replace', find: 'a', replaceWith: 'b' },
            { kind: 'replace', find: '', replaceWith: 'ignored' },
            { kind: 'set_unread' },
            { kind: 'unknown', original: { kind: 'later' } },
          ],
        ),
      ],
      ctxFor({ text: 'a' }),
    );
    expect(outcome.classes).toEqual([{ name: 'muted', selector: '.body' }]);
    expect(outcome.styles).toEqual([
      { property: 'opacity', value: '.5', important: false },
      { property: 'color', value: 'red', important: true, selector: 'p' },
    ]);
    expect(outcome.replacements).toHaveLength(1);
    expect(outcome.replacements[0]?.find.flags).toBe('gi');
    expect(outcome.read).toBe('unread');
    expect(outcome.hiding).toBeNull();
  });

  it('makes replaced text visible to later filters, through set or an overlay', () => {
    const redact = filter(
      [text(['spoiler'])],
      [{ kind: 'replace', find: 'spoiler', replaceWith: 'X' }],
    );
    const afterRedact = filter([text(['spoiler'], { part: 'body' })], [hide]);
    const seesX = filter(
      [text(['X'], { matchCase: true, part: 'body' })],
      [{ kind: 'add_class', className: 'x' }],
    );

    const plain = fieldsOf({ text: 'a spoiler', body: 'the spoiler' });
    const overlay = runFilters([redact, afterRedact, seesX], {
      fields: { ...plain, textParts: ['text', 'body'] },
    });
    expect(overlay.hiding).toBeNull();
    expect(overlay.classes).toEqual([{ name: 'x' }]);

    const stored: Record<string, FilterFieldValue> = { text: 'a spoiler', body: ['spoiler', 'ok'] };
    const set = vi.fn((name: string, value: FilterFieldValue) => {
      stored[name] = value;
    });
    const settable: FilterFields = {
      get: (name) => stored[name] ?? null,
      set,
      textParts: ['body'],
    };
    const viaSet = runFilters([redact, afterRedact], { fields: settable });
    expect(set).toHaveBeenCalledWith('body', ['X', 'ok']);
    expect(set).not.toHaveBeenCalledWith('text', expect.anything());
    expect(viaSet.hiding).toBeNull();

    const report = vi.fn();
    const badFind = filter([text(['a'])], [{ kind: 'replace', find: '(', replaceWith: '' }]);
    expect(runFilters([badFind], ctxFor({ text: 'a' }, { report }))).toBe(EMPTY_OUTCOME);
    expect(report).toHaveBeenCalled();
  });
});

describe('helpers', () => {
  it('parses style declarations with URLs, !important and junk', () => {
    expect(
      parseStyleDeclarations(
        'background: url("https://x.test/a;b.png") no-repeat ; color:red!important;;nonsense; :x; --gap : 4px ; 1bad: 2',
      ),
    ).toEqual([
      {
        property: 'background',
        value: 'url("https://x.test/a;b.png") no-repeat',
        important: false,
      },
      { property: 'color', value: 'red', important: true },
      { property: '--gap', value: '4px', important: false },
    ]);
    expect(parseStyleDeclarations('background-image: url(https://a.test/x.png)', '.img')).toEqual([
      {
        property: 'background-image',
        value: 'url(https://a.test/x.png)',
        important: false,
        selector: '.img',
      },
    ]);
  });

  it('builds list parts from distinct non-empty texts', () => {
    expect(listPart(['a', '', 'b', 'a'])).toEqual(['a', 'b']);
    expect(listPart(['', ''])).toBeNull();
  });
});
