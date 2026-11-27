import type { DomEnvironment } from '../core/dom-env';
import type { Binder, Feature, FeatureDefinition, PageFactory } from '../core/feature';
import type { Locate, Locator, LocatorSpec } from '../core/locator';
import type { OptionSpecs } from '../core/options';
import type { PageWatcher, WatchHandlers } from '../core/page-watcher';
import type { FeatureData } from '../core/saved';
import type { AtomTranslator } from './atoms';
import type { SetHomeFeedResult } from './home-rails';
import type { ComposerInfo, ComposerMode } from './post-composer';
import type { StopFeedRefreshAnswer } from './stop-feed-refresh';
import type { VideoSources } from './video-sources';
import { PageBridge } from '../core/bridge';
import { defineFeature as defineCoreFeature } from '../core/feature';
import { isLocatorSpec, Locators, readLocatorOverrides } from '../core/locator';
import { createLogger } from '../core/log';
import { pageWatcher } from '../core/page-watcher';
import { Atoms } from './atoms';
import { mountHomeLeftRail, mountHomeRightRail, setHomeFeed } from './home-rails';
import { STOP_FEED_REFRESH } from './page-toggles';
import { composerInfo, openPostComposer } from './post-composer';
import { Posts } from './posts';
import * as selectors from './selectors';
import { postSponsored, rightRailSponsored } from './sponsored';
import { setStopFeedRefresh } from './stop-feed-refresh';
import { videoSources } from './video-sources';
import { Videos } from './videos';

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
   * Translates `FS_` names into Facebook's current class names, for CSS
   * text and the user's own selectors. Call `start()` before relying on it.
   */
  atoms: AtomTranslator;
  /**
   * The locator for one of the specs in `src/facebook/selectors.ts`. Its
   * lookups skip strategies whose class names are not known yet, and
   * `onChange` ends with the feature's scope.
   */
  locate: Locate;
  /** The posts on the page. Subscribing with `onAdd` or `onTrack` starts post detection. */
  posts: Pick<Posts, 'onAdd' | 'onRemove' | 'onReset' | 'onTrack' | 'onUntrack' | 'onUpdate'>;
  /** The videos on the page. Subscribing with `onAdd` starts looking for them. */
  videos: Pick<Videos, 'around' | 'onAdd' | 'onControls' | 'onRemove'>;
  /**
   * What only the page's own world can read, through the page-world bridge
   * (`PageBridge` in `src/core/bridge.ts`). The first question or `onStatus`
   * starts the bridge. A question still open when the feature's scope is
   * disposed is withdrawn, and rejects with `cancelled`.
   */
  bridge: FacebookBridge;
  /**
   * Reports the elements a locator or selector finds as they enter and
   * leave the page, for anything that is not a post. See `PageWatcher.watch`
   * in `src/core/page-watcher.ts`. A locator is looked at again whenever
   * class names or the user's selectors change.
   */
  watch: PageWatcher['watch'];
  /** Opens Feed Sanity's Options dialog, optionally jumping straight to `initialSection`. */
  openOptions?: (initialSection?: string) => void;
}

/** The page-world bridge as features use it, with Facebook's readers. */
export interface FacebookBridge {
  status: PageBridge['status'];
  onStatus: PageBridge['onStatus'];
  /**
   * The files of the video `element`, checked; see `videoSources` in
   * `src/facebook/video-sources.ts`. Null when no player data was found for
   * it. Rejects with a `BridgeError` when the question could not be asked.
   */
  videoSources: (element: HTMLVideoElement, signal?: AbortSignal) => Promise<VideoSources | null>;
  /**
   * Whether the feed post `element` is an ad, checked; see `postSponsored`
   * in `src/facebook/sponsored.ts`. Null when no feed unit was found for
   * it. Rejects with a `BridgeError` when the question could not be asked.
   */
  postSponsored: (element: Element, signal?: AbortSignal) => Promise<boolean | null>;
  /**
   * Disables Facebook's automatic feed refreshes and return-to-feed redirects
   * while this feature's scope is alive, and restores them when the scope is
   * disposed. Rejects with a `BridgeError` when the toggle could not be sent.
   */
  stopFeedRefresh: (signal?: AbortSignal) => Promise<StopFeedRefreshAnswer | null>;
  /**
   * The signed-in user's short name and ID for the inline post composer,
   * checked; see `composerInfo` in `src/facebook/post-composer.ts`.
   */
  composerInfo: (element: Element, signal?: AbortSignal) => Promise<ComposerInfo | null>;
  /**
   * Opens Facebook's native "Create post" composer dialog on the current page.
   * Resolves true when Facebook's dialog launcher accepted the request.
   */
  openPostComposer: (mode?: ComposerMode, signal?: AbortSignal) => Promise<boolean>;
  /**
   * Sets Facebook's Home feed style in place on `/` and optionally triggers a
   * Relay refresh so the URL stays `https://www.facebook.com/`.
   */
  setHomeFeed: (
    feedStyle: number | null,
    refresh?: boolean,
    signal?: AbortSignal,
  ) => Promise<SetHomeFeedResult>;
  /** Mounts Facebook's native Home left rail inside `target`, auto-unmounting with scope. */
  mountHomeLeftRail: (target: Element, signal?: AbortSignal) => Promise<(() => void) | null>;
  /** Mounts Facebook's native Home right rail inside `target`, auto-unmounting with scope. */
  mountHomeRightRail: (target: Element, signal?: AbortSignal) => Promise<(() => void) | null>;
  /** Whether a Right Rail unit element is a Sponsored ad unit. */
  rightRailSponsored: (element: Element, signal?: AbortSignal) => Promise<boolean | null>;
}

/** The page-world bridge as `bindPage` takes it, before it is tied to a feature. */
export type PageWorld = Pick<PageBridge, 'ask' | 'mount' | 'onStatus' | 'run' | 'set' | 'status'>;

/**
 * `bridge` with `onStatus` tied to the binder's scope, and each question
 * withdrawn when the scope is disposed, with Facebook's readers and toggles
 * on top. A new reader or toggle needs only its typed call here.
 */
function bindBridge(bridge: PageWorld, { scope, listen }: Binder): FacebookBridge {
  const withScope = <T>(
    run: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> => {
    // Joined by hand: AbortSignal.any needs Chrome 116, and the page-world
    // script runs from Chrome 111.
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    // Runs at once when the scope is disposed already.
    const settled = scope.add(abort);
    if (signal?.aborted) {
      abort();
    }
    signal?.addEventListener('abort', abort, { once: true });
    return run(controller.signal).finally(() => {
      signal?.removeEventListener('abort', abort);
      settled();
    });
  };
  const ask: PageWorld['ask'] = (element, reader, signal) =>
    withScope((scoped) => bridge.ask(element, reader, scoped), signal);
  const set: PageWorld['set'] = (toggle, enabled, signal) =>
    withScope((scoped) => bridge.set(toggle, enabled, scoped), signal);
  const run: PageWorld['run'] = (action, payload, signal) =>
    withScope((scoped) => bridge.run(action, payload, scoped), signal);
  const mount: PageWorld['mount'] = async (element, name, payload, signal) => {
    const handle = await withScope(
      (scoped) => bridge.mount(element, name, payload, scoped),
      signal,
    );
    if (!handle) {
      return null;
    }
    const stop = scope.add(handle);
    return scope.disposed ? null : stop;
  };
  return {
    status: () => bridge.status(),
    onStatus: (listener) => listen((guarded) => bridge.onStatus(guarded), listener),
    videoSources: (element, signal) => videoSources({ ask }, element, signal),
    postSponsored: (element, signal) => postSponsored({ ask }, element, signal),
    rightRailSponsored: (element, signal) => rightRailSponsored({ ask }, element, signal),
    composerInfo: (element, signal) => composerInfo({ ask }, element, signal),
    openPostComposer: (mode, signal) => openPostComposer({ run }, mode, signal),
    setHomeFeed: (feedStyle, refresh, signal) => setHomeFeed({ run }, feedStyle, refresh, signal),
    mountHomeLeftRail: (target, signal) => mountHomeLeftRail({ mount }, target, signal),
    mountHomeRightRail: (target, signal) => mountHomeRightRail({ mount }, target, signal),
    stopFeedRefresh: (signal) => {
      let active = false;
      let disposed = false;
      // Restores the page-world toggle through the raw bridge so the already-
      // disposed feature scope does not abort the turn-off call.
      const release = scope.add(() => {
        disposed = true;
        if (active) {
          active = false;
          void bridge.set(STOP_FEED_REFRESH, false).catch(() => undefined);
        }
      });
      return setStopFeedRefresh({ set }, true, signal).then(
        (answer) => {
          if (disposed) {
            void bridge.set(STOP_FEED_REFRESH, false).catch(() => undefined);
          } else {
            active = true;
          }
          return answer;
        },
        (error: unknown) => {
          release();
          throw error;
        },
      );
    },
  };
}

/** The page services `bindPage` ties to each feature: a `FacebookPage` with the bridge as it comes. */
export interface PageServices extends Omit<FacebookPage, 'bridge'> {
  bridge: PageWorld;
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
export function bindPage(page: PageServices): PageFactory<FacebookPage> {
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
        onTrack: (listener) => listen((guarded) => page.posts.onTrack(guarded), listener),
        onUntrack: (listener) => listen((guarded) => page.posts.onUntrack(guarded), listener),
        onAdd: (listener) => listen((guarded) => page.posts.onAdd(guarded), listener),
        onRemove: (listener) => listen((guarded) => page.posts.onRemove(guarded), listener),
        onReset: (listener) => listen((guarded) => page.posts.onReset(guarded), listener),
        onUpdate: (listener) => listen((guarded) => page.posts.onUpdate(guarded), listener),
      },
      videos: {
        around: (element, within) => page.videos.around(element, within),
        onAdd: (listener) => listen((guarded) => page.videos.onAdd(guarded), listener),
        onControls: (listener) => listen((guarded) => page.videos.onControls(guarded), listener),
        onRemove: (listener) => listen((guarded) => page.videos.onRemove(guarded), listener),
      },
      bridge: bindBridge(page.bridge, binder),
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
      ...(page.openOptions ? { openOptions: page.openOptions } : {}),
    };
  };
}

/** The page services' counts, read by the diagnostics. */
export interface PageStats {
  readonly atoms: Pick<Atoms, 'stats'>;
  readonly locators: Pick<Locators, 'names' | 'stats'>;
  readonly posts: Pick<Posts, 'stats'>;
  readonly bridge: Pick<PageBridge, 'status'>;
}

/**
 * Builds the page services. Nothing in them runs until a feature uses it,
 * except reading the user's replacement selectors from `data`, which are
 * applied again whenever they change. `installPageWorld`, from the build's
 * `Platform`, puts the page-world side of the bridge in the page when the
 * bridge is first used. `stats` reads their counts.
 */
export function createPage(
  data: FeatureData,
  installPageWorld: () => Promise<void>,
  env?: DomEnvironment,
  openOptions?: (initialSection?: string) => void,
): PageFactory<FacebookPage> & { readonly stats: PageStats } {
  const atoms = new Atoms();
  const locators = new Locators(atoms, Object.values(selectors).filter(isLocatorSpec));
  const overrides = data.value(LOCATOR_OVERRIDES, readLocatorOverrides);
  // The value may have been read already, if something else asked for it first.
  locators.override(overrides.get());
  const stopOverrides = overrides.onChange((value) => locators.override(value));
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
  const posts = new Posts(atoms, locate);
  const bridge = new PageBridge(installPageWorld, { reconnectOnReady: Boolean(env) });
  env?.scope.add(() => {
    stopOverrides();
    atoms.dispose();
    posts.dispose();
    bridge.dispose();
  });
  const page = bindPage({
    atoms,
    locate,
    posts,
    videos: new Videos(locate),
    bridge,
    watch: (selector, handlers, options) => pageWatcher.watch(selector, handlers, options),
    ...(openOptions ? { openOptions } : {}),
  });
  return Object.assign(page, {
    setActive(active: boolean) {
      atoms.setActive(active);
    },
    stats: { atoms, locators, posts, bridge },
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
