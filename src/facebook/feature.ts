import type { Feature, FeatureDefinition } from '../core/feature';
import type { OptionSpecs } from '../core/options';
import type { AtomTranslator } from './atoms';
import { defineFeature as defineCoreFeature } from '../core/feature';
import { Atoms } from './atoms';
import { Posts } from './posts';

/** What a feature can use on a Facebook page. It arrives as `ctx.page` in `setup`. */
export interface FacebookPage {
  /** Translates `S2F_` names into Facebook's current class names. Call `start()` before relying on it. */
  atoms: AtomTranslator;
  /** The posts on the page. Subscribing with `onAdd` starts post detection. */
  posts: Pick<Posts, 'onAdd' | 'onRemove' | 'onReset'>;
}

/** Builds the page services. Nothing in them runs until a feature uses it. */
export function createPage(): FacebookPage {
  const atoms = new Atoms();
  return { atoms, posts: new Posts(atoms) };
}

/**
 * Declares a feature. Inside `setup`, `ctx.options` only accepts the keys
 * listed in `options`, and `ctx.page` gives access to the Facebook page.
 */
export function defineFeature<S extends OptionSpecs = Record<never, never>>(
  feature: FeatureDefinition<S, FacebookPage>,
): Feature<FacebookPage> {
  return defineCoreFeature(feature);
}
