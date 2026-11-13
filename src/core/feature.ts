import type { Logger } from './log';
import type { FeatureOptions, OptionSpecs } from './options';

/**
 * What a feature's setup function receives. `P` is whatever the site the
 * features run on offers them, such as its posts. Core does not look inside.
 */
export interface FeatureContext<S extends OptionSpecs, P = unknown> {
  options: FeatureOptions<S>;
  log: Logger;
  page: P;
}

export interface FeatureDefinition<S extends OptionSpecs, P = unknown> {
  /** Stable name, used in logs. */
  id: string;
  options?: S;
  /** Runs once per page load, after saved options have been read. */
  setup: (ctx: FeatureContext<S, P>) => void | Promise<void>;
}

/** A feature with its option types erased, so features of every shape fit in one list. */
export type Feature<P = unknown> = FeatureDefinition<OptionSpecs, P>;

/**
 * Declares a feature. Inside `setup`, `ctx.options` only accepts the keys
 * listed in `options` and returns each one's own value type.
 */
export function defineFeature<S extends OptionSpecs = Record<never, never>, P = unknown>(
  feature: FeatureDefinition<S, P>,
): Feature<P> {
  return feature as unknown as Feature<P>;
}
