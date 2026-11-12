import type { Logger } from './log';
import type { FeatureOptions, OptionSpecs } from './options';

/** What a feature's setup function receives. */
export interface FeatureContext<S extends OptionSpecs> {
  options: FeatureOptions<S>;
  log: Logger;
}

export interface FeatureDefinition<S extends OptionSpecs> {
  /** Stable name, used in logs. */
  id: string;
  options?: S;
  /** Runs once per page load, after saved options have been read. */
  setup(ctx: FeatureContext<S>): void | Promise<void>;
}

/** A feature with its option types erased, so features of every shape fit in one list. */
export type Feature = FeatureDefinition<OptionSpecs>;

/**
 * Declares a feature. Inside `setup`, `ctx.options` only accepts the keys
 * listed in `options` and returns each one's own value type.
 */
export function defineFeature<S extends OptionSpecs = Record<never, never>>(
  feature: FeatureDefinition<S>,
): Feature {
  return feature as unknown as Feature;
}
