import type { CapablePage, SiteCapabilities } from '../../capabilities';
import type { DomEnvironment } from '../../core/dom-env';
import type { Binder, Feature, FeatureDefinition, PageFactory } from '../../core/feature';
import type { Locate, LocatorStats } from '../../core/locator';
import type { OptionSpecs } from '../../core/options';
import type { PageWatcher } from '../../core/page-watcher';
import type { SavedData } from '../../core/saved';
import type { InstagramNetworkStats } from './page-world';
import { bindFeed, bindLocate, bindVideos, bindWatch } from '../../core/bind';
import { PageBridge } from '../../core/bridge';
import { createDomEnvironment } from '../../core/dom-env';
import { defineFeature as defineCoreFeature } from '../../core/feature';
import {
  IDENTITY_RESOLVER,
  isLocatorSpec,
  Locators,
  readLocatorOverrides,
} from '../../core/locator';
import { createLogger } from '../../core/log';
import { isObject } from '../../engines/react';
import { InstagramFeed } from './feed';
import * as selectors from './selectors';
import { InstagramVideos } from './videos';

export const IG_LOCATOR_OVERRIDES = 'ig_locators';

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
  readonly env: DomEnvironment;
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
  sharedEnv?: DomEnvironment,
): PageFactory<InstagramPage> & { readonly stats: InstagramStats } {
  const env: DomEnvironment = sharedEnv ?? createDomEnvironment({ log: createLogger('ig-dom') });
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
          ...(typeof payload.errors === 'number' ? { errors: payload.errors } : {}),
        };
        feed.recheck();
      }
    });
  };

  feed = new InstagramFeed(env, locate, bridge, subscribeNetworkStats);
  const videos = new InstagramVideos(env, locate);

  const factory: PageFactory<InstagramPage> = (binder: Binder) => {
    const boundFeed = bindFeed(feed, binder);
    const boundVideos = bindVideos(videos, binder);
    return {
      doc: env.doc,
      env,
      locate: bindLocate(locate, binder),
      watch: bindWatch(env, binder),
      onUrlChange: (listener) => binder.listen((guarded) => env.onUrlChange(guarded), listener),
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
