// Shared `FeedCapability` implementation for site adapters (Instagram, X.com,
// and future feed-based sites). Handles watcher lifecycle, single-delivery
// initial replay, lazy text reading, AbortController-guarded bridge enrichment,
// recheck on late Network Tap captures, and accurate `FeedStats` accounting.

import type { FeedCapability, FeedItem, FeedStats } from '../../capabilities';
import type { PageBridge } from '../../core/bridge';
import type { DomEnvironment } from '../../core/dom-env';
import type { FilterFields } from '../../core/filter-engine';
import type { Locate, LocatorSpec } from '../../core/locator';
import { callSafely, Listeners } from '../../core/listeners';
import { createLogger } from '../../core/log';
import { isObject } from '../../engines/react';

export interface SiteFeedItem extends FeedItem {
  readonly isAd: boolean;
  readonly isSuggested: boolean;
  readonly pending: boolean;
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
  /** Optional structured field extractor for custom cross-site Filter Rules. */
  readonly readFields?: (
    element: HTMLElement,
    signals: { readonly isAd: boolean; readonly isSuggested: boolean },
  ) => FilterFields;
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

  /** Re-runs DOM + bridge classification for items not yet flagged as ad/suggested (e.g. after Network Tap capture). */
  recheck(): void {
    if (!this.#started) {
      return;
    }
    for (const [element, item] of this.#tracked) {
      if (item.isAd || item.isSuggested) {
        continue;
      }
      const current = this.#mergeSignals(element, item, false, undefined, true);
      if (
        !current.isAd &&
        !current.isSuggested &&
        this.#bridge.status().state !== 'unavailable' &&
        !this.#identifying.has(element)
      ) {
        void this.#enrich(element, false);
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
    this.#stop = this.#env.watch(this.#locate(this.#config.itemSpec), {
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

  #makeReadFields(
    element: HTMLElement,
    isAd: boolean,
    isSuggested: boolean,
  ): (() => FilterFields) | undefined {
    const reader = this.#config.readFields;
    return reader ? () => reader(element, { isAd, isSuggested }) : undefined;
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
    const readFields = this.#makeReadFields(element, dom.isAd, dom.isSuggested);
    const willEnrich = this.#bridge.status().state !== 'unavailable';
    const pending = willEnrich && !dom.isAd && !dom.isSuggested;
    const item: SiteFeedItem = {
      element,
      content: element,
      id: dom.id,
      permalink: false,
      isAd: dom.isAd,
      isSuggested: dom.isSuggested,
      pending,
      readLowerText,
      ...(readFields ? { readFields } : {}),
    };
    this.#tracked.set(element, item);
    this.#trackListeners.emit(item);
    this.#addListeners.emit(item);
    if (willEnrich && (pending || dom.id === null)) {
      void this.#enrich(element, true);
    }
  }

  #mergeSignals(
    element: HTMLElement,
    item: SiteFeedItem,
    settlePending: boolean,
    answer: unknown,
    readDom: boolean,
  ): SiteFeedItem {
    const answerObj = isObject(answer) ? answer : undefined;
    const answerAd = answerObj?.isAd === true;
    const answerSuggested = answerObj?.isSuggested === true;
    const answerId =
      typeof answerObj?.id === 'string' && answerObj.id.length > 0 ? answerObj.id : null;
    const skipDom =
      !readDom || ((item.id !== null || answerId !== null) && (answerAd || answerSuggested));
    const dom = skipDom ? undefined : this.#config.readDomSignals(element);

    const nextId = answerId ?? dom?.id ?? item.id;
    const nextAd = item.isAd || answerAd || dom?.isAd === true;
    const nextSuggested = item.isSuggested || answerSuggested || dom?.isSuggested === true;
    const nextPending = settlePending || nextAd || nextSuggested ? false : item.pending;
    if (
      nextPending === item.pending &&
      nextId === item.id &&
      nextAd === item.isAd &&
      nextSuggested === item.isSuggested
    ) {
      return item;
    }
    const updatedReadFields = this.#makeReadFields(element, nextAd, nextSuggested);
    const updated: SiteFeedItem = {
      ...item,
      id: nextId,
      isAd: nextAd,
      isSuggested: nextSuggested,
      pending: nextPending,
      ...(updatedReadFields ? { readFields: updatedReadFields } : {}),
    };
    this.#tracked.set(element, updated);
    this.#updateListeners.emit(updated);
    return updated;
  }

  async #enrich(element: HTMLElement, readDomAfter: boolean): Promise<void> {
    if (this.#bridge.status().state === 'unavailable') {
      const current = this.#tracked.get(element);
      if (current?.pending) {
        this.#mergeSignals(element, current, true, undefined, false);
      }
      return;
    }
    this.#onBridgeActive?.();
    const controller = new AbortController();
    this.#identifying.set(element, controller);
    let answer: unknown;
    try {
      answer = await this.#bridge.ask(element, this.#config.readerName, controller.signal);
    } catch {
      // Bridge unavailable, aborted, or detached; DOM signals remain authoritative.
    } finally {
      if (this.#identifying.get(element) === controller) {
        this.#identifying.delete(element);
      }
    }
    if (controller.signal.aborted) {
      return;
    }
    const latest = this.#tracked.get(element);
    if (latest) {
      this.#mergeSignals(element, latest, true, answer, readDomAfter);
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
