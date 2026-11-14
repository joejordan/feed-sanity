import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  answerEvent,
  askEvent,
  CONNECT_EVENT,
  connectedEvent,
  messageEvent,
  READY_EVENT,
} from './bridge-protocol';
import { servePageWorld } from './page-world';

/**
 * A channel of the test's own. A page-world side from an earlier test is
 * connected to that test's channel, so it does not answer on this one.
 */
const newChannel = (): string => `feed-sanity-${crypto.randomUUID()}`;

/** Every answer sent on `element` on `channel`, as parsed JSON. */
function answersOn(element: Element, channel: string): unknown[] {
  const answers: unknown[] = [];
  element.addEventListener(answerEvent(channel), (event) => {
    answers.push(JSON.parse((event as CustomEvent<string>).detail));
  });
  return answers;
}

const connect = (channel: string): void => {
  document.dispatchEvent(messageEvent(CONNECT_EVENT, { channel }));
};

const ask = (element: Element, message: Record<string, unknown>, channel: string): void => {
  element.dispatchEvent(messageEvent(askEvent(channel), message));
};

describe('servePageWorld', () => {
  let element: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<div id="asked"></div>';
    element = document.querySelector('#asked') as HTMLElement;
  });

  it('says it is ready, then connects to the first channel it is sent and lists its readers', () => {
    const channel = newChannel();
    const ready = vi.fn();
    const connected = vi.fn();
    document.addEventListener(READY_EVENT, ready);
    document.addEventListener(connectedEvent(channel), (event) =>
      connected(JSON.parse((event as CustomEvent<string>).detail)),
    );

    servePageWorld({ first: () => 1, second: () => 2 });
    expect(ready).toHaveBeenCalledTimes(1);
    connect(channel);

    expect(connected).toHaveBeenCalledExactlyOnceWith({ readers: ['first', 'second'] });
    document.removeEventListener(READY_EVENT, ready);
  });

  it('answers a question with the named reader, run on the element it was asked on', () => {
    const channel = newChannel();
    const reader = vi.fn((asked: Element) => ({ id: asked.id }));
    servePageWorld({ 'element-id': reader });
    connect(channel);
    const answers = answersOn(element, channel);

    ask(element, { id: 7, reader: 'element-id' }, channel);

    expect(answers).toEqual([{ id: 7, value: { id: 'asked' } }]);
    expect(reader).toHaveBeenCalledExactlyOnceWith(element);
  });

  it('runs nothing but its own readers', () => {
    const reader = vi.fn(() => 1);
    servePageWorld({ only: reader });
    const channel = newChannel();
    connect(channel);
    const answers = answersOn(element, channel);

    for (const name of ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'alert(1)']) {
      ask(element, { id: 1, reader: name }, channel);
    }
    ask(element, { id: 2, reader: { toString: 'only' } }, channel);

    expect(answers).toEqual(
      [1, 1, 1, 1, 1, 2].map((id) => ({ id, error: 'there is no such reader' })),
    );
    expect(reader).not.toHaveBeenCalled();
  });

  it('reports a reader that throws, or returns what cannot be sent, as failed', () => {
    const channel = newChannel();
    servePageWorld({
      throws: () => {
        throw new Error('a getter threw');
      },
      cycle: () => {
        const value: Record<string, unknown> = {};
        value.self = value;
        return value;
      },
      nothing: () => undefined,
    });
    connect(channel);
    const answers = answersOn(element, channel);

    ask(element, { id: 1, reader: 'throws' }, channel);
    ask(element, { id: 2, reader: 'cycle' }, channel);
    ask(element, { id: 3, reader: 'nothing' }, channel);

    expect(answers).toEqual([
      { id: 1, error: 'the reader failed' },
      { id: 2, error: 'the reader failed' },
      { id: 3, value: null },
    ]);
  });

  it('ignores a second channel, a channel of the wrong form, and questions that are not JSON', () => {
    const reader = vi.fn(() => 1);
    servePageWorld({ reader });
    const first = newChannel();
    const second = newChannel();
    connect('feed-sanity-not-a-uuid');
    connect(first);
    connect(second);
    const onFirst = answersOn(element, first);
    const onSecond = answersOn(element, second);

    ask(element, { id: 1, reader: 'reader' }, second);
    element.dispatchEvent(new CustomEvent(askEvent(first), { detail: '{not json' }));
    element.dispatchEvent(
      new CustomEvent(askEvent(first), { detail: { id: 1, reader: 'reader' } }),
    );
    ask(element, { id: 'one', reader: 'reader' }, first);
    ask(element, { id: 2, reader: 'reader' }, first);

    expect(onSecond).toEqual([]);
    expect(onFirst).toEqual([{ id: 2, value: 1 }]);
  });

  it('defines no global', () => {
    const before = Object.getOwnPropertyNames(globalThis);

    servePageWorld({ reader: () => 1 });
    connect(newChannel());

    expect(Object.getOwnPropertyNames(globalThis)).toEqual(before);
  });
});
