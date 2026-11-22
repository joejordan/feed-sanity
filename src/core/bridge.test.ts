import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { PageActions, PageReaders, PageToggles } from './page-world';
import { BridgeError, PageBridge } from './bridge';
import {
  answerEvent,
  askEvent,
  CONNECT_EVENT,
  connectedEvent,
  messageEvent,
  READY_EVENT,
  readMessage,
} from './bridge-protocol';
import { createLogger } from './log';
import { servePageWorld } from './page-world';

const serve =
  (
    readers: PageReaders,
    toggles: PageToggles = {},
    actions: PageActions = {},
  ): (() => Promise<void>) =>
  () => {
    servePageWorld(readers, toggles, actions);
    return Promise.resolve();
  };

/** The channel the content side sends with its next connect. */
function nextChannel(): Promise<string> {
  return new Promise((resolve) => {
    const heard = (event: Event): void => {
      const channel = readMessage(event)?.channel;
      if (typeof channel === 'string') {
        document.removeEventListener(CONNECT_EVENT, heard);
        resolve(channel);
      }
    };
    document.addEventListener(CONNECT_EVENT, heard);
  });
}

describe('PageBridge', () => {
  let video: HTMLVideoElement;
  let errors: Mock<(...args: unknown[]) => void>;
  const log = { ...createLogger('test'), error: (...args: unknown[]) => errors(...args) };

  beforeEach(() => {
    document.body.innerHTML = '<video></video>';
    video = document.querySelector('video') as HTMLVideoElement;
    errors = vi.fn();
  });

  /** Every bridge a test made. One still connecting would answer the next test's page-world side. */
  const bridges: PageBridge[] = [];
  const make = (...args: ConstructorParameters<typeof PageBridge>): PageBridge => {
    const bridge = new PageBridge(...args);
    bridges.push(bridge);
    return bridge;
  };

  afterEach(async () => {
    vi.useRealTimers();
    await vi.waitFor(() => {
      expect(bridges.filter((bridge) => bridge.status().state === 'connecting')).toEqual([]);
    });
    bridges.length = 0;
  });

  it('does nothing until it is first used', () => {
    const install = vi.fn(() => Promise.resolve());
    const bridge = make(install, { log });

    expect(bridge.status()).toEqual({
      state: 'not started',
      problem: null,
      readers: [],
      toggles: [],
      actions: [],
      mounts: [],
    });
    expect(install).not.toHaveBeenCalled();
  });

  it('connects to a page-world side it installs, and asks it about an element', async () => {
    const bridge = make(serve({ tag: (element) => element.tagName }), { log });
    const states: string[] = [];
    bridge.onStatus((status) => states.push(status.state));

    expect(await bridge.ask(video, 'tag')).toBe('VIDEO');
    expect(bridge.status()).toEqual({
      state: 'connected',
      problem: null,
      readers: ['tag'],
      toggles: [],
      actions: [],
      mounts: [],
    });
    expect(states).toEqual(['connecting', 'connected']);
    expect(errors).not.toHaveBeenCalled();
  });

  it('connects to a page-world side that was there before it', async () => {
    servePageWorld({ early: () => 'here' });
    const bridge = make(() => Promise.resolve(), { log });

    expect(await bridge.ask(video, 'early')).toBe('here');
  });

  it('connects again when a page-world side starts after its first connect', async () => {
    let start = (): void => undefined;
    const bridge = make(
      () =>
        new Promise((resolve) => {
          // As a script loaded from a blob: address runs a little later.
          start = () => {
            servePageWorld({ late: () => 'late' });
            resolve();
          };
        }),
      { log },
    );
    const asked = bridge.ask(video, 'late');
    await vi.waitFor(() => expect(bridge.status().state).toBe('connecting'));

    start();

    expect(await asked).toBe('late');
  });

  it('uses a new random channel on each page load', async () => {
    const first = nextChannel();
    void make(() => Promise.resolve(), { log, connectMs: 10 }).onStatus(() => undefined);
    const second = nextChannel();
    void make(() => Promise.resolve(), { log, connectMs: 10 }).onStatus(() => undefined);

    const channels = [await first, await second];

    expect(channels[0]).not.toBe(channels[1]);
    for (const channel of channels) {
      expect(channel).toMatch(/^feed-sanity-[0-9a-f-]{36}$/);
    }
  });

  it('is unavailable when the page script cannot be added, says so once, and answers nothing', async () => {
    const bridge = make(() => Promise.reject(new Error('blocked by CSP')), { log });

    await expect(bridge.ask(video, 'tag')).rejects.toMatchObject({ failure: 'unavailable' });
    await expect(bridge.ask(video, 'tag')).rejects.toBeInstanceOf(BridgeError);

    expect(bridge.status()).toEqual({
      state: 'unavailable',
      problem: 'the page script could not be added: blocked by CSP',
      readers: [],
      toggles: [],
      actions: [],
      mounts: [],
    });
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it('is unavailable when the page script never answers', async () => {
    vi.useFakeTimers();
    const bridge = make(() => Promise.resolve(), { log, connectMs: 5000 });
    const asked = bridge.ask(video, 'tag');
    const failed = expect(asked).rejects.toMatchObject({ failure: 'unavailable' });

    await vi.advanceTimersByTimeAsync(5000);

    await failed;
    expect(bridge.status().problem).toBe('the page script did not answer');
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it('gives up on a question that gets no answer', async () => {
    vi.useFakeTimers();
    const channel = nextChannel();
    const bridge = make(serve({ slow: () => 1 }), { log, answerMs: 2000 });
    await bridge.ask(video, 'slow');
    // The next question goes unanswered, as if the page-world side had stopped.
    const swallow = (event: Event): void => event.stopImmediatePropagation();
    addEventListener(askEvent(await channel), swallow, { capture: true });
    const asked = bridge.ask(video, 'slow');
    const failed = expect(asked).rejects.toMatchObject({ failure: 'timeout' });

    await vi.advanceTimersByTimeAsync(2000);

    await failed;
    removeEventListener(askEvent(await channel), swallow, { capture: true });
  });

  it('withdraws a question when its signal aborts, and asks nothing when it already has', async () => {
    // Short, so it stops listening before the next test.
    const bridge = make(() => new Promise(() => undefined), { log, connectMs: 10 });
    const controller = new AbortController();
    const asked = bridge.ask(video, 'tag', controller.signal);

    controller.abort();

    await expect(asked).rejects.toMatchObject({ failure: 'cancelled' });
    await expect(bridge.ask(video, 'tag', controller.signal)).rejects.toMatchObject({
      failure: 'cancelled',
    });
  });

  it('refuses a reader the page-world side does not have, and an element not in the page', async () => {
    const bridge = make(serve({ tag: (element) => element.tagName }), { log });

    await expect(bridge.ask(video, 'other')).rejects.toMatchObject({ failure: 'failed' });
    await expect(bridge.ask(document.createElement('div'), 'tag')).rejects.toMatchObject({
      failure: 'detached',
    });
  });

  it('rejects when the reader failed', async () => {
    const bridge = make(
      serve({
        broken: () => {
          throw new Error('no fiber');
        },
      }),
      { log },
    );

    await expect(bridge.ask(video, 'broken')).rejects.toMatchObject({ failure: 'failed' });
  });

  it('ignores answers that are not for its question, and takes the first that is', async () => {
    const connecting = nextChannel();
    const bridge = make(serve({ real: () => 'real' }), { log });
    await bridge.ask(video, 'real');
    const channel = await connecting;
    // Something in the page answers first, with the wrong id, then with no JSON, then as if real.
    addEventListener(
      askEvent(channel),
      (event) => {
        const id = readMessage(event)?.id;
        video.dispatchEvent(messageEvent(answerEvent(channel), { id: 999, value: 'wrong id' }));
        video.dispatchEvent(new CustomEvent(answerEvent(channel), { detail: '{oops' }));
        video.dispatchEvent(
          new CustomEvent(answerEvent(channel), { detail: { id, value: 'object' } }),
        );
        video.dispatchEvent(messageEvent(answerEvent(channel), { id, value: 'spoofed' }));
      },
      { capture: true, once: true },
    );

    // The answer is untrusted data: the bridge hands it on, and the caller checks it.
    expect(await bridge.ask(video, 'real')).toBe('spoofed');
  });

  it('takes only a well-formed list of readers and toggles', async () => {
    vi.useFakeTimers();
    const bridge = make(() => Promise.resolve(), { log, connectMs: 1000 });
    const channel = nextChannel();
    bridge.onStatus(() => undefined);
    const name = connectedEvent(await channel);

    document.dispatchEvent(messageEvent(name, { readers: 'video-sources' }));
    document.dispatchEvent(messageEvent(name, { readers: [1, 2] }));
    document.dispatchEvent(messageEvent(name, { readers: ['tag'], toggles: 'stop' }));
    expect(bridge.status().state).toBe('connecting');
    document.dispatchEvent(messageEvent(name, { readers: ['tag'] }));

    expect(bridge.status()).toEqual({
      state: 'connected',
      problem: null,
      readers: ['tag'],
      toggles: [],
      actions: [],
      mounts: [],
    });
  });

  it('switches a named toggle on and off, and refuses an unknown one', async () => {
    const seen: boolean[] = [];
    const bridge = make(
      serve(
        {},
        {
          flag: (enabled) => {
            seen.push(enabled);
            return { enabled };
          },
        },
      ),
      { log },
    );

    expect(await bridge.set('flag', true)).toEqual({ enabled: true });
    expect(await bridge.set('flag', false)).toEqual({ enabled: false });
    expect(seen).toEqual([true, false]);
    expect(bridge.status().toggles).toEqual(['flag']);
    await expect(bridge.set('missing', true)).rejects.toMatchObject({ failure: 'failed' });
  });

  it('runs a named action with payload, and refuses an unknown one', async () => {
    const received: Record<string, unknown>[] = [];
    const bridge = make(
      serve(
        {},
        {},
        {
          open: (payload) => {
            received.push(payload);
            return { opened: true };
          },
        },
      ),
      { log },
    );

    expect(await bridge.run('open', { mode: 'feeling' })).toEqual({ opened: true });
    expect(received).toEqual([{ mode: 'feeling' }]);
    expect(bridge.status().actions).toEqual(['open']);
    await expect(bridge.run('missing')).rejects.toMatchObject({ failure: 'failed' });
  });

  it('mounts a lifecycle-managed target and auto-unmounts on explicit release or DOM disconnect', async () => {
    const unmounts: string[] = [];
    const bridge = make(
      () => {
        servePageWorld(
          {},
          {},
          {},
          {
            rail: (target) => {
              target.setAttribute('data-mounted', 'yes');
              return () => {
                unmounts.push(target.id);
                target.removeAttribute('data-mounted');
              };
            },
          },
        );
        return Promise.resolve();
      },
      { log },
    );

    const a = document.createElement('div');
    a.id = 'a';
    const b = document.createElement('div');
    b.id = 'b';
    document.body.append(a, b);

    const releaseA = await bridge.mount(a, 'rail');
    const releaseB = await bridge.mount(b, 'rail');
    expect(releaseA).toBeTypeOf('function');
    expect(releaseB).toBeTypeOf('function');
    expect(a.getAttribute('data-mounted')).toBe('yes');
    expect(bridge.status().mounts).toEqual(['rail']);

    // Double release is idempotent.
    releaseA?.();
    releaseA?.();
    await vi.waitFor(() => expect(unmounts).toEqual(['a']));
    expect(a.hasAttribute('data-mounted')).toBe(false);

    // Removing `b` from the DOM triggers the page-world disconnect guard.
    b.remove();
    await vi.waitFor(() => expect(unmounts).toEqual(['a', 'b']));
    releaseB?.();
    expect(unmounts).toEqual(['a', 'b']);
  });

  it('handles mount decline (null), throwing mounts, unknown mounts, and detached elements', async () => {
    const bridge = make(
      () => {
        servePageWorld(
          {},
          {},
          {},
          {
            declining: () => null,
            broken: () => {
              throw new Error('boom');
            },
          },
        );
        return Promise.resolve();
      },
      { log },
    );
    const connected = document.createElement('div');
    const detached = document.createElement('div');
    document.body.append(connected);

    expect(await bridge.mount(connected, 'declining')).toBeNull();
    await expect(bridge.mount(connected, 'broken')).rejects.toMatchObject({ failure: 'failed' });
    await expect(bridge.mount(connected, 'missing')).rejects.toMatchObject({ failure: 'failed' });
    await expect(bridge.mount(detached, 'declining')).rejects.toMatchObject({
      failure: 'detached',
    });
  });

  it('supports async handlers, document_start buffered push events, and open Shadow DOM targets', async () => {
    const bridge = make(
      () => {
        const emitter = servePageWorld(
          {
            asyncRead: (el) => Promise.resolve({ tag: el.tagName }),
          },
          {},
          {
            asyncAct: (payload) => Promise.resolve({ echoed: payload.n }),
          },
          {
            asyncMount: async () => {
              await Promise.resolve();
              return () => undefined;
            },
          },
        );
        // Buffered before handshake completes, flushed automatically on connect.
        emitter.emit('network:feed', { count: 3 });
        return Promise.resolve();
      },
      { log },
    );

    const pushed: unknown[] = [];
    bridge.on('network:feed', (payload) => pushed.push(payload));

    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const inner = document.createElement('section');
    shadow.append(inner);

    expect(await bridge.ask(inner, 'asyncRead')).toEqual({ tag: 'SECTION' });
    expect(await bridge.run('asyncAct', { n: 7 })).toEqual({ echoed: 7 });
    const unmount = await bridge.mount(inner, 'asyncMount');
    expect(unmount).toBeTypeOf('function');
    unmount?.();

    await vi.waitFor(() => expect(pushed).toEqual([{ count: 3 }]));
  });

  it('auto-unmounts Shadow DOM targets on inner removal and host removal, and handles async rejections/races', async () => {
    const unmounts: string[] = [];
    let resolveDelayed!: (fn: () => void) => void;
    let resolveCancelled!: (fn: () => void) => void;
    const bridge = make(
      () => {
        servePageWorld(
          {
            rejectRead: () => Promise.reject(new Error('async boom')),
          },
          {},
          {},
          {
            shadowMount: (target) => () => unmounts.push(target.id),
            delayedDisconnect: (target) =>
              new Promise((resolve) => {
                resolveDelayed = resolve;
                void target;
              }),
            delayedCancel: () =>
              new Promise((resolve) => {
                resolveCancelled = resolve;
              }),
          },
        );
        return Promise.resolve();
      },
      { log },
    );

    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const innerA = document.createElement('div');
    innerA.id = 'innerA';
    const innerB = document.createElement('div');
    innerB.id = 'innerB';
    shadow.append(innerA, innerB);

    await expect(bridge.ask(innerA, 'rejectRead')).rejects.toMatchObject({ failure: 'failed' });

    await bridge.mount(innerA, 'shadowMount');
    await bridge.mount(innerB, 'shadowMount');

    // Removing an element inside the ShadowRoot triggers auto-unmount.
    innerA.remove();
    await vi.waitFor(() => expect(unmounts).toEqual(['innerA']));

    // Removing the ShadowRoot host from light DOM also triggers auto-unmount.
    host.remove();
    await vi.waitFor(() => expect(unmounts).toEqual(['innerA', 'innerB']));

    // Async mount whose target disconnects before resolution auto-unmounts immediately.
    const transient = document.createElement('div');
    document.body.append(transient);
    const pendingDisconnect = bridge.mount(transient, 'delayedDisconnect');
    await vi.waitFor(() => expect(resolveDelayed).toBeTypeOf('function'));
    transient.remove();
    const cleanedOnDisconnect = vi.fn();
    resolveDelayed(cleanedOnDisconnect);
    expect(await pendingDisconnect).toBeNull();
    expect(cleanedOnDisconnect).toHaveBeenCalledTimes(1);

    // Aborted async mount that resolves later is automatically unmounted via late-answer cleanup.
    const kept = document.createElement('div');
    document.body.append(kept);
    const controller = new AbortController();
    const pendingCancel = bridge.mount(kept, 'delayedCancel', {}, controller.signal);
    await vi.waitFor(() => expect(resolveCancelled).toBeTypeOf('function'));
    controller.abort();
    await expect(pendingCancel).rejects.toMatchObject({ failure: 'cancelled' });
    const cleanedOnCancel = vi.fn();
    resolveCancelled(cleanedOnCancel);
    await vi.waitFor(() => expect(cleanedOnCancel).toHaveBeenCalledTimes(1));
  });

  it('delivers document_start buffered push events in FIFO order even when subscribed after connect', async () => {
    let emitter!: ReturnType<typeof servePageWorld>;
    const bridge = make(
      () => {
        emitter = servePageWorld({ ping: () => 'ok' });
        emitter.emit('net', { seq: 1 });
        emitter.emit('net', { seq: 2 });
        return Promise.resolve();
      },
      { log },
    );

    // Connect before any `bridge.on('net', ...)` listener exists.
    expect(await bridge.ask(video, 'ping')).toBe('ok');
    // Emit a third event right after connect before the microtask drain runs.
    emitter.emit('net', { seq: 3 });
    await Promise.resolve();
    await Promise.resolve();

    const received: unknown[] = [];
    const stop = bridge.on('net', (payload) => received.push(payload));
    expect(received).toEqual([{ seq: 1 }, { seq: 2 }, { seq: 3 }]);

    emitter.emit('net', { seq: 4 });
    expect(received).toEqual([{ seq: 1 }, { seq: 2 }, { seq: 3 }, { seq: 4 }]);
    stop();
  });

  it('listens for a late page-world side only while it connects', async () => {
    const bridge = make(serve({ tag: () => 1 }), { log });
    await bridge.ask(video, 'tag');
    const connects = vi.fn();
    document.addEventListener(CONNECT_EVENT, connects);

    document.dispatchEvent(new CustomEvent(READY_EVENT));

    expect(connects).not.toHaveBeenCalled();
    document.removeEventListener(CONNECT_EVENT, connects);
  });
});
