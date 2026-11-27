// Reusable `Binder` helpers that wrap site services (`Locator`, `PageWatcher`,
// `FeedCapability`, `MediaCapability`) so every callback registered by a
// feature counts toward `FeatureRunner`'s error guard and cleans up with its
// feature scope.

import type {
  FeedCapability,
  FeedItem,
  MediaCapability,
  MediaItem,
  ThreadListCapability,
  ThreadRow,
} from '../capabilities';
import type { PageBridge } from './bridge';
import type { Binder } from './feature';
import type { Locate, Locator, LocatorSpec } from './locator';
import type { PageWatcher, WatchHandlers } from './page-watcher';

export function bindLocator(locator: Locator, { listen }: Binder): Locator {
  return {
    name: locator.name,
    all: (root, keep) => locator.all(root, keep),
    first: (root) => locator.first(root),
    matches: (element) => locator.matches(element),
    closest: (element) => locator.closest(element),
    probe: (root) => locator.probe(root),
    selector: () => locator.selector(),
    onChange: (listener) => listen((guarded) => locator.onChange(guarded), listener),
  };
}

/** Memoizes `bindLocator` per `LocatorSpec` for a feature's `Binder`. */
export function bindLocate(locate: Locate, binder: Binder): Locate {
  const bound = new Map<LocatorSpec, Locator>();
  return (spec) => {
    let locator = bound.get(spec);
    if (!locator) {
      locator = bindLocator(locate(spec), binder);
      bound.set(spec, locator);
    }
    return locator;
  };
}

export function bindWatch(
  watcher: Pick<PageWatcher, 'watch'>,
  { scope, guard }: Binder,
): PageWatcher['watch'] {
  return (selector, { added, removed, changed }, options) => {
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
    const watching = watcher.watch(selector, handlers, options);
    return Object.assign(scope.add(watching), { refresh: () => watching.refresh() });
  };
}

export function bindFeed<T extends FeedItem>(
  feed: {
    onTrack: (listener: (item: T) => void) => () => void;
    onUntrack: (listener: (item: T) => void) => () => void;
    onAdd: (listener: (item: T) => void) => () => void;
    onUpdate: (listener: (item: T) => void) => () => void;
    onRemove: (listener: (item: T) => void) => () => void;
    onReset: (listener: () => void) => () => void;
  },
  { listen }: Binder,
): FeedCapability & {
  onTrack: (listener: (item: T) => void) => () => void;
  onUntrack: (listener: (item: T) => void) => () => void;
  onAdd: (listener: (item: T) => void) => () => void;
  onUpdate: (listener: (item: T) => void) => () => void;
  onRemove: (listener: (item: T) => void) => () => void;
  onReset: (listener: () => void) => () => void;
} {
  return {
    onTrack: (listener) => listen((guarded) => feed.onTrack(guarded), listener),
    onUntrack: (listener) => listen((guarded) => feed.onUntrack(guarded), listener),
    onAdd: (listener) => listen((guarded) => feed.onAdd(guarded), listener),
    onUpdate: (listener) => listen((guarded) => feed.onUpdate(guarded), listener),
    onRemove: (listener) => listen((guarded) => feed.onRemove(guarded), listener),
    onReset: (listener) => listen((guarded) => feed.onReset(guarded), listener),
  };
}

export function bindVideos<V extends MediaItem>(
  videos: {
    onAdd: (listener: (video: V) => void) => () => void;
    onRemove: (listener: (video: V) => void) => () => void;
    onControls: (listener: (video: V) => void) => () => void;
    around: (element: Element, within?: Element) => V | undefined;
  },
  { listen }: Binder,
): MediaCapability & {
  onAdd: (listener: (video: V) => void) => () => void;
  onRemove: (listener: (video: V) => void) => () => void;
  onControls: (listener: (video: V) => void) => () => void;
  around: (element: Element, within?: Element) => V | undefined;
} {
  // Wrap each yielded `MediaItem` via a WeakMap so calling `video.onControls(cb)`
  // routes through `binder.listen` for error guarding and automatic scope cleanup.
  const wrapped = new WeakMap<V, V>();
  const wrapVideo = (video: V): V => {
    let proxy = wrapped.get(video);
    if (!proxy) {
      proxy = new Proxy(video, {
        get(target, prop) {
          if (prop === 'onControls' && typeof target.onControls === 'function') {
            return (listener: () => void): (() => void) =>
              listen((guarded) => target.onControls!(guarded), listener);
          }
          const value = Reflect.get(target, prop, target);
          return typeof value === 'function'
            ? (value as (...args: unknown[]) => unknown).bind(target)
            : value;
        },
      });
      wrapped.set(video, proxy);
    }
    return proxy;
  };

  return {
    onAdd: (listener) =>
      listen((guarded) => videos.onAdd((video) => guarded(wrapVideo(video))), listener),
    onRemove: (listener) =>
      listen((guarded) => videos.onRemove((video) => guarded(wrapVideo(video))), listener),
    onControls: (listener) =>
      listen((guarded) => videos.onControls((video) => guarded(wrapVideo(video))), listener),
    around: (element: Element, within?: Element) => {
      const found = videos.around(element, within);
      return found ? wrapVideo(found) : undefined;
    },
  };
}

export function bindThreads<R extends ThreadRow>(
  threads: {
    onAdd: (listener: (row: R) => void) => () => void;
    onUpdate?: (listener: (row: R) => void) => () => void;
    onRemove: (listener: (row: R) => void) => () => void;
    onReset?: (listener: () => void) => () => void;
  },
  { listen }: Binder,
): ThreadListCapability & {
  onAdd: (listener: (row: R) => void) => () => void;
  onUpdate?: (listener: (row: R) => void) => () => void;
  onRemove: (listener: (row: R) => void) => () => void;
  onReset?: (listener: () => void) => () => void;
} {
  return {
    onAdd: (listener) => listen((guarded) => threads.onAdd(guarded), listener),
    ...(threads.onUpdate
      ? { onUpdate: (listener) => listen((guarded) => threads.onUpdate!(guarded), listener) }
      : {}),
    onRemove: (listener) => listen((guarded) => threads.onRemove(guarded), listener),
    ...(threads.onReset
      ? { onReset: (listener) => listen((guarded) => threads.onReset!(guarded), listener) }
      : {}),
  };
}

/**
 * Ref-counts active feature bindings against a MAIN-world `PageBridge` toggle
 * so passive-start page-world scripts activate on first consumer use and
 * deactivate cleanly when all features stop (e.g. site paused).
 */
export function createBridgeActiveToggle(
  bridge: Pick<PageBridge, 'set'>,
  toggleName: string,
  initiallyActive = false,
): {
  /** Activates the remote toggle if inactive. Resolves `true` when it transitioned from inactive to active. */
  readonly activate: () => Promise<boolean>;
  readonly deactivate: () => Promise<void>;
  readonly setPinned: (pinned: boolean) => void;
  readonly bind: (binder: Binder) => void;
} {
  let activated = false;
  let pinned = false;
  let remoteActive = initiallyActive;
  let activeBindings = 0;

  const setRemote = (enabled: boolean): Promise<void> => {
    remoteActive = enabled;
    return bridge
      .set(toggleName, enabled)
      .then(() => undefined)
      .catch(() => undefined);
  };

  return {
    activate() {
      if (activated && remoteActive) {
        return Promise.resolve(false);
      }
      activated = true;
      return setRemote(true).then(() => true);
    },
    deactivate() {
      activated = false;
      if (!remoteActive) {
        return Promise.resolve();
      }
      return setRemote(false);
    },
    setPinned(nextPinned) {
      pinned = nextPinned;
    },
    bind(binder) {
      if (activeBindings === 0 && activated && !remoteActive) {
        void setRemote(true);
      }
      activeBindings++;
      binder.scope.add(() => {
        activeBindings = Math.max(0, activeBindings - 1);
        if (activeBindings === 0 && !pinned && (activated || remoteActive)) {
          void setRemote(false);
        }
      });
    },
  };
}
