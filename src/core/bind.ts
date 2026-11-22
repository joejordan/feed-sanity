// Reusable `Binder` helpers that wrap site services (`Locator`, `PageWatcher`,
// `FeedCapability`, `MediaCapability`) so every callback registered by a
// feature counts toward `FeatureRunner`'s error guard and cleans up with its
// feature scope.

import type { FeedCapability, FeedItem, MediaCapability, MediaItem } from '../capabilities';
import type { Binder } from './feature';
import type { Locator } from './locator';
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

export function bindWatch(watcher: PageWatcher, { scope, guard }: Binder): PageWatcher['watch'] {
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
