// The page-world side of the bridge. It runs in the page's own world, with
// the page's privileges and in the page's sight, so it is kept small: it
// imports only the protocol and serves only the named readers, toggles,
// actions and mounts written in this repo. Read `src/core/bridge.ts` for the
// content side.

import {
  actionEvent,
  answerEvent,
  askEvent,
  CHANNEL,
  CONNECT_EVENT,
  connectedEvent,
  isPlainObject,
  messageEvent,
  mountEvent,
  pushEvent,
  READY_EVENT,
  readMessage,
  toggleEvent,
  unmountEvent,
} from './bridge-protocol';

/**
 * Reads something about `element` that only the page's own world can see,
 * such as the data React keeps on it. May return plain data synchronously or
 * resolve asynchronously via a Promise. It must change nothing.
 */
export type PageReader = (element: Element) => unknown;

/** The readers the page-world side offers, by name. Nothing else can be asked for. */
export type PageReaders = Readonly<Record<string, PageReader>>;

/**
 * Switches one named page-world behaviour on or off, returning plain data
 * (synchronously or via Promise), or null. Turning it off must undo what
 * turning it on did, with no page reload.
 */
export type PageToggle = (enabled: boolean) => unknown;

/** The toggles the page-world side offers, by name. Nothing else can be toggled. */
export type PageToggles = Readonly<Record<string, PageToggle>>;

/**
 * Runs one named page-world action with a plain JSON object payload and
 * returns plain data (synchronously or via Promise), or null.
 */
export type PageAction = (payload: Record<string, unknown>) => unknown;

/** The actions the page-world side offers, by name. Nothing else can be run. */
export type PageActions = Readonly<Record<string, PageAction>>;

/**
 * Mounts a named page-world UI (such as a native React/Relay component) into
 * `target`, returning an unmount function or null (synchronously or via
 * Promise) if the mount could not start.
 */
export type PageMount = (
  target: Element,
  payload: Record<string, unknown>,
) => (() => void) | null | Promise<(() => void) | null>;

/** The mounts the page-world side offers, by name. Nothing else can be mounted. */
export type PageMounts = Readonly<Record<string, PageMount>>;

/** Handle returned by `servePageWorld` for pushing unsolicited events to the content script. */
export interface PageWorldEmitter {
  /**
   * Emits a named event to the content script. Events emitted at
   * `document_start` before the bridge handshake finishes are buffered in a
   * bounded ring buffer and delivered in order as soon as the channel connects.
   */
  emit: (topic: string, payload: unknown) => void;
}

const MAX_BUFFERED_EVENTS = 64;

function lookup<T>(map: Readonly<Record<string, T>>, name: unknown): T | undefined {
  return typeof name === 'string' && Object.hasOwn(map, name) ? map[name] : undefined;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function serializeValue(id: number, value: unknown, errorMessage: string): string {
  try {
    return JSON.stringify({ id, value: value ?? null });
  } catch {
    return JSON.stringify({ id, error: errorMessage });
  }
}

/** Sends a synchronous or async handler result back on `target` via `answerType`. */
function settleResult(
  target: EventTarget,
  answerType: string,
  id: number,
  run: () => unknown,
  errorMessage: string,
  format: (value: unknown) => string = (val) => serializeValue(id, val, errorMessage),
): void {
  const send = (detail: string): void => {
    target.dispatchEvent(new CustomEvent(answerType, { detail, composed: true }));
  };
  let result: unknown;
  try {
    result = run();
  } catch {
    send(JSON.stringify({ id, error: errorMessage }));
    return;
  }
  if (isPromiseLike(result)) {
    void Promise.resolve(result).then(
      (resolved) => send(format(resolved)),
      () => send(JSON.stringify({ id, error: errorMessage })),
    );
    return;
  }
  send(format(result));
}

/**
 * Serves `readers`, `toggles`, `actions` and `mounts` to the content side,
 * supporting both fast synchronous replies and Promise-returning async
 * handlers. Returns a `PageWorldEmitter` for pushing unsolicited events
 * (such as `document_start` network tap captures) back to the content script.
 */
export function servePageWorld(
  readers: PageReaders,
  toggles: PageToggles = {},
  actions: PageActions = {},
  mounts: PageMounts = {},
): PageWorldEmitter {
  let pushType: string | undefined;
  const bufferedEvents: Array<{ topic: string; payload: unknown }> = [];

  const dispatchPush = (type: string, topic: string, payload: unknown): void => {
    try {
      document.dispatchEvent(messageEvent(type, { topic, payload: payload ?? null }));
    } catch {
      // Ignore unserializable payloads.
    }
  };

  const emitter: PageWorldEmitter = {
    emit(topic, payload) {
      if (pushType) {
        dispatchPush(pushType, topic, payload);
        return;
      }
      if (bufferedEvents.length >= MAX_BUFFERED_EVENTS) {
        bufferedEvents.shift();
      }
      bufferedEvents.push({ topic, payload });
    },
  };

  const connect = (event: Event): void => {
    const channel = readMessage(event)?.channel;
    if (typeof channel !== 'string' || !CHANNEL.test(channel)) {
      return;
    }
    document.removeEventListener(CONNECT_EVENT, connect, true);

    const answer = answerEvent(channel);
    const resolvedPushType = pushEvent(channel);
    let nextMountId = 1;
    const activeMounts = new Map<
      number,
      { target: Element; roots: readonly Node[]; unmount: () => void }
    >();
    const rootRefCounts = new Map<Node, number>();
    const disconnectObservers = new Map<Node, MutationObserver>();
    let disconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const rootChain = (target: Element): Node[] => {
      const roots: Node[] = [];
      let current: Node = target;
      while (true) {
        const root = current.getRootNode();
        if (root.nodeType === Node.DOCUMENT_NODE) {
          const docRoot = (root as Document).documentElement ?? root;
          if (!roots.includes(docRoot)) {
            roots.push(docRoot);
          }
          break;
        }
        if (root.nodeType === Node.DOCUMENT_FRAGMENT_NODE && 'host' in root) {
          if (!roots.includes(root)) {
            roots.push(root);
          }
          current = (root as ShadowRoot).host;
          continue;
        }
        break;
      }
      return roots;
    };

    const releaseMount = (mountId: number): boolean => {
      const entry = activeMounts.get(mountId);
      if (!entry) {
        return false;
      }
      activeMounts.delete(mountId);
      for (const root of entry.roots) {
        const nextCount = (rootRefCounts.get(root) ?? 1) - 1;
        if (nextCount <= 0) {
          rootRefCounts.delete(root);
          disconnectObservers.get(root)?.disconnect();
          disconnectObservers.delete(root);
        } else {
          rootRefCounts.set(root, nextCount);
        }
      }
      if (activeMounts.size === 0 && disconnectTimer !== undefined) {
        clearTimeout(disconnectTimer);
        disconnectTimer = undefined;
      }
      try {
        entry.unmount();
      } catch {
        // Ignore teardown errors from page code.
      }
      return true;
    };

    const scheduleDisconnectCheck = (records: readonly MutationRecord[]): void => {
      if (!records.some((record) => record.removedNodes.length > 0)) {
        return;
      }
      // Defer past microtasks so content-script `mountSlot` re-attachment
      // completes before deciding a slot was truly removed.
      if (disconnectTimer !== undefined) {
        return;
      }
      disconnectTimer = setTimeout(() => {
        disconnectTimer = undefined;
        for (const [id, { target }] of activeMounts) {
          if (!target.isConnected) {
            releaseMount(id);
          }
        }
      }, 0);
    };

    const watchDisconnects = (roots: readonly Node[]): void => {
      for (const root of roots) {
        const prev = rootRefCounts.get(root) ?? 0;
        rootRefCounts.set(root, prev + 1);
        if (prev === 0) {
          const observer = new MutationObserver(scheduleDisconnectCheck);
          observer.observe(root, { childList: true, subtree: true });
          disconnectObservers.set(root, observer);
        }
      }
    };

    const registerMount = (target: Element, unmount: () => void): number => {
      const mountId = nextMountId++;
      const roots = rootChain(target);
      activeMounts.set(mountId, { target, roots, unmount });
      watchDisconnects(roots);
      return mountId;
    };

    const sendError = (target: EventTarget, id: number, error: string): void => {
      target.dispatchEvent(messageEvent(answer, { id, error }));
    };

    const onElement = (
      type: string,
      handle: (target: Element, id: number, message: Record<string, unknown>) => void,
    ): void => {
      document.addEventListener(
        type,
        (request) => {
          let target = request.target;
          // Only allocate `composedPath()` when the event may have crossed an open Shadow Root.
          if (!(target instanceof Element) || target.shadowRoot !== null) {
            const first = request.composedPath()[0];
            if (first instanceof Element) {
              target = first;
            }
          }
          const message = readMessage(request);
          if (!(target instanceof Element) || typeof message?.id !== 'number') {
            return;
          }
          handle(target, message.id, message);
        },
        true,
      );
    };

    const onDocument = (
      type: string,
      handle: (id: number, message: Record<string, unknown>) => void,
    ): void => {
      document.addEventListener(
        type,
        (request) => {
          const message = readMessage(request);
          if (request.target !== document || typeof message?.id !== 'number') {
            return;
          }
          handle(message.id, message);
        },
        true,
      );
    };

    onElement(askEvent(channel), (target, id, message) => {
      const read = lookup(readers, message.reader);
      if (!read) {
        sendError(target, id, 'there is no such reader');
        return;
      }
      settleResult(target, answer, id, () => read(target), 'the reader failed');
    });

    onDocument(toggleEvent(channel), (id, message) => {
      const run = lookup(toggles, message.toggle);
      if (!run) {
        sendError(document, id, 'there is no such toggle');
        return;
      }
      if (typeof message.enabled !== 'boolean') {
        sendError(document, id, 'enabled must be a boolean');
        return;
      }
      const enabled = message.enabled;
      settleResult(document, answer, id, () => run(enabled), 'the toggle failed');
    });

    onDocument(actionEvent(channel), (id, message) => {
      const run = lookup(actions, message.action);
      if (!run) {
        sendError(document, id, 'there is no such action');
        return;
      }
      const payload = message.payload ?? {};
      if (!isPlainObject(payload)) {
        sendError(document, id, 'payload must be an object');
        return;
      }
      settleResult(document, answer, id, () => run(payload), 'the action failed');
    });

    onElement(mountEvent(channel), (target, id, message) => {
      const fn = lookup(mounts, message.mount);
      if (!fn) {
        sendError(target, id, 'there is no such mount');
        return;
      }
      const payload = message.payload ?? {};
      if (!isPlainObject(payload)) {
        sendError(target, id, 'payload must be an object');
        return;
      }
      settleResult(
        target,
        answer,
        id,
        () => fn(target, payload),
        'the mount failed',
        (unmount) => {
          if (typeof unmount !== 'function') {
            return JSON.stringify({ id, value: null });
          }
          if (!target.isConnected) {
            try {
              (unmount as () => void)();
            } catch {
              // Ignore teardown errors from page code.
            }
            return JSON.stringify({ id, value: null });
          }
          return JSON.stringify({
            id,
            value: { mountId: registerMount(target, unmount as () => void) },
          });
        },
      );
    });

    onDocument(unmountEvent(channel), (id, message) => {
      const removed = typeof message.mountId === 'number' ? releaseMount(message.mountId) : false;
      document.dispatchEvent(messageEvent(answer, { id, value: removed }));
    });

    const toggleNames = Object.keys(toggles);
    const actionNames = Object.keys(actions);
    const mountNames = Object.keys(mounts);
    document.dispatchEvent(
      messageEvent(connectedEvent(channel), {
        readers: Object.keys(readers),
        ...(toggleNames.length > 0 ? { toggles: toggleNames } : {}),
        ...(actionNames.length > 0 ? { actions: actionNames } : {}),
        ...(mountNames.length > 0 ? { mounts: mountNames } : {}),
      }),
    );

    // Flush any `document_start` boot events buffered before the handshake,
    // keeping `pushType` unset until drained so strict FIFO order is preserved.
    if (bufferedEvents.length > 0) {
      queueMicrotask(() => {
        while (bufferedEvents.length > 0) {
          const item = bufferedEvents.shift();
          if (item) {
            dispatchPush(resolvedPushType, item.topic, item.payload);
          }
        }
        pushType = resolvedPushType;
      });
    } else {
      pushType = resolvedPushType;
    }
  };
  document.addEventListener(CONNECT_EVENT, connect, true);
  document.dispatchEvent(new CustomEvent(READY_EVENT));
  return emitter;
}
