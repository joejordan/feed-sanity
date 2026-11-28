import { describe, expect, it } from 'vitest';
import type { TextCondition } from '../../core/filter-types';
import { newAction, newCondition, newFilter } from '../../core/filter-types';
import { FACEBOOK_FILTER_SCHEMA } from '../../features/post-filters/schema';
import { GMAIL_FILTER_SCHEMA } from '../../sites/gmail/filter-schema';
import { sampleFields, testFilterAgainstSample } from './tester';
import {
  filtersProblem,
  validateAction,
  validateCondition,
  validateCssSelector,
  validateRegexFlags,
} from './validate';

const regex = (value: string, regexFlags?: string): TextCondition => ({
  ...newCondition('text'),
  test: 'regex',
  values: [value],
  ...(regexFlags ? { regexFlags } : {}),
});

describe('validate', () => {
  it('accepts only valid, non-repeated flags other than the case flag', () => {
    expect(validateRegexFlags('')).toBeNull();
    expect(validateRegexFlags('ms')).toBeNull();
    expect(validateRegexFlags('i')).toContain('Match case');
    expect(validateRegexFlags('g')).toContain('not a flag');
    expect(validateRegexFlags('mm')).toContain('twice');
    expect(validateCondition(regex('a', 'zz'))).toContain('not a flag');
    // `u` and `v` are each fine, but not together.
    expect(validateCondition(regex('a', 'uv'))).toContain('Invalid regular expression');
  });

  it('reports regexes that do not compile, and nothing for literal text', () => {
    expect(validateCondition(regex('(unclosed'))).toContain('Invalid regular expression');
    expect(validateCondition(regex('a|b'))).toBeNull();
    expect(validateCondition({ ...newCondition(), values: ['(unclosed'] })).toBeNull();
  });

  it('checks selectors, ages and actions', () => {
    expect(validateCssSelector('div[')).toContain('not a valid CSS selector');
    expect(validateCssSelector('a[href*="x"]')).toBeNull();
    expect(validateCondition({ kind: 'element', selector: 'div[' })).toContain('CSS selector');
    expect(validateCondition({ kind: 'age', olderThan: true, amount: -1, unit: 'days' })).toContain(
      'zero or more',
    );
    expect(validateAction({ kind: 'replace', find: '(', replaceWith: '' })).toContain(
      'Invalid find pattern',
    );
    expect(validateAction({ kind: 'style', css: 'color: red', selector: 'p[' })).toContain(
      'CSS selector',
    );
    expect(validateAction(newAction('keep'))).toBeNull();
  });

  it('blocks saving only while an enabled filter is broken', () => {
    const broken = newFilter({ name: 'Bad regex', conditions: [regex('(unclosed')] });
    expect(filtersProblem([broken])).toContain('Bad regex');
    expect(filtersProblem([{ ...broken, enabled: false }])).toBeNull();
    expect(filtersProblem([newFilter()])).toBeNull();
  });
});

describe('tester', () => {
  it('builds the whole text from the samples and splits list parts', () => {
    const fields = sampleFields({ body: 'Hello', hashtags: '#cats, dogs' }, FACEBOOK_FILTER_SCHEMA);
    expect(fields.get('text')).toBe('Hello #cats, dogs');
    expect(fields.get('hashtags')).toEqual(['cats', 'dogs']);
    expect(fields.get('group')).toBeNull();
  });

  it('reports each condition: matched, not matched, skipped or the error', () => {
    const filter = newFilter({
      join: 'all',
      conditions: [
        { ...newCondition('subject'), values: ['invoice'] },
        { kind: 'element', selector: 'img' },
        regex('(bad'),
        { ...newCondition('sender'), values: ['nobody'], negate: true },
      ],
    });
    const report = testFilterAgainstSample(
      filter,
      GMAIL_FILTER_SCHEMA.sampleItem ?? {},
      GMAIL_FILTER_SCHEMA,
    );
    expect(report.conditions.map(({ matched, skipped }) => ({ matched, skipped }))).toEqual([
      { matched: true, skipped: false },
      { matched: false, skipped: true },
      { matched: false, skipped: false },
      { matched: true, skipped: false },
    ]);
    expect(report.conditions[0]?.caught).toBe('invoice');
    expect(report.conditions[2]?.error).toBeTruthy();
    expect(report.matched).toBe(false);
    expect(
      testFilterAgainstSample({ ...filter, join: 'any' }, { subject: 'invoice' }).matched,
    ).toBe(true);
  });
});
