import type { CapablePage, SiteCapabilities } from '../../capabilities';
import type { DomEnvironment } from '../../core/dom-env';
import type { Binder, Feature, FeatureDefinition, PageFactory } from '../../core/feature';
import type { Locate, LocatorStats } from '../../core/locator';
import type { OptionSpecs } from '../../core/options';
import type { PageWatcher } from '../../core/page-watcher';
import type { SavedData } from '../../core/saved';
import type { XNetworkStats } from './page-world';
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
import { XFeed } from './feed';
import * as selectors from './selectors';
import { XVideos } from './videos';

export const X_LOCATOR_OVERRIDES = 'x_locators';

export interface XStats {
  readonly locators: {
    stats: () => LocatorStats[];
    names: () => string[];
  };
  readonly feed: XFeed;
  readonly bridge: PageBridge;
  readonly networkStats: () => XNetworkStats;
}

export interface XPage extends CapablePage {
  readonly doc: Document;
  readonly env: DomEnvironment;
  readonly locate: Locate;
  readonly watch: PageWatcher['watch'];
  readonly onUrlChange: (listener: () => void) => () => void;
  /** Opens Feed Sanity's Options dialog, optionally jumping straight to `initialSection`. */
  readonly openOptions: (initialSection?: string) => void;
  /** Enables or disables MAIN-world Network Tap stripping of promoted timeline entries. */
  readonly setStripPromoted: (enabled: boolean) => void;
  readonly feed: Pick<
    XFeed,
    'onAdd' | 'onRemove' | 'onReset' | 'onTrack' | 'onUntrack' | 'onUpdate'
  >;
  readonly videos: Pick<XVideos, 'around' | 'onAdd' | 'onControls' | 'onRemove'>;
  readonly capabilities: SiteCapabilities;
}

/**
 * Creates X.com's `PageFactory`: owns a `DomEnvironment`, `Locators`, lazy
 * `PageBridge`, `XFeed`, and `XVideos`. Every feature subscription is bound
 * through `Binder` for error guarding and scope cleanup.
 */
export function createXPage(
  data: SavedData,
  installPageWorld: () => Promise<void>,
  sharedEnv?: DomEnvironment,
  openOptions: (initialSection?: string) => void = () => undefined,
): PageFactory<XPage> & { readonly stats: XStats } {
  const env: DomEnvironment = sharedEnv ?? createDomEnvironment({ log: createLogger('x-dom') });
  const locators = new Locators(IDENTITY_RESOLVER, Object.values(selectors).filter(isLocatorSpec));
  const overrides = data.value(X_LOCATOR_OVERRIDES, readLocatorOverrides);
  locators.override(overrides.get());
  env.scope.add(overrides.onChange((value) => locators.override(value)));

  const bridge = new PageBridge(installPageWorld, { log: createLogger('x-bridge') });
  env.scope.add(() => bridge.dispose());
  let latestNetwork: XNetworkStats = { matchedResponses: 0, strippedPromoted: 0 };
  let listeningStats = false;
  let stripPromoted = false;

  const subscribeNetworkStats = (): void => {
    if (listeningStats) {
      return;
    }
    listeningStats = true;
    env.scope.add(
      bridge.on('x:network-stats', (payload) => {
        if (
          isObject(payload) &&
          typeof payload.matchedResponses === 'number' &&
          typeof payload.strippedPromoted === 'number'
        ) {
          latestNetwork = {
            matchedResponses: payload.matchedResponses,
            strippedPromoted: payload.strippedPromoted,
            ...(typeof payload.errors === 'number' ? { errors: payload.errors } : {}),
          };
        }
      }),
    );
    env.scope.add(
      bridge.on('x:shadow-attached', () => {
        env.scanShadowRoots();
      }),
    );
  };

  const locate: Locate = (spec) => locators.locate(spec);
  const feed = new XFeed(env, locate, bridge, subscribeNetworkStats);
  const videos = new XVideos(env, locate);

  const factory: PageFactory<XPage> = (binder: Binder) => {
    const boundFeed = bindFeed(feed, binder);
    const boundVideos = bindVideos(videos, binder);
    return {
      doc: env.doc,
      env,
      locate: bindLocate(locate, binder),
      watch: bindWatch(env, binder),
      onUrlChange: (listener) => binder.listen((guarded) => env.onUrlChange(guarded), listener),
      openOptions,
      setStripPromoted: (enabled) => {
        if (enabled === stripPromoted) {
          return;
        }
        stripPromoted = enabled;
        subscribeNetworkStats();
        void bridge.set('x-strip-promoted', enabled).catch(() => undefined);
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

/** Declares an X.com feature with typed access to `XPage`. */
export function defineXFeature<S extends OptionSpecs>(
  definition: FeatureDefinition<S, XPage>,
): Feature<XPage> {
  return defineCoreFeature(definition);
}
