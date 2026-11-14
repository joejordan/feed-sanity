import { describe, expect, it, vi } from 'vitest';
import type { RuleContext } from './rules';
import type { Filter, Rule } from './types';
import { readPostFields } from '../../facebook/post-fields';
import { fakeAtoms as atoms } from '../../facebook/testing';
import { FILTERED_FEED, isFixedTabName, runFilters } from './engine';
import { keywordFilter } from './keyword-filter';
import { matchFilter } from './rules';
import { expandVariables } from './variables';

/** A filter variable such as `${author}`, spelled so that it is not taken for a template placeholder. */
const variable = (name: string): string => ['$', '{', name, '}'].join('');

const POST = `
  <h4><b>Ann Author</b></h4>
  <div data-ad-rendering-role="story_message">Huge crypto giveaway for Facebook fans</div>
  <a href="/hashtag/crypto">#crypto</a>
  <img alt="A golden coin">
  <div role="article">a comment about kittens</div>`;

function contextFor(html = POST, now = new Date(2026, 10, 13)): RuleContext {
  document.body.innerHTML = `<div role="article">${html}</div>`;
  const post = document.body.firstElementChild as Element;
  return {
    post,
    fields: readPostFields(post, atoms),
    atoms,
    now: () => now,
    report: vi.fn<RuleContext['report']>(),
  };
}

const rule = (changes: Rule & { text?: string }): Rule => {
  const { text, ...rest } = changes;
  return {
    target: 'any',
    operator: 'contains',
    ...rest,
    condition: { ...(text === undefined ? {} : { text }), ...rest.condition },
  };
};

const matches = (rules: Rule[], match = 'ALL', context = contextFor()): boolean =>
  matchFilter({ match, rules }, context) !== null;

describe('matchFilter', () => {
  it('matches whole words unless partial words are allowed', () => {
    expect(matches([rule({ text: 'give' })])).toBe(false);
    expect(matches([rule({ text: 'giveaway' })])).toBe(true);
    expect(matches([rule({ text: 'give', match_partial_words: true })])).toBe(true);
  });

  it('ignores case unless told to match it', () => {
    expect(matches([rule({ text: 'CRYPTO' })])).toBe(true);
    expect(matches([rule({ text: 'CRYPTO', condition: { modifier: 'I' } })])).toBe(false);
  });

  it('reads the text as a regular expression, or literally when asked', () => {
    expect(matches([rule({ text: 'kittens|crypto' })])).toBe(true);
    expect(matches([rule({ text: 'kittens|crypto', matcher: 'str' })])).toBe(false);
    // A stray pipe would otherwise match everything.
    expect(matches([rule({ text: '|kittens|' })])).toBe(false);
    expect(matches([rule({ text: '||kittens' })])).toBe(false);
  });

  it('keeps an escaped pipe as a pipe to look for', () => {
    const context = contextFor('<p>cats | dogs and crypto</p>');

    expect(matches([rule({ text: String.raw`cats \||kittens` })], 'ALL', context)).toBe(true);
    expect(matches([rule({ text: String.raw`kittens \|` })], 'ALL', context)).toBe(false);
    expect(matches([rule({ text: String.raw`cats \|` })], 'ALL', context)).toBe(true);
  });

  it('never matches with nothing to look for, even with NOT', () => {
    expect(matches([rule({})])).toBe(false);
    expect(matches([rule({ text: '' })])).toBe(false);
    expect(matches([rule({ text: '', matcher: 'str' })])).toBe(false);
    expect(matches([rule({ text: '|' })])).toBe(false);
    expect(matches([rule({ text: '', not: true })])).toBe(false);
  });

  it('tests the start, the end and the whole of a part', () => {
    const author = { target: 'author' };

    expect(matches([rule({ ...author, operator: 'startswith', text: 'ann' })])).toBe(true);
    expect(matches([rule({ ...author, operator: 'endswith', text: 'ann' })])).toBe(false);
    expect(matches([rule({ ...author, operator: 'equals', text: 'ann author' })])).toBe(true);
    expect(matches([rule({ ...author, operator: 'equals', text: 'ann' })])).toBe(false);
  });

  it('takes its flags from the rule for a regular expression match', () => {
    expect(matches([rule({ operator: 'matches', text: 'CRYPTO' })])).toBe(false);
    expect(
      matches([rule({ operator: 'matches', text: 'CRYPTO', condition: { modifier: 'i' } })]),
    ).toBe(true);
    // The editor has no "plain text" choice for it, so one left over from another comparison is not used.
    expect(matches([rule({ operator: 'matches', text: 'cry.to', matcher: 'str' })])).toBe(true);
  });

  it('inverts a rule marked NOT, either way of writing it', () => {
    expect(matches([rule({ text: 'kittens', not: true })])).toBe(true);
    expect(matches([rule({ text: 'kittens', operator: 'not_contains' })])).toBe(true);
    expect(matches([rule({ text: 'crypto', not: true })])).toBe(false);
  });

  it('never matches a part the post does not have, even with NOT', () => {
    expect(matches([rule({ target: 'group', text: 'x', not: true })])).toBe(false);
  });

  it('leaves the comments out, and photo descriptions unless asked for', () => {
    expect(matches([rule({ text: 'kittens' })])).toBe(false);
    expect(matches([rule({ text: 'golden' })])).toBe(false);
    expect(matches([rule({ target: 'any+image', text: 'golden' })])).toBe(true);
    expect(matches([rule({ target: 'image', text: 'golden' })])).toBe(true);
  });

  it('tests each item of a list', () => {
    expect(matches([rule({ target: 'hashtag', operator: 'equals', text: 'crypto' })])).toBe(true);
  });

  it('needs every rule for ALL and one for ANY', () => {
    const rules = [rule({ text: 'crypto' }), rule({ text: 'kittens' })];

    expect(matches(rules, 'ALL')).toBe(false);
    expect(matches(rules, 'ANY')).toBe(true);
    expect(matches([], 'ANY')).toBe(false);
  });

  it('reports a rule that cannot be tested and does not match on it', () => {
    const context = contextFor();

    expect(matches([rule({ text: '(' })], 'ALL', context)).toBe(false);
    expect(context.report).toHaveBeenCalled();
  });

  it('finds elements by selector, in the post and not its comments', () => {
    const selector = (text: string, not = false) =>
      rule({ operator: 'contains_selector', text, not });

    expect(matches([selector('img[alt]')])).toBe(true);
    expect(matches([selector('video')])).toBe(false);
    expect(matches([selector('video', true)])).toBe(true);
    expect(matches([selector('[role=article]')])).toBe(false);
    expect(matches([selector('h4:contains(Ann)')])).toBe(true);
    expect(matches([selector('h4:contains("Bob")')])).toBe(false);
    expect(matches([selector('h4:has-visible-text(Author)')])).toBe(true);
  });

  it('reports a selector that is not valid and does not match on it, even with NOT', () => {
    const context = contextFor();
    const broken = (not: boolean) => rule({ operator: 'contains_selector', text: 'h4[', not });

    expect(matches([broken(false)], 'ALL', context)).toBe(false);
    expect(matches([broken(true)], 'ALL', context)).toBe(false);
    expect(context.report).toHaveBeenCalledTimes(2);
  });

  it('finds elements hidden inside another', () => {
    const context = contextFor(
      '<div class="box"><span style="display: none"><b>Sponsored</b></span></div><i>x</i>',
    );
    const hidden = (text: string) => rule({ operator: 'contains_selector', text });

    expect(matches([hidden('b:hidden-within(.box)')], 'ALL', context)).toBe(true);
    expect(matches([hidden('i:hidden-within(.box)')], 'ALL', context)).toBe(false);
  });

  it('matches on the chosen days of the week', () => {
    // 13 November 2026 is a Friday.
    const friday = { target: 'day', condition: { day_5: true } };

    expect(matches([friday])).toBe(true);
    expect(matches([{ target: 'day', condition: { day_1: true } }])).toBe(false);
  });

  it('compares the age of a post whose time can be read', () => {
    const now = new Date(2026, 10, 13, 12);
    const threeHoursAgo = Math.round(now.getTime() / 1000) - 3 * 3600;
    const context = contextFor(`<abbr data-utime="${threeHoursAgo}">3h</abbr>`, now);
    const age = (operator: string, value: number, units: string): Rule => ({
      target: 'age',
      operator,
      condition: { value, units },
    });

    expect(matches([age('gt', 2, 'h')], 'ALL', context)).toBe(true);
    expect(matches([age('lt', 2, 'h')], 'ALL', context)).toBe(false);
    expect(matches([age('lt', 1, 'd')], 'ALL', context)).toBe(true);
    expect(matches([age('gt', 2, 'h')])).toBe(false);
  });
});

describe('runFilters', () => {
  const hide = (text: string, changes: Filter = {}): Filter => ({
    title: text,
    match: 'ALL',
    stop_on_match: true,
    rules: [rule({ text })],
    actions: [{ action: 'hide', show_note: true }],
    ...changes,
  });

  it('leaves a post alone when nothing matches', () => {
    const outcome = runFilters([hide('kittens')], contextFor());

    expect(outcome.hiding).toBeNull();
    expect(outcome.tabs).toEqual([FILTERED_FEED]);
  });

  it('hides with a note that names the filter', () => {
    const outcome = runFilters([hide('crypto')], contextFor());

    expect(outcome.hiding).toEqual({
      reveal: 'Post hidden by filter "crypto" -- Click to reveal post',
      rehide: 'Post was hidden by filter "crypto" -- Click to rehide post',
      showNote: true,
    });
  });

  it('skips disabled filters and stops after a match when told to', () => {
    const second = hide('giveaway', { actions: [{ action: 'class', content: 'second' }] });

    const stopped = runFilters(
      [hide('crypto', { enabled: false }), hide('crypto'), second],
      contextFor(),
    );
    const carriedOn = runFilters([hide('crypto', { stop_on_match: false }), second], contextFor());

    expect(stopped.hiding?.reveal).toContain('"crypto"');
    expect(stopped.classes).toEqual([]);
    expect(carriedOn.classes).toEqual([{ name: 'second' }]);
  });

  it('lets a later filter unhide what an earlier one hid', () => {
    const outcome = runFilters(
      [hide('crypto', { stop_on_match: false }), hide('ann', { actions: [{ action: 'unhide' }] })],
      contextFor(),
    );

    expect(outcome.hiding).toBeNull();
  });

  it('collects classes and styles, for the post or for elements inside it', () => {
    const outcome = runFilters(
      [
        hide('crypto', {
          actions: [
            { action: 'class', content: 'spam', selector: 'h4' },
            { action: 'css', content: 'opacity: 0.5; border : 1px solid red;' },
          ],
        }),
      ],
      contextFor(),
    );

    expect(outcome.classes).toEqual([{ name: 'spam', selector: 'h4' }]);
    expect(outcome.styles).toEqual([
      { property: 'opacity', value: '0.5' },
      { property: 'border', value: '1px solid red' },
    ]);
  });

  it('keeps the colons inside a style value', () => {
    const content = 'background: url(https://example.com/a.png) no-repeat';
    const outcome = runFilters(
      [hide('crypto', { actions: [{ action: 'css', content }] })],
      contextFor(),
    );

    expect(outcome.styles).toEqual([
      { property: 'background', value: 'url(https://example.com/a.png) no-repeat' },
    ]);
  });

  it('replaces nothing when there is nothing to find', () => {
    const outcome = runFilters(
      [hide('crypto', { actions: [{ action: 'replace', find: '', replace: 'x' }] })],
      contextFor(),
    );

    expect(outcome.replacements).toEqual([]);
  });

  it('moves and copies posts to tabs, filling in what the rule caught', () => {
    const tab = (action: string, name: string): Filter =>
      hide('(crypto|kittens)', { stop_on_match: false, actions: [{ action, tab: name }] });

    const moved = runFilters([tab('move-to-tab', 'About $1')], contextFor());
    const copied = runFilters([tab('copy-to-tab', `By ${variable('author')}`)], contextFor());
    const both = runFilters([tab('copy-to-tab', 'A'), tab('move-to-tab', '')], contextFor());

    expect(moved.tabs).toEqual(['About crypto']);
    expect(copied.tabs).toEqual([FILTERED_FEED, 'By Ann Author']);
    expect(both.tabs).toEqual(['[nameless]']);
  });

  it('lets later filters see text an earlier one replaced', () => {
    const outcome = runFilters(
      [
        hide('crypto', {
          stop_on_match: false,
          actions: [{ action: 'replace', find: 'crypto', replace: 'kittens' }],
        }),
        hide('kittens'),
      ],
      contextFor(),
    );

    expect(outcome.replacements).toHaveLength(1);
    expect(outcome.hiding?.reveal).toContain('"kittens"');
  });

  it('reports the actions that are not ported', () => {
    const context = contextFor();

    runFilters([hide('crypto', { actions: [{ action: 'read' }] })], context);

    expect(context.report).toHaveBeenCalled();
  });
});

describe('keywordFilter', () => {
  const settings = {
    keywords: 'the',
    partial: true,
    caseSensitive: false,
    captions: true,
    showNote: true,
    showMatch: true,
  };
  const caught = (changes: Partial<typeof settings>, html: string) => {
    const filter = keywordFilter({ ...settings, ...changes });
    return filter ? (matchFilter(filter, contextFor(html))?.caught?.[1] ?? null) : undefined;
  };

  it('is nothing when there are no keywords', () => {
    expect(keywordFilter({ ...settings, keywords: ' \n \n' })).toBeNull();
  });

  it('finds whole words only when partial matching is off', () => {
    expect(caught({ partial: false }, 'Feed them well')).toBeNull();
    expect(caught({ partial: false }, 'Feed the cat')).toBe('the');
    expect(caught({}, 'Feed them well')).toBe('the');
  });

  it('can tell capital letters from small ones', () => {
    const apple = { keywords: 'Apple', caseSensitive: true };

    expect(caught(apple, 'an apple a day')).toBeNull();
    expect(caught(apple, 'Apple announced')).toBe('Apple');
  });

  it('treats punctuation in a keyword as plain text', () => {
    const keywords = { keywords: '$5 (free)\nc++' };

    expect(caught(keywords, 'only $5 (free) today')).toBe('$5 (free)');
    expect(caught(keywords, 'learning C++ fast')).toBe('C++');
    expect(caught(keywords, '555 free')).toBeNull();
  });
});

describe('expandVariables', () => {
  const caught = /(a)|(b)(c)/.exec('bc');
  const field = (name: string) => (name === 'author' ? 'Ann Author' : ['x', 'y']);

  it('fills in what the brackets caught', () => {
    expect(expandVariables(`$2-${variable('3')}-$9`, caught, field)).toBe('b-c-x,y');
    expect(expandVariables(variable('any'), caught, field)).toBe('b');
    expect(expandVariables(variable('all:20:+'), caught, field)).toBe('+b+c');
  });

  it('fills in parts of the post, cut to a length', () => {
    expect(expandVariables(`${variable('author:3')} / ${variable('hashtag')}`, null, field)).toBe(
      'Ann / x,y',
    );
  });

  it('gives nothing for something that is not text', () => {
    expect(expandVariables(undefined, null, field)).toBe('');
  });
});

describe('isFixedTabName', () => {
  it('is false for a name with variables or no name', () => {
    expect(isFixedTabName('News')).toBe(true);
    expect(isFixedTabName(`By ${variable('author')}`)).toBe(false);
    expect(isFixedTabName('About $1')).toBe(false);
    // Every variable `expandVariables` fills in counts, whatever follows the name.
    expect(isFixedTabName(variable('all:20:, '))).toBe(false);
    expect(isFixedTabName('')).toBe(false);
  });
});
