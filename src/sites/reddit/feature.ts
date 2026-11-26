import type { CapablePage, SiteCapabilities } from '../../capabilities';
import type { DomEnvironment } from '../../core/dom-env';
import type { Binder, Feature, FeatureDefinition, PageFactory } from '../../core/feature';
import type { Locate, LocatorStats } from '../../core/locator';
import type { OptionSpecs } from '../../core/options';
import type { PageWatcher } from '../../core/page-watcher';
import type { SavedData } from '../../core/saved';
import type { RedditRuntimeStats } from './page-world';
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
import { RedditFeed } from './feed';
import * as selectors from './selectors';
import { RedditVideos } from './videos';

export const REDDIT_LOCATOR_OVERRIDES = 'reddit_locators';

export interface RedditStats {
  readonly locators: {
    stats: () => LocatorStats[];
    names: () => string[];
  };
  readonly feed: RedditFeed;
  readonly bridge: PageBridge;
  readonly env: DomEnvironment;
  readonly runtimeStats: () => RedditRuntimeStats;
}

export interface RedditPage extends CapablePage {
  readonly doc: Document;
  readonly env: DomEnvironment;
  readonly locate: Locate;
  readonly watch: PageWatcher['watch'];
  readonly onUrlChange: (listener: () => void) => () => void;
  readonly feed: Pick<
    RedditFeed,
    'onAdd' | 'onRemove' | 'onReset' | 'onTrack' | 'onUntrack' | 'onUpdate'
  >;
  readonly videos: Pick<RedditVideos, 'around' | 'onAdd' | 'onControls' | 'onRemove'>;
  readonly capabilities: SiteCapabilities;
}

/**
 * Creates Reddit (Shreddit)'s `PageFactory`: owns a shadow-piercing
 * `DomEnvironment`, `Locators`, `PageBridge` wired to `reddit:shadow-attached`
 * for zero-polling nested Shadow Root discovery, `RedditFeed`, and `RedditVideos`.
 */
export function createRedditPage(
  data: SavedData,
  installPageWorld: () => Promise<void>,
  sharedEnv?: DomEnvironment,
): PageFactory<RedditPage> & { readonly stats: RedditStats } {
  const env: DomEnvironment =
    sharedEnv ?? createDomEnvironment({ pierceShadow: true, log: createLogger('reddit-dom') });
  const locators = new Locators(IDENTITY_RESOLVER, Object.values(selectors).filter(isLocatorSpec));
  const overrides = data.value(REDDIT_LOCATOR_OVERRIDES, readLocatorOverrides);
  locators.override(overrides.get());
  env.scope.add(overrides.onChange((value) => locators.override(value)));

  const bridge = new PageBridge(installPageWorld, {
    log: createLogger('reddit-bridge'),
    reconnectOnReady: true,
  });
  env.scope.add(() => bridge.dispose());

  let latestRuntime: RedditRuntimeStats = {
    scannedScripts: 0,
    indexedAds: 0,
    indexedSuggested: 0,
    shadowAttachments: 0,
  };
  let bridgeSubscribed = false;

  const subscribeBridgeEvents = (): void => {
    if (bridgeSubscribed) {
      return;
    }
    bridgeSubscribed = true;
    env.scope.add(
      bridge.on('reddit:shadow-attached', () => {
        env.scanShadowRoots();
      }),
    );
    env.scope.add(
      bridge.on('reddit:runtime-stats', (payload) => {
        if (
          isObject(payload) &&
          typeof payload.scannedScripts === 'number' &&
          typeof payload.indexedAds === 'number' &&
          typeof payload.indexedSuggested === 'number' &&
          typeof payload.shadowAttachments === 'number'
        ) {
          const prevAds = latestRuntime.indexedAds;
          const prevSuggested = latestRuntime.indexedSuggested;
          latestRuntime = {
            scannedScripts: payload.scannedScripts,
            indexedAds: payload.indexedAds,
            indexedSuggested: payload.indexedSuggested,
            shadowAttachments: payload.shadowAttachments,
          };
          // Re-check tracked posts only when SSR hydration newly indexed more ads/recommendations.
          if (payload.indexedAds > prevAds || payload.indexedSuggested > prevSuggested) {
            feed.recheck();
          }
        }
      }),
    );
  };

  const locate: Locate = (spec) => locators.locate(spec);
  const feed = new RedditFeed(env, locate, bridge, subscribeBridgeEvents);
  const videos = new RedditVideos(env, locate);

  const factory: PageFactory<RedditPage> = (binder: Binder) => {
    const boundFeed = bindFeed(feed, binder);
    const boundVideos = bindVideos(videos, binder);
    const feedWithBridge: RedditPage['feed'] = {
      ...boundFeed,
      onAdd(listener) {
        subscribeBridgeEvents();
        return boundFeed.onAdd(listener);
      },
      onTrack(listener) {
        subscribeBridgeEvents();
        return boundFeed.onTrack(listener);
      },
    };
    return {
      doc: env.doc,
      env,
      locate: bindLocate(locate, binder),
      watch: bindWatch(env, binder),
      onUrlChange: (listener) => binder.listen((guarded) => env.onUrlChange(guarded), listener),
      feed: feedWithBridge,
      videos: boundVideos,
      capabilities: {
        feed: feedWithBridge,
        media: boundVideos,
      },
    };
  };

  return Object.assign(factory, {
    stats: {
      locators,
      feed,
      bridge,
      env,
      runtimeStats: () => latestRuntime,
    },
  });
}

/** Declares a Reddit feature with typed access to `RedditPage`. */
export function defineRedditFeature<S extends OptionSpecs>(
  definition: FeatureDefinition<S, RedditPage>,
): Feature<RedditPage> {
  return defineCoreFeature(definition);
}
