import { describe, expect, it } from 'vitest';
import type { Filter, TextCondition } from '../../core/filter-types';
import { newAction, newCondition, newFilter } from '../../core/filter-types';
import { FACEBOOK_FILTER_SCHEMA } from '../../features/post-filters/schema';
import { GMAIL_FILTER_SCHEMA } from '../../sites/gmail/filter-schema';
import { INSTAGRAM_FILTER_SCHEMA } from '../../sites/instagram/filter-schema';
import { REDDIT_FILTER_SCHEMA } from '../../sites/reddit/filter-schema';
import { X_FILTER_SCHEMA } from '../../sites/x/filter-schema';
import { HIGHLIGHT_CSS } from './schema';
import {
  activeSimpleTarget,
  commitPendingText,
  createQuickHideFilter,
  detectSmartTarget,
  extractSimpleChips,
  isSimpleCompatible,
  newSimpleFilter,
  normalizeChipForTarget,
  withSimpleChips,
} from './simple-model';
import { displayFilterTitle, summarizeFilter } from './summary';

const FB = FACEBOOK_FILTER_SCHEMA;

function withCondition(filter: Filter, changes: Partial<TextCondition>): Filter {
  const first = filter.conditions[0] as TextCondition;
  return { ...filter, conditions: [{ ...first, ...changes }] };
}

describe('isSimpleCompatible', () => {
  const simple = withSimpleChips(newSimpleFilter(FB), 'text', ['crypto', 'giveaway']);

  it('accepts one contains condition whose values are the chips', () => {
    expect(isSimpleCompatible(simple, FB)).toEqual({ ok: true });
    expect(simple.join).toBe('any');
    expect(simple.conditions).toEqual([
      { kind: 'text', part: 'text', test: 'contains', values: ['crypto', 'giveaway'] },
    ]);
    expect(simple.actions).toEqual([{ kind: 'hide' }]);
  });

  it('accepts one condition per chip under any', () => {
    const perChip: Filter = {
      ...simple,
      conditions: [
        { ...newCondition('author'), values: ['Sam'] },
        { ...newCondition('author'), values: ['Alex'] },
      ],
    };
    expect(isSimpleCompatible(perChip, FB).ok).toBe(true);
    expect(extractSimpleChips(perChip)).toEqual(['Sam', 'Alex']);
    expect(isSimpleCompatible({ ...perChip, join: 'all' }, FB).ok).toBe(false);
  });

  it('rejects every condition option Simple mode cannot show', () => {
    expect(isSimpleCompatible(withCondition(simple, { negate: true }), FB).ok).toBe(false);
    expect(isSimpleCompatible(withCondition(simple, { matchCase: true }), FB).ok).toBe(false);
    expect(isSimpleCompatible(withCondition(simple, { wholeWords: true }), FB).ok).toBe(false);
    expect(isSimpleCompatible(withCondition(simple, { test: 'regex' }), FB).ok).toBe(false);
    expect(isSimpleCompatible(withCondition(simple, { test: 'is' }), FB).ok).toBe(false);
    // `body` is a valid part, but not one of Facebook's Simple pills.
    expect(isSimpleCompatible(withCondition(simple, { part: 'body' }), FB)).toEqual({
      ok: false,
      reason: 'Uses an advanced part or condition',
    });
    const mixed: Filter = {
      ...simple,
      conditions: [newCondition('text'), newCondition('author')],
    };
    expect(isSimpleCompatible(mixed, FB).ok).toBe(false);
    const weekday: Filter = { ...simple, conditions: [{ kind: 'weekday', days: [1] }] };
    expect(isSimpleCompatible(weekday, FB).ok).toBe(false);
  });

  it('accepts goal actions only, and style only with a preset', () => {
    const preset: Filter = { ...simple, actions: [{ kind: 'style', css: HIGHLIGHT_CSS.gold }] };
    expect(isSimpleCompatible(preset, FB).ok).toBe(true);
    expect(
      isSimpleCompatible({ ...simple, actions: [{ kind: 'style', css: 'color: red' }] }, FB).ok,
    ).toBe(false);
    expect(
      isSimpleCompatible(
        { ...simple, actions: [{ kind: 'style', css: HIGHLIGHT_CSS.gold, selector: 'a' }] },
        FB,
      ).ok,
    ).toBe(false);
    expect(isSimpleCompatible({ ...simple, actions: [newAction('set_read')] }, FB).ok).toBe(false);
    expect(isSimpleCompatible({ ...simple, actions: [] }, FB)).toEqual({
      ok: false,
      reason: 'Has no actions',
    });
    expect(
      isSimpleCompatible({ ...simple, actions: [{ kind: 'hide', noteText: 'x {match}' }] }, FB).ok,
    ).toBe(false);
    expect(isSimpleCompatible({ ...simple, actions: [{ kind: 'hide', note: false }] }, FB).ok).toBe(
      true,
    );
  });

  it('allows stopAfter only with keep', () => {
    expect(isSimpleCompatible({ ...simple, stopAfter: true }, FB).ok).toBe(false);
    expect(
      isSimpleCompatible({ ...simple, stopAfter: true, actions: [newAction('keep')] }, FB).ok,
    ).toBe(true);
  });
});

describe('chips', () => {
  it('commits pending comma-separated text without repeats', () => {
    const base = withSimpleChips(newSimpleFilter(FB), 'text', ['cats']);
    const next = commitPendingText(base, 'Cats, dogs ,', 'text', FB);
    expect(extractSimpleChips(next)).toEqual(['cats', 'dogs']);
    expect(commitPendingText(base, ' , ', 'text', FB)).toBe(base);
  });

  it('keeps an empty value when there are no chips', () => {
    const empty = withSimpleChips(newSimpleFilter(FB), 'author', []);
    expect(empty.conditions).toEqual([newCondition('author')]);
    expect(activeSimpleTarget(empty, FB)).toBe('author');
  });

  it('strips # from hashtags and @ from authors where the site leaves it out', () => {
    expect(normalizeChipForTarget('#cats', 'hashtags', FB)).toBe('cats');
    expect(normalizeChipForTarget('@barista_daily', 'author', INSTAGRAM_FILTER_SCHEMA)).toBe(
      'barista_daily',
    );
    // X's sample author carries the handle with its @.
    expect(normalizeChipForTarget('@alexdev', 'author', X_FILTER_SCHEMA)).toBe('@alexdev');
    // Domain parts hold a bare host name.
    expect(
      normalizeChipForTarget('https://www.youtube.com/watch?v=1', 'domain', REDDIT_FILTER_SCHEMA),
    ).toBe('youtube.com');
    expect(normalizeChipForTarget('github.com', 'domain', REDDIT_FILTER_SCHEMA)).toBe('github.com');
  });
});

describe('detectSmartTarget', () => {
  it('suggests a part for #tags, @accounts and addresses typed on the whole item', () => {
    expect(detectSmartTarget('#election', 'text', FB)).toEqual({
      targetId: 'hashtags',
      label: 'Hashtag',
    });
    expect(detectSmartTarget('@someone', 'text', GMAIL_FILTER_SCHEMA)).toEqual({
      targetId: 'sender',
      label: 'Sender',
    });
    expect(detectSmartTarget('https://tiktok.com', 'text', X_FILTER_SCHEMA)).toEqual({
      targetId: 'link_urls',
      label: 'Link',
    });
    // Facebook has no Simple link pill.
    expect(detectSmartTarget('https://tiktok.com', 'text', FB)).toBeNull();
    expect(detectSmartTarget('#election', 'author', FB)).toBeNull();
  });
});

describe('createQuickHideFilter', () => {
  it('builds a contains hide filter on the whole text', () => {
    const created = createQuickHideFilter('spoilers, #finale', FB);
    expect(created?.conditions).toEqual([
      { kind: 'text', part: 'text', test: 'contains', values: ['spoilers', '#finale'] },
    ]);
    expect(created?.actions).toEqual([{ kind: 'hide' }]);
    expect(created?.enabled).toBe(true);
    expect(createQuickHideFilter(' , , ', FB)).toBeNull();
    // A bare # or @ would hide every item that contains one.
    expect(createQuickHideFilter('#, @', FB)).toBeNull();
  });
});

describe('summaries', () => {
  it('titles a filter from its chips and summarises it in words', () => {
    const multi = withSimpleChips(newSimpleFilter(FB), 'text', ['crypto', 'giveaway', 'nft']);
    expect(displayFilterTitle(multi, FB)).toBe('Hide "crypto, giveaway +1"');
    expect(summarizeFilter(multi, FB).line).toBe(
      'Hide the post when Anything in the post contains "crypto" or "giveaway" or "nft"',
    );
    expect(displayFilterTitle({ ...multi, name: 'No crypto' }, FB)).toBe('No crypto');
  });

  it('words negation, regex, joins and the other kinds', () => {
    const filter = newFilter({
      join: 'all',
      conditions: [
        { kind: 'text', part: 'author', test: 'starts', values: ['Sam'], negate: true },
        { kind: 'text', part: 'body', test: 'regex', values: ['a|b'] },
        { kind: 'weekday', days: [6, 0] },
      ],
      actions: [{ kind: 'hide', note: false }, newAction('set_read')],
    });
    const summary = summarizeFilter(filter, FB);
    expect(summary.line).toBe(
      `Hide the post (no note) when Author does not start with "Sam" and The author's message matches regex /a|b/ (+1 more)`,
    );
    expect(summary.extraActionCount).toBe(1);
    const element = newFilter({ conditions: [{ kind: 'element', selector: 'video' }] });
    expect(summarizeFilter(element, FB).line).toBe(
      'Hide the post when the post contains an element matching `video`',
    );
    const days = newFilter({ conditions: [{ kind: 'weekday', days: [6, 0] }] });
    expect(summarizeFilter(days, FB).line).toBe('Hide the post when the day is Sun, Sat');
  });
});
