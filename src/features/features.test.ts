import { expect, it } from 'vitest';
import { Options } from '../core/options';
import { features } from '.';

it('gives every feature its own id', () => {
  const ids = features.map((feature) => feature.id);
  expect(new Set(ids).size).toBe(ids.length);
});

// Two features defining the same key would stop every feature from starting.
it('has no option key defined by two features', () => {
  const options = new Options('u/options');
  for (const feature of features) {
    options.register(feature.options ?? {});
  }
});
