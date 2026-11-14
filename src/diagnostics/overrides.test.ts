import { describe, expect, it } from 'vitest';
import { checkOverrides, overridesText } from './overrides';

const NAMES = ['post', 'comment'];

describe('checkOverrides', () => {
  it('takes valid overrides, and empty text as none', () => {
    expect(checkOverrides('{ "post": ["[role=article]", "div.S2F_pos_rel"] }', NAMES)).toEqual({
      overrides: { post: ['[role=article]', 'div.S2F_pos_rel'] },
      problems: [],
    });
    expect(checkOverrides('  ', NAMES)).toEqual({ overrides: {}, problems: [] });
    expect(checkOverrides('{}', NAMES)).toEqual({ overrides: {}, problems: [] });
  });

  it('says when the text is not JSON', () => {
    const { overrides, problems } = checkOverrides('{ "post": [', NAMES);

    expect(overrides).toBeNull();
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^This is not valid JSON\./);
  });

  it('says when the JSON is not an object of lists', () => {
    expect(checkOverrides('["post"]', NAMES).problems).toEqual([
      'Write an object of locator names and lists of selectors, as in { "post": ["[role=article]"] }.',
    ]);
    expect(checkOverrides('{ "post": "[role=article]" }', NAMES).problems).toEqual([
      '"post" needs a list of selectors in quotes, as in ["[role=article]"].',
    ]);
    expect(checkOverrides('{ "post": [1] }', NAMES).problems).toHaveLength(1);
  });

  it('names a locator that does not exist', () => {
    expect(checkOverrides('{ "pots": ["div"] }', NAMES).problems).toEqual([
      '"pots" is not a locator. The names are in the Locators table.',
    ]);
  });

  it('names each selector that is not valid, including one left open', () => {
    expect(
      checkOverrides('{ "post": ["div:not(", "[role=article]"], "comment": ["[unclosed"] }', NAMES)
        .problems,
    ).toEqual([
      '"div:not(" for "post" is not a valid selector.',
      '"[unclosed" for "comment" is not a valid selector.',
    ]);
  });

  it('says a list with no selectors would do nothing', () => {
    expect(checkOverrides('{ "post": [] }', NAMES).problems).toEqual([
      '"post" has no selectors. Take it out to use the built-in ones.',
    ]);
  });
});

describe('overridesText', () => {
  it('lays the overrides out for the editor', () => {
    expect(overridesText({})).toBe('{}');
    expect(overridesText({ post: ['div'] })).toBe('{\n  "post": [\n    "div"\n  ]\n}');
  });
});
