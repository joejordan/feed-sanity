// Shared `MediaCapability` implementation for site adapters (Instagram, X.com,
// and future video sites). Tracks `<video>` elements, caches player containers
// while connected, guards `playing`/`emptied` control refreshes, and provides
// fast scoped `around()` lookup with zero DOM queries on photo posts.

import type { MediaCapability, MediaItem, VideoControl } from '../../capabilities';
import type { DomEnvironment } from '../../core/dom-env';
import type { Locate, LocatorSpec } from '../../core/locator';
import { callSafely, Listeners } from '../../core/listeners';
import { createLogger } from '../../core/log';

export interface SiteVideo extends MediaItem {
  readonly container: HTMLElement;
  readonly controls: () => VideoControl[];
}

export interface SiteVideosConfig {
  readonly logName: string;
  readonly videoSpec: LocatorSpec;
  readonly controlSpec: LocatorSpec;
  readonly resolveContainer?: (element: HTMLVideoElement) => HTMLElement;
  readonly resolveSurface: (element: HTMLVideoElement) => string;
}

class TrackedSiteVideo implements SiteVideo {
  readonly element: HTMLVideoElement;
  readonly #locate: Locate;
  readonly #config: SiteVideosConfig;
  readonly #subscribeControls: (listener: (video: SiteVideo) => void) => () => void;
  #cachedContainer: HTMLElement | undefined;
  started = false;

  constructor(
    element: HTMLVideoElement,
    locate: Locate,
    config: SiteVideosConfig,
    subscribeControls: (listener: (video: SiteVideo) => void) => () => void,
  ) {
    this.element = element;
    this.#locate = locate;
    this.#config = config;
    this.#subscribeControls = subscribeControls;
  }

  get container(): HTMLElement {
    if (
      this.#cachedContainer &&
      this.#cachedContainer !== this.element &&
      this.#cachedContainer.isConnected &&
      this.#cachedContainer.contains(this.element)
    ) {
      return this.#cachedContainer;
    }
    const resolved = this.#config.resolveContainer
      ? this.#config.resolveContainer(this.element)
      : (this.element.parentElement ?? this.element);
    this.#cachedContainer =
      resolved !== this.element && resolved.isConnected ? resolved : undefined;
    return resolved;
  }

  get surface(): string {
    return this.#config.resolveSurface(this.element);
  }

  onControls(listener: () => void): () => void {
    return this.#subscribeControls((video) => {
      if (video === this) {
        listener();
      }
    });
  }

  controls(): VideoControl[] {
    if (!this.element.isConnected) {
      return [];
    }
    return this.#locate(this.#config.controlSpec)
      .all(this.container)
      .map((element) => ({
        element,
        bar: element.getAttribute('role') === 'slider',
      }));
  }
}

export class SiteVideos implements MediaCapability {
  readonly #env: DomEnvironment;
  readonly #locate: Locate;
  readonly #config: SiteVideosConfig;
  readonly #log: ReturnType<typeof createLogger>;
  readonly #videos = new Map<Element, TrackedSiteVideo>();
  readonly #added: Listeners<[SiteVideo]>;
  readonly #removed: Listeners<[SiteVideo]>;
  readonly #controls: Listeners<[SiteVideo]>;
  #stop: (() => void) | undefined;

  constructor(env: DomEnvironment, locate: Locate, config: SiteVideosConfig) {
    this.#env = env;
    this.#locate = locate;
    this.#config = config;
    this.#log = createLogger(config.logName);
    this.#added = new Listeners(this.#log);
    this.#removed = new Listeners(this.#log);
    this.#controls = new Listeners(this.#log);
  }

  onAdd(listener: (video: SiteVideo) => void): () => void {
    for (const video of this.#videos.values()) {
      callSafely(this.#log, listener, video);
    }
    const remove = this.#added.add(listener);
    this.#ensureStarted();
    return () => {
      remove();
      if (this.#added.size === 0) {
        this.#end();
      }
    };
  }

  onRemove(listener: (video: SiteVideo) => void): () => void {
    return this.#removed.add(listener);
  }

  onControls(listener: (video: SiteVideo) => void): () => void {
    return this.#controls.add(listener);
  }

  around(
    element: Element,
    within: Element | null = this.#env.doc.body ?? this.#env.doc.documentElement,
  ): SiteVideo | undefined {
    if (this.#videos.size === 0 || !within || !within.contains(element)) {
      return undefined;
    }
    const direct = this.#videos.get(element);
    if (direct) {
      return direct;
    }
    const inScope: TrackedSiteVideo[] = [];
    for (const [videoEl, tracked] of this.#videos) {
      if (within.contains(videoEl)) {
        inScope.push(tracked);
      }
    }
    if (inScope.length === 0) {
      return undefined;
    }
    if (inScope.length === 1) {
      return inScope[0];
    }
    let node: Element | null = element;
    while (node && within.contains(node)) {
      let match: TrackedSiteVideo | undefined;
      let count = 0;
      for (const candidate of inScope) {
        if (node.contains(candidate.element)) {
          match = candidate;
          count++;
        }
      }
      if (count > 0) {
        return count === 1 ? match : undefined;
      }
      if (node === within) {
        break;
      }
      node = node.parentElement;
    }
    return undefined;
  }

  #ensureStarted(): void {
    if (this.#stop) {
      return;
    }
    this.#stop = this.#env.watcher.watch(this.#locate(this.#config.videoSpec), {
      added: (el) => {
        if (!(el instanceof HTMLVideoElement) || this.#videos.has(el)) {
          return;
        }
        const video = new TrackedSiteVideo(el, this.#locate, this.#config, (listener) =>
          this.onControls(listener),
        );
        this.#videos.set(el, video);
        el.addEventListener('playing', this.#onPlaying);
        el.addEventListener('emptied', this.#onEmptied);
        this.#added.emit(video);
      },
      removed: (el) => {
        const video = this.#videos.get(el);
        if (!video) {
          return;
        }
        this.#videos.delete(el);
        el.removeEventListener('playing', this.#onPlaying);
        el.removeEventListener('emptied', this.#onEmptied);
        this.#removed.emit(video);
      },
    });
  }

  #end(): void {
    this.#stop?.();
    this.#stop = undefined;
    for (const el of this.#videos.keys()) {
      el.removeEventListener('playing', this.#onPlaying);
      el.removeEventListener('emptied', this.#onEmptied);
    }
    this.#videos.clear();
  }

  readonly #onPlaying = (event: Event): void => {
    const video = event.target instanceof Element ? this.#videos.get(event.target) : undefined;
    if (video && !video.started) {
      video.started = true;
      this.#controls.emit(video);
    }
  };

  readonly #onEmptied = (event: Event): void => {
    const video = event.target instanceof Element ? this.#videos.get(event.target) : undefined;
    if (video) {
      video.started = false;
      this.#controls.emit(video);
    }
  };
}
