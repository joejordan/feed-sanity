import type { MediaCapability, MediaItem } from '../../capabilities';
import type { DomEnvironment } from '../../core/dom-env';
import type { Locate } from '../../core/locator';
import type { VideoControl } from '../../facebook/videos';
import { callSafely, Listeners } from '../../core/listeners';
import { createLogger } from '../../core/log';
import { IG_VIDEO, IG_VIDEO_CONTROL } from './selectors';

const log = createLogger('ig-videos');

export interface InstagramVideo extends MediaItem {
  readonly container: HTMLElement;
  readonly controls: () => VideoControl[];
}

class TrackedInstagramVideo implements InstagramVideo {
  readonly element: HTMLVideoElement;
  readonly #locate: Locate;
  readonly #subscribeControls: (listener: (video: InstagramVideo) => void) => () => void;
  started = false;

  constructor(
    element: HTMLVideoElement,
    locate: Locate,
    subscribeControls: (listener: (video: InstagramVideo) => void) => () => void,
  ) {
    this.element = element;
    this.#locate = locate;
    this.#subscribeControls = subscribeControls;
  }

  get container(): HTMLElement {
    return this.element.parentElement ?? this.element;
  }

  get surface(): string {
    if (this.element.closest('article')) {
      return 'feed';
    }
    if (location.pathname.startsWith('/reels')) {
      return 'reel';
    }
    if (location.pathname.startsWith('/stories')) {
      return 'story';
    }
    return 'other';
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
    return this.#locate(IG_VIDEO_CONTROL)
      .all(this.container)
      .map((element) => ({
        element,
        bar: element.getAttribute('role') === 'slider',
      }));
  }
}

/**
 * Tracks `<video>` elements on Instagram and implements `MediaCapability` so
 * shared video controls (scrubber, click-to-pause) work across feed posts and
 * Reels without duplicating player tracking logic.
 */
export class InstagramVideos implements MediaCapability {
  readonly #env: DomEnvironment;
  readonly #locate: Locate;
  readonly #videos = new Map<Element, TrackedInstagramVideo>();
  readonly #added = new Listeners<[InstagramVideo]>(log);
  readonly #removed = new Listeners<[InstagramVideo]>(log);
  readonly #controls = new Listeners<[InstagramVideo]>(log);
  #stop: (() => void) | undefined;

  constructor(env: DomEnvironment, locate: Locate) {
    this.#env = env;
    this.#locate = locate;
  }

  onAdd(listener: (video: InstagramVideo) => void): () => void {
    for (const video of this.#videos.values()) {
      callSafely(log, listener, video);
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

  onRemove(listener: (video: InstagramVideo) => void): () => void {
    return this.#removed.add(listener);
  }

  onControls(listener: (video: InstagramVideo) => void): () => void {
    return this.#controls.add(listener);
  }

  around(element: Element, within: Element = this.#env.doc.body): InstagramVideo | undefined {
    if (this.#videos.size === 0) {
      return undefined;
    }
    const direct = this.#videos.get(element);
    if (direct) {
      return direct;
    }
    // Filter tracked videos inside `within` first so clicks on photo posts return
    // immediately without running any ancestor `querySelectorAll('video')` scans.
    const inScope: TrackedInstagramVideo[] = [];
    for (const [videoEl, tracked] of this.#videos) {
      if (within.contains(videoEl)) {
        inScope.push(tracked);
      }
    }
    if (inScope.length === 0) {
      return undefined;
    }
    if (inScope.length === 1) {
      return within.contains(element) ? inScope[0] : undefined;
    }
    let node = element.parentElement;
    while (node && within.contains(node)) {
      let match: TrackedInstagramVideo | undefined;
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
    this.#stop = this.#env.watcher.watch(this.#locate(IG_VIDEO), {
      added: (el) => {
        if (!(el instanceof HTMLVideoElement) || this.#videos.has(el)) {
          return;
        }
        const video = new TrackedInstagramVideo(el, this.#locate, (listener) =>
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
