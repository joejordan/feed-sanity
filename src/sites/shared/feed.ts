// Shared `FeedCapability` implementation for site adapters (Instagram, X.com,
// and future feed-based sites). Handles watcher lifecycle, single-delivery
// initial replay, lazy text reading, AbortController-guarded bridge enrichment,
// recheck on late Network Tap captures, and accurate `FeedStats` accounting.

import type { FeedCapability, FeedItem, FeedStats } from '../../capabilities';
import type { PageBridge } from '../../core/bridge';
import type { DomEnvironment } from '../../core/dom-env';
import type { Locate, LocatorSpec } from '../../core/locator';
import { callSafely, Listeners } from '../../core/listeners';
import { createLogger } from '../../core/log';
import { isObject } from '../../engines/react';

export interface SiteFeedItem extends FeedItem {
  readonly isAd: boolean;
  readonly isSuggested: boolean;
  readonly readLowerText: () => string;
}

export interface SiteFeedConfig {
  readonly logName: string;
  readonly itemSpec: LocatorSpec;
  readonly readerName: string;
  readonly readDomSignals: (element: HTMLElement) => {
    readonly id: string | null;
    readonly isAd: boolean;
    readonly isSuggested: boolean;
  };
  /** Optional text extractor (defaults to `element.textContent`). Return `null` to skip caching until hydrated. */
  readonly readText?: (element: HTMLElement) => string | null;
}

export class SiteFeed implements FeedCapability {
  readonly #env: DomEnvironment;
  readonly #locate: Locate;
  readonly #bridge: PageBridge;
  readonly #config: SiteFeedConfig;
  readonly #onBridgeActive: (() => void) | undefined;
  readonly #log: ReturnType<typeof createLogger>;

  readonly #tracked = new Map<HTMLElement, SiteFeedItem>();
  readonly #identifying = new Map<HTMLElement, AbortController>();
  readonly #trackListeners: Listeners<[SiteFeedItem]>;
  readonly #untrackListeners: Listeners<[SiteFeedItem]>;
  readonly #addListeners: Listeners<[SiteFeedItem]>;
  readonly #updateListeners: Listeners<[SiteFeedItem]>;
  readonly #removeListeners: Listeners<[SiteFeedItem]>;
  readonly #resetListeners: Listeners<[]>;

  #stop: (() => void) | undefined;
  #stopUrl: (() => void) | undefined;
  #started = false;

  constructor(
    env: DomEnvironment,
    locate: Locate,
    bridge: PageBridge,
    config: SiteFeedConfig,
    onBridgeActive?: () => void,
  ) {
    this.#env = env;
    this.#locate = locate;
    this.#bridge = bridge;
    this.#config = config;
    this.#onBridgeActive = onBridgeActive;
    this.#log = createLogger(config.logName);
    this.#trackListeners = new Listeners(this.#log);
    this.#untrackListeners = new Listeners(this.#log);
    this.#addListeners = new Listeners(this.#log);
    this.#updateListeners = new Listeners(this.#log);
    this.#removeListeners = new Listeners(this.#log);
    this.#resetListeners = new Listeners(this.#log);
  }

  onTrack(listener: (item: SiteFeedItem) => void): () => void {
    for (const item of this.#tracked.values()) {
      callSafely(this.#log, listener, item);
    }
    const remove = this.#trackListeners.add(listener);
    this.#ensureStarted();
    return () => {
      remove();
      this.#maybeStop();
    };
  }

  onUntrack(listener: (item: SiteFeedItem) => void): () => void {
    const remove = this.#untrackListeners.add(listener);
    return () => {
      remove();
      this.#maybeStop();
    };
  }

  onAdd(listener: (item: SiteFeedItem) => void): () => void {
    for (const item of this.#tracked.values()) {
      callSafely(this.#log, listener, item);
    }
    const remove = this.#addListeners.add(listener);
    this.#ensureStarted();
    return () => {
      remove();
      this.#maybeStop();
    };
  }

  onUpdate(listener: (item: SiteFeedItem) => void): () => void {
    const remove = this.#updateListeners.add(listener);
    return () => {
      remove();
      this.#maybeStop();
    };
  }

  onRemove(listener: (item: SiteFeedItem) => void): () => void {
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

  /** Re-runs bridge enrichment for items not yet flagged as ad/suggested (e.g. after Network Tap capture). */
  recheck(): void {
    if (!this.#started || this.#bridge.status().state === 'unavailable') {
      return;
    }
    for (const [element, item] of this.#tracked) {
      if (!item.isAd && !item.isSuggested && !this.#identifying.has(element)) {
        void this.#enrich(element, item);
      }
    }
  }

  stats(): FeedStats {
    let withId = 0;
    let withoutId = 0;
    for (const [el, item] of this.#tracked) {
      if (item.id !== null) {
        withId++;
      } else if (!this.#identifying.has(el)) {
        withoutId++;
      }
    }
    return {
      started: this.#started,
      tracked: this.#tracked.size,
      withId,
      withoutId,
      identifying: this.#identifying.size,
      unrecognised: 0,
    };
  }

  #ensureStarted(): void {
    if (this.#stop) {
      return;
    }
    this.#started = true;
    this.#stop = this.#env.watcher.watch(this.#locate(this.#config.itemSpec), {
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
    const dom = this.#config.readDomSignals(element);
    let cachedLower: string | undefined;
    const readLowerText = (): string => {
      if (cachedLower !== undefined) {
        return cachedLower;
      }
      if (this.#config.readText) {
        const extracted = this.#config.readText(element);
        if (extracted !== null) {
          cachedLower = extracted.toLowerCase();
          return cachedLower;
        }
        return (element.textContent ?? '').toLowerCase();
      }
      cachedLower = (element.textContent ?? '').toLowerCase();
      return cachedLower;
    };
    const item: SiteFeedItem = {
      element,
      content: element,
      id: dom.id,
      permalink: false,
      isAd: dom.isAd,
      isSuggested: dom.isSuggested,
      readLowerText,
    };
    this.#tracked.set(element, item);
    this.#trackListeners.emit(item);
    this.#addListeners.emit(item);
    void this.#enrich(element, item);
  }

  async #enrich(element: HTMLElement, initial: SiteFeedItem): Promise<void> {
    if (this.#bridge.status().state === 'unavailable') {
      return;
    }
    this.#onBridgeActive?.();
    const controller = new AbortController();
    this.#identifying.set(element, controller);
    try {
      const answer = await this.#bridge.ask(element, this.#config.readerName, controller.signal);
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
        const updated: SiteFeedItem = {
          ...initial,
          id: nextId,
          isAd: nextAd,
          isSuggested: nextSuggested,
        };
        this.#tracked.set(element, updated);
        this.#updateListeners.emit(updated);
      }
    } catch {
      // Bridge unavailable, aborted, or detached; DOM signals remain authoritative.
    } finally {
      if (this.#identifying.get(element) === controller) {
        this.#identifying.delete(element);
      }
    }
  }

  #leave(element: HTMLElement): void {
    const item = this.#tracked.get(element);
    if (!item) {
      return;
    }
    this.#tracked.delete(element);
    const controller = this.#identifying.get(element);
    if (controller) {
      controller.abort();
      this.#identifying.delete(element);
    }
    this.#untrackListeners.emit(item);
    this.#removeListeners.emit(item);
  }
}
