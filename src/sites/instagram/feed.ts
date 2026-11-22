import type { FeedCapability, FeedItem } from '../../capabilities';
import type { PageBridge } from '../../core/bridge';
import type { DomEnvironment } from '../../core/dom-env';
import type { Locate } from '../../core/locator';
import type { PostStats } from '../../facebook/posts';
import { callSafely, Listeners } from '../../core/listeners';
import { createLogger } from '../../core/log';
import { isObject } from '../../engines/react';
import { IG_FEED_POST } from './selectors';

const log = createLogger('ig-feed');

export interface InstagramPost extends FeedItem {
  readonly isAd: boolean;
  readonly isSuggested: boolean;
  /** Lazily reads and caches the post's lowercased text only when keyword filtering needs it. */
  readonly readLowerText: () => string;
}

const SHORTCODE_LINK = /\/(?:p|reel|reels)\/([A-Za-z0-9_-]{4,})/;
const SHORTCODE_SELECTOR = 'a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"]';

function extractShortcode(article: Element): string | null {
  const link = article.querySelector(SHORTCODE_SELECTOR);
  const href = link?.getAttribute('href');
  if (!href) {
    return null;
  }
  return SHORTCODE_LINK.exec(href)?.[1] ?? null;
}

function readDomSignals(article: HTMLElement): {
  id: string | null;
  isAd: boolean;
  isSuggested: boolean;
} {
  let isAd = false;
  let isSuggested = false;
  const doc = article.ownerDocument ?? document;
  const walker = doc.createTreeWalker(article, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const raw = (node.nodeValue ?? '').trim();
    if (!raw || raw.length > 32) {
      continue;
    }
    if (/^Sponsored$/i.test(raw)) {
      isAd = true;
    } else if (/^Suggested for you$/i.test(raw)) {
      isSuggested = true;
    }
    if (isAd && isSuggested) {
      break;
    }
  }
  return {
    id: extractShortcode(article),
    isAd,
    isSuggested,
  };
}

/**
 * Tracks Instagram `<article>` feed posts via `DomEnvironment` and enriches
 * each post with React fiber + Network Tap ad/suggested metadata over the
 * `PageBridge`. Implements `FeedCapability`.
 */
export class InstagramFeed implements FeedCapability {
  readonly #env: DomEnvironment;
  readonly #locate: Locate;
  readonly #bridge: PageBridge;
  readonly #onBridgeActive: (() => void) | undefined;

  readonly #tracked = new Map<HTMLElement, InstagramPost>();
  readonly #identifying = new Map<HTMLElement, AbortController>();
  readonly #trackListeners = new Listeners<[InstagramPost]>(log);
  readonly #untrackListeners = new Listeners<[InstagramPost]>(log);
  readonly #addListeners = new Listeners<[InstagramPost]>(log);
  readonly #updateListeners = new Listeners<[InstagramPost]>(log);
  readonly #removeListeners = new Listeners<[InstagramPost]>(log);
  readonly #resetListeners = new Listeners<[]>(log);

  #stop: (() => void) | undefined;
  #stopUrl: (() => void) | undefined;
  #started = false;

  constructor(
    env: DomEnvironment,
    locate: Locate,
    bridge: PageBridge,
    onBridgeActive?: () => void,
  ) {
    this.#env = env;
    this.#locate = locate;
    this.#bridge = bridge;
    this.#onBridgeActive = onBridgeActive;
  }

  onTrack(listener: (item: InstagramPost) => void): () => void {
    for (const post of this.#tracked.values()) {
      callSafely(log, listener, post);
    }
    const remove = this.#trackListeners.add(listener);
    this.#ensureStarted();
    return () => {
      remove();
      this.#maybeStop();
    };
  }

  onUntrack(listener: (item: InstagramPost) => void): () => void {
    const remove = this.#untrackListeners.add(listener);
    return () => {
      remove();
      this.#maybeStop();
    };
  }

  onAdd(listener: (item: InstagramPost) => void): () => void {
    for (const post of this.#tracked.values()) {
      callSafely(log, listener, post);
    }
    const remove = this.#addListeners.add(listener);
    this.#ensureStarted();
    return () => {
      remove();
      this.#maybeStop();
    };
  }

  onUpdate(listener: (item: InstagramPost) => void): () => void {
    const remove = this.#updateListeners.add(listener);
    return () => {
      remove();
      this.#maybeStop();
    };
  }

  onRemove(listener: (item: InstagramPost) => void): () => void {
    const remove = this.#removeListeners.add(listener);
    return () => {
      remove();
      this.#maybeStop();
    };
  }

  onReset(listener: () => void): () => void {
    const remove = this.#resetListeners.add(listener);
    return () => {
      remove();
      this.#maybeStop();
    };
  }

  /**
   * Re-checks tracked posts that are not yet marked ad/suggested when the
   * MAIN-world Network Tap indexes new GraphQL/REST metadata after DOM render.
   */
  recheck(): void {
    if (!this.#started || this.#bridge.status().state === 'unavailable') {
      return;
    }
    for (const [element, post] of this.#tracked) {
      if (!post.isAd && !post.isSuggested && !this.#identifying.has(element)) {
        void this.#enrich(element, post);
      }
    }
  }

  stats(): PostStats {
    let withId = 0;
    for (const post of this.#tracked.values()) {
      if (post.id !== null) {
        withId++;
      }
    }
    const identifying = this.#identifying.size;
    return {
      started: this.#started,
      tracked: this.#tracked.size,
      withId,
      withoutId: Math.max(0, this.#tracked.size - withId - identifying),
      identifying,
      unrecognised: 0,
    };
  }

  #ensureStarted(): void {
    if (this.#stop) {
      return;
    }
    this.#started = true;
    this.#stop = this.#env.watcher.watch(this.#locate(IG_FEED_POST), {
      added: (el) => {
        if (el instanceof HTMLElement) {
          this.#enter(el);
        }
      },
      removed: (el) => {
        if (el instanceof HTMLElement) {
          this.#leave(el);
        }
      },
    });
    this.#stopUrl = this.#env.onUrlChange(() => {
      this.#resetListeners.emit();
    });
    this.#maybeStop();
  }

  #maybeStop(): void {
    const activeCount =
      this.#trackListeners.size +
      this.#untrackListeners.size +
      this.#addListeners.size +
      this.#updateListeners.size +
      this.#removeListeners.size +
      this.#resetListeners.size;
    if (activeCount > 0) {
      return;
    }
    this.#started = false;
    this.#stop?.();
    this.#stop = undefined;
    this.#stopUrl?.();
    this.#stopUrl = undefined;
    for (const controller of this.#identifying.values()) {
      controller.abort();
    }
    this.#identifying.clear();
    this.#tracked.clear();
  }

  #enter(element: HTMLElement): void {
    if (this.#tracked.has(element)) {
      return;
    }
    const dom = readDomSignals(element);
    let cachedLowerText: string | undefined;
    const readLowerText = (): string => {
      cachedLowerText ??= (element.textContent ?? '').toLowerCase();
      return cachedLowerText;
    };
    const post: InstagramPost = {
      element,
      content: element,
      id: dom.id,
      permalink: false,
      isAd: dom.isAd,
      isSuggested: dom.isSuggested,
      readLowerText,
    };
    this.#tracked.set(element, post);
    this.#trackListeners.emit(post);
    this.#addListeners.emit(post);
    void this.#enrich(element, post);
  }

  async #enrich(element: HTMLElement, initial: InstagramPost): Promise<void> {
    if (this.#bridge.status().state === 'unavailable') {
      return;
    }
    this.#onBridgeActive?.();
    const controller = new AbortController();
    this.#identifying.set(element, controller);
    try {
      const answer = await this.#bridge.ask(element, 'ig-post-meta', controller.signal);
      if (controller.signal.aborted || !this.#tracked.has(element) || !isObject(answer)) {
        return;
      }
      const nextId = typeof answer.id === 'string' && answer.id.length > 0 ? answer.id : initial.id;
      const nextAd = initial.isAd || answer.isAd === true;
      const nextSuggested = initial.isSuggested || answer.isSuggested === true;
      if (
        nextId !== initial.id ||
        nextAd !== initial.isAd ||
        nextSuggested !== initial.isSuggested
      ) {
        const updated: InstagramPost = {
          ...initial,
          id: nextId,
          isAd: nextAd,
          isSuggested: nextSuggested,
        };
        this.#tracked.set(element, updated);
        this.#updateListeners.emit(updated);
      }
    } catch {
      // Bridge unavailable, aborted, or element detached; DOM signals remain authoritative.
    } finally {
      if (this.#identifying.get(element) === controller) {
        this.#identifying.delete(element);
      }
    }
  }

  #leave(element: HTMLElement): void {
    const post = this.#tracked.get(element);
    if (!post) {
      return;
    }
    this.#tracked.delete(element);
    const controller = this.#identifying.get(element);
    if (controller) {
      controller.abort();
      this.#identifying.delete(element);
    }
    this.#untrackListeners.emit(post);
    this.#removeListeners.emit(post);
  }
}
