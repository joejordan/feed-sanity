import type { Locate } from '../core/locator';
import type { AtomTranslator } from './atoms';
import { probe, waitForElement } from '../core/dom';
import { callSafely, Listeners } from '../core/listeners';
import { createLogger } from '../core/log';
import { onUrlChange } from '../core/navigation';
import { pageWatcher } from '../core/page-watcher';
import { pageContext } from './page';
import { findPostId } from './post-id';
import {
  FEED_POSITION,
  LOADING_POST,
  MARK,
  MARKETPLACE_POST,
  MARKETPLACE_POST_VERIFIER,
  OWN_ELEMENT,
  POPUP_CONTAINED_POST,
  POPUP_POST_CONTAINER,
  POST,
  POST_ANCESTOR,
  POST_REACTIONS,
  POST_VERIFIER,
  THEATER_COMMENTS,
} from './selectors';

const log = createLogger('posts');

/** How long after content arrives in a post `onUpdate` listeners hear of it. */
const UPDATE_DELAY_MS = 100;

/**
 * A feed slot not tracked yet, which may be waiting for its content. Made
 * only of the feed position attribute and this project's mark, so it stays
 * a plain selector.
 */
const UNTRACKED_SLOT = `[${FEED_POSITION}]:not([${MARK.post}])`;

/** A post on the page, or a Marketplace listing on Marketplace pages. */
export interface Post {
  /** The post's top element. It carries the `sfx_post` and `sfx_id` attributes. */
  readonly element: HTMLElement;
  /**
   * The element that holds the post's own content, for reading its text. It
   * is `element`, except in the comments popup, where `element` is the popup
   * and this is the post inside it.
   */
  readonly content: HTMLElement;
  /** Counts the posts found since the page last had none, starting at 1. */
  readonly number: number;
  /** Facebook's ID for the post, or null when none could be found. */
  readonly id: string | null;
  /** True when the page is about this post: its ID is in the address, or it is open in theater mode. */
  readonly permalink: boolean;
}

type PostListener = (post: Post) => void;

function addressContains(id: string): boolean {
  try {
    return new RegExp(String.raw`(?:^|\D)${id}(?:\D|$)`).test(decodeURIComponent(location.href));
  } catch {
    // The address has a malformed escape sequence.
    return false;
  }
}

/**
 * Finds the posts on the page and keeps finding them as Facebook adds and
 * removes them.
 *
 * Nothing runs until the first `onAdd` call, because working out a post's ID
 * can mean hovering its time link.
 *
 * It looks at the page at once, before Facebook's class names are known,
 * with the strategies that can run without them. It looks again each time
 * the locators change: when more class names become known, and when the
 * user's selectors change. Each ID lookup waits for the first class name
 * scan, so the ID and what features read from the post do not depend on how
 * early the post was found.
 */
export class Posts {
  readonly #atoms: Pick<AtomTranslator, 'start'>;
  readonly #locate: Locate;
  readonly #findId: typeof findPostId;
  readonly #added = new Listeners<[Post]>(log);
  readonly #removed = new Listeners<[Post]>(log);
  readonly #reset = new Listeners(log);
  readonly #updated = new Listeners<[Post]>(log);
  /** Posts that gained content since the last `onUpdate` round. */
  readonly #pendingUpdates = new Set<Post>();
  #updateTimer: ReturnType<typeof setTimeout> | undefined;
  /** Every marked element and its post number, including posts whose ID is still being looked up. */
  readonly #numbers = new Map<Element, number>();
  /** The posts listeners have been told about, in the order their ID lookups finished. */
  readonly #announced = new Map<Element, Post>();
  #started = false;
  #stopWatching: (() => void)[] = [];
  #nextNumber = 1;
  #resetPending = true;
  #hasReset = false;
  #marketplace = false;
  /** Settles once the first class name scan has finished, whether or not it worked. */
  #scanned: Promise<void> = Promise.resolve();

  constructor(
    atoms: Pick<AtomTranslator, 'start'>,
    locate: Locate,
    findId: typeof findPostId = findPostId,
  ) {
    this.#atoms = atoms;
    this.#locate = locate;
    this.#findId = findId;
  }

  /**
   * Calls `listener` with every post already on the page and each one found
   * later, once its ID lookup has finished. Returns a function that stops it.
   */
  onAdd(listener: PostListener): () => void {
    for (const post of this.#announced.values()) {
      callSafely(log, listener, post);
    }
    this.#start();
    return this.#added.add(listener);
  }

  /** Calls `listener` when a post it was told about leaves the page. */
  onRemove(listener: PostListener): () => void {
    return this.#removed.add(listener);
  }

  /**
   * Calls `listener` just before the first post of a page is tracked: on the
   * first page, and again each time a navigation has left none of the old
   * posts behind. Post numbers start again at 1. A listener added after the
   * first such moment is called at once.
   */
  onReset(listener: () => void): () => void {
    if (this.#hasReset) {
      callSafely(log, listener);
    }
    return this.#reset.add(listener);
  }

  /**
   * Calls `listener` when Facebook adds content inside a post it was told
   * about: more text, new comments, or the whole post again after Facebook
   * emptied it while it was scrolled out of view. A refill discards anything
   * a feature had put inside. Additions close together are reported once, so
   * a listener must be safe to run again on the same post.
   */
  onUpdate(listener: PostListener): () => void {
    return this.#updated.add(listener);
  }

  /** Stops looking for posts. The marks stay on the posts already found. */
  stop(): void {
    this.#started = false;
    clearTimeout(this.#updateTimer);
    this.#updateTimer = undefined;
    this.#pendingUpdates.clear();
    for (const stop of this.#stopWatching.splice(0)) {
      stop();
    }
  }

  #start(): void {
    if (this.#started) {
      return;
    }
    this.#started = true;
    this.#watch().catch((error: unknown) => {
      log.error('failed to watch for posts', error);
    });
  }

  async #watch(): Promise<void> {
    await waitForElement('body');
    // After a stop and a second start during the wait, the earlier call is already watching.
    if (!this.#started || this.#stopWatching.length > 0) {
      return;
    }
    // Not awaited. Until a class is known, the strategies that need it are
    // skipped, and the change that comes with it brings a rescan. A failed
    // scan is logged by the page, and the posts are announced all the same.
    this.#scanned = this.#atoms.start().catch(() => undefined);
    this.#stopWatching = [
      // The watcher reports a new address before the content that came with
      // it, so a new page is known about before its content is scanned.
      onUrlChange(() => this.#navigated()),
      // Shared by every locator: new class names, or new selectors from the user.
      this.#locate(POST).onChange(() => this.#refresh()),
      pageWatcher.watchTree({
        added: (element) => this.#inserted(element),
        removed: (element) => this.#left(element),
      }),
    ];
    this.#refresh();
  }

  /** Facebook changes pages without reloading. The new page may be of another kind. */
  #navigated(): void {
    this.#resetPending = true;
    this.#refresh();
  }

  /**
   * Works out what posts look like on the current page, then scans the whole
   * page. Posts found before are marked, so they are not counted again.
   */
  #refresh(): void {
    this.#marketplace = pageContext().type === 'marketplace';
    this.#scan(document.body);
  }

  #inserted(element: Element): void {
    // Facebook empties feed slots that scroll out of view and fills them
    // again later, so content can arrive inside a slot not tracked yet.
    const slot = element.parentElement?.closest(UNTRACKED_SLOT);
    if (slot) {
      this.#scan(slot);
    } else if (!this.#locate(POST_REACTIONS).closest(element)) {
      this.#scan(element);
    }
    this.#noteUpdate(element);
  }

  /** Queues an `onUpdate` call for the announced post `element` was added to, if any. */
  #noteUpdate(element: Element): void {
    if (this.#updated.size === 0) {
      return;
    }
    const top = element.parentElement?.closest(`[${MARK.post}]`);
    const post = top && this.#announced.get(top);
    // Most additions are outside any post, so the post is looked for first.
    if (!post || element.closest(OWN_ELEMENT)) {
      return;
    }
    this.#pendingUpdates.add(post);
    // Not restarted on each addition, or a post that keeps receiving
    // comments would hold back the report for every other post.
    this.#updateTimer ??= setTimeout(() => {
      this.#updateTimer = undefined;
      const posts = [...this.#pendingUpdates];
      this.#pendingUpdates.clear();
      for (const pending of posts) {
        if (this.#announced.get(pending.element) === pending) {
          this.#updated.emit(pending);
        }
      }
    }, UPDATE_DELAY_MS);
  }

  #scan(container: Element): void {
    const candidates = this.#locate(this.#marketplace ? MARKETPLACE_POST : POST);
    for (const candidate of candidates.probe(container)) {
      if (this.#isPost(candidate)) {
        this.#track(this.#topOf(candidate), candidate);
      }
    }
  }

  #isPost(element: Element): element is HTMLElement {
    if (!(element instanceof HTMLElement) || element.hasAttribute(MARK.post)) {
      return false;
    }
    if (element.getAttribute(FEED_POSITION)) {
      // An empty slot is a post not loaded yet, or one scrolled far out of view.
      return !!element.textContent?.trim();
    }
    // Inside another post, it is a comment or an embedded post.
    const parent = element.parentElement;
    if (
      parent &&
      (parent.closest(`[${MARK.post}]`) || this.#locate(POST_ANCESTOR).closest(parent))
    ) {
      return false;
    }
    if (this.#locate(LOADING_POST).first(element) && !element.textContent) {
      return false;
    }
    const verifier = this.#marketplace ? MARKETPLACE_POST_VERIFIER : POST_VERIFIER;
    return this.#locate(verifier).first(element) !== null;
  }

  /** A post in the comments popup is tracked by the popup's container. */
  #topOf(post: HTMLElement): HTMLElement {
    if (!this.#locate(POPUP_CONTAINED_POST).matches(post)) {
      return post;
    }
    const popup =
      post.parentElement && this.#locate(POPUP_POST_CONTAINER).closest(post.parentElement);
    if (!(popup instanceof HTMLElement)) {
      return post;
    }
    popup.classList.add(MARK.popupPost);
    return popup;
  }

  #track(element: HTMLElement, content: HTMLElement): void {
    if (this.#numbers.has(element)) {
      return;
    }
    this.#resetIfEmptied();
    const number = this.#nextNumber++;
    element.id ||= `${MARK.postElementId}${number}`;
    element.setAttribute(MARK.post, String(number));
    this.#numbers.set(element, number);
    this.#identify(element, number, content).catch((error: unknown) => {
      log.error('failed to identify a post', error);
    });
  }

  /** On a new page, starts numbering again if none of the old page's posts are left. */
  #resetIfEmptied(): void {
    if (!this.#resetPending) {
      return;
    }
    this.#resetPending = false;
    if (document.querySelector(`[${MARK.post}]`)) {
      return;
    }
    this.#nextNumber = 1;
    this.#numbers.clear();
    this.#announced.clear();
    this.#hasReset = true;
    this.#reset.emit();
  }

  async #identify(element: HTMLElement, number: number, content: HTMLElement): Promise<void> {
    // Some strategies for the ID and for the parts features read need class
    // names. The first scan is usually over by the time a post is found.
    const here = (): boolean => this.#numbers.get(element) === number;
    await this.#scanned;
    if (!here()) {
      return;
    }
    const id = await this.#findId(element, this.#locate);
    if (!here()) {
      // The post left the page while its ID was being looked up.
      return;
    }
    element.setAttribute(MARK.postId, id ?? MARK.noPostId);
    const permalink =
      (id !== null && addressContains(id)) || this.#locate(THEATER_COMMENTS).matches(element);
    const post: Post = { element, content, number, id, permalink };
    this.#announced.set(element, post);
    this.#added.emit(post);
  }

  #left(container: Element): void {
    for (const element of probe(container, `[${MARK.post}]:not(.${MARK.removing})`)) {
      // A move to another place in the page is reported as a removal too.
      if (element.isConnected) {
        continue;
      }
      element.classList.add(MARK.removing);
      this.#numbers.delete(element);
      const post = this.#announced.get(element);
      if (post) {
        this.#announced.delete(element);
        this.#removed.emit(post);
      }
    }
  }
}
