import type { CapablePage, MediaSources, SiteCapabilities } from '../../capabilities';
import type { BridgeStatus } from '../../core/bridge';
import type { DomEnvironment } from '../../core/dom-env';
import type { Binder, Feature, FeatureDefinition, PageFactory } from '../../core/feature';
import type { Locate, LocatorStats } from '../../core/locator';
import type { OptionSpecs } from '../../core/options';
import type { PageWatcher } from '../../core/page-watcher';
import type { SavedData } from '../../core/saved';
import type { VideoDownloadBridge } from '../../features/shared/video-download';
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
import { isInstagramMediaAddress } from './urls';
import { InstagramVideos } from './videos';

export const IG_LOCATOR_OVERRIDES = 'ig_locators';
const SAFE_VIDEO_ID = /^[A-Za-z0-9_-]{1,64}$/;

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
  readonly bridge: VideoDownloadBridge;
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
  env.scope.add(overrides.onChange((value) => locators.override(value)));

  const bridge = new PageBridge(installPageWorld, {
    log: createLogger('ig-bridge'),
    reconnectOnReady: true,
  });
  env.scope.add(() => bridge.dispose());
  let latestNetwork: InstagramNetworkStats = { matchedResponses: 0, cachedItems: 0 };
  let listeningStats = false;

  const locate: Locate = (spec) => locators.locate(spec);
  let feed!: InstagramFeed;

  const subscribeNetworkStats = (): void => {
    if (listeningStats) {
      return;
    }
    listeningStats = true;
    env.scope.add(
      bridge.on('ig:network-stats', (payload) => {
        if (
          isObject(payload) &&
          typeof payload.matchedResponses === 'number' &&
          typeof payload.cachedItems === 'number'
        ) {
          const prevCached = latestNetwork.cachedItems;
          const prevMatched = latestNetwork.matchedResponses;
          latestNetwork = {
            matchedResponses: payload.matchedResponses,
            cachedItems: payload.cachedItems,
            ...(typeof payload.errors === 'number' ? { errors: payload.errors } : {}),
          };
          if (payload.cachedItems > prevCached || payload.matchedResponses > prevMatched) {
            feed.recheck();
          }
        }
      }),
    );
  };

  feed = new InstagramFeed(env, locate, bridge, subscribeNetworkStats);
  const videos = new InstagramVideos(env, locate);

  const readVideoSources = async (
    element: HTMLVideoElement,
    signal?: AbortSignal,
  ): Promise<MediaSources | null> => {
    subscribeNetworkStats();
    const raw = await bridge.ask(element, 'ig-video-sources', signal);
    if (!isObject(raw)) {
      return null;
    }
    const file = typeof raw.url === 'string' && isInstagramMediaAddress(raw.url) ? raw.url : null;
    const videoId =
      typeof raw.videoId === 'string' && SAFE_VIDEO_ID.test(raw.videoId) ? raw.videoId : null;
    if (!file && !videoId) {
      return null;
    }
    return { file, manifest: !file, videoId };
  };

  const factory: PageFactory<InstagramPage> = (binder: Binder) => {
    const boundFeed = bindFeed(feed, binder);
    const boundVideos = bindVideos(videos, binder);
    return {
      doc: env.doc,
      env,
      locate: bindLocate(locate, binder),
      watch: bindWatch(env, binder),
      onUrlChange: (listener) => binder.listen((guarded) => env.onUrlChange(guarded), listener),
      bridge: {
        status: () => bridge.status(),
        onStatus: (listener: (status: BridgeStatus) => void) =>
          binder.listen((guarded) => bridge.onStatus(guarded), listener),
        videoSources: readVideoSources,
      },
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
