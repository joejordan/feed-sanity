import { describe, expect, it } from 'vitest';
import { isLocatorSpec, Locators } from '../core/locator';
import { ATOM_RULES } from './atom-rules';
import { TOKEN } from './atoms';
import * as selectors from './selectors';

describe('selectors', () => {
  const texts = Object.values(selectors).flatMap((value) => {
    if (typeof value === 'string') {
      return [value];
    }
    if (isLocatorSpec(value)) {
      return value.strategies.map(({ selector }) => selector);
    }
    return Object.values(value);
  });

  it('gives every locator a name of its own', () => {
    const names = Object.values(selectors)
      .filter(isLocatorSpec)
      .map(({ name }) => name);

    expect(names.length).toBeGreaterThan(20);
    expect(new Set(names).size).toBe(names.length);
  });

  it('only uses S2F_ names that have a rule', () => {
    const names = texts.flatMap((text) => [...text.matchAll(TOKEN)].map((m) => m[1]));

    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => !((name as string) in ATOM_RULES))).toEqual([]);
  });

  it('can run every strategy once its classes are known', () => {
    const specs = Object.values(selectors).filter(isLocatorSpec);
    const locators = new Locators({ resolve: (selector) => selector, onChange: () => () => true });
    for (const spec of specs) {
      locators.locate(spec);
    }

    const states = locators
      .stats()
      .flatMap(({ name, strategies }) => strategies.map(({ state }) => `${name} ${state}`));

    expect(states.filter((state) => !state.endsWith(' ready'))).toEqual([]);
  });

  it('holds valid selectors', () => {
    const marks: readonly string[] = Object.values(selectors.MARK);
    for (const text of texts.filter((text) => !marks.includes(text))) {
      expect(() => document.querySelector(text), text).not.toThrow();
    }
  });
});
