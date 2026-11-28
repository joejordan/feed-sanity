import type { Locator } from './locator';
import type { Logger } from './log';
import { callSafely, Listeners } from './listeners';
import { createLogger } from './log';

/** Elements that never hold page content worth reacting to. */
// TODO(clean): the core-cleanup unit chooses this set (spec-core-cleanup.md).
const SKIPPED_TAGS: ReadonlySet<string> = new Set<string>();
/** Attribute marking an element this project inserted into the host DOM. */
export const OWN_ATTR = 'data-feed-sanity';
const EMPTY_ELEMENTS: Element[] = [];

const isElement = (node: Node): node is Element => node.nodeType === Node.ELEMENT_NODE;

const isWatched = (node: Node): node is Element =>
  isElement(node) && !SKIPPED_TAGS.has(node.nodeName.toUpperCase());

export interface TreeChanges {
  added?: (element: Element) => void;
  removed?: (element: Element) => void;
}

/**
 * A CSS selector, or a function that builds one. A function suits selectors
 * made from translated class names: it is read again on `refresh`.
 */
export type SelectorSource = string | (() => string);

/** What a watch looks elements up with. */
type Query = Pick<Locator, 'all' | 'matches' | 'probe'>;

function selectorQuery(selector: string): Query {
  const all = <E extends Element = Element>(root: ParentNode): E[] => [
    ...root.querySelectorAll<E>(selector),
  ];
  const matches = (element: Element): boolean => element.matches(selector);
  return {
    all,
    matches,
    probe: (root) => {
      const hit = matches(root);
      if (root.childElementCount === 0) {
        return hit ? [root] : [];
      }
      return hit ? [root, ...all(root)] : all(root);
    },
  };
}

export interface WatchHandlers {
  /**
   * An element matching the selector is in the page. Called for each one
   * there at the start and each one that arrives later, once while it stays.
   */
  added?: (element: Element) => void;
  /** An element `added` was called for has left the page or no longer matches. */
  removed?: (element: Element) => void;
  /** One of the watched attributes changed on a tracked element that still matches. */
  changed?: (element: Element, attribute: string) => void;
}

export interface WatchOptions {
  /**
   * Attributes whose changes can make an element start or stop matching.
   * Only the element whose attribute changed is checked again, so a selector
   * that depends on an ancestor's attribute is not.
   */
  attributes?: readonly string[];
}

/** Stops the watch when called. */
export interface Watch {
  (): void;
  /** Reads the selector again and reports the elements that start or stop matching. */
  refresh: () => void;
}

/** One batch of mutations, read only as far as a subscriber needs. */
class Batch {
  readonly records: readonly MutationRecord[];
  #childList: readonly MutationRecord[] | undefined;
  #added: Element[] | undefined;
  #removesElements: boolean | undefined;
  #attributes: Map<Element, Set<string>> | undefined;

  constructor(records: readonly MutationRecord[]) {
    this.records = records;
  }

  /** The records of added and removed nodes, without the attribute changes. */
  get childList(): readonly MutationRecord[] {
    const isChildList = (record: MutationRecord): boolean => record.type === 'childList';
    // While no attributes are watched every record is one, and no copy is needed.
    this.#childList ??= this.records.every(isChildList)
      ? this.records
      : this.records.filter(isChildList);
    return this.#childList;
  }

  /** The top element of each subtree added in the batch that is still in the page, each once. */
  get added(): Element[] {
    if (!this.#added) {
      let first: Element | undefined;
      let added: Set<Element> | undefined;
      for (const record of this.childList) {
        for (const node of record.addedNodes) {
          if (isElement(node) && node.isConnected && !node.hasAttribute(OWN_ATTR)) {
            if (!first) {
              first = node;
            } else if (node !== first) {
              added ??= new Set([first]);
              added.add(node);
            }
          }
        }
      }
      if (added) {
        this.#added = [...added];
      } else {
        this.#added = first ? [first] : EMPTY_ELEMENTS;
      }
    }
    return this.#added;
  }

  /** True when an element left the page or moved in it. Removing text cannot take an element away. */
  get removesElements(): boolean {
    this.#removesElements ??= this.childList.some((record) => {
      for (const node of record.removedNodes) {
        if (isElement(node)) {
          return true;
        }
      }
      return false;
    });
    return this.#removesElements;
  }

  /** The attributes that changed, by element. */
  get attributes(): Map<Element, Set<string>> {
    if (!this.#attributes) {
      this.#attributes = new Map();
      for (const { type, target, attributeName } of this.records) {
        if (type === 'attributes' && attributeName && isElement(target)) {
          const names = this.#attributes.get(target) ?? new Set();
          names.add(attributeName);
          this.#attributes.set(target, names);
        }
      }
    }
    return this.#attributes;
  }
}

interface Subscriber {
  /** False until the subscriber is registered, and again once it stops. */
  active: boolean;
  /** The attributes it needs the observer to watch. */
  readonly attributes?: ReadonlySet<string>;
  deliver: (batch: Batch) => void;
}

/** Hands each added and removed subtree to `TreeChanges`, in the order the mutations happened. */
class TreeSubscriber implements Subscriber {
  active = false;
  readonly #changes: TreeChanges;
  readonly #log: Logger;

  constructor(changes: TreeChanges, log: Logger) {
    this.#changes = changes;
    this.#log = log;
  }

  deliver({ childList }: Batch): void {
    const { added, removed } = this.#changes;
    for (const record of childList) {
      if (added && record.addedNodes.length > 0) {
        for (const node of record.addedNodes) {
          if (this.active && isWatched(node) && node.isConnected && !node.hasAttribute(OWN_ATTR)) {
            callSafely(this.#log, added, node);
          }
        }
      }
      if (removed && record.removedNodes.length > 0) {
        for (const node of record.removedNodes) {
          if (this.active && isWatched(node)) {
            callSafely(this.#log, removed, node);
          }
        }
      }
    }
  }
}

/** One `watch` call: the elements matching its selector, and the handlers to tell. */
class SelectorSubscriber implements Subscriber {
  active = false;
  readonly attributes: ReadonlySet<string>;
  readonly #source: Locator | SelectorSource;
  readonly #handlers: WatchHandlers;
  readonly #log: Logger;
  readonly #root: () => Document | ShadowRoot;
  readonly #tracked = new Set<Element>();
  #query: Query;

  constructor(
    source: Locator | SelectorSource,
    handlers: WatchHandlers,
    options: WatchOptions,
    log: Logger,
    root: () => Document | ShadowRoot,
  ) {
    this.#source = source;
    this.#handlers = handlers;
    this.#log = log;
    this.#root = root;
    this.attributes = new Set(options.attributes);
    this.#query = this.#read();
  }

  /** The elements in the page that match now. Throws if the selector is not valid. */
  matching(): Element[] {
    return this.#query.all(this.#root());
  }

  enter(element: Element): void {
    if (!this.active || this.#tracked.has(element) || !this.#inRoot(element)) {
      return;
    }
    this.#tracked.add(element);
    if (this.#handlers.added) {
      callSafely(this.#log, this.#handlers.added, element);
    }
  }

  deliver(batch: Batch): void {
    if (this.attributes.size > 0 && batch.attributes.size > 0) {
      for (const [element, names] of batch.attributes) {
        this.#attributesChanged(element, names);
      }
    }
    if (this.#tracked.size > 0 && batch.removesElements) {
      for (const element of this.#tracked) {
        if (!this.#inRoot(element)) {
          this.#leave(element);
        }
      }
    }
    const added = batch.added;
    if (added.length === 0) {
      return;
    }
    for (const top of added) {
      // One lookup per subtree, so a locator that falls back picks one strategy for all of it.
      for (const element of this.#query.probe(top)) {
        this.enter(element);
      }
    }
  }

  refresh(): void {
    if (!this.active) {
      return;
    }
    try {
      this.#query = this.#read();
      for (const element of this.#tracked) {
        if (!this.#query.matches(element)) {
          this.#leave(element);
        }
      }
      for (const element of this.matching()) {
        this.enter(element);
      }
    } catch (error) {
      this.#log.error('could not look for elements again', error);
    }
  }

  #watchesAny(names: Set<string>): boolean {
    for (const name of names) {
      if (this.attributes.has(name)) {
        return true;
      }
    }
    return false;
  }

  #read(): Query {
    if (typeof this.#source === 'object') {
      return this.#source;
    }
    return selectorQuery(typeof this.#source === 'string' ? this.#source : this.#source());
  }

  #leave(element: Element): void {
    this.#tracked.delete(element);
    if (this.active && this.#handlers.removed) {
      callSafely(this.#log, this.#handlers.removed, element);
    }
  }

  #inRoot(element: Element): boolean {
    return element.isConnected && element.getRootNode() === this.#root();
  }

  #attributesChanged(element: Element, names: Set<string>): void {
    // An element that left the page is dealt with as a removal.
    if (!this.#inRoot(element) || !this.#watchesAny(names)) {
      return;
    }
    const tracked = this.#tracked.has(element);
    const matches = this.#query.matches(element);
    if (matches && !tracked) {
      this.enter(element);
    } else if (!matches && tracked) {
      this.#leave(element);
    } else if (matches && this.#handlers.changed) {
      for (const name of names) {
        if (this.active && this.attributes.has(name)) {
          callSafely(this.#log, this.#handlers.changed, element, name);
        }
      }
    }
  }
}

/**
 * Watches the whole page with one `MutationObserver`, shared by everything
 * that needs to know about changes to it. The observer runs only while
 * something is subscribed, and watches attributes only while a `watch` asks
 * for them.
 *
 * Each batch of changes is read once and handed to the subscribers in the
 * order they subscribed. A listener for address changes always hears first.
 * Every callback is feature code: one that throws is logged and the others
 * still run.
 */
export class PageWatcher {
  readonly #log: Logger;
  readonly #customRoot: Document | ShadowRoot | undefined;
  /** Replaced, not changed, so a batch being handed out keeps the list it started with. */
  #subscribers: readonly Subscriber[] = [];
  readonly #urlListeners: Listeners;
  #observer: MutationObserver | undefined;
  /** The attributes the observer watches, joined, or undefined while it is stopped. */
  #observed: string | undefined;
  #lastHref = '';
  #urlWindow: (Window & typeof globalThis) | undefined;
  /** Changes that arrived while a batch was being handed out, or undefined when none is. */
  #deferred: MutationRecord[] | undefined;

  constructor(log: Logger = createLogger('page-watcher'), root?: Document | ShadowRoot) {
    this.#log = log;
    this.#customRoot = root;
    this.#urlListeners = new Listeners(log);
  }

  get #root(): Document | ShadowRoot {
    return this.#customRoot ?? document;
  }

  get #window(): Window & typeof globalThis {
    const root = this.#root;
    const doc = root.nodeType === Node.DOCUMENT_NODE ? (root as Document) : root.ownerDocument;
    return (doc?.defaultView ?? globalThis) as Window & typeof globalThis;
  }

  /**
   * Reports each element added to or removed from the page, at any depth.
   * Only the top element of an added or removed subtree is reported; use
   * `probe` from `src/core/dom.ts` to look inside it. Returns a function that
   * stops it.
   */
  watchTree(changes: TreeChanges): () => void {
    const subscriber = new TreeSubscriber(changes, this.#log);
    this.#subscribe(subscriber);
    return () => this.#unsubscribe(subscriber);
  }

  /**
   * Calls `handlers.added` for every element matching `selector` that is in
   * the page now or arrives later, and `handlers.removed` when one leaves.
   * An element that changes after it was found is still reported when it
   * leaves. Throws if the selector is not valid.
   *
   * With `options.attributes`, a change to one of those attributes is
   * reported too: as `added` or `removed` when the element starts or stops
   * matching, and as `changed` when it still matches.
   *
   * A locator in place of the selector is looked at again by itself
   * whenever it changes. A locator that falls back uses, in each subtree
   * added to the page, the first strategy that finds anything there.
   */
  watch(
    selector: Locator | SelectorSource,
    handlers: WatchHandlers,
    options: WatchOptions = {},
  ): Watch {
    const subscriber = new SelectorSubscriber(
      selector,
      handlers,
      options,
      this.#log,
      () => this.#root,
    );
    const present = subscriber.matching();
    this.#subscribe(subscriber);
    for (const element of present) {
      subscriber.enter(element);
    }
    const stopFollowing =
      typeof selector === 'object' ? selector.onChange(() => subscriber.refresh()) : undefined;
    return Object.assign(
      () => {
        stopFollowing?.();
        this.#unsubscribe(subscriber);
      },
      { refresh: () => subscriber.refresh() },
    );
  }

  /**
   * Calls `listener` when the page address changes without a reload, as it
   * does when moving around a single-page app. Returns a function that stops
   * it.
   *
   * A content script cannot see the page's `history.pushState` calls, so the
   * address is compared whenever the document changes, as well as on
   * `popstate`, `hashchange` and the Navigation API's `currententrychange`
   * where the browser has it. A new page always changes the document, and
   * the listener hears of the new address before any subscriber hears of the
   * content that came with it.
   */
  onUrlChange(listener: () => void): () => void {
    if (this.#urlListeners.size === 0) {
      const win = this.#window;
      this.#urlWindow = win;
      this.#lastHref = win.location.href;
      win.addEventListener('popstate', this.#checkUrl);
      win.addEventListener('hashchange', this.#checkUrl);
      win.navigation?.addEventListener('currententrychange', this.#checkUrl);
    }
    const remove = this.#urlListeners.add(listener);
    this.#sync();
    let removed = false;
    return () => {
      if (removed) {
        return;
      }
      removed = true;
      remove();
      if (this.#urlListeners.size === 0) {
        const win = this.#urlWindow ?? this.#window;
        this.#urlWindow = undefined;
        win.removeEventListener('popstate', this.#checkUrl);
        win.removeEventListener('hashchange', this.#checkUrl);
        win.navigation?.removeEventListener('currententrychange', this.#checkUrl);
      }
      this.#sync();
    };
  }

  /**
   * Resolves with the first element matching `selector`, waiting for it to
   * be added if the page does not have it yet. Content scripts start before
   * the document is parsed, so even <head> may be missing at first.
   *
   * It never gives up. Only wait for elements that are sure to appear.
   */
  waitForElement(selector: string): Promise<Element> {
    const existing = this.#root.querySelector(selector);
    if (existing) {
      return Promise.resolve(existing);
    }
    return new Promise((resolve) => {
      const stop = this.watch(selector, {
        added: (element) => {
          stop();
          resolve(element);
        },
      });
    });
  }

  #subscribe(subscriber: Subscriber): void {
    // Changes made before it subscribed are handed out first, to the others only.
    const pending = this.#observed === undefined ? [] : (this.#observer?.takeRecords() ?? []);
    if (pending.length > 0) {
      this.#dispatch(pending);
    }
    this.#subscribers = [...this.#subscribers, subscriber];
    this.#sync();
    subscriber.active = true;
  }

  #unsubscribe(subscriber: Subscriber): void {
    if (!subscriber.active) {
      return;
    }
    subscriber.active = false;
    this.#subscribers = this.#subscribers.filter((other) => other !== subscriber);
    this.#sync();
  }

  readonly #checkUrl = (): void => {
    const href = (this.#urlWindow ?? this.#window).location.href;
    if (href !== this.#lastHref) {
      this.#lastHref = href;
      this.#urlListeners.emit();
    }
  };

  readonly #dispatch = (records: readonly MutationRecord[]): void => {
    // A handler that changes what is observed can hand out newer changes.
    // They wait until every subscriber has had this batch.
    if (this.#deferred) {
      this.#deferred.push(...records);
      return;
    }
    this.#deferred = [];
    try {
      this.#deliver(records);
      while (this.#deferred.length > 0) {
        this.#deliver(this.#deferred.splice(0));
      }
    } finally {
      this.#deferred = undefined;
    }
  };

  #deliver(records: readonly MutationRecord[]): void {
    if (this.#urlListeners.size > 0) {
      this.#checkUrl();
    }
    if (this.#subscribers.length === 0) {
      return;
    }
    const batch = new Batch(records);
    // Subscribers added while this batch is handed out found what it holds when they started.
    for (const subscriber of this.#subscribers) {
      if (!subscriber.active) {
        continue;
      }
      try {
        subscriber.deliver(batch);
      } catch (error) {
        // A selector built by a function can turn out not to be valid.
        this.#log.error('could not handle a change to the page', error);
      }
    }
  }

  /** Starts, stops or changes the observer to fit what is subscribed. */
  #sync(): void {
    if (this.#subscribers.length === 0 && this.#urlListeners.size === 0) {
      this.#observer?.disconnect();
      this.#observed = undefined;
      return;
    }
    const attributes = [
      ...new Set(this.#subscribers.flatMap((subscriber) => [...(subscriber.attributes ?? [])])),
    ].sort();
    const observed = attributes.join(' ');
    if (this.#observed === observed) {
      return;
    }
    this.#observer ??= new MutationObserver(this.#dispatch);
    // Changing what is observed means starting again, which would drop the
    // changes not handed out yet.
    const pending = this.#observed === undefined ? [] : this.#observer.takeRecords();
    this.#observer.disconnect();
    this.#observer.observe(
      this.#root,
      attributes.length > 0
        ? { childList: true, subtree: true, attributes: true, attributeFilter: attributes }
        : { childList: true, subtree: true },
    );
    this.#observed = observed;
    if (pending.length > 0) {
      this.#dispatch(pending);
    }
  }
}

/** The watcher the whole content script shares. */
export const pageWatcher = new PageWatcher();
