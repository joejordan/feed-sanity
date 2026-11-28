// Helpers for tests. Nothing in the extension imports this file.

import { vi } from 'vitest';
import type { BridgeOptions } from '../core/bridge';
import type { PageActions, PageMounts, PageReaders, PageToggles } from '../core/page-world';
import type { PageServices, PageWorld } from './feature';
import type { Post } from './posts';
import { PageBridge } from '../core/bridge';
import { IDENTITY_RESOLVER, Locators } from '../core/locator';
import { pageWatcher } from '../core/page-watcher';
import { servePageWorld } from '../core/page-world';
import { MARK } from './selectors';
import { Videos } from './videos';

/** Locators with the built-in strategies, as a page without the user's selectors has them. */
export const fakeLocate = new Locators(IDENTITY_RESOLVER).locate;

let nextNumber = 1;

/** Adds a post with this content to the page, as `Posts` would announce it. */
export function makePost(html: string, changes: Partial<Post> = {}): Post {
  const element = document.createElement('div');
  const number = nextNumber++;
  element.setAttribute(MARK.post, String(number));
  element.innerHTML = html;
  document.body.append(element);
  return { element, content: element, number, id: null, permalink: false, ...changes };
}

type PostListener = (post: Post) => void;

/**
 * Stands in for fb-dom's post tracker in `PageServices['posts']`: the test
 * tracks, announces, refills and removes posts. Late `onTrack` and `onAdd`
 * listeners are told about the posts already present, as `Posts` does.
 */
export class FakePosts {
  /** The posts on the page, as last announced. */
  readonly posts: Post[] = [];
  readonly #tracked = new Set<PostListener>();
  readonly #added = new Set<PostListener>();
  readonly #updated = new Set<PostListener>();
  readonly #untracked = new Set<PostListener>();
  readonly #reset = new Set<() => void>();

  readonly services: PageServices['posts'] = {
    onTrack: (listener) => this.#subscribe(this.#tracked, listener, true),
    onAdd: (listener) => this.#subscribe(this.#added, listener, true),
    onUntrack: (listener) => this.#subscribe(this.#untracked, listener),
    onRemove: (listener) => this.#subscribe(this.#untracked, listener),
    onUpdate: (listener) => this.#subscribe(this.#updated, listener),
    onReset: (listener) => {
      this.#reset.add(listener);
      return () => this.#reset.delete(listener);
    },
  };

  /** Tracks `post` and announces it with `id`, as fb-dom does a moment after tracking. */
  add(post: Post, id: string | null = post.id): Post {
    this.track(post);
    return this.announce(post, id);
  }

  track(post: Post): Post {
    this.posts.push(post);
    for (const listener of this.#tracked) {
      listener(post);
    }
    return post;
  }

  announce(post: Post, id: string | null = post.id): Post {
    const announced = { ...post, id };
    const index = this.posts.findIndex((present) => present.element === post.element);
    this.posts[index === -1 ? this.posts.length : index] = announced;
    for (const listener of this.#added) {
      listener(announced);
    }
    return announced;
  }

  update(post: Post): void {
    for (const listener of this.#updated) {
      listener(post);
    }
  }

  /** Takes `post` off the page and tells the untrack listeners. */
  remove(post: Post): void {
    const index = this.posts.findIndex((present) => present.element === post.element);
    if (index !== -1) {
      this.posts.splice(index, 1);
    }
    post.element.remove();
    for (const listener of this.#untracked) {
      listener(post);
    }
  }

  /** An in-page move: every post leaves, then numbering starts again. */
  reset(): void {
    for (const post of [...this.posts]) {
      this.remove(post);
    }
    for (const listener of this.#reset) {
      listener();
    }
  }

  #subscribe(listeners: Set<PostListener>, listener: PostListener, replay = false): () => void {
    listeners.add(listener);
    if (replay) {
      for (const post of this.posts) {
        listener(post);
      }
    }
    return () => listeners.delete(listener);
  }
}

/**
 * The verified badge Facebook draws beside a page's name, a button too, as
 * seen on 2026-11-14. Its label is translated on the real site.
 */
const VERIFIED_BADGE =
  '<span><div role="button" tabindex="0" aria-label="Verified account"><svg viewBox="0 0 12 12"></svg><span>Verified</span></div></span>';

/**
 * A post's header as Facebook drew it on 2026-11-14, with a Follow or Join
 * button reading `button` in the name heading when one is given, and the
 * verified badge before it when `verified` is true.
 */
export const postHeader = (name: string, button = '', verified = false): string =>
  `<div data-ad-rendering-role="profile_name"><h4><span><a href="/x"><strong>${name}</strong></a></span>${
    verified ? VERIFIED_BADGE : ''
  }${
    button
      ? `<span><span><span><div role="button" tabindex="0">${button}</div></span></span></span>`
      : ''
  }</h4></div>`;

/**
 * Gives `element` a React fiber with `feedUnit` in the props `depth` steps
 * above its own, as only the page's own world would see it.
 */
export function giveFeedUnit<E extends Element>(element: E, feedUnit: unknown, depth = 4): E {
  let fiber: Record<string, unknown> = { memoizedProps: { feedUnit }, return: null };
  for (let step = 0; step < depth; step++) {
    fiber = { memoizedProps: { className: `level-${step}` }, return: fiber };
  }
  Object.assign(element, { '__reactFiber$test': fiber });
  return element;
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

/**
 * A bridge whose page-world side serves `readers` and `toggles` in the test's
 * own world, as the harness in `.claude/skills/live-facebook-check` runs it.
 * With neither readers nor toggles, the page-world side cannot be installed.
 */
export function testBridge(
  readers?: PageReaders,
  options?: BridgeOptions,
  toggles?: PageToggles,
  actions?: PageActions,
  mounts?: PageMounts,
): PageWorld {
  return new PageBridge(installReaders(readers, toggles, actions, mounts), options);
}

/**
 * An installer for `createPage` that serves `readers`, `toggles`, `actions`
 * and `mounts` in the test's own world. With none, it fails as a page that refuses the script would.
 */
export function installReaders(
  readers?: PageReaders,
  toggles?: PageToggles,
  actions?: PageActions,
  mounts?: PageMounts,
): () => Promise<void> {
  return () => {
    if (!readers && !toggles && !actions && !mounts) {
      return Promise.reject(new Error('there is no page world in this test'));
    }
    servePageWorld(readers ?? {}, toggles ?? {}, actions ?? {}, mounts ?? {});
    return Promise.resolve();
  };
}

/**
 * A page with no posts and the real video tracker, for features that only
 * use videos. Its bridge is `bridge`, by default one that cannot be installed.
 */
export function videoPage(bridge: PageWorld = testBridge()): PageServices {
  const none = () => () => undefined;
  return {
    locate: fakeLocate,
    posts: {
      onTrack: none,
      onUntrack: none,
      onAdd: none,
      onRemove: none,
      onReset: none,
      onUpdate: none,
    },
    videos: new Videos(fakeLocate),
    bridge,
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

/** The parts of a story that `addStory` adds, by ID. */
export interface FakeStory {
  readonly card: HTMLElement;
  /** The video, or null for a photo story. */
  readonly video: HTMLVideoElement | null;
  /** The video's state, which the test changes. Null for a photo story. */
  readonly media: FakeMedia | null;
  readonly part: (id: string) => HTMLElement;
}

/**
 * Adds a story as the stories viewer drew one on 2026-11-14 (see
 * docs/facebook-notes.md), with the page's address set to a story's. The card is
 * 356 by 633 pixels at (100, 0). The three header buttons on the right lie
 * over its top, outside it, the pause button left of the menu button, and
 * the next and previous buttons are beside it. Without `pause`, no button
 * lies just left of the menu button.
 */
export function addStory({ photo = false, pause = true } = {}): FakeStory {
  history.replaceState({}, '', '/stories/100000000000077/UzpfSTE/');
  const viewer = document.createElement('div');
  const picture = photo ? '<img alt="" id="photo">' : '';
  const button = (id: string, extra = '') =>
    `<div><div><div role="button" id="${id}"${extra}></div></div></div>`;
  viewer.innerHTML = `
    <div id="stage">
      <div data-id="story-1" id="card">
        <div data-pagelet="StoryCard"><div><div><div><div><div id="frame">${picture}<div role="group"></div></div></div></div></div></div></div>
        <div id="shade"></div>
        <div id="header"><a href="/someone" id="avatar"><img alt=""></a><a href="/someone" id="name">Someone</a><div role="button" id="info"></div><a href="/sticker" id="sticker">Sticker</a></div>
        <div id="caption"></div>
        <div id="strip"></div>
      </div>
      <div id="row">${button('mute')}${button('pause')}${button('menu', ' aria-haspopup="menu" aria-expanded="false"')}</div>
    </div>
    <div role="button" id="previous"></div>
    <div role="button" id="next"></div>`;
  document.body.append(viewer);
  const part = (id: string) => viewer.querySelector(`#${id}`) as HTMLElement;
  let video: HTMLVideoElement | null = null;
  let media: FakeMedia | null = null;
  if (!photo) {
    ({ video, media } = fakeVideo({ duration: 20 }));
    part('frame').prepend(video);
  }
  const boxes: Record<string, [number, number, number, number]> = {
    card: [100, 0, 356, 633],
    frame: [100, 0, 356, 633],
    avatar: [112, 28, 40, 40],
    name: [164, 31, 90, 10],
    info: [294, 31, 12, 12],
    sticker: [200, 300, 80, 40],
    strip: [100, 621, 356, 12],
    mute: [356, 36, 32, 24],
    // Without `pause`, the button left of the menu button is lower, so it is not taken for it.
    pause: pause ? [388, 36, 32, 24] : [388, 80, 32, 24],
    menu: [420, 36, 32, 24],
    previous: [52, 315, 48, 48],
    next: [496, 315, 48, 48],
  };
  for (const [id, [x, y, width, height]] of Object.entries(boxes)) {
    placeAt(part(id), x, y, width, height);
  }
  placeAt(video ?? part('photo'), 100, 0, 356, 633);
  return { card: part('card'), video, media, part };
}
