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
  disconnectEvent,
  isPlainObject,
  messageEvent,
  mountEvent,
  pushEvent,
  READY_EVENT,
  REPLACE_PAGE_WORLD_EVENT,
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
  /** Registers a cleanup callback invoked when this page-world instance is disposed or replaced. */
  onDispose: (callback: () => void) => void;
  /** Tears down all listeners, active mounts, enabled toggles, and registered cleanups. */
  dispose: () => void;
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
  const instanceId = crypto.randomUUID();
  // Tear down any previous page-world instance synchronously before binding
  // our own listeners or installing host hooks (fetch/XHR/attachShadow).
  document.dispatchEvent(new CustomEvent(REPLACE_PAGE_WORLD_EVENT, { detail: instanceId }));

  let disposed = false;
  let pushType: string | undefined;
  const bufferedEvents: Array<{ topic: string; payload: unknown }> = [];
  const cleanups: Array<() => void> = [];
  const disposeCallbacks: Array<() => void> = [];
  const enabledToggles = new Set<string>();

  const dispatchPush = (type: string, topic: string, payload: unknown): void => {
    if (disposed) {
      return;
    }
    try {
      document.dispatchEvent(messageEvent(type, { topic, payload: payload ?? null }));
    } catch {
      // Ignore unserializable payloads.
    }
  };

  const dispose = (): void => {
    if (disposed) {
      return;
    }
    disposed = true;
    pushType = undefined;
    bufferedEvents.length = 0;
    for (const cleanup of cleanups.splice(0)) {
      try {
        cleanup();
      } catch {
        // Ignore teardown errors.
      }
    }
    for (const name of [...enabledToggles]) {
      enabledToggles.delete(name);
      const run = lookup(toggles, name);
      if (run) {
        try {
          void run(false);
        } catch {
          // Ignore toggle teardown errors.
        }
      }
    }
    for (const cb of disposeCallbacks.splice(0)) {
      try {
        cb();
      } catch {
        // Ignore teardown errors.
      }
    }
  };

  const emitter: PageWorldEmitter = {
    emit(topic, payload) {
      if (disposed) {
        return;
      }
      if (pushType) {
        dispatchPush(pushType, topic, payload);
        return;
      }
      if (bufferedEvents.length >= MAX_BUFFERED_EVENTS) {
        bufferedEvents.shift();
      }
      bufferedEvents.push({ topic, payload });
    },
    onDispose(callback) {
      if (disposed) {
        try {
          callback();
        } catch {
          // Ignore teardown errors.
        }
        return;
      }
      disposeCallbacks.push(callback);
    },
    dispose,
  };

  const onReplace = (event: Event): void => {
    if ((event as CustomEvent<unknown>).detail !== instanceId) {
      dispose();
    }
  };
  document.addEventListener(REPLACE_PAGE_WORLD_EVENT, onReplace, true);
  cleanups.push(() => document.removeEventListener(REPLACE_PAGE_WORLD_EVENT, onReplace, true));

  const connect = (event: Event): void => {
    if (disposed) {
      return;
    }
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

    cleanups.push(() => {
      if (disconnectTimer !== undefined) {
        clearTimeout(disconnectTimer);
        disconnectTimer = undefined;
      }
      for (const mountId of [...activeMounts.keys()]) {
        releaseMount(mountId);
      }
      for (const observer of disconnectObservers.values()) {
        observer.disconnect();
      }
      disconnectObservers.clear();
      rootRefCounts.clear();
    });

    const scheduleDisconnectCheck = (records: readonly MutationRecord[]): void => {
      if (disposed || !records.some((record) => record.removedNodes.length > 0)) {
        return;
      }
      // Defer past microtasks so content-script `mountSlot` re-attachment
      // completes before deciding a slot was truly removed.
      if (disconnectTimer !== undefined) {
        return;
      }
      disconnectTimer = setTimeout(() => {
        disconnectTimer = undefined;
        if (disposed) {
          return;
        }
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
      const listener = (request: Event): void => {
        if (disposed) {
          return;
        }
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
      };
      document.addEventListener(type, listener, true);
      cleanups.push(() => document.removeEventListener(type, listener, true));
    };

    const onDocument = (
      type: string,
      handle: (id: number, message: Record<string, unknown>) => void,
    ): void => {
      const listener = (request: Event): void => {
        if (disposed) {
          return;
        }
        const message = readMessage(request);
        if (request.target !== document || typeof message?.id !== 'number') {
          return;
        }
        handle(message.id, message);
      };
      document.addEventListener(type, listener, true);
      cleanups.push(() => document.removeEventListener(type, listener, true));
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
      const name = typeof message.toggle === 'string' ? message.toggle : undefined;
      const run = lookup(toggles, name);
      if (!run || !name) {
        sendError(document, id, 'there is no such toggle');
        return;
      }
      if (typeof message.enabled !== 'boolean') {
        sendError(document, id, 'enabled must be a boolean');
        return;
      }
      const enabled = message.enabled;
      if (enabled) {
        enabledToggles.add(name);
      } else {
        enabledToggles.delete(name);
      }
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
          if (disposed || !target.isConnected) {
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

    const onDisconnect = (): void => {
      dispose();
    };
    const disconnectType = disconnectEvent(channel);
    document.addEventListener(disconnectType, onDisconnect, true);
    cleanups.push(() => document.removeEventListener(disconnectType, onDisconnect, true));

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
        if (disposed) {
          return;
        }
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
  cleanups.push(() => document.removeEventListener(CONNECT_EVENT, connect, true));
  document.dispatchEvent(new CustomEvent(READY_EVENT));
  return emitter;
}
