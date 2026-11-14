import type { Feature, FeatureDefinition, PageFactory } from '../core/feature';
import type { OptionSpecs } from '../core/options';
import type { PageWatcher, WatchHandlers } from '../core/page-watcher';
import type { AtomTranslator } from './atoms';
import { defineFeature as defineCoreFeature } from '../core/feature';
import { pageWatcher } from '../core/page-watcher';
import { Atoms } from './atoms';
import { Posts } from './posts';

/** What a feature can use on a Facebook page. It arrives as `ctx.page` in `setup`. */
export interface FacebookPage {
  /** Translates `S2F_` names into Facebook's current class names. Call `start()` before relying on it. */
  atoms: AtomTranslator;
  /** The posts on the page. Subscribing with `onAdd` starts post detection. */
  posts: Pick<Posts, 'onAdd' | 'onRemove' | 'onReset' | 'onUpdate'>;
  /**
   * Reports the elements matching a selector as they enter and leave the
   * page, for anything that is not a post. See `PageWatcher.watch` in
   * `src/core/page-watcher.ts`. A selector with `S2F_` names can be given as
   * a function that translates it, with `refresh` called from `atoms.onChange`.
   */
  watch: PageWatcher['watch'];
}

/**
 * Turns page services into a `PageFactory`: each feature gets a view of
 * `page` whose subscriptions end with the feature's scope and whose
 * callbacks are guarded.
 */
export function bindPage(page: FacebookPage): PageFactory<FacebookPage> {
  return ({ scope, guard, listen }) => ({
    atoms: {
      translate: (text) => page.atoms.translate(text),
      start: () => page.atoms.start(),
      onChange: (listener) => listen((guarded) => page.atoms.onChange(guarded), listener),
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
  });
}

/** Builds the page services. Nothing in them runs until a feature uses it. */
export function createPage(): PageFactory<FacebookPage> {
  const atoms = new Atoms();
  return bindPage({
    atoms,
    posts: new Posts(atoms),
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
