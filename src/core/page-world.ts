// The page-world side of the bridge. It runs in the page's own world, with
// the page's privileges and in the page's sight, so it is kept small: it
// imports only the protocol, reads what its readers read, and changes
// nothing in the page. Read `src/core/bridge.ts` for the content side.

import {
  answerEvent,
  askEvent,
  CHANNEL,
  CONNECT_EVENT,
  connectedEvent,
  messageEvent,
  READY_EVENT,
  readMessage,
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

/** The answer to one question, as the JSON text sent back. */
function answer(readers: PageReaders, element: Element, id: number, reader: unknown): string {
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

/**
 * Serves `readers` to the content side. It announces itself with
 * `READY_EVENT`, takes the first channel it is sent with `CONNECT_EVENT`,
 * and from then on answers each question asked on that channel by running
 * the named reader on the element the question was sent on.
 *
 * It never runs code or looks up names it is sent, apart from choosing one
 * of `readers`, and it defines no global. Questions are answered at once,
 * while the content side's `dispatchEvent` call is still running.
 */
export function servePageWorld(readers: PageReaders): void {
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
        const detail = answer(readers, target, message.id, message.reader);
        target.dispatchEvent(new CustomEvent(answerEvent(channel), { detail }));
      },
      true,
    );
    document.dispatchEvent(
      messageEvent(connectedEvent(channel), { readers: Object.keys(readers) }),
    );
  };
  document.addEventListener(CONNECT_EVENT, connect, true);
  document.dispatchEvent(new CustomEvent(READY_EVENT));
}
