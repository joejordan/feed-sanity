import type { Locate } from '../core/locator';
import type { PageWatcher } from '../core/page-watcher';
import { callSafely, Listeners } from '../core/listeners';
import { createLogger } from '../core/log';
import { pageWatcher } from '../core/page-watcher';
import { pageContext } from './page';
import {
  REEL_CARD,
  VIDEO,
  VIDEO_CONTAINER,
  VIDEO_CONTROL,
  VIDEO_POST,
  VIDEO_SLIDER,
} from './selectors';

const log = createLogger('videos');

/**
 * Where a video is shown: in a post, in the reel viewer, or anywhere else.
 * Stories have not been looked at yet, so their videos count as `other`.
 */
export type VideoSurface = 'feed' | 'other' | 'reel';

/** A `<video>` element on the page. */
export interface Video {
  readonly element: HTMLVideoElement;
  /**
   * The element Facebook wraps the video in, or the video's parent when no
   * wrapper is found. Null while the video is not in the page. It is looked
   * up each time it is read, because Facebook can move a video.
   */
  readonly container: HTMLElement | null;
  /** Looked up each time it is read, like `container`. */
  readonly surface: VideoSurface;
  /**
   * Facebook's controls that can lie over the video: the buttons, sliders
   * and links in the smallest element that holds the video's container and
   * every slider of Facebook's that belongs to the video. Facebook keeps
   * them in the page after they fade out, and some have no size, so measure
   * them to know where they are. `onControls` reports when they may have
   * moved.
   */
  readonly controls: () => VideoControl[];
}

/** One of Facebook's controls in a video's player. */
export interface VideoControl {
  readonly element: Element;
  /** True for a slider that runs from side to side, such as the position slider. */
  readonly bar: boolean;
}

type VideoListener = (video: Video) => void;

class TrackedVideo implements Video {
  readonly element: HTMLVideoElement;
  /** Facebook's sliders that belong to this video. */
  readonly sliders = new Set<Element>();
  /** True once the video has played since it was loaded. */
  started = false;
  readonly #locate: Locate;

  constructor(element: HTMLVideoElement, locate: Locate) {
    this.element = element;
    this.#locate = locate;
  }

  get container(): HTMLElement | null {
    if (!this.element.isConnected) {
      return null;
    }
    const parent = this.element.parentElement;
    const wrapper = parent && this.#locate(VIDEO_CONTAINER).closest(parent);
    return wrapper instanceof HTMLElement ? wrapper : parent;
  }

  get surface(): VideoSurface {
    if (this.#locate(REEL_CARD).closest(this.element)) {
      return 'reel';
    }
    if (this.#locate(VIDEO_POST).closest(this.element)) {
      return 'feed';
    }
    return pageContext().type === 'reel' ? 'reel' : 'other';
  }

  controls(): VideoControl[] {
    // A slider can lie outside the container, as in the reel viewer.
    let player: Element | null = this.container;
    for (const slider of this.sliders) {
      // One Facebook has just taken out is forgotten once the watch reports it.
      if (!slider.isConnected) {
        continue;
      }
      while (player && !player.contains(slider)) {
        player = player.parentElement;
      }
    }
    const sliders = this.#locate(VIDEO_SLIDER);
    return (player ? this.#locate(VIDEO_CONTROL).all(player) : []).map((element) => ({
      element,
      bar: sliders.matches(element) && element.getAttribute('aria-orientation') !== 'vertical',
    }));
  }
}

/**
 * Finds the videos on the page and follows them as Facebook adds and removes
 * them. Nothing runs until the first `onAdd` call, and it stops again once
 * nothing listens with `onAdd`.
 *
 * Facebook's own controls are found from their sliders. A slider belongs to
 * the video `around` finds for it, so nothing of the player's markup is
 * needed but the slider role.
 */
export class Videos {
  readonly #locate: Locate;
  readonly #watch: PageWatcher['watch'];
  readonly #added = new Listeners<[Video]>(log);
  readonly #removed = new Listeners<[Video]>(log);
  readonly #controls = new Listeners<[Video]>(log);
  readonly #videos = new Map<Element, TrackedVideo>();
  /** Facebook's sliders, each with its video, or null while that is not known. */
  readonly #sliders = new Map<Element, TrackedVideo | null>();
  #stop: (() => void)[] = [];

  constructor(
    locate: Locate,
    watch: PageWatcher['watch'] = (selector, handlers, options) =>
      pageWatcher.watch(selector, handlers, options),
  ) {
    this.#locate = locate;
    this.#watch = watch;
  }

  /**
   * Calls `listener` with every video already on the page and each one that
   * arrives later. Returns a function that stops it.
   */
  onAdd(listener: VideoListener): () => void {
    for (const video of this.#videos.values()) {
      callSafely(log, listener, video);
    }
    const remove = this.#added.add(listener);
    this.#start();
    return () => {
      remove();
      if (this.#added.size === 0) {
        this.#end();
      }
    };
  }

  /** Calls `listener` when a video it was told about leaves the page. */
  onRemove(listener: VideoListener): () => void {
    return this.#removed.add(listener);
  }

  /**
   * Calls `listener` when Facebook's controls on a video may have moved: one
   * of its sliders came to the video or left it, the element was emptied to
   * be given another video, or the video started playing for the first time
   * since it was loaded.
   */
  onControls(listener: VideoListener): () => void {
    return this.#controls.add(listener);
  }

  /**
   * The video `element` is, or else the one in the nearest element above it
   * that holds any video, when that element holds only one. This tells which
   * video something drawn over a video belongs to, without knowing the
   * player's markup. The search goes no higher than `within`, which defaults
   * to the page body. Only finds videos while something listens with `onAdd`.
   */
  around(element: Element, within?: Element): Video | undefined {
    return this.#around(element, within);
  }

  #start(): void {
    if (this.#stop.length > 0) {
      return;
    }
    // Videos first, so the sliders already on the page find theirs.
    this.#stop = [
      this.#watch(this.#locate(VIDEO), {
        added: (element) => this.#enter(element),
        removed: (element) => this.#leave(element),
      }),
      this.#watch(this.#locate(VIDEO_SLIDER), {
        added: (slider) => this.#sliderAdded(slider),
        removed: (slider) => this.#sliderRemoved(slider),
      }),
    ];
    // A listener told about a video above may have stopped the last `onAdd`
    // before the watches were kept, so `#end` could not stop them.
    if (this.#added.size === 0) {
      this.#end();
    }
  }

  #end(): void {
    for (const stop of this.#stop.splice(0)) {
      stop();
    }
    for (const element of this.#videos.keys()) {
      this.#unlisten(element);
    }
    this.#videos.clear();
    this.#sliders.clear();
  }

  #enter(element: Element): void {
    if (!(element instanceof HTMLVideoElement) || this.#videos.has(element)) {
      return;
    }
    const video = new TrackedVideo(element, this.#locate);
    this.#videos.set(element, video);
    element.addEventListener('playing', this.#playing);
    element.addEventListener('emptied', this.#emptied);
    this.#added.emit(video);
    // A slider that arrived before its video, in the same player.
    const container = video.container;
    for (const [slider, owner] of this.#sliders) {
      if (owner === null && container?.contains(slider)) {
        this.#sliderAdded(slider);
      }
    }
  }

  #leave(element: Element): void {
    const video = this.#videos.get(element);
    if (!video) {
      return;
    }
    this.#videos.delete(element);
    this.#unlisten(element);
    for (const [slider, owner] of this.#sliders) {
      if (owner === video) {
        this.#sliders.set(slider, null);
      }
    }
    video.sliders.clear();
    this.#removed.emit(video);
  }

  // Facebook can draw its controls when a video starts.
  readonly #playing = (event: Event): void => {
    const video = event.target instanceof Element ? this.#videos.get(event.target) : undefined;
    if (video && !video.started) {
      video.started = true;
      this.#controls.emit(video);
    }
  };

  readonly #emptied = (event: Event): void => {
    const video = event.target instanceof Element ? this.#videos.get(event.target) : undefined;
    if (video) {
      video.started = false;
      this.#controls.emit(video);
    }
  };

  #unlisten(element: Element): void {
    element.removeEventListener('playing', this.#playing);
    element.removeEventListener('emptied', this.#emptied);
  }

  #sliderAdded(slider: Element): void {
    const owner = this.#around(slider) ?? null;
    this.#sliders.set(slider, owner);
    if (owner) {
      owner.sliders.add(slider);
      this.#controls.emit(owner);
    }
  }

  #sliderRemoved(slider: Element): void {
    const owner = this.#sliders.get(slider);
    this.#sliders.delete(slider);
    if (owner?.sliders.delete(slider)) {
      this.#controls.emit(owner);
    }
  }

  #around(element: Element, within: Element = document.body): TrackedVideo | undefined {
    if (this.#videos.size === 0) {
      return undefined;
    }
    const own = this.#videos.get(element);
    // What the tracked videos were found by, so an override of the locator applies here too.
    const selector = this.#locate(VIDEO).selector();
    if (own || !selector) {
      return own;
    }
    let node = element.parentElement;
    while (node && within.contains(node)) {
      const videos = node.querySelectorAll(selector);
      if (videos.length > 0) {
        const video = videos.length === 1 ? videos[0] : undefined;
        return video && this.#videos.get(video);
      }
      if (node === within) {
        break;
      }
      node = node.parentElement;
    }
    return undefined;
  }
}
