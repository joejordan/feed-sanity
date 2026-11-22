import type { Logger } from './log';
import {
  actionEvent,
  answerEvent,
  askEvent,
  CONNECT_EVENT,
  connectedEvent,
  messageEvent,
  READY_EVENT,
  readMessage,
  toggleEvent,
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
  /** The page-world side has no such reader or toggle, or it failed. */
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
}

const NOT_STARTED: BridgeStatus = {
  state: 'not started',
  problem: null,
  readers: [],
  toggles: [],
  actions: [],
};

const cancelled = (): BridgeError => new BridgeError('cancelled', 'the question was withdrawn');

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((name) => typeof name === 'string');

/**
 * The content side of the page-world bridge: asks questions about an element
 * or switches a named toggle that only code in the page's own world can reach,
 * such as what React or Facebook's module loader keeps on the page.
 *
 * The other side, `servePageWorld` in `src/core/page-world.ts`, holds named
 * readers and toggles. `install`, which comes from the build's `Platform`,
 * puts it in the page. The two sides find each other through a fixed pair of
 * events, then talk on a channel whose names are random for each page load.
 * Questions and answers are events on the element asked about (or `document`
 * for toggles), so elements are never copied, and their `detail` is a JSON
 * string.
 *
 * The page can see and send these events too, so an answer is data to check
 * before use, never something to trust.
 *
 * Nothing happens until the first `ask`, `set` or `onStatus`. If the
 * page-world side cannot be put in the page, or does not answer within
 * `connectMs`, the bridge is unavailable for the rest of the page load. That
 * is logged once, and every call fails at once with `unavailable`.
 */
export class PageBridge {
  readonly #install: () => Promise<void>;
  readonly #connectMs: number;
  readonly #answerMs: number;
  readonly #log: Logger;
  readonly #listeners: Listeners<[BridgeStatus]>;
  #status: BridgeStatus = NOT_STARTED;
  #channel = '';
  #nextId = 1;
  /** Settles once the bridge is connected or unavailable. */
  #settled: Promise<void> | undefined;

  constructor(
    install: () => Promise<void>,
    {
      connectMs = CONNECT_MS,
      answerMs = ANSWER_MS,
      log = createLogger('bridge'),
    }: BridgeOptions = {},
  ) {
    this.#install = install;
    this.#connectMs = connectMs;
    this.#answerMs = answerMs;
    this.#log = log;
    this.#listeners = new Listeners(log);
  }

  status(): BridgeStatus {
    return this.#status;
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
   * Asks the page-world reader `reader` about `element`, which must be in
   * the page. Resolves with the reader's value as the page sent it, which the
   * caller must check, or rejects with a `BridgeError`.
   */
  async ask(element: Element, reader: string, signal?: AbortSignal): Promise<unknown> {
    await this.#settledOrAborted(signal);
    // It may have been aborted while the wait above was resolving, and a
    // listener added to an aborted signal is never called.
    if (signal?.aborted) {
      throw cancelled();
    }
    const { state, readers } = this.#status;
    if (state !== 'connected') {
      throw new BridgeError('unavailable', 'the page-world bridge is unavailable');
    }
    if (!readers.includes(reader)) {
      throw new BridgeError('failed', `the page-world side has no reader called ${reader}`);
    }
    if (!element.isConnected) {
      throw new BridgeError('detached', 'the element is not in the page');
    }
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
    await this.#settledOrAborted(signal);
    if (signal?.aborted) {
      throw cancelled();
    }
    const { state, toggles } = this.#status;
    if (state !== 'connected') {
      throw new BridgeError('unavailable', 'the page-world bridge is unavailable');
    }
    if (!toggles.includes(toggle)) {
      throw new BridgeError('failed', `the page-world side has no toggle called ${toggle}`);
    }
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
    await this.#settledOrAborted(signal);
    if (signal?.aborted) {
      throw cancelled();
    }
    const { state, actions } = this.#status;
    if (state !== 'connected') {
      throw new BridgeError('unavailable', 'the page-world bridge is unavailable');
    }
    if (!actions.includes(action)) {
      throw new BridgeError('failed', `the page-world side has no action called ${action}`);
    }
    return this.#send(
      document,
      actionEvent(this.#channel),
      (id) => ({ id, action, payload }),
      `the ${action} action`,
      signal,
    );
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
  ): Promise<unknown> {
    const id = this.#nextId++;
    const type = answerEvent(this.#channel);
    return new Promise((resolve, reject) => {
      const end = (): void => {
        clearTimeout(timer);
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
      const timer = setTimeout(() => {
        end();
        reject(new BridgeError('timeout', `${label} did not answer in time`));
      }, this.#answerMs);
      target.addEventListener(type, heard);
      signal?.addEventListener('abort', aborted);
      target.dispatchEvent(messageEvent(requestType, payload(id)));
    });
  }

  #update(status: BridgeStatus): void {
    this.#status = status;
    this.#listeners.emit(status);
  }

  #start(): Promise<void> {
    this.#settled ??= this.#connect();
    return this.#settled;
  }

  #connect(): Promise<void> {
    this.#channel = `feed-sanity-${crypto.randomUUID()}`;
    this.#update({ state: 'connecting', problem: null, readers: [], toggles: [], actions: [] });
    const connected = connectedEvent(this.#channel);
    const hello = (): void => {
      document.dispatchEvent(messageEvent(CONNECT_EVENT, { channel: this.#channel }));
    };
    return new Promise((resolve) => {
      const end = (status: BridgeStatus): void => {
        if (this.#status.state !== 'connecting') {
          return;
        }
        clearTimeout(timer);
        document.removeEventListener(READY_EVENT, hello, true);
        document.removeEventListener(connected, heard, true);
        if (status.problem) {
          this.#log.error(`the page-world bridge is unavailable: ${status.problem}`);
        }
        this.#update(status);
        resolve();
      };
      const unavailable = (problem: string): void =>
        end({ state: 'unavailable', problem, readers: [], toggles: [], actions: [] });
      const heard = (event: Event): void => {
        const message = readMessage(event);
        const readers = message?.readers;
        const toggles = message?.toggles;
        const actions = message?.actions;
        if (
          isStringList(readers) &&
          (toggles === undefined || isStringList(toggles)) &&
          (actions === undefined || isStringList(actions))
        ) {
          end({
            state: 'connected',
            problem: null,
            readers,
            toggles: toggles ?? [],
            actions: actions ?? [],
          });
        }
      };
      const timer = setTimeout(
        () => unavailable('the page script did not answer'),
        this.#connectMs,
      );
      document.addEventListener(connected, heard, true);
      // A page-world side that starts later says so, and is sent this again.
      document.addEventListener(READY_EVENT, hello, true);
      hello();
      Promise.resolve()
        .then(() => this.#install())
        .catch((error: unknown) => {
          unavailable(`the page script could not be added: ${messageOf(error)}`);
        });
    });
  }
}
