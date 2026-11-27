import type { Logger } from './log';
import {
  actionEvent,
  answerEvent,
  askEvent,
  CONNECT_EVENT,
  connectedEvent,
  disconnectEvent,
  isPlainObject,
  messageEvent,
  mountEvent,
  pushEvent,
  READY_EVENT,
  readMessage,
  toggleEvent,
  unmountEvent,
} from './bridge-protocol';
import { Listeners } from './listeners';
import { createLogger, messageOf } from './log';

/** How long the page-world side has to answer the first connect, in milliseconds. */
export const CONNECT_MS = 5000;

/** How long one question may go unanswered, in milliseconds. Readers answer at once. */
export const ANSWER_MS = 2000;

export type BridgeState = 'connected' | 'connecting' | 'not started' | 'unavailable';

export interface BridgeStatus {
  readonly state: BridgeState;
  /** Why the bridge is unavailable, in words for the diagnostics. Null in every other state. */
  readonly problem: string | null;
  /** The readers the page-world side offers, once connected. */
  readonly readers: readonly string[];
  /** The toggles the page-world side offers, once connected. */
  readonly toggles: readonly string[];
  /** The actions the page-world side offers, once connected. */
  readonly actions: readonly string[];
  /** The lifecycle-managed mounts the page-world side offers, once connected. */
  readonly mounts: readonly string[];
}

/** Why a question got no answer. */
export type BridgeFailure =
  /** The page-world side could not be put in the page, or never answered. */
  | 'unavailable'
  /** No answer came in time. */
  | 'timeout'
  /** The signal passed to `ask` or `set` was aborted, or the asking feature stopped. */
  | 'cancelled'
  /** The element was not in the page, where the page-world side cannot hear about it. */
  | 'detached'
  /** The page-world side has no such reader, toggle, action or mount, or it failed. */
  | 'failed';

export class BridgeError extends Error {
  readonly failure: BridgeFailure;

  constructor(failure: BridgeFailure, message: string) {
    super(message);
    this.name = 'BridgeError';
    this.failure = failure;
  }
}

export interface BridgeOptions {
  connectMs?: number;
  answerMs?: number;
  log?: Logger;
  /**
   * When true, keeps listening for `READY_EVENT` until `dispose()` so late-arriving
   * or freshly replaced MAIN-world scripts (such as Safari cold-start races or live
   * extension reloads) automatically re-establish the bridge channel. Callers using
   * this option must call `dispose()` when tearing down the runtime.
   */
  reconnectOnReady?: boolean;
}

const NOT_STARTED: BridgeStatus = {
  state: 'not started',
  problem: null,
  readers: [],
  toggles: [],
  actions: [],
  mounts: [],
};

const MAX_BUFFERED_TOPICS = 32;
const MAX_BUFFERED_PER_TOPIC = 64;
const LATE_MOUNT_CLEANUP_MS = 10_000;

const cancelled = (): BridgeError => new BridgeError('cancelled', 'the question was withdrawn');

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((name) => typeof name === 'string');

/**
 * The content side of the page-world bridge: asks questions about an element,
 * switches a named toggle, runs a named action, or mounts a native page-world
 * component that only code in the page's own world can reach.
 *
 * The other side, `servePageWorld` in `src/core/page-world.ts`, holds named
 * readers, toggles, actions and mounts. `install`, which comes from the
 * build's `Platform`, puts it in the page. The two sides find each other
 * through a fixed pair of events, then talk on a channel whose names are
 * random for each page load. Questions and answers are events on the element
 * asked about (or `document` for toggles, actions and unmounts), so elements
 * are never copied, and their `detail` is a JSON string.
 *
 * The page can see and send these events too, so an answer is data to check
 * before use, never something to trust.
 *
 * Nothing happens until the first `ask`, `set`, `run`, `mount` or `onStatus`.
 * If the page-world side cannot be put in the page, or does not answer within
 * `connectMs`, the bridge is unavailable for the rest of the page load. That
 * is logged once, and every call fails at once with `unavailable`.
 */
export class PageBridge {
  readonly #install: () => Promise<void>;
  readonly #connectMs: number;
  readonly #answerMs: number;
  readonly #log: Logger;
  readonly #allowReconnectOnReady: boolean;
  readonly #listeners: Listeners<[BridgeStatus]>;
  readonly #topicListeners = new Map<string, Listeners<[unknown]>>();
  readonly #bufferedTopics = new Map<string, unknown[]>();
  readonly #lateMountCleanups = new Set<() => void>();
  readonly #pendingSends = new Set<() => void>();
  #status: BridgeStatus = NOT_STARTED;
  #channel = '';
  #nextId = 1;
  #disposed = false;
  #connectCleanup: (() => void) | undefined;
  #readyCleanup: (() => void) | undefined;
  #pushCleanup: (() => void) | undefined;
  /** Settles once the bridge is connected or unavailable. */
  #settled: Promise<void> | undefined;

  constructor(
    install: () => Promise<void>,
    {
      connectMs = CONNECT_MS,
      answerMs = ANSWER_MS,
      log = createLogger('bridge'),
      reconnectOnReady = false,
    }: BridgeOptions = {},
  ) {
    this.#install = install;
    this.#connectMs = connectMs;
    this.#answerMs = answerMs;
    this.#log = log;
    this.#allowReconnectOnReady = reconnectOnReady;
    this.#listeners = new Listeners(log);
  }

  status(): BridgeStatus {
    return this.#status;
  }

  /**
   * Tears down document event listeners, pending connect/late-mount timers, and
   * buffered topics. Safe to call repeatedly; any subsequent call fails with
   * `unavailable`. Pass `{ keepRemoteAlive: true }` to detach without disposing
   * the page-world server (e.g. one-shot stale-hint disarming).
   */
  dispose(options?: { readonly keepRemoteAlive?: boolean }): void {
    if (this.#disposed) {
      return;
    }
    const connectedChannel = this.#status.state === 'connected' ? this.#channel : undefined;
    this.#disposed = true;
    this.#connectCleanup?.();
    this.#connectCleanup = undefined;
    this.#readyCleanup?.();
    this.#readyCleanup = undefined;
    this.#pushCleanup?.();
    this.#pushCleanup = undefined;
    for (const cleanup of [...this.#lateMountCleanups]) {
      cleanup();
    }
    this.#lateMountCleanups.clear();
    for (const cancelSend of [...this.#pendingSends]) {
      cancelSend();
    }
    this.#pendingSends.clear();
    this.#listeners.clear();
    for (const bucket of this.#topicListeners.values()) {
      bucket.clear();
    }
    this.#topicListeners.clear();
    this.#bufferedTopics.clear();
    this.#status = { ...NOT_STARTED, state: 'unavailable', problem: 'the bridge was disposed' };
    this.#settled = Promise.resolve();
    if (connectedChannel && typeof document !== 'undefined') {
      document.dispatchEvent(
        options?.keepRemoteAlive
          ? messageEvent(disconnectEvent(connectedChannel), { keepAlive: true })
          : new CustomEvent(disconnectEvent(connectedChannel)),
      );
    }
  }

  /**
   * Calls `listener` with the new status whenever it changes, and starts the
   * bridge if it has not started. Returns a function that stops it.
   */
  onStatus(listener: (status: BridgeStatus) => void): () => void {
    const remove = this.#listeners.add(listener);
    this.#start();
    return remove;
  }

  /**
   * Subscribes to unsolicited events pushed by the page-world side under
   * `topic` (such as `document_start` network tap metadata), starting the
   * bridge if needed. Callers must validate `payload` as untrusted data.
   */
  on(topic: string, listener: (payload: unknown) => void): () => void {
    let listeners = this.#topicListeners.get(topic);
    if (!listeners) {
      listeners = new Listeners(this.#log);
      this.#topicListeners.set(topic, listeners);
    }
    const bucket = listeners;
    const remove = bucket.add(listener);
    const buffered = this.#bufferedTopics.get(topic);
    if (buffered && buffered.length > 0) {
      this.#bufferedTopics.delete(topic);
      for (const payload of buffered) {
        bucket.emit(payload);
      }
    }
    this.#start();
    return () => {
      remove();
      if (bucket.size === 0 && this.#topicListeners.get(topic) === bucket) {
        this.#topicListeners.delete(topic);
      }
    };
  }

  /**
   * Asks the page-world reader `reader` about `element`, which must be in
   * the page. Resolves with the reader's value as the page sent it, which the
   * caller must check, or rejects with a `BridgeError`.
   */
  async ask(element: Element, reader: string, signal?: AbortSignal): Promise<unknown> {
    await this.#ensureReady('readers', 'reader', reader, signal, element);
    return this.#send(
      element,
      askEvent(this.#channel),
      (id) => ({ id, reader }),
      `the ${reader} reader`,
      signal,
    );
  }

  /**
   * Switches the named page-world toggle `toggle` on or off. Resolves with
   * the toggle's value as the page sent it, which the caller must check, or
   * rejects with a `BridgeError`.
   */
  async set(toggle: string, enabled: boolean, signal?: AbortSignal): Promise<unknown> {
    await this.#ensureReady('toggles', 'toggle', toggle, signal);
    return this.#send(
      document,
      toggleEvent(this.#channel),
      (id) => ({ id, toggle, enabled }),
      `the ${toggle} toggle`,
      signal,
    );
  }

  /**
   * Runs the named page-world action `action` with `payload`. Resolves with
   * the action's value as the page sent it, which the caller must check, or
   * rejects with a `BridgeError`.
   */
  async run(
    action: string,
    payload: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<unknown> {
    await this.#ensureReady('actions', 'action', action, signal);
    return this.#send(
      document,
      actionEvent(this.#channel),
      (id) => ({ id, action, payload }),
      `the ${action} action`,
      signal,
    );
  }

  /**
   * Mounts the named page-world component `mount` into `element` (which must
   * be connected in the DOM). Resolves with an idempotent unmount function, or
   * null when the mount declined to start. Rejects with a `BridgeError` when
   * the bridge is unavailable or the mount failed.
   */
  async mount(
    element: Element,
    mount: string,
    payload: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<(() => void) | null> {
    await this.#ensureReady('mounts', 'mount', mount, signal, element);
    const requestId = this.#nextId++;
    let answer: unknown;
    try {
      answer = await this.#send(
        element,
        mountEvent(this.#channel),
        (id) => ({ id, mount, payload }),
        `the ${mount} mount`,
        signal,
        requestId,
      );
    } catch (error) {
      if (
        error instanceof BridgeError &&
        (error.failure === 'cancelled' || error.failure === 'timeout')
      ) {
        this.#watchLateMount(element, requestId, mount);
      }
      throw error;
    }
    if (!isPlainObject(answer) || typeof answer.mountId !== 'number') {
      return null;
    }
    const { mountId } = answer;
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.#unmount(mountId, mount);
    };
  }

  #unmount(mountId: number, mount: string): void {
    void this.#send(
      document,
      unmountEvent(this.#channel),
      (id) => ({ id, mountId }),
      `unmounting ${mount}`,
      undefined,
    ).catch(() => undefined);
  }

  #watchLateMount(element: Element, requestId: number, mount: string): void {
    if (this.#disposed) {
      return;
    }
    const type = answerEvent(this.#channel);
    const cleanup = (): void => {
      clearTimeout(timer);
      element.removeEventListener(type, heard);
      this.#lateMountCleanups.delete(cleanup);
    };
    const heard = (event: Event): void => {
      const message = readMessage(event);
      if (message?.id !== requestId) {
        return;
      }
      cleanup();
      if (this.#disposed) {
        return;
      }
      const value = message.value;
      if (isPlainObject(value) && typeof value.mountId === 'number') {
        this.#unmount(value.mountId, mount);
      }
    };
    const timer = setTimeout(cleanup, LATE_MOUNT_CLEANUP_MS);
    this.#lateMountCleanups.add(cleanup);
    element.addEventListener(type, heard);
  }

  async #ensureReady(
    listKey: 'readers' | 'toggles' | 'actions' | 'mounts',
    kind: string,
    name: string,
    signal: AbortSignal | undefined,
    element?: Element,
  ): Promise<void> {
    await this.#settledOrAborted(signal);
    // It may have been aborted while the wait above was resolving, and a
    // listener added to an aborted signal is never called.
    if (signal?.aborted) {
      throw cancelled();
    }
    if (this.#status.state !== 'connected') {
      throw new BridgeError('unavailable', 'the page-world bridge is unavailable');
    }
    if (!this.#status[listKey].includes(name)) {
      throw new BridgeError('failed', `the page-world side has no ${kind} called ${name}`);
    }
    if (element && !element.isConnected) {
      throw new BridgeError('detached', 'the element is not in the page');
    }
  }

  /** Waits for the bridge to connect or fail, and rejects as soon as `signal` aborts. */
  #settledOrAborted(signal: AbortSignal | undefined): Promise<void> {
    const settled = this.#start();
    if (!signal) {
      return settled;
    }
    return new Promise((resolve, reject) => {
      const aborted = (): void => reject(cancelled());
      if (signal.aborted) {
        aborted();
        return;
      }
      signal.addEventListener('abort', aborted, { once: true });
      void settled.then(() => {
        signal.removeEventListener('abort', aborted);
        resolve();
      });
    });
  }

  #send(
    target: EventTarget,
    requestType: string,
    payload: (id: number) => Record<string, unknown>,
    label: string,
    signal: AbortSignal | undefined,
    explicitId?: number,
  ): Promise<unknown> {
    const id = explicitId ?? this.#nextId++;
    const type = answerEvent(this.#channel);
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cancelOnDispose = (): void => {
        end();
        reject(new BridgeError('unavailable', 'the bridge was disposed'));
      };
      const end = (): void => {
        settled = true;
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
        this.#pendingSends.delete(cancelOnDispose);
        target.removeEventListener(type, heard);
        signal?.removeEventListener('abort', aborted);
      };
      const heard = (event: Event): void => {
        const message = readMessage(event);
        if (message?.id !== id) {
          return;
        }
        end();
        if ('value' in message) {
          resolve(message.value);
        } else {
          reject(new BridgeError('failed', `${label} gave no answer`));
        }
      };
      const aborted = (): void => {
        end();
        reject(cancelled());
      };
      target.addEventListener(type, heard);
      target.dispatchEvent(messageEvent(requestType, payload(id)));
      // `servePageWorld` answers synchronously during `dispatchEvent`; skip
      // allocating a timer and abort listener in that common path.
      if (!settled) {
        this.#pendingSends.add(cancelOnDispose);
        timer = setTimeout(() => {
          end();
          reject(new BridgeError('timeout', `${label} did not answer in time`));
        }, this.#answerMs);
        signal?.addEventListener('abort', aborted);
      }
    });
  }

  #update(status: BridgeStatus): void {
    this.#status = status;
    this.#listeners.emit(status);
  }

  #start(): Promise<void> {
    if (this.#disposed) {
      return Promise.resolve();
    }
    this.#settled ??= this.#connect();
    return this.#settled;
  }

  #handlePush(pushed: Event): void {
    if (this.#disposed || pushed.target !== document) {
      return;
    }
    const payloadMsg = readMessage(pushed);
    if (typeof payloadMsg?.topic !== 'string') {
      return;
    }
    const bucket = this.#topicListeners.get(payloadMsg.topic);
    if (bucket && bucket.size > 0) {
      bucket.emit(payloadMsg.payload);
      return;
    }
    let queue = this.#bufferedTopics.get(payloadMsg.topic);
    if (!queue) {
      if (this.#bufferedTopics.size >= MAX_BUFFERED_TOPICS) {
        const oldest = this.#bufferedTopics.keys().next().value;
        if (oldest !== undefined) {
          this.#bufferedTopics.delete(oldest);
        }
      }
      queue = [];
      this.#bufferedTopics.set(payloadMsg.topic, queue);
    }
    if (queue.length >= MAX_BUFFERED_PER_TOPIC) {
      queue.shift();
    }
    queue.push(payloadMsg.payload);
  }

  #parseConnected(event: Event): BridgeStatus | undefined {
    const message = readMessage(event);
    const readers = message?.readers;
    const toggles = message?.toggles;
    const actions = message?.actions;
    const mounts = message?.mounts;
    if (
      isStringList(readers) &&
      (toggles === undefined || isStringList(toggles)) &&
      (actions === undefined || isStringList(actions)) &&
      (mounts === undefined || isStringList(mounts))
    ) {
      return {
        state: 'connected',
        problem: null,
        readers,
        toggles: toggles ?? [],
        actions: actions ?? [],
        mounts: mounts ?? [],
      };
    }
    return undefined;
  }

  #bindPushChannel(channel: string): void {
    this.#pushCleanup?.();
    const pushType = pushEvent(channel);
    const onPush = (pushed: Event): void => this.#handlePush(pushed);
    document.addEventListener(pushType, onPush, true);
    this.#pushCleanup = () => document.removeEventListener(pushType, onPush, true);
  }

  /**
   * Synchronously recovers from an initial `'unavailable'` state when a late
   * page-world script announces `READY_EVENT` (e.g. a Safari cold-start race).
   * Never runs once `'connected'`, so untrusted post-boot page scripts cannot
   * hijack an established bridge channel.
   */
  #reconnectOnReady(): void {
    if (this.#disposed || this.#status.state !== 'unavailable') {
      return;
    }
    const nextChannel = `feed-sanity-${crypto.randomUUID()}`;
    const connected = connectedEvent(nextChannel);
    let nextStatus: BridgeStatus | undefined;
    const heard = (event: Event): void => {
      nextStatus ??= this.#parseConnected(event);
    };
    document.addEventListener(connected, heard, true);
    try {
      document.dispatchEvent(messageEvent(CONNECT_EVENT, { channel: nextChannel }));
    } finally {
      document.removeEventListener(connected, heard, true);
    }
    if (nextStatus && !this.#disposed) {
      this.#readyCleanup?.();
      this.#readyCleanup = undefined;
      this.#channel = nextChannel;
      this.#bindPushChannel(nextChannel);
      this.#update(nextStatus);
    }
  }

  #connect(): Promise<void> {
    this.#channel = `feed-sanity-${crypto.randomUUID()}`;
    this.#update({ ...NOT_STARTED, state: 'connecting' });
    const connected = connectedEvent(this.#channel);
    const hello = (): void => {
      document.dispatchEvent(messageEvent(CONNECT_EVENT, { channel: this.#channel }));
    };
    return new Promise((resolve) => {
      const cleanupHandshake = (keepReadyListener: boolean): void => {
        clearTimeout(timer);
        document.removeEventListener(connected, heard, true);
        if (!keepReadyListener) {
          this.#readyCleanup?.();
          this.#readyCleanup = undefined;
        }
      };
      const end = (status: BridgeStatus): void => {
        if (this.#status.state !== 'connecting') {
          return;
        }
        this.#connectCleanup = undefined;
        // Always stop listening for `READY_EVENT` once connected so post-boot
        // page scripts cannot hijack an active channel. Only keep it when
        // `reconnectOnReady` is enabled and the initial attempt went unavailable.
        cleanupHandshake(
          this.#allowReconnectOnReady && !this.#disposed && status.state === 'unavailable',
        );
        if (this.#disposed) {
          resolve();
          return;
        }
        if (status.problem) {
          this.#log.error(`the page-world bridge is unavailable: ${status.problem}`);
        }
        this.#update(status);
        resolve();
      };
      const unavailable = (problem: string): void =>
        end({ ...NOT_STARTED, state: 'unavailable', problem });
      const heard = (event: Event): void => {
        const status = this.#parseConnected(event);
        if (status) {
          this.#bindPushChannel(this.#channel);
          end(status);
        }
      };
      const onReady = (): void => {
        if (this.#disposed) {
          return;
        }
        if (this.#status.state === 'connecting') {
          hello();
        } else if (this.#status.state === 'unavailable') {
          this.#reconnectOnReady();
        }
      };
      const timer = setTimeout(
        () => unavailable('the page script did not answer'),
        this.#connectMs,
      );
      this.#connectCleanup = () => {
        cleanupHandshake(false);
        resolve();
      };
      document.addEventListener(connected, heard, true);
      // Keep listening for `READY_EVENT` until disposed so late-arriving or
      // freshly replaced page-world scripts re-establish the channel cleanly.
      document.addEventListener(READY_EVENT, onReady, true);
      this.#readyCleanup = () => document.removeEventListener(READY_EVENT, onReady, true);
      hello();
      // If a `document_start` page-world script already answered `hello()`
      // synchronously, skip `#install()` to avoid redundant IPC or injection.
      if (this.#status.state === 'connecting') {
        Promise.resolve()
          .then(() => this.#install())
          .catch((error: unknown) => {
            unavailable(`the page script could not be added: ${messageOf(error)}`);
          });
      }
    });
  }
}
