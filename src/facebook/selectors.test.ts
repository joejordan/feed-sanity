import { describe, expect, it } from 'vitest';
import { isLocatorSpec, Locators } from '../core/locator';
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
    // TODO(clean): skip the fb-dom unit's `MARK` attribute names here once they exist.
    for (const text of texts) {
      expect(() => document.querySelector(text), text).not.toThrow();
    }
  });
});
