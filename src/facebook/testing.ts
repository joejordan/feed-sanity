// Helpers for tests. Nothing in the extension imports this file.

import { vi } from 'vitest';
import type { AtomTranslator } from './atoms';
import type { FacebookPage } from './feature';
import type { Post } from './posts';
import { Locators } from '../core/locator';
import { pageWatcher } from '../core/page-watcher';
import { Videos } from './videos';

/**
 * A class-name translator that leaves every name as it is, so a test's
 * markup can use `S2F_` names as its classes.
 */
export const fakeAtoms: AtomTranslator = {
  translate: (text) => text,
  resolve: (selector) => selector,
  onChange: () => () => true,
  start: () => Promise.resolve(),
};

/** Locators that read `S2F_` names as they are, through `fakeAtoms`. */
export const fakeLocate = new Locators(fakeAtoms).locate;

let nextNumber = 1;

/** Adds a post with this content to the page, as `Posts` would announce it. */
export function makePost(html: string, changes: Partial<Post> = {}): Post {
  const element = document.createElement('div');
  const number = nextNumber++;
  element.setAttribute('sfx_post', String(number));
  element.innerHTML = html;
  document.body.append(element);
  return { element, content: element, number, id: null, permalink: false, ...changes };
}

/** Stands in for ResizeObserver, which happy-dom does not run. `report` plays the browser's part. */
export class FakeResizeObserver {
  static latest: FakeResizeObserver | undefined;
  readonly observed = new Set<Element>();
  /**
   * The elements a browser would report soon: those observed since the last
   * `report`. As in Chrome and Firefox, observing an element that is
   * observed already does nothing.
   */
  readonly pending = new Set<Element>();
  readonly #callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
    FakeResizeObserver.latest = this;
  }

  observe(element: Element): void {
    if (!this.observed.has(element)) {
      this.observed.add(element);
      this.pending.add(element);
    }
  }

  unobserve(element: Element): void {
    this.observed.delete(element);
    this.pending.delete(element);
  }

  disconnect(): void {
    this.observed.clear();
    this.pending.clear();
  }

  /** Reports a change in size of `elements`, by default every element observed. */
  report(elements: Iterable<Element> = this.observed): void {
    const entries = [...elements].map((target) => ({ target }) as ResizeObserverEntry);
    for (const { target } of entries) {
      this.pending.delete(target);
    }
    this.#callback(entries, this as unknown as ResizeObserver);
  }
}

/** Gives `element` this box on the screen, which happy-dom does not lay out. */
export function placeAt(element: Element, x: number, y: number, width: number, height: number) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(
    DOMRect.fromRect({ x, y, width, height }),
  );
}

/** A page with no posts and the real video tracker, for features that only use videos. */
export function videoPage(): FacebookPage {
  const none = () => () => undefined;
  return {
    atoms: fakeAtoms,
    locate: fakeLocate,
    posts: { onAdd: none, onRemove: none, onReset: none, onUpdate: none },
    videos: new Videos(fakeLocate),
    watch: (selector, handlers, options) => pageWatcher.watch(selector, handlers, options),
  };
}

/** The parts of a video's state that happy-dom does not play out. A test changes them here. */
export interface FakeMedia {
  duration: number;
  seeking: boolean;
  buffered: [number, number][];
}

/**
 * A `<video>` whose length, seeking state and buffered ranges come from
 * `media`. Its time and paused state are happy-dom's own: setting
 * `currentTime` moves it, and `play` and `pause` fire their events.
 */
export function fakeVideo(state: Partial<FakeMedia> = {}): {
  video: HTMLVideoElement;
  media: FakeMedia;
} {
  const media: FakeMedia = { duration: Number.NaN, seeking: false, buffered: [], ...state };
  const video = document.createElement('video');
  const buffered = {
    get length() {
      return media.buffered.length;
    },
    start: (index: number) => media.buffered[index]?.[0] ?? 0,
    end: (index: number) => media.buffered[index]?.[1] ?? 0,
  };
  Object.defineProperties(video, {
    duration: { get: () => media.duration, configurable: true },
    seeking: { get: () => media.seeking, configurable: true },
    buffered: { get: () => buffered, configurable: true },
    // happy-dom's fastSeek does nothing, so without it a fast seek sets the time.
    fastSeek: { value: undefined, configurable: true },
  });
  return { video, media };
}
