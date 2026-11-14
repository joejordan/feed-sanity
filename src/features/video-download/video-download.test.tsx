import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { PageWorld } from '../../facebook/feature';
import { startFeatures } from '../../core/app';
import { Options } from '../../core/options';
import { SavedData } from '../../core/saved';
import { bindPage } from '../../facebook/feature';
import {
  addStory,
  FakeResizeObserver,
  fakeVideo,
  placeAt,
  testBridge,
  videoPage,
} from '../../facebook/testing';
import { extensionStore } from '../../platform/extension-store';
import { HOST_TAG } from '../../ui/mount';
import videoDownload from '.';
import {
  NOT_YET,
  OPENED,
  PRESS_AGAIN,
  STOPPED,
  TIP_DELAY_MS,
  UNAVAILABLE,
} from './download-button';

const HD = 'https://video.xx.fbcdn.net/v/t42/hd.mp4?oe=1';

/** What the page-world reader answers for the video. */
let answer: unknown;

/** Adds a feed post with a 600 by 400 video to the page and returns the video's wrapper. */
function addPlayer(duration = 20): HTMLElement {
  const post = document.createElement('div');
  post.setAttribute('aria-posinset', '1');
  post.innerHTML = '<div data-video-id="1"><div></div><div role="presentation"></div></div>';
  const { video } = fakeVideo({ duration });
  post.querySelector('[data-video-id] > div')?.append(video);
  placeAt(video, 0, 0, 600, 400);
  document.body.append(post);
  return post.querySelector('[data-video-id]') as HTMLElement;
}

const shadowOf = (player: Element) => player.querySelector(`:scope > ${HOST_TAG}`)?.shadowRoot;
const buttonIn = (player: Element) => shadowOf(player)?.querySelector('button') ?? null;

/** The button, once it has been measured and drawn. */
const buttonOf = (player: Element): Promise<HTMLButtonElement> =>
  vi.waitFor(() => {
    const button = buttonIn(player);
    if (!button) {
      throw new Error('no button yet');
    }
    return button;
  });
const wrapIn = (player: Element) => shadowOf(player)?.querySelector('.save') ?? null;
const statusIn = (player: Element) => shadowOf(player)?.querySelector('[role=status]') ?? null;
const tipIn = (player: Element) => shadowOf(player)?.querySelector('[role=tooltip]') ?? null;

const pointer = (element: Element, type: string): void => {
  element.dispatchEvent(
    new PointerEvent(type, { bubbles: type !== 'pointerenter' && type !== 'pointerleave' }),
  );
};

describe('video_download', () => {
  let options: Options;

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    fakeBrowser.reset();
    document.body.innerHTML = '';
    options = new Options(extensionStore, 'u/options');
    answer = { hdSrc: HD, sdSrc: null, manifest: true, videoId: '200000000000001' };
  });

  afterEach(async () => {
    await options.set('video_download', false);
    vi.unstubAllGlobals();
    vi.useRealTimers();
    history.replaceState({}, '', '/');
  });

  const start = async (
    bridge: PageWorld = testBridge({ 'video-sources': () => answer }),
  ): Promise<void> => {
    const data = new SavedData(extensionStore, 'u');
    expect(
      await startFeatures([videoDownload], options, bindPage(videoPage(bridge)), data),
    ).toEqual([]);
    // The button's place is first measured when the browser reports the overlay's size.
    for (const host of document.querySelectorAll(HOST_TAG)) {
      placeAt(host, 0, 0, 0, 0);
    }
    FakeResizeObserver.latest?.report();
  };

  /** Starts the feature and brings the pointer over the video. */
  const hovered = async (player: HTMLElement, bridge?: PageWorld): Promise<HTMLButtonElement> => {
    await start(bridge);
    const button = await buttonOf(player);
    // Preact adds the listener after it renders.
    await vi.waitFor(() => {
      pointer(player, 'pointerenter');
      expect(wrapIn(player)?.classList).toContain('shown');
    });
    return button;
  };

  it('puts a hidden Save video button in the top left corner of each video, shown while the pointer is over it', async () => {
    const player = addPlayer();
    await start();

    const button = await buttonOf(player);
    expect(button.getAttribute('aria-label')).toBe('Save video');
    expect(button.hasAttribute('title')).toBe(false);
    expect((wrapIn(player) as HTMLElement).style.cssText).toContain('left: 8px; top: 8px');
    expect(wrapIn(player)?.classList).not.toContain('shown');

    // Preact adds the listener after it renders.
    await vi.waitFor(() => {
      pointer(player, 'pointerenter');
      expect(wrapIn(player)?.classList).toContain('shown');
    });
    pointer(player, 'pointerleave');
    await vi.waitFor(() => expect(wrapIn(player)?.classList).not.toContain('shown'));
  });

  it("goes last in a story's card, below the story's header at the left", async () => {
    const { card } = addStory();
    await start();

    expect(card.lastElementChild?.tagName.toLowerCase()).toBe(HOST_TAG);
    await vi.waitFor(() =>
      expect((wrapIn(card) as HTMLElement | null)?.style.cssText).toContain('left: 8px; top: 72px'),
    );
  });

  it('gives a story that replaces the last one in the same card a fresh button', async () => {
    const story = addStory();
    await start();
    await vi.waitFor(() => expect(wrapIn(story.card)).not.toBeNull());

    const { video: next } = fakeVideo({ duration: 30 });
    placeAt(next, 100, 0, 356, 633);
    story.video?.replaceWith(next);
    await vi.waitFor(() => {
      for (const host of story.card.querySelectorAll(HOST_TAG)) {
        placeAt(host, 100, 0, 0, 0);
      }
      FakeResizeObserver.latest?.report();
      expect(story.card.querySelectorAll(`:scope > ${HOST_TAG}`)).toHaveLength(1);
      expect(wrapIn(story.card)).not.toBeNull();
    });
  });

  it('shows no button on a live video', async () => {
    const player = addPlayer(Number.POSITIVE_INFINITY);
    await start();

    expect(shadowOf(player)?.querySelector('.save')).toBeNull();
  });

  it("saves the high definition file under the video's ID, and keeps the press from the page", async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response('video bytes')));
    vi.stubGlobal('fetch', fetch);
    const saved: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved.push(this.download);
    });
    const heard = vi.fn();
    document.addEventListener('click', heard);
    const player = addPlayer();
    const button = await hovered(player);

    button.click();

    await vi.waitFor(() =>
      expect(statusIn(player)?.textContent).toBe('Saved as facebook-video-200000000000001.mp4.'),
    );
    expect(fetch).toHaveBeenCalledWith(HD, expect.objectContaining({ credentials: 'omit' }));
    expect(saved).toEqual(['facebook-video-200000000000001.mp4']);
    expect(heard).not.toHaveBeenCalled();
    document.removeEventListener('click', heard);
  });

  it('says a video that has only a manifest cannot be saved yet, and fetches nothing', async () => {
    answer = { hdSrc: null, sdSrc: null, manifest: true, videoId: '5' };
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const player = addPlayer();
    const button = await hovered(player);

    // Asked when the button first shows.
    await vi.waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('true'));
    const reason = button.getAttribute('aria-describedby');
    expect(shadowOf(player)?.getElementById(reason ?? '')?.textContent).toBe(NOT_YET);
    button.click();

    await vi.waitFor(() => expect(statusIn(player)?.textContent).toBe(NOT_YET));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('asks again on a press when the first look found no file', async () => {
    answer = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('video bytes'))),
    );
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const player = addPlayer();
    const button = await hovered(player);
    await vi.waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('true'));

    answer = { hdSrc: HD, sdSrc: null, manifest: false, videoId: '7' };
    button.click();

    await vi.waitFor(() =>
      expect(statusIn(player)?.textContent).toBe('Saved as facebook-video-7.mp4.'),
    );
  });

  it('says so plainly when the page-world bridge is unavailable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const player = addPlayer();
    const button = await hovered(player, testBridge());

    await vi.waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('true'));
    button.click();

    await vi.waitFor(() => expect(statusIn(player)?.textContent).toBe(UNAVAILABLE));
  });

  it('opens the file in a new tab when it cannot be fetched from the page, and says so', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    const open = vi.spyOn(globalThis, 'open').mockReturnValue(null);
    const player = addPlayer();
    const button = await hovered(player);

    button.click();

    await vi.waitFor(() => expect(statusIn(player)?.textContent).toBe(OPENED));
    expect(open).toHaveBeenCalledWith(HD, '_blank', 'noopener,noreferrer');
  });

  it('asks for a second press when the first is too old for a new tab, and opens it then', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    vi.stubGlobal('navigator', { ...navigator, userActivation: { isActive: false } });
    const open = vi.spyOn(globalThis, 'open').mockReturnValue(null);
    const player = addPlayer();
    const button = await hovered(player);

    button.click();
    await vi.waitFor(() => expect(statusIn(player)?.textContent).toBe(PRESS_AGAIN));
    expect(open).not.toHaveBeenCalled();
    button.click();

    await vi.waitFor(() => expect(statusIn(player)?.textContent).toBe(OPENED));
    expect(open).toHaveBeenCalledExactlyOnceWith(HD, '_blank', 'noopener,noreferrer');
  });

  it('shows the progress on the button, and stops on a second press', async () => {
    let fetched: AbortSignal | undefined;
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      fetched = init.signal ?? undefined;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(250));
          fetched?.addEventListener('abort', () =>
            controller.error(new DOMException('stopped', 'AbortError')),
          );
        },
      });
      return Promise.resolve(new Response(body, { headers: { 'content-length': '1000' } }));
    });
    const player = addPlayer();
    const button = await hovered(player);

    button.click();
    await vi.waitFor(() =>
      expect(shadowOf(player)?.querySelector('.bubble:not([role])')?.textContent).toBe(
        'Saving: 25%',
      ),
    );
    expect(button.getAttribute('aria-label')).toBe('Stop saving the video');
    expect(shadowOf(player)?.querySelector('.ring')).not.toBeNull();
    button.click();

    await vi.waitFor(() => expect(statusIn(player)?.textContent).toBe(STOPPED));
    expect(fetched?.aborted).toBe(true);
    expect(button.getAttribute('aria-label')).toBe('Save video');
  });

  it('takes its button away when switched off', async () => {
    const player = addPlayer();
    await start();

    await options.set('video_download', false);

    expect(player.querySelector(HOST_TAG)).toBeNull();
  });

  describe('tooltip', () => {
    beforeEach(() => {
      // happy-dom has no keyboard, so every focus counts as one from the keyboard.
      const matches = Element.prototype.matches;
      vi.spyOn(Element.prototype, 'matches').mockImplementation(function (
        this: Element,
        selector: string,
      ) {
        return selector === ':focus-visible' || matches.call(this, selector);
      });
    });

    it("shows the button's name after the pointer rests on it, and goes when the pointer leaves", async () => {
      const player = addPlayer();
      const button = await hovered(player);
      vi.useFakeTimers();

      pointer(button, 'pointerenter');
      await vi.advanceTimersByTimeAsync(TIP_DELAY_MS - 1);
      expect(tipIn(player)).toBeNull();
      await vi.advanceTimersByTimeAsync(1);

      expect(tipIn(player)?.textContent).toBe('Save video');
      expect(tipIn(player)?.className).toBe('tip below-start');
      pointer(button, 'pointerleave');
      await vi.advanceTimersByTimeAsync(0);
      expect(tipIn(player)).toBeNull();
    });

    it('shows at once on keyboard focus, and goes on Escape and on blur', async () => {
      const player = addPlayer();
      const button = await hovered(player);

      button.focus();
      await vi.waitFor(() => expect(tipIn(player)?.textContent).toBe('Save video'));
      button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await vi.waitFor(() => expect(tipIn(player)).toBeNull());

      button.blur();
      button.focus();
      await vi.waitFor(() => expect(tipIn(player)).not.toBeNull());
      button.blur();
      await vi.waitFor(() => expect(tipIn(player)).toBeNull());
    });

    it('gives way to a message, and goes on a press', async () => {
      answer = { hdSrc: null, sdSrc: null, manifest: true, videoId: null };
      const player = addPlayer();
      const button = await hovered(player);
      button.focus();
      await vi.waitFor(() => expect(tipIn(player)).not.toBeNull());

      pointer(button, 'pointerdown');
      button.click();

      await vi.waitFor(() => expect(statusIn(player)?.textContent).toBe(NOT_YET));
      expect(tipIn(player)).toBeNull();
      // Focus comes back while the message shows; the message keeps its place.
      button.blur();
      button.focus();
      await vi.waitFor(() => expect((statusIn(player) as HTMLElement | null)?.hidden).toBe(false));
      expect(tipIn(player)).toBeNull();
    });
  });
});
