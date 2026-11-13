import type { AtomTranslator } from './atoms';
import { probe, waitForElement, watchTree } from '../core/dom';
import { callSafely, Listeners } from '../core/listeners';
import { createLogger } from '../core/log';
import { onUrlChange } from '../core/navigation';
import { pageContext } from './page';
import { findPostId } from './post-id';
import {
  FEED_POSITION,
  LOADING_POST,
  MARK,
  MARKETPLACE_POST,
  MARKETPLACE_POST_VERIFIER,
  POPUP_CONTAINED_POST,
  POPUP_POST_CONTAINER,
  POST,
  POST_ANCESTOR,
  POST_REACTIONS,
  POST_VERIFIER,
  THEATER_COMMENTS,
} from './selectors';

const log = createLogger('posts');

/** A post on the page, or a Marketplace listing on Marketplace pages. */
export interface Post {
  /** The post's top element. It carries the `sfx_post` and `sfx_id` attributes. */
  readonly element: HTMLElement;
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
 */
export class Posts {
  readonly #atoms: AtomTranslator;
  readonly #findId: typeof findPostId;
  readonly #added = new Listeners<[Post]>(log);
  readonly #removed = new Listeners<[Post]>(log);
  readonly #reset = new Listeners(log);
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
  #postSelector = POST;

  constructor(atoms: AtomTranslator, findId: typeof findPostId = findPostId) {
    this.#atoms = atoms;
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

  /** Stops looking for posts. The marks stay on the posts already found. */
  stop(): void {
    this.#started = false;
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
    const body = await waitForElement('body');
    // The first page scan needs the class names. Without them a selector such
    // as `:not(.S2F_pos_rel)` excludes nothing and comments pass for posts.
    await this.#atoms.start();
    // After a stop and a second start during the wait, the earlier call is already watching.
    if (!this.#started || this.#stopWatching.length > 0) {
      return;
    }
    this.#stopWatching = [
      // Before `watchTree`, so a new page is known about before its content is scanned.
      onUrlChange(() => this.#navigated()),
      this.#atoms.onChange(() => this.#refresh()),
      watchTree(body, {
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

  /** Works out the post selector for the current page and class names, then scans the whole page. */
  #refresh(): void {
    this.#marketplace = pageContext().type === 'marketplace';
    this.#postSelector = this.#atoms.translate(this.#marketplace ? MARKETPLACE_POST : POST);
    this.#scan(document.body);
  }

  #inserted(element: Element): void {
    if (!element.closest(POST_REACTIONS)) {
      this.#scan(element);
    }
  }

  #scan(container: Element): void {
    for (const candidate of probe(container, this.#postSelector)) {
      if (this.#isPost(candidate)) {
        this.#track(this.#topOf(candidate));
      }
    }
  }

  #isPost(element: Element): element is HTMLElement {
    if (!(element instanceof HTMLElement) || element.hasAttribute(MARK.post)) {
      return false;
    }
    if (element.getAttribute(FEED_POSITION)) {
      return true;
    }
    // Inside another post, it is a comment or an embedded post.
    if (element.parentElement?.closest(POST_ANCESTOR)) {
      return false;
    }
    if (element.querySelector(LOADING_POST) && !element.textContent) {
      return false;
    }
    const verifier = this.#marketplace ? MARKETPLACE_POST_VERIFIER : POST_VERIFIER;
    return element.querySelector(verifier) !== null;
  }

  /** A post in the comments popup is tracked by the popup's container. */
  #topOf(post: HTMLElement): HTMLElement {
    if (!post.matches(this.#atoms.translate(POPUP_CONTAINED_POST))) {
      return post;
    }
    const popup = post.parentElement?.closest(POPUP_POST_CONTAINER);
    if (!(popup instanceof HTMLElement)) {
      return post;
    }
    popup.classList.add(MARK.popupPost);
    return popup;
  }

  #track(element: HTMLElement): void {
    if (this.#numbers.has(element)) {
      return;
    }
    this.#resetIfEmptied();
    const number = this.#nextNumber++;
    element.id ||= `${MARK.postElementId}${number}`;
    element.setAttribute(MARK.post, String(number));
    this.#numbers.set(element, number);
    this.#identify(element, number).catch((error: unknown) => {
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

  async #identify(element: HTMLElement, number: number): Promise<void> {
    const id = await this.#findId(element, { atoms: this.#atoms, marketplace: this.#marketplace });
    if (this.#numbers.get(element) !== number) {
      // The post left the page while its ID was being looked up.
      return;
    }
    element.setAttribute(MARK.postId, id ?? MARK.noPostId);
    const permalink =
      (id !== null && addressContains(id)) ||
      element.matches(this.#atoms.translate(THEATER_COMMENTS));
    const post: Post = { element, number, id, permalink };
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
