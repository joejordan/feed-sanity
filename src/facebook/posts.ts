import type { Locate } from '../core/locator';
import { callSafely, Listeners } from '../core/listeners';
import { createLogger } from '../core/log';
import { onUrlChange } from '../core/navigation';
import { pageWatcher } from '../core/page-watcher';
import { pageContext } from './page';
import { addressNames, findPostId } from './post-id';
import { hasPostElement, hasPostText, isExcluded, notOwnSelector } from './post-text';
import {
  FEED_SLOT,
  MARK,
  NO_POST_ID,
  POST_ARTICLE,
  POST_FEEDBACK,
  POST_HEADER_LINK,
  POST_POPUP,
  POST_TIME_LINK,
} from './selectors';

const log = createLogger('posts');

/** How long content added inside a post is gathered before `onUpdate` reports it. */
const UPDATE_DELAY_MS = 25;

/**
 * How long after a post is tracked its ID is looked for. Facebook fills a
 * post in a few steps, and the time link can come after the text.
 */
const IDENTIFY_DELAY_MS = 50;

/** One post on the page. */
export interface Post {
  /** The tracked top element. It carries the marks, and features key their state on it. */
  readonly element: HTMLElement;
  /** Where the post's text and parts are read: `element`, except in the comments popup. */
  readonly content: HTMLElement;
  /** The post's number on this page, from 1, in the order posts were tracked. */
  readonly number: number;
  /** The post's Facebook ID, or null when it is not known. */
  readonly id: string | null;
  /** True when the page is about this post. */
  readonly permalink: boolean;
}

/** How post detection is doing, for the diagnostics. */
export interface PostStats {
  readonly started: boolean;
  readonly tracked: number;
  readonly withId: number;
  /** Tracked posts whose ID lookup finished without one. */
  readonly withoutId: number;
  /**
   * Tracked posts whose ID lookup is still running or waiting to run, including
   * feed slots emptied before it ran, which are identified once refilled.
   */
  readonly identifying: number;
  /** Feed slots with text that are not tracked: a sign that detection misses posts. */
  readonly unrecognised: number;
}

/** Where a post would be: its element, where its content is, and what kind it is. */
interface Place {
  readonly element: HTMLElement;
  readonly content: HTMLElement;
  /** In a news-feed slot. */
  readonly slot: boolean;
  /** In the comments popup. */
  readonly popup: boolean;
}

interface Entry extends Place {
  post: Post;
  /** True once the ID lookup has finished and `onAdd` has been told. */
  announced: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
}

type FindId = (post: Element, locate: Locate) => Promise<string | null>;

/**
 * Finds the posts on the page and follows them while they stay. Nothing
 * runs until something subscribes with `onTrack` or `onAdd`, and it stops
 * when neither has a listener left.
 *
 * A post is a news-feed slot holding text, an article that is not inside
 * another post, or the comments popup with the post in it. Each needs a
 * link in its header or on its time, which loading placeholders lack.
 *
 * A post is tracked as soon as it is found, in the same mutation callback
 * and so before the browser paints: it gets `MARK.post` and `onTrack` is
 * told, with no ID yet. Its ID is looked for a moment later; then it gets
 * `MARK.postId` and `onAdd` is told.
 */
export class Posts {
  readonly #locate: Locate;
  readonly #findId: FindId;
  readonly #tracked = new Listeners<[Post]>(log);
  readonly #untracked = new Listeners<[Post]>(log);
  readonly #added = new Listeners<[Post]>(log);
  readonly #removed = new Listeners<[Post]>(log);
  readonly #updated = new Listeners<[Post]>(log);
  readonly #reset = new Listeners(log);
  readonly #entries = new Map<HTMLElement, Entry>();
  #started = false;
  /** Bumped on each start and stop, so work begun before a stop does nothing after it. */
  #generation = 0;
  #stops: (() => void)[] = [];
  #number = 0;
  #hasReset = false;
  /** True after an in-page move, until numbering has started again. */
  #navigated = false;
  #sweepQueued = false;
  readonly #pendingUpdates = new Set<Entry>();
  #updateTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(locate: Locate, findId: FindId = findPostId) {
    this.#locate = locate;
    this.#findId = findId;
  }

  /** Calls `listener` with each post as it is found, before its ID is known. Posts already found are told at once. */
  onTrack(listener: (post: Post) => void): () => void {
    return this.#subscribe(this.#tracked, listener, () => this.#posts());
  }

  /** Calls `listener` with each tracked post that leaves the page. */
  onUntrack(listener: (post: Post) => void): () => void {
    return this.#untracked.add(listener);
  }

  /** Calls `listener` with each post once its ID lookup has finished. Posts already announced are told at once. */
  onAdd(listener: (post: Post) => void): () => void {
    return this.#subscribe(this.#added, listener, () =>
      this.#posts().filter((post) => this.#entries.get(post.element)?.announced),
    );
  }

  /** Calls `listener` with each announced post that leaves the page. */
  onRemove(listener: (post: Post) => void): () => void {
    return this.#removed.add(listener);
  }

  /** Calls `listener`, at most once per post every 25 ms or so, when content was added inside an announced post. */
  onUpdate(listener: (post: Post) => void): () => void {
    return this.#updated.add(listener);
  }

  /**
   * Calls `listener` when numbering starts again: after an in-page move,
   * once no post from before it is left. A listener that arrives after a
   * reset is called at once.
   */
  onReset(listener: () => void): () => void {
    const remove = this.#reset.add(listener);
    if (this.#hasReset) {
      callSafely(log, listener);
    }
    return remove;
  }

  stats(): PostStats {
    let withId = 0;
    let identifying = 0;
    for (const entry of this.#entries.values()) {
      if (!entry.announced) {
        identifying++;
      } else if (entry.post.id !== null) {
        withId++;
      }
    }
    const tracked = this.#entries.size;
    return {
      started: this.#started,
      tracked,
      withId,
      withoutId: tracked - withId - identifying,
      identifying,
      unrecognised: this.#started ? this.#unrecognised() : 0,
    };
  }

  /** Stops looking for posts and takes this project's marks off them. Listeners stay. */
  stop(): void {
    if (!this.#started) {
      return;
    }
    this.#started = false;
    this.#generation++;
    for (const stop of this.#stops.splice(0)) {
      stop();
    }
    for (const entry of this.#entries.values()) {
      clearTimeout(entry.timer);
      unmark(entry.element);
    }
    this.#entries.clear();
    this.#pendingUpdates.clear();
    clearTimeout(this.#updateTimer);
    this.#updateTimer = undefined;
    this.#number = 0;
    this.#navigated = false;
    // A fresh start numbers from 1 with nothing to reset from.
    this.#hasReset = false;
  }

  /** Stops, and forgets every listener. */
  dispose(): void {
    this.stop();
    for (const listeners of [
      this.#tracked,
      this.#untracked,
      this.#added,
      this.#removed,
      this.#updated,
      this.#reset,
    ]) {
      listeners.clear();
    }
  }

  #posts(): Post[] {
    return [...this.#entries.values()].map((entry) => entry.post);
  }

  #subscribe(
    listeners: Listeners<[Post]>,
    listener: (post: Post) => void,
    present: () => Post[],
  ): () => void {
    const started = this.#started;
    const remove = listeners.add(listener);
    if (started) {
      for (const post of present()) {
        callSafely(log, listener, post);
      }
    } else {
      this.#start();
    }
    let removed = false;
    return () => {
      if (removed) {
        return;
      }
      removed = true;
      remove();
      if (this.#tracked.size === 0 && this.#added.size === 0) {
        this.stop();
      }
    };
  }

  #start(): void {
    this.#started = true;
    const generation = ++this.#generation;
    const begin = (body: Element): void => {
      if (generation !== this.#generation) {
        return;
      }
      this.#stops.push(
        pageWatcher.watchTree({
          added: (element) => this.#onAdded(element),
          removed: () => this.#queueSweep(),
        }),
        onUrlChange(() => {
          this.#navigated = true;
          this.#scan(document.body);
        }),
        // Every locator of one page shares its change listeners, so one is enough.
        this.#locate(FEED_SLOT).onChange(() => this.#scan(document.body)),
      );
      this.#scan(body);
    };
    if (document.body) {
      begin(document.body);
    } else {
      pageWatcher.waitForElement('body').then(begin, (error: unknown) => {
        log.error('could not wait for the page body', error);
      });
    }
  }

  /** Looks for posts in and under `root`. */
  #scan(root: Element | null): void {
    if (!root?.isConnected) {
      return;
    }
    const seen = new Set<Element>();
    for (const candidate of [
      ...this.#locate(FEED_SLOT).probe(root),
      ...this.#locate(POST_ARTICLE).probe(root),
    ]) {
      const place = this.#placeOf(candidate);
      if (place && !seen.has(place.element)) {
        seen.add(place.element);
        this.#consider(place);
      }
    }
  }

  #onAdded(node: Element): void {
    const owner = node.closest(`[${MARK.post}]`);
    if (owner) {
      // Inside a post: an update to it, unless the post was only moved. A
      // post another copy of this project marked is left to that copy.
      const entry = owner instanceof HTMLElement ? this.#entries.get(owner) : undefined;
      if (entry && owner !== node) {
        this.#noteUpdate(entry, node);
      }
      return;
    }
    // Content arriving in a slot or article that is not tracked yet: check it again.
    const around = node.parentElement && this.#placeOf(node.parentElement);
    if (around) {
      this.#consider(around);
      return;
    }
    this.#scan(node);
  }

  /**
   * The post `element` would be part of, by where it is: the feed slot
   * around it, or else the outermost article around it. An article in the
   * comments popup makes the popup the post, unless it is a comment.
   */
  #placeOf(element: Element): Place | null {
    const slot = this.#locate(FEED_SLOT).closest(element);
    if (slot) {
      return slot instanceof HTMLElement
        ? { element: slot, content: slot, slot: true, popup: false }
        : null;
    }
    const articles = this.#locate(POST_ARTICLE);
    let article = articles.closest(element);
    if (!article) {
      return null;
    }
    const popup = this.#locate(POST_POPUP).closest(article);
    for (
      let outer = article.parentElement && articles.closest(article.parentElement);
      outer && (!popup || popup.contains(outer));
      outer = outer.parentElement && articles.closest(outer.parentElement)
    ) {
      article = outer;
    }
    if (!(article instanceof HTMLElement)) {
      return null;
    }
    if (popup instanceof HTMLElement) {
      // In the popup the post is an unlabelled article, and each comment a labelled one.
      return this.#locate(POST_FEEDBACK).matches(article)
        ? null
        : { element: popup, content: article, slot: false, popup: true };
    }
    return { element: article, content: article, slot: false, popup: false };
  }

  /** Tracks the post at `place` if it is one and is not tracked yet. */
  #consider(place: Place): void {
    const { element, content } = place;
    if (this.#entries.has(element) || element.hasAttribute(MARK.post) || !this.#isPost(content)) {
      return;
    }
    if (this.#navigated) {
      const generation = this.#generation;
      this.#sweep();
      // A listener told of a post leaving may have stopped detection.
      if (generation !== this.#generation) {
        return;
      }
      if (this.#entries.size === 0) {
        this.#navigated = false;
        this.#number = 0;
        this.#hasReset = true;
        this.#reset.emit();
      }
    }
    const number = ++this.#number;
    element.setAttribute(MARK.post, String(number));
    if (place.popup) {
      element.setAttribute(MARK.popupPost, '');
    }
    const entry: Entry = {
      ...place,
      post: { element, content, number, id: null, permalink: false },
      announced: false,
      timer: undefined,
    };
    this.#entries.set(element, entry);
    this.#tracked.emit(entry.post);
    // A listener may have stopped detection or the post may have gone.
    if (this.#entries.get(element) === entry) {
      this.#scheduleIdentify(entry);
    }
  }

  /** Looks for the post's ID shortly, unless a lookup is already waiting. */
  #scheduleIdentify(entry: Entry): void {
    entry.timer ??= setTimeout(() => void this.#identify(entry), IDENTIFY_DELAY_MS);
  }

  /** True when `content` holds a real post: a link in its header or on its time, and text of its own. */
  #isPost(content: HTMLElement): boolean {
    const locate = this.#locate;
    return (
      (hasPostElement(content, locate(POST_HEADER_LINK), locate) ||
        hasPostElement(content, locate(POST_TIME_LINK), locate)) &&
      hasPostText(content, locate)
    );
  }

  async #identify(entry: Entry): Promise<void> {
    entry.timer = undefined;
    const generation = this.#generation;
    let id: string | null = null;
    try {
      id = await this.#findId(entry.content, this.#locate);
    } catch (error) {
      log.error('could not look for a post ID', error);
    }
    const { element } = entry;
    if (
      generation !== this.#generation ||
      this.#entries.get(element) !== entry ||
      !element.isConnected ||
      // A refill can schedule a second lookup while this one waits on `findId`.
      entry.announced
    ) {
      return;
    }
    // Emptied before its ID was looked for: `#noteUpdate` looks again once it is refilled. A
    // refill during `findId` has already scheduled that lookup, which reads the new content.
    if (id === null && (entry.timer !== undefined || !this.#isPost(entry.content))) {
      return;
    }
    // On a single post's page, every post outside the feed and the popup without a time link gets
    // the page's ID from `findPostId`. Only the first to be identified keeps it.
    if (id !== null && isStandalone(entry) && addressNames(id) && this.#heldElsewhere(entry, id)) {
      id = null;
    }
    element.setAttribute(MARK.postId, id ?? NO_POST_ID);
    entry.post = { ...entry.post, id, permalink: this.#isPagePost(entry, id) };
    entry.announced = true;
    this.#added.emit(entry.post);
  }

  /**
   * True when the page is about the post: the address names its ID, or the
   * page is a single post's and this is the first post outside the feed and
   * the popup found on it.
   */
  #isPagePost(entry: Entry, id: string | null): boolean {
    if (id !== null && addressNames(id)) {
      return true;
    }
    if (!isStandalone(entry) || !pageContext().singlePost) {
      return false;
    }
    for (const other of this.#entries.values()) {
      if (other !== entry && other.post.permalink && isStandalone(other)) {
        return false;
      }
    }
    return true;
  }

  /** True when a tracked post outside the feed and the popup, other than `entry`, has the ID `id`. */
  #heldElsewhere(entry: Entry, id: string): boolean {
    for (const other of this.#entries.values()) {
      if (other !== entry && isStandalone(other) && other.post.id === id) {
        return true;
      }
    }
    return false;
  }

  #noteUpdate(entry: Entry, node: Element): void {
    // A lookup is already waiting, and it checks the post again itself.
    if (!entry.announced && entry.timer !== undefined) {
      return;
    }
    const { content } = entry;
    // In the popup, only what arrives in the post itself counts, not the comments beside it.
    const inPost = content.contains(node) || node.contains(content);
    if (!inPost || isExcluded(node, content, notOwnSelector(this.#locate))) {
      return;
    }
    if (!entry.announced) {
      // A post emptied before it was identified is identified once content comes back.
      this.#scheduleIdentify(entry);
      return;
    }
    this.#pendingUpdates.add(entry);
    this.#updateTimer ??= setTimeout(() => this.#flushUpdates(), UPDATE_DELAY_MS);
  }

  #flushUpdates(): void {
    this.#updateTimer = undefined;
    const entries = [...this.#pendingUpdates];
    this.#pendingUpdates.clear();
    for (const entry of entries) {
      if (this.#entries.get(entry.element) === entry && entry.element.isConnected) {
        this.#updated.emit(entry.post);
      }
    }
  }

  /** Checks for posts that left the page once the current batch of changes is handed out. */
  #queueSweep(): void {
    if (this.#entries.size === 0 || this.#sweepQueued) {
      return;
    }
    this.#sweepQueued = true;
    queueMicrotask(() => {
      this.#sweepQueued = false;
      this.#sweep();
    });
  }

  /**
   * Stops tracking each post whose element left the page; one moved
   * elsewhere in it is still there. A popup that lost its post is looked
   * at again, since it may hold another.
   */
  #sweep(): void {
    const generation = this.#generation;
    for (const entry of [...this.#entries.values()]) {
      if (!entry.element.isConnected || !entry.content.isConnected) {
        this.#untrack(entry);
        // A listener told of the post leaving may have stopped detection.
        if (generation !== this.#generation) {
          return;
        }
        if (entry.element.isConnected) {
          this.#scan(entry.element);
        }
      }
    }
  }

  #untrack(entry: Entry): void {
    this.#entries.delete(entry.element);
    this.#pendingUpdates.delete(entry);
    clearTimeout(entry.timer);
    unmark(entry.element);
    this.#untracked.emit(entry.post);
    if (entry.announced) {
      this.#removed.emit(entry.post);
    }
  }

  #unrecognised(): number {
    // Read through the joined selector, so the diagnostics do not add to the locator's own counts.
    const selector = this.#locate(FEED_SLOT).selector();
    if (selector === null) {
      return 0;
    }
    let count = 0;
    for (const slot of document.querySelectorAll<HTMLElement>(selector)) {
      if (
        !this.#entries.has(slot) &&
        !slot.hasAttribute(MARK.post) &&
        /\S/.test(slot.textContent ?? '')
      ) {
        count++;
      }
    }
    return count;
  }
}

/** True for a post outside the news feed and the comments popup. */
const isStandalone = ({ slot, popup }: Place): boolean => !slot && !popup;

function unmark(element: Element): void {
  element.removeAttribute(MARK.post);
  element.removeAttribute(MARK.postId);
  element.removeAttribute(MARK.popupPost);
}
