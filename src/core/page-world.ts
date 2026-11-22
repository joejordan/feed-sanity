// The page-world side of the bridge. It runs in the page's own world, with
// the page's privileges and in the page's sight, so it is kept small: it
// imports only the protocol and serves only the named readers and toggles
// written in this repo. Read `src/core/bridge.ts` for the content side.

import {
  actionEvent,
  answerEvent,
  askEvent,
  CHANNEL,
  CONNECT_EVENT,
  connectedEvent,
  messageEvent,
  READY_EVENT,
  readMessage,
  toggleEvent,
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

/** The answer to one reader question, as the JSON text sent back. */
function answerReader(readers: PageReaders, element: Element, id: number, reader: unknown): string {
  const read = typeof reader === 'string' && Object.hasOwn(readers, reader) && readers[reader];
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
  const run = typeof toggle === 'string' && Object.hasOwn(toggles, toggle) && toggles[toggle];
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
  const run = typeof action === 'string' && Object.hasOwn(actions, action) && actions[action];
  if (!run) {
    return JSON.stringify({ id, error: 'there is no such action' });
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return JSON.stringify({ id, error: 'payload must be an object' });
  }
  try {
    return JSON.stringify({ id, value: run(payload as Record<string, unknown>) ?? null });
  } catch {
    return JSON.stringify({ id, error: 'the action failed' });
  }
}

/**
 * Serves `readers`, `toggles` and `actions` to the content side. It announces
 * itself with `READY_EVENT`, takes the first channel it is sent with
 * `CONNECT_EVENT`, and from then on answers each question asked on that
 * channel by running the named reader on the element it was sent on, and each
 * toggle or action sent on `document` by running the named handler.
 *
 * It never runs code or looks up names it is sent, apart from choosing one of
 * `readers`, `toggles` or `actions`, and it defines no global. Requests are
 * answered at once, while the content side's `dispatchEvent` call is still
 * running.
 */
export function servePageWorld(
  readers: PageReaders,
  toggles: PageToggles = {},
  actions: PageActions = {},
): void {
  const connect = (event: Event): void => {
    const channel = readMessage(event)?.channel;
    if (typeof channel !== 'string' || !CHANNEL.test(channel)) {
      return;
    }
    document.removeEventListener(CONNECT_EVENT, connect, true);
    document.addEventListener(
      askEvent(channel),
      (ask) => {
        const { target } = ask;
        const message = readMessage(ask);
        if (!(target instanceof Element) || typeof message?.id !== 'number') {
          return;
        }
        const detail = answerReader(readers, target, message.id, message.reader);
        target.dispatchEvent(new CustomEvent(answerEvent(channel), { detail }));
      },
      true,
    );
    document.addEventListener(
      toggleEvent(channel),
      (request) => {
        const message = readMessage(request);
        if (request.target !== document || typeof message?.id !== 'number') {
          return;
        }
        const detail = answerToggle(toggles, message.id, message.toggle, message.enabled);
        document.dispatchEvent(new CustomEvent(answerEvent(channel), { detail }));
      },
      true,
    );
    document.addEventListener(
      actionEvent(channel),
      (request) => {
        const message = readMessage(request);
        if (request.target !== document || typeof message?.id !== 'number') {
          return;
        }
        const detail = answerAction(actions, message.id, message.action, message.payload ?? {});
        document.dispatchEvent(new CustomEvent(answerEvent(channel), { detail }));
      },
      true,
    );
    const toggleNames = Object.keys(toggles);
    const actionNames = Object.keys(actions);
    document.dispatchEvent(
      messageEvent(connectedEvent(channel), {
        readers: Object.keys(readers),
        ...(toggleNames.length > 0 ? { toggles: toggleNames } : {}),
        ...(actionNames.length > 0 ? { actions: actionNames } : {}),
      }),
    );
  };
  document.addEventListener(CONNECT_EVENT, connect, true);
  document.dispatchEvent(new CustomEvent(READY_EVENT));
}
