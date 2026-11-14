// What the two sides of the page-world bridge say to each other. Both
// `src/core/bridge.ts`, in the content script, and `src/core/page-world.ts`,
// in the page's own world, import it, so it stays small and imports nothing.
//
// Every message is an event whose `detail` is a JSON string. A string crosses
// from one world to the other as it is in every browser, where an object may
// arrive empty or not at all.

/**
 * Sent on `document` by the page-world side when it starts, so that a
 * content side that started first sends `CONNECT_EVENT` again.
 */
export const READY_EVENT = 'feed-sanity-page-world-ready';

/**
 * Sent on `document` by the content side with `{ "channel": "..." }`. The
 * page-world side takes the first one it is given and stops listening for
 * more. Every later message goes by that channel's names.
 */
export const CONNECT_EVENT = 'feed-sanity-page-world-connect';

/** A channel name: this project's prefix and a random UUID, made fresh on each page load. */
export const CHANNEL = /^feed-sanity-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Sent on `document` by the page-world side once connected, with `{ "readers": [...] }`. */
export const connectedEvent = (channel: string): string => `${channel}-connected`;

/** Sent on the element asked about, with `{ "id": 1, "reader": "..." }`. */
export const askEvent = (channel: string): string => `${channel}-ask`;

/**
 * Sent on the same element in reply, with `{ "id": 1, "value": ... }`, or
 * `{ "id": 1, "error": "..." }` when the reader is not known or failed.
 */
export const answerEvent = (channel: string): string => `${channel}-answer`;

export type Message = Record<string, unknown>;

/** The message in an event's `detail`, or undefined when it is not a JSON object. */
export function readMessage(event: Event): Message | undefined {
  const { detail } = event as CustomEvent<unknown>;
  if (typeof detail !== 'string') {
    return undefined;
  }
  let message: unknown;
  try {
    message = JSON.parse(detail);
  } catch {
    return undefined;
  }
  return typeof message === 'object' && message !== null && !Array.isArray(message)
    ? (message as Message)
    : undefined;
}

/**
 * An event that carries `message` as JSON. It does not bubble, so listeners
 * on the page's elements above it hear it only if they listen in the
 * capture phase.
 */
export const messageEvent = (type: string, message: Message): CustomEvent<string> =>
  new CustomEvent(type, { detail: JSON.stringify(message) });
