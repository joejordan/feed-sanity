import { act } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OverlayOptions } from './overlay';
import { sleep } from '../core/timing';
import { FakeResizeObserver, placeAt } from '../facebook/testing';
import { HOST_TAG } from './mount';
import { mountOverlay } from './overlay';

/** Flushes the page watcher and the check it queues. */
const settle = () => sleep(10);

describe('mountOverlay', () => {
  let container: HTMLElement;
  let target: HTMLElement;
  let removes: (() => void)[];

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    document.body.innerHTML =
      '<div id="post"><div id="player"><div id="frame"><video></video></div><div id="layer"></div></div></div>';
    container = document.querySelector('#player') as HTMLElement;
    target = document.querySelector('video') as HTMLElement;
    removes = [];
  });

  afterEach(() => {
    act(() => {
      for (const remove of removes) {
        remove();
      }
    });
    vi.unstubAllGlobals();
  });

  const show = (options: OverlayOptions = { container: () => container }): HTMLElement => {
    act(() => {
      removes.push(mountOverlay(target, <button type="button">Seek</button>, options));
    });
    const host = document.querySelector<HTMLElement>(HOST_TAG);
    if (!host) {
      throw new Error('no host');
    }
    return host;
  };

  it("goes last in the container, marked as this project's, with the UI in a shadow root", () => {
    const host = show();

    expect(container.lastElementChild).toBe(host);
    expect(host.hasAttribute('data-feed-sanity')).toBe(true);
    expect(host.shadowRoot?.querySelector('button')?.textContent).toBe('Seek');
    expect(host.style.pointerEvents).toBe('none');
    expect(host.style.position).toBe('absolute');
  });

  it("goes in the target's parent by default", () => {
    const host = show({});

    expect(host.parentElement?.id).toBe('frame');
  });

  it('takes the place and size of the target when they are reported', () => {
    const host = show();
    placeAt(target, 110, 220, 400, 300);
    // Where the host's containing block starts.
    placeAt(host, 100, 200, 0, 0);

    FakeResizeObserver.latest?.report();

    expect([host.style.left, host.style.top, host.style.width, host.style.height]).toEqual([
      '10px',
      '20px',
      '400px',
      '300px',
    ]);
    expect(FakeResizeObserver.latest?.observed).toEqual(new Set([container, target]));
  });

  it('calls onMeasure before it moves any host, and measures again when asked', () => {
    const widths: string[] = [];
    let host: HTMLElement | undefined;
    const overlay = mountOverlay(target, <p>Bar</p>, {
      container: () => container,
      onMeasure: () => widths.push(host?.style.width ?? ''),
    });
    removes.push(overlay);
    host = document.querySelector<HTMLElement>(HOST_TAG) ?? undefined;
    placeAt(target, 0, 0, 400, 300);
    placeAt(host as Element, 0, 0, 0, 0);
    const observer = FakeResizeObserver.latest;

    observer?.report();
    expect(widths).toEqual(['0px']);
    expect(host?.style.width).toBe('400px');

    overlay.measure();
    expect(observer?.pending.has(target)).toBe(true);
    observer?.report([target]);
    expect(widths).toHaveLength(2);

    // A containing block further up that changes size moves the host and nothing else.
    const post = document.querySelector('#post') as HTMLElement;
    Object.defineProperty(host, 'offsetParent', { get: () => post, configurable: true });
    observer?.report([target]);
    observer?.report([post]);
    expect(widths).toHaveLength(3);
  });

  it('also follows the size of a containing block further up', () => {
    const host = show();
    const post = document.querySelector('#post') as HTMLElement;
    Object.defineProperty(host, 'offsetParent', { get: () => post, configurable: true });

    FakeResizeObserver.latest?.report();

    expect(FakeResizeObserver.latest?.observed).toEqual(new Set([container, target, post]));
    act(() => removes.pop()?.());
    expect(FakeResizeObserver.latest?.observed.size ?? 0).toBe(0);
  });

  it('is put back when it is removed while the target stays', async () => {
    const host = show();

    host.remove();
    await settle();

    expect(container.lastElementChild).toBe(host);
    expect(host.shadowRoot?.querySelector('button')).not.toBeNull();
  });

  it('follows the target to a new container', async () => {
    let current = container;
    const host = show({ container: () => current });
    const other = document.createElement('div');
    document.body.append(other);

    current = other;
    other.append(target);
    await settle();

    expect(host.parentElement).toBe(other);
    expect(FakeResizeObserver.latest?.observed.has(container)).toBe(false);
    expect(FakeResizeObserver.latest?.observed.has(other)).toBe(true);
  });

  it('is not put back once the target has left the page', async () => {
    const host = show();

    document.querySelector('#post')?.remove();
    document.body.append(container);
    target.remove();
    host.remove();
    await settle();

    expect(host.isConnected).toBe(false);
  });

  it('keeps presses, clicks and keys from the page, and lets pointer moves through', () => {
    const host = show();
    const heard: string[] = [];
    for (const type of ['pointerdown', 'click', 'keydown', 'pointermove']) {
      container.addEventListener(type, () => heard.push(type));
    }
    const button = host.shadowRoot?.querySelector('button') as HTMLElement;

    for (const type of ['pointerdown', 'click', 'pointermove']) {
      button.dispatchEvent(new MouseEvent(type, { bubbles: true, composed: true }));
    }
    button.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, composed: true }));

    expect(heard).toEqual(['pointermove']);
  });

  it('removes the host and stops watching sizes when removed', () => {
    const host = show();
    const observer = FakeResizeObserver.latest;

    act(() => removes.pop()?.());

    expect(host.isConnected).toBe(false);
    expect(host.shadowRoot?.querySelector('button')).toBeNull();
    expect(observer?.observed.size).toBe(0);
  });
});
