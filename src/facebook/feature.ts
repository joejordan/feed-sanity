import type { Binder, Feature, FeatureDefinition, PageFactory } from '../core/feature';
import type { Locate, Locator, LocatorSpec } from '../core/locator';
import type { OptionSpecs } from '../core/options';
import type { PageWatcher, WatchHandlers } from '../core/page-watcher';
import type { FeatureData } from '../core/saved';
import type { AtomTranslator } from './atoms';
import { defineFeature as defineCoreFeature } from '../core/feature';
import { isLocatorSpec, Locators, readLocatorOverrides } from '../core/locator';
import { createLogger } from '../core/log';
import { pageWatcher } from '../core/page-watcher';
import { Atoms } from './atoms';
import { Posts } from './posts';
import * as selectors from './selectors';

const log = createLogger('page');

/**
 * The saved value that holds the user's replacement selectors, by locator
 * name: `{ "post": ["[role=article]"] }`. Each list replaces that locator's
 * own strategies.
 */
export const LOCATOR_OVERRIDES = 'locators';

/** What a feature can use on a Facebook page. It arrives as `ctx.page` in `setup`. */
export interface FacebookPage {
  /**
   * Translates `S2F_` names into Facebook's current class names, for CSS
   * text and the user's own selectors. Call `start()` before relying on it.
   */
  atoms: AtomTranslator;
  /**
   * The locator for one of the specs in `src/facebook/selectors.ts`. Its
   * lookups skip strategies whose class names are not known yet, and
   * `onChange` ends with the feature's scope.
   */
  locate: Locate;
  /** The posts on the page. Subscribing with `onAdd` starts post detection. */
  posts: Pick<Posts, 'onAdd' | 'onRemove' | 'onReset' | 'onUpdate'>;
  /**
   * Reports the elements a locator or selector finds as they enter and
   * leave the page, for anything that is not a post. See `PageWatcher.watch`
   * in `src/core/page-watcher.ts`. A locator is looked at again whenever
   * class names or the user's selectors change.
   */
  watch: PageWatcher['watch'];
}

/** `locator` with its `onChange` tied to the binder's scope. */
function bindLocator(locator: Locator, { listen }: Binder): Locator {
  return {
    name: locator.name,
    all: (root, keep) => locator.all(root, keep),
    first: (root) => locator.first(root),
    probe: (root) => locator.probe(root),
    matches: (element) => locator.matches(element),
    closest: (element) => locator.closest(element),
    selector: () => locator.selector(),
    onChange: (listener) => listen((guarded) => locator.onChange(guarded), listener),
  };
}

/**
 * Turns page services into a `PageFactory`: each feature gets a view of
 * `page` whose subscriptions end with the feature's scope and whose
 * callbacks are guarded.
 */
export function bindPage(page: FacebookPage): PageFactory<FacebookPage> {
  return (binder) => {
    const { scope, guard, listen } = binder;
    const locators = new Map<LocatorSpec, Locator>();
    return {
      atoms: {
        translate: (text) => page.atoms.translate(text),
        resolve: (selector) => page.atoms.resolve(selector),
        start: () => page.atoms.start(),
        onChange: (listener) => listen((guarded) => page.atoms.onChange(guarded), listener),
      },
      locate: (spec) => {
        let locator = locators.get(spec);
        if (!locator) {
          locator = bindLocator(page.locate(spec), binder);
          locators.set(spec, locator);
        }
        return locator;
      },
      posts: {
        onAdd: (listener) => listen((guarded) => page.posts.onAdd(guarded), listener),
        onRemove: (listener) => listen((guarded) => page.posts.onRemove(guarded), listener),
        onReset: (listener) => listen((guarded) => page.posts.onReset(guarded), listener),
        onUpdate: (listener) => listen((guarded) => page.posts.onUpdate(guarded), listener),
      },
      watch: (selector, { added, removed, changed }, options) => {
        const handlers: WatchHandlers = {};
        if (added) {
          handlers.added = guard(added);
        }
        if (removed) {
          handlers.removed = guard(removed);
        }
        if (changed) {
          handlers.changed = guard(changed);
        }
        // A disposed scope stops it at once.
        const watching = page.watch(selector, handlers, options);
        return Object.assign(scope.add(watching), { refresh: () => watching.refresh() });
      },
    };
  };
}

/**
 * Builds the page services. Nothing in them runs until a feature uses it,
 * except reading the user's replacement selectors from `data`, which are
 * applied again whenever they change.
 */
export function createPage(data: FeatureData): PageFactory<FacebookPage> {
  const atoms = new Atoms();
  const locators = new Locators(atoms, Object.values(selectors).filter(isLocatorSpec));
  const overrides = data.value(LOCATOR_OVERRIDES, readLocatorOverrides);
  // The value may have been read already, if something else asked for it first.
  locators.override(overrides.get());
  overrides.onChange((value) => locators.override(value));
  let scanning = false;
  const locate: Locate = (spec) => {
    // Many strategies need Facebook's class names, so the first lookup starts the search for them.
    if (!scanning) {
      scanning = true;
      atoms.start().catch((error: unknown) => {
        log.error('could not look for class names', error);
      });
    }
    return locators.locate(spec);
  };
  return bindPage({
    atoms,
    locate,
    posts: new Posts(atoms, locate),
    watch: (selector, handlers, options) => pageWatcher.watch(selector, handlers, options),
  });
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
