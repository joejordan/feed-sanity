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
  READY_EVENT,
  readMessage,
  toggleEvent,
  unmountEvent,
} from './bridge-protocol';

/**
 * Reads something about `element` that only the page's own world can see,
 * such as the data React keeps on it. It returns plain data that survives
 * `JSON.stringify`, and null when there is nothing to read. It must change
 * nothing.
 */
export type PageReader = (element: Element) => unknown;

/** The readers the page-world side offers, by name. Nothing else can be asked for. */
export type PageReaders = Readonly<Record<string, PageReader>>;

/**
 * Switches one named page-world behaviour on or off, returning plain data
 * that survives `JSON.stringify`, or null. Turning it off must undo what
 * turning it on did, with no page reload.
 */
export type PageToggle = (enabled: boolean) => unknown;

/** The toggles the page-world side offers, by name. Nothing else can be toggled. */
export type PageToggles = Readonly<Record<string, PageToggle>>;

/**
 * Runs one named page-world action with a plain JSON object payload and
 * returns plain data that survives `JSON.stringify`, or null.
 */
export type PageAction = (payload: Record<string, unknown>) => unknown;

/** The actions the page-world side offers, by name. Nothing else can be run. */
export type PageActions = Readonly<Record<string, PageAction>>;

/**
 * Mounts a named page-world UI (such as a native Facebook React/Relay
 * component) into `target`, returning an unmount function or null if the mount
 * could not start.
 */
export type PageMount = (target: Element, payload: Record<string, unknown>) => (() => void) | null;

/** The mounts the page-world side offers, by name. Nothing else can be mounted. */
export type PageMounts = Readonly<Record<string, PageMount>>;

function lookup<T>(map: Readonly<Record<string, T>>, name: unknown): T | undefined {
  return typeof name === 'string' && Object.hasOwn(map, name) ? map[name] : undefined;
}

/** The answer to one reader question, as the JSON text sent back. */
function answerReader(readers: PageReaders, element: Element, id: number, reader: unknown): string {
  const read = lookup(readers, reader);
  if (!read) {
    return JSON.stringify({ id, error: 'there is no such reader' });
  }
  try {
    // A value that cannot be sent counts as a failed read.
    return JSON.stringify({ id, value: read(element) ?? null });
  } catch {
    return JSON.stringify({ id, error: 'the reader failed' });
  }
}

/** The answer to one toggle request, as the JSON text sent back. */
function answerToggle(toggles: PageToggles, id: number, toggle: unknown, enabled: unknown): string {
  const run = lookup(toggles, toggle);
  if (!run) {
    return JSON.stringify({ id, error: 'there is no such toggle' });
  }
  if (typeof enabled !== 'boolean') {
    return JSON.stringify({ id, error: 'enabled must be a boolean' });
  }
  try {
    return JSON.stringify({ id, value: run(enabled) ?? null });
  } catch {
    return JSON.stringify({ id, error: 'the toggle failed' });
  }
}

/** The answer to one action request, as the JSON text sent back. */
function answerAction(actions: PageActions, id: number, action: unknown, payload: unknown): string {
  const run = lookup(actions, action);
  if (!run) {
    return JSON.stringify({ id, error: 'there is no such action' });
  }
  if (!isPlainObject(payload)) {
    return JSON.stringify({ id, error: 'payload must be an object' });
  }
  try {
    return JSON.stringify({ id, value: run(payload) ?? null });
  } catch {
    return JSON.stringify({ id, error: 'the action failed' });
  }
}

/** The answer to one mount request, registering any live unmount callback via `register`. */
function answerMount(
  mounts: PageMounts,
  element: Element,
  id: number,
  mount: unknown,
  payload: unknown,
  register: (target: Element, unmount: () => void) => number,
): string {
  const fn = lookup(mounts, mount);
  if (!fn) {
    return JSON.stringify({ id, error: 'there is no such mount' });
  }
  if (!isPlainObject(payload)) {
    return JSON.stringify({ id, error: 'payload must be an object' });
  }
  try {
    const unmount = fn(element, payload);
    if (typeof unmount !== 'function') {
      return JSON.stringify({ id, value: null });
    }
    return JSON.stringify({ id, value: { mountId: register(element, unmount) } });
  } catch {
    return JSON.stringify({ id, error: 'the mount failed' });
  }
}

/**
 * Serves `readers`, `toggles`, `actions` and `mounts` to the content side. It
 * announces itself with `READY_EVENT`, takes the first channel it is sent with
 * `CONNECT_EVENT`, and from then on answers each request on that channel by
 * running the matching named handler.
 *
 * It never runs code or looks up names it is sent, apart from choosing one of
 * `readers`, `toggles`, `actions` or `mounts`, and it defines no global.
 * Requests are answered at once, while the content side's `dispatchEvent` call
 * is still running.
 */
export function servePageWorld(
  readers: PageReaders,
  toggles: PageToggles = {},
  actions: PageActions = {},
  mounts: PageMounts = {},
): void {
  const connect = (event: Event): void => {
    const channel = readMessage(event)?.channel;
    if (typeof channel !== 'string' || !CHANNEL.test(channel)) {
      return;
    }
    document.removeEventListener(CONNECT_EVENT, connect, true);

    const answer = answerEvent(channel);
    let nextMountId = 1;
    const activeMounts = new Map<number, { target: Element; unmount: () => void }>();
    let disconnectObserver: MutationObserver | undefined;
    let disconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const releaseMount = (mountId: number): boolean => {
      const entry = activeMounts.get(mountId);
      if (!entry) {
        return false;
      }
      activeMounts.delete(mountId);
      if (activeMounts.size === 0) {
        disconnectObserver?.disconnect();
        disconnectObserver = undefined;
        if (disconnectTimer !== undefined) {
          clearTimeout(disconnectTimer);
          disconnectTimer = undefined;
        }
      }
      try {
        entry.unmount();
      } catch {
        // Ignore teardown errors from page code.
      }
      return true;
    };

    const watchDisconnects = (): void => {
      if (disconnectObserver || !document.documentElement) {
        return;
      }
      disconnectObserver = new MutationObserver(() => {
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
      });
      disconnectObserver.observe(document.documentElement, { childList: true, subtree: true });
    };

    const registerMount = (target: Element, unmount: () => void): number => {
      const mountId = nextMountId++;
      activeMounts.set(mountId, { target, unmount });
      watchDisconnects();
      return mountId;
    };

    const onElement = (
      type: string,
      handle: (target: Element, id: number, message: Record<string, unknown>) => string,
    ): void => {
      document.addEventListener(
        type,
        (request) => {
          const { target } = request;
          const message = readMessage(request);
          if (!(target instanceof Element) || typeof message?.id !== 'number') {
            return;
          }
          target.dispatchEvent(
            new CustomEvent(answer, { detail: handle(target, message.id, message) }),
          );
        },
        true,
      );
    };

    const onDocument = (
      type: string,
      handle: (id: number, message: Record<string, unknown>) => string,
    ): void => {
      document.addEventListener(
        type,
        (request) => {
          const message = readMessage(request);
          if (request.target !== document || typeof message?.id !== 'number') {
            return;
          }
          document.dispatchEvent(new CustomEvent(answer, { detail: handle(message.id, message) }));
        },
        true,
      );
    };

    onElement(askEvent(channel), (target, id, message) =>
      answerReader(readers, target, id, message.reader),
    );
    onDocument(toggleEvent(channel), (id, message) =>
      answerToggle(toggles, id, message.toggle, message.enabled),
    );
    onDocument(actionEvent(channel), (id, message) =>
      answerAction(actions, id, message.action, message.payload ?? {}),
    );
    onElement(mountEvent(channel), (target, id, message) =>
      answerMount(mounts, target, id, message.mount, message.payload ?? {}, registerMount),
    );
    onDocument(unmountEvent(channel), (id, message) => {
      const removed = typeof message.mountId === 'number' ? releaseMount(message.mountId) : false;
      return JSON.stringify({ id, value: removed });
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
  };
  document.addEventListener(CONNECT_EVENT, connect, true);
  document.dispatchEvent(new CustomEvent(READY_EVENT));
}
