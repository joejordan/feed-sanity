import type { CapablePage, SiteCapabilities } from '../../capabilities';
import type { DomEnvironment } from '../../core/dom-env';
import type { Binder, Feature, FeatureDefinition, PageFactory } from '../../core/feature';
import type {
  Locate,
  Locator,
  LocatorSpec,
  LocatorStats,
  SelectorResolver,
} from '../../core/locator';
import type { OptionSpecs } from '../../core/options';
import type { PageWatcher, WatchHandlers } from '../../core/page-watcher';
import type { SavedData } from '../../core/saved';
import type { InstagramNetworkStats } from './page-world';
import { PageBridge } from '../../core/bridge';
import { createDomEnvironment } from '../../core/dom-env';
import { defineFeature as defineCoreFeature } from '../../core/feature';
import { isLocatorSpec, Locators, readLocatorOverrides } from '../../core/locator';
import { createLogger } from '../../core/log';
import { isObject } from '../../engines/react';
import { InstagramFeed } from './feed';
import * as selectors from './selectors';
import { InstagramVideos } from './videos';

export const IG_LOCATOR_OVERRIDES = 'ig_locators';

const IDENTITY_RESOLVER: SelectorResolver = {
  resolve: (selector) => selector,
  onChange: () => () => undefined,
};

export interface InstagramStats {
  readonly locators: {
    stats: () => LocatorStats[];
    names: () => string[];
  };
  readonly feed: InstagramFeed;
  readonly bridge: PageBridge;
  readonly networkStats: () => InstagramNetworkStats;
}

export interface InstagramPage extends CapablePage {
  readonly doc: Document;
  readonly locate: Locate;
  readonly watch: PageWatcher['watch'];
  readonly onUrlChange: (listener: () => void) => () => void;
  readonly feed: Pick<
    InstagramFeed,
    'onAdd' | 'onRemove' | 'onReset' | 'onTrack' | 'onUntrack' | 'onUpdate'
  >;
  readonly videos: Pick<InstagramVideos, 'around' | 'onAdd' | 'onControls' | 'onRemove'>;
  readonly capabilities: SiteCapabilities;
}

function bindLocator(locator: Locator, { listen }: Binder): Locator {
  return {
    name: locator.name,
    all: (root) => locator.all(root),
    first: (root) => locator.first(root),
    matches: (element) => locator.matches(element),
    closest: (element) => locator.closest(element),
    probe: (root) => locator.probe(root),
    selector: () => locator.selector(),
    onChange: (listener) => listen((guarded) => locator.onChange(guarded), listener),
  };
}

/**
 * Creates Instagram's `PageFactory`: owns a `DomEnvironment`, `Locators`,
 * lazy `PageBridge` (subscribing to MAIN-world `ig:network-stats` only once a
 * feature uses the bridge and re-checking tracked posts on fresh captures),
 * `InstagramFeed`, and `InstagramVideos`. Every feature subscription is bound
 * to its `Binder` for error guarding and scope cleanup.
 */
export function createInstagramPage(
  data: SavedData,
  installPageWorld: () => Promise<void>,
): PageFactory<InstagramPage> & { readonly stats: InstagramStats } {
  const env: DomEnvironment = createDomEnvironment({ log: createLogger('ig-dom') });
  const locators = new Locators(IDENTITY_RESOLVER, Object.values(selectors).filter(isLocatorSpec));
  const overrides = data.value(IG_LOCATOR_OVERRIDES, readLocatorOverrides);
  locators.override(overrides.get());
  overrides.onChange((value) => locators.override(value));

  const bridge = new PageBridge(installPageWorld, { log: createLogger('ig-bridge') });
  let latestNetwork: InstagramNetworkStats = { matchedResponses: 0, cachedItems: 0 };
  let listeningStats = false;

  const locate: Locate = (spec) => locators.locate(spec);
  let feed!: InstagramFeed;

  const subscribeNetworkStats = (): void => {
    if (listeningStats) {
      return;
    }
    listeningStats = true;
    bridge.on('ig:network-stats', (payload) => {
      if (
        isObject(payload) &&
        typeof payload.matchedResponses === 'number' &&
        typeof payload.cachedItems === 'number'
      ) {
        latestNetwork = {
          matchedResponses: payload.matchedResponses,
          cachedItems: payload.cachedItems,
        };
        feed.recheck();
      }
    });
  };

  feed = new InstagramFeed(env, locate, bridge, subscribeNetworkStats);
  const videos = new InstagramVideos(env, locate);

  const factory: PageFactory<InstagramPage> = (binder: Binder) => {
    const { scope, guard, listen } = binder;
    const boundLocators = new Map<LocatorSpec, Locator>();
    const boundFeed: InstagramPage['feed'] = {
      onTrack: (listener) => listen((guarded) => feed.onTrack(guarded), listener),
      onUntrack: (listener) => listen((guarded) => feed.onUntrack(guarded), listener),
      onAdd: (listener) => listen((guarded) => feed.onAdd(guarded), listener),
      onUpdate: (listener) => listen((guarded) => feed.onUpdate(guarded), listener),
      onRemove: (listener) => listen((guarded) => feed.onRemove(guarded), listener),
      onReset: (listener) => listen((guarded) => feed.onReset(guarded), listener),
    };
    const boundVideos: InstagramPage['videos'] = {
      onAdd: (listener) => listen((guarded) => videos.onAdd(guarded), listener),
      onRemove: (listener) => listen((guarded) => videos.onRemove(guarded), listener),
      onControls: (listener) => listen((guarded) => videos.onControls(guarded), listener),
      around: (element, within) => videos.around(element, within),
    };
    return {
      doc: env.doc,
      locate: (spec) => {
        let locator = boundLocators.get(spec);
        if (!locator) {
          locator = bindLocator(locate(spec), binder);
          boundLocators.set(spec, locator);
        }
        return locator;
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
        const watching = env.watcher.watch(selector, handlers, options);
        return Object.assign(scope.add(watching), { refresh: () => watching.refresh() });
      },
      onUrlChange: (listener) => listen((guarded) => env.onUrlChange(guarded), listener),
      feed: boundFeed,
      videos: boundVideos,
      capabilities: {
        feed: boundFeed,
        media: boundVideos,
      },
    };
  };

  return Object.assign(factory, {
    stats: {
      locators,
      feed,
      bridge,
      networkStats: () => latestNetwork,
    },
  });
}

/** Declares an Instagram feature with typed access to `InstagramPage`. */
export function defineInstagramFeature<S extends OptionSpecs>(
  definition: FeatureDefinition<S, InstagramPage>,
): Feature<InstagramPage> {
  return defineCoreFeature(definition);
}
