import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SelectorResolver } from './locator';
import { Listeners } from './listeners';
import { anyOf, firstOf, isLocatorSpec, Locators, readLocatorOverrides } from './locator';
import { createLogger } from './log';

/** Resolves `{name}` to a class once the test has said what the class is. */
function fakeResolver() {
  const classes = new Map<string, string>();
  const changed = new Listeners(createLogger('test'));
  const resolve = vi.fn((selector: string): string | null => {
    let known = true;
    const resolved = selector.replaceAll(/\{(\w+)\}/g, (_token, name: string) => {
      const found = classes.get(name);
      known &&= found !== undefined;
      return found ?? '';
    });
    return known ? resolved : null;
  });
  const resolver: SelectorResolver = { resolve, onChange: (listener) => changed.add(listener) };
  const learn = (name: string, atom: string): void => {
    classes.set(name, atom);
    changed.emit();
  };
  return { resolver, resolve, learn };
}

const seen = '2026-11-13';

const CARD = anyOf('card', [
  { selector: 'article', seen },
  { selector: 'section.{card}', seen: '2023', note: 'Older cards' },
]);

const MESSAGE = firstOf('message', [
  { selector: '.message', seen },
  { selector: 'p', seen: '2023' },
]);

describe('Locators', () => {
  let fake: ReturnType<typeof fakeResolver>;
  let locators: Locators;

  beforeEach(() => {
    document.body.innerHTML = '';
    fake = fakeResolver();
    locators = new Locators(fake.resolver, [CARD, MESSAGE]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('finds what any strategy of a union matches, in document order', () => {
    document.body.innerHTML =
      '<section class="xcard"></section><article id="a"></article><section class="xcard"></section>';
    fake.learn('card', 'xcard');
    const card = locators.locate(CARD);

    expect(card.all(document).map((element) => element.tagName)).toEqual([
      'SECTION',
      'ARTICLE',
      'SECTION',
    ]);
    expect(card.first(document)?.tagName).toBe('SECTION');
    expect(card.matches(document.querySelector('#a') as Element)).toBe(true);
  });

  it('uses the first strategy of a fallback that finds anything', () => {
    document.body.innerHTML = '<div><p>one</p><p class="message">two</p></div><p>three</p>';
    const message = locators.locate(MESSAGE);

    expect(message.all(document).map((element) => element.textContent)).toEqual(['two']);
    expect(message.all(document, (element) => element.textContent !== 'two')).toEqual([
      ...document.querySelectorAll('p:not(.message)'),
    ]);
    document.querySelector('.message')?.remove();
    expect(message.all(document).map((element) => element.textContent)).toEqual(['one', 'three']);
  });

  it('looks in an element and the element itself', () => {
    document.body.innerHTML = '<article><article></article></article>';
    const outer = document.querySelector('article') as Element;

    expect(locators.locate(CARD).probe(outer)).toEqual([...document.querySelectorAll('article')]);
    expect(locators.locate(CARD).closest(outer.firstElementChild as Element)).toBe(
      outer.firstElementChild,
    );
  });

  it('skips a strategy until the resolver can give its selector', () => {
    document.body.innerHTML = '<section class="xcard"></section>';
    const card = locators.locate(CARD);
    const changed = vi.fn();
    card.onChange(changed);

    expect(card.all(document)).toEqual([]);
    expect(locators.stats()[0]?.strategies.map(({ state }) => state)).toEqual(['ready', 'waiting']);

    fake.learn('card', 'xcard');

    expect(changed).toHaveBeenCalledTimes(1);
    expect(card.all(document)).toHaveLength(1);
    expect(locators.stats()[0]?.strategies[1]?.state).toBe('ready');
  });

  it('asks the resolver again only after it changed', () => {
    const card = locators.locate(CARD);
    card.all(document);
    card.matches(document.body);
    expect(fake.resolve).toHaveBeenCalledTimes(2);

    fake.learn('card', 'xcard');
    card.first(document);

    expect(fake.resolve).toHaveBeenCalledTimes(4);
  });

  it('reports a selector that is not valid once, counts it and never throws', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = anyOf('broken', [
      { selector: 'p[', seen },
      { selector: 'p', seen },
    ]);
    document.body.innerHTML = '<p></p>';
    const locator = locators.locate(broken);

    expect(locator.all(document)).toHaveLength(1);
    expect(locator.matches(document.querySelector('p') as Element)).toBe(true);
    fake.learn('card', 'xcard');
    expect(locator.first(document)).not.toBeNull();

    expect(error).toHaveBeenCalledTimes(1);
    const [stats] = locators.stats().filter(({ name }) => name === 'broken');
    expect(stats?.strategies[0]).toMatchObject({ state: 'invalid', errors: 2, lookups: 0 });
  });

  it('skips a selector left open at its end, which would swallow the next one when joined', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // Browsers close an open string at the end of a selector. happy-dom throws instead.
    const real = DocumentFragment.prototype.querySelector;
    vi.spyOn(DocumentFragment.prototype, 'querySelector').mockImplementation(function (
      this: DocumentFragment,
      selector: string,
    ) {
      return selector.startsWith('p[title="a') ? null : real.call(this, selector);
    });
    const open = anyOf('open', [
      { selector: 'p[title="a', seen },
      { selector: 'p', seen },
    ]);
    document.body.innerHTML = '<p></p>';
    const locator = locators.locate(open);

    expect(locator.selector()).toBe('p');
    expect(locator.all(document)).toHaveLength(1);
    const [stats] = locators.stats().filter(({ name }) => name === 'open');
    expect(stats?.strategies[0]?.state).toBe('invalid');
  });

  it('finds nothing, without throwing, when no strategy can be used', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const locator = locators.locate(anyOf('nothing', [{ selector: ':::', seen }]));
    document.body.innerHTML = '<p></p>';

    expect(locator.all(document)).toEqual([]);
    expect(locator.first(document)).toBeNull();
    expect(locator.matches(document.body)).toBe(false);
    expect(locator.closest(document.body)).toBeNull();
  });

  it('counts lookups and finds, and credits the strategy that matched', () => {
    vi.useFakeTimers({ now: 1_000_000 });
    document.body.innerHTML = '<article></article><section class="xcard"></section>';
    fake.learn('card', 'xcard');
    const card = locators.locate(CARD);

    card.all(document);
    card.matches(document.querySelector('article') as Element);
    vi.setSystemTime(2_000_000);
    card.matches(document.querySelector('section') as Element);
    card.matches(document.body);

    const [stats] = locators.stats();
    expect(stats).toMatchObject({ name: 'card', mode: 'any', overridden: false });
    expect(stats).toMatchObject({ lookups: 4, found: 3 });
    expect(stats?.strategies).toEqual([
      expect.objectContaining({
        selector: 'article',
        seen,
        lookups: 4,
        found: 2,
        lastFound: 1_000_000,
      }),
      {
        selector: 'section.{card}',
        seen: '2023',
        note: 'Older cards',
        state: 'ready',
        lookups: 4,
        found: 2,
        lastFound: 2_000_000,
        errors: 0,
      },
    ]);
  });

  it('counts each strategy a fallback tried', () => {
    document.body.innerHTML = '<p>one</p>';
    const message = locators.locate(MESSAGE);

    message.all(document);
    message.all(document.createElement('div'));

    const stats = locators.stats()[1];
    expect(stats).toMatchObject({ lookups: 2, found: 1 });
    expect(stats?.strategies.map(({ lookups, found }) => [lookups, found])).toEqual([
      [2, 0],
      [2, 1],
    ]);
  });

  it('sets the counts back to zero', () => {
    document.body.innerHTML = '<article></article>';
    locators.locate(CARD).all(document);

    locators.resetStats();

    expect(locators.stats()[0]).toMatchObject({ lookups: 0, found: 0 });
    expect(locators.stats()[0]?.strategies[0]).toMatchObject({ lookups: 0, lastFound: null });
  });

  it('lists every locator it was given before any lookup', () => {
    expect(locators.stats().map(({ name }) => name)).toEqual(['card', 'message']);
  });

  it("uses the user's selectors in place of a locator's own, and gives them back", () => {
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    document.body.innerHTML = '<article></article><aside></aside>';
    const card = locators.locate(CARD);
    const changed = vi.fn();
    card.onChange(changed);

    locators.override({ card: ['aside'], nonsense: ['p'] });

    expect(changed).toHaveBeenCalledTimes(1);
    expect(card.all(document).map((element) => element.tagName)).toEqual(['ASIDE']);
    expect(locators.stats()[0]).toMatchObject({
      overridden: true,
      strategies: [expect.objectContaining({ selector: 'aside', seen: null, found: 1 })],
    });
    expect(locators.stats().map(({ name }) => name)).toEqual(['card', 'message']);

    locators.override({ card: ['aside'] });
    expect(changed).toHaveBeenCalledTimes(1);

    locators.override({ card: ['article', 'aside'] });
    expect(card.all(document)).toHaveLength(2);

    locators.override({});
    expect(changed).toHaveBeenCalledTimes(3);
    expect(card.all(document).map((element) => element.tagName)).toEqual(['ARTICLE']);
    expect(locators.stats()[0]?.overridden).toBe(false);
  });

  it('gives the same locator for the same spec', () => {
    expect(locators.locate(CARD)).toBe(locators.locate(CARD));
  });
});

describe('readLocatorOverrides', () => {
  it('keeps the lists of selectors and drops everything else', () => {
    expect(
      readLocatorOverrides({
        post: ['[role=article]', 3, '  ', 'div'],
        empty: [],
        text: 'div',
        nothing: null,
      }),
    ).toEqual({ post: ['[role=article]', 'div'] });
  });

  it.each([undefined, null, 'post', ['post'], 42])('reads %s as no overrides', (stored) => {
    expect(readLocatorOverrides(stored)).toEqual({});
  });
});

describe('isLocatorSpec', () => {
  it('tells a spec from other values', () => {
    expect(isLocatorSpec(CARD)).toBe(true);
    expect(isLocatorSpec({ name: 'x', mode: 'some', strategies: [] })).toBe(false);
    expect(isLocatorSpec('card')).toBe(false);
  });
});
