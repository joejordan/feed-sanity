import type { Logger } from './log';
import type { FeatureOptions, OptionSpecs } from './options';
import type { FeatureData } from './saved';
import type { Scope } from './scope';

/**
 * What a feature's setup function receives. `P` is whatever the site the
 * features run on offers them, such as its posts. Core does not look inside.
 *
 * Whatever the feature subscribes to through `options`, `data` and `page`
 * ends when `scope` is disposed, so the feature does not need to keep the
 * functions that stop them. Each subscription still returns one, to stop it
 * earlier.
 */
export interface FeatureContext<S extends OptionSpecs, P = unknown> {
  options: FeatureOptions<S>;
  /** Saved values that are not options, such as lists the user builds. */
  data: FeatureData;
  log: Logger;
  page: P;
  /**
   * Disposed when the feature is switched off or has failed. Add cleanups
   * for anything else the feature puts in the page, such as what `addStyle`
   * and `mount` return.
   */
  scope: Scope;
  /**
   * Shows `count` on the toolbar button's badge, such as how many posts the
   * feature has hidden on this page. Each call replaces the number this
   * context showed before, and the badge shows the sum over every feature.
   * The number is dropped when `scope` is disposed. 0 adds nothing. It
   * throws for a number that is not a whole number of 0 or more.
   */
  badge: (count: number) => void;
  /**
   * A context whose scope is a child of this one, for work the feature
   * starts and stops while it runs. Disposing the child's scope ends what
   * was subscribed through it.
   */
  child: () => FeatureContext<S, P>;
}

/** The keys of the options whose value is true or false. */
type SwitchKey<S extends OptionSpecs> = {
  [K in keyof S & string]: S[K]['default'] extends boolean ? K : never;
}[keyof S & string];

export interface FeatureDefinition<S extends OptionSpecs, P = unknown> {
  /** Stable name, used in logs. */
  id: string;
  options?: S;
  /**
   * An option of this feature that switches it on and off. While it is
   * false the feature does not run. Turning it on runs `setup`, and turning
   * it off disposes the feature's scope, without a page reload.
   */
  enabledBy?: SwitchKey<S>;
  /**
   * Runs after saved options have been read: once per page load, or each
   * time `enabledBy` is turned on.
   */
  setup: (ctx: FeatureContext<S, P>) => void | Promise<void>;
}

/** A feature with its option types erased, so features of every shape fit in one list. */
export type Feature<P = unknown> = FeatureDefinition<OptionSpecs, P>;

/**
 * Ties what a feature subscribes to through its context to the feature's
 * scope. Core hands one to the site's `PageFactory` for each context.
 */
export interface Binder {
  readonly scope: Scope;
  /**
   * Wraps a callback of the feature's. An error it throws is logged and
   * counted against the feature, and it does nothing once the scope is
   * disposed.
   */
  guard: <A extends unknown[]>(callback: (...args: A) => void) => (...args: A) => void;
  /**
   * Subscribes the guarded `listener` with `subscribe`, which returns a
   * function that unsubscribes. That function runs when the scope is
   * disposed. Returns a function that runs it earlier.
   */
  listen: <A extends unknown[]>(
    subscribe: (listener: (...args: A) => void) => () => void,
    listener: (...args: A) => void,
  ) => () => void;
}

/**
 * Builds a feature's view of the site's page services, with each
 * subscription tied to the binder's scope and each callback guarded.
 */
export type PageFactory<P> = (binder: Binder) => P;

/**
 * Declares a feature. Inside `setup`, `ctx.options` only accepts the keys
 * listed in `options` and returns each one's own value type.
 */
export function defineFeature<S extends OptionSpecs = Record<never, never>, P = unknown>(
  feature: FeatureDefinition<S, P>,
): Feature<P> {
  return feature as unknown as Feature<P>;
}
