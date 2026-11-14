import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { FakeMedia, FakeStory } from '../../facebook/testing';
import { startFeatures } from '../../core/app';
import { Options } from '../../core/options';
import { SavedData } from '../../core/saved';
import { sleep } from '../../core/timing';
import { bindPage } from '../../facebook/feature';
import { STOOD_IN_FOR } from '../../facebook/selectors';
import {
  addStory,
  FakeResizeObserver,
  fakeVideo,
  placeAt,
  videoPage,
} from '../../facebook/testing';
import { extensionStore } from '../../platform/extension-store';
import { HOST_TAG } from '../../ui/mount';
import videoScrubber, { STYLE_ID } from '.';

/** Adds a feed post with a 20 second video to the page and returns the video's wrapper. */
function addPlayer(): HTMLElement {
  const post = document.createElement('div');
  post.setAttribute('aria-posinset', '1');
  post.innerHTML = '<div data-video-id="1"><div></div><div role="presentation"></div></div>';
  post.querySelector('[data-video-id] > div')?.append(fakeVideo({ duration: 20 }).video);
  document.body.append(post);
  return post.querySelector('[data-video-id]') as HTMLElement;
}

const hostIn = (player: Element) => player.querySelector(`:scope > ${HOST_TAG}`);

const sliderIn = (player: Element) =>
  hostIn(player)?.shadowRoot?.querySelector<HTMLElement>('[role=slider]') ?? null;

describe('video_scrubber', () => {
  let options: Options;

  beforeEach(async () => {
    fakeBrowser.reset();
    document.body.innerHTML = '';
    options = new Options(extensionStore, 'u/options');
  });

  afterEach(async () => {
    // Stops the feature, which stops it following the videos.
    await options.set('video_scrubber', false);
    vi.unstubAllGlobals();
    history.replaceState({}, '', '/');
  });

  const start = async (): Promise<void> => {
    const data = new SavedData(extensionStore, 'u');
    expect(await startFeatures([videoScrubber], options, bindPage(videoPage()), data)).toEqual([]);
  };

  it('puts a scrubber last in the wrapper of every video', async () => {
    const first = addPlayer();
    await start();
    expect(first.lastElementChild?.tagName.toLowerCase()).toBe(HOST_TAG);
    expect(sliderIn(first)?.getAttribute('aria-valuemax')).toBe('20');

    const second = addPlayer();
    await vi.waitFor(() => expect(sliderIn(second)).not.toBeNull());
  });

  it('removes the scrubber of a video that leaves the page', async () => {
    const player = addPlayer();
    await start();

    player.querySelector('video')?.remove();

    await vi.waitFor(() => expect(hostIn(player)).toBeNull());
  });

  it('takes the scrubbers away when switched off, and brings them back when switched on', async () => {
    const player = addPlayer();
    await start();

    await options.set('video_scrubber', false);
    expect(hostIn(player)).toBeNull();

    await options.set('video_scrubber', true);
    expect(sliderIn(player)).not.toBeNull();
  });

  it('keeps clear of a control in the band along the bottom edge', async () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const player = addPlayer();
    placeAt(player.querySelector('video') as Element, 0, 0, 600, 400);
    await start();
    placeAt(hostIn(player) as Element, 0, 0, 0, 0);
    const controls = document.createElement('div');
    controls.innerHTML = '<div role="slider"></div><div role="button" id="settings"></div>';
    player.querySelector('[role=presentation]')?.after(controls);
    // Facebook's slider above the band, as under a feed video, and a button in it.
    placeAt(controls.querySelector('[role=slider]') as Element, 100, 370, 400, 18);
    placeAt(controls.querySelector('#settings') as Element, 560, 390, 20, 10);
    await sleep(10);
    FakeResizeObserver.latest?.report();

    await vi.waitFor(() => expect(sliderIn(player)?.style.right).toBe('42px'));
    expect(document.querySelector(`[${STOOD_IN_FOR}]`)).toBeNull();
  });

  describe("standing in for a story's strip over the bottom edge", () => {
    let story: FakeStory;
    const strip = () => story.part('strip');

    /** Waits until Facebook's strip is hidden, or shown when `hidden` is false. */
    const stoodIn = (hidden = true) =>
      vi.waitFor(() => expect(strip().hasAttribute(STOOD_IN_FOR)).toBe(hidden));

    /** Starts the feature on the story and lets the overlay measure the video. */
    const measured = async (): Promise<void> => {
      await start();
      placeAt(hostIn(story.card) as Element, 100, 0, 0, 0);
      await sleep(10);
      FakeResizeObserver.latest?.report();
    };

    beforeEach(() => {
      vi.stubGlobal('ResizeObserver', FakeResizeObserver);
      story = addStory();
    });

    it("goes last in the card and hides Facebook's strip, which would take the pointer above it", async () => {
      await measured();

      expect(story.card.lastElementChild?.tagName.toLowerCase()).toBe(HOST_TAG);
      await stoodIn();
      const slider = sliderIn(story.card);
      expect([slider?.style.left, slider?.style.right]).toEqual(['0px', '0px']);
      expect(document.querySelectorAll(`[${STOOD_IN_FOR}]`)).toHaveLength(1);
    });

    it('gives the strip back when switched off', async () => {
      await measured();
      await stoodIn();

      await options.set('video_scrubber', false);

      expect(strip().hasAttribute(STOOD_IN_FOR)).toBe(false);
    });

    it('gives the strip back when the video leaves the page', async () => {
      await measured();
      await stoodIn();

      story.video?.remove();

      await stoodIn(false);
    });

    it("gives the strip back while the next story's length is not known, and hides it again once it is", async () => {
      await measured();
      await stoodIn();
      const media = story.media as FakeMedia;

      // Facebook gives the same element the next story.
      media.duration = Number.NaN;
      story.video?.dispatchEvent(new Event('emptied'));
      await stoodIn(false);
      media.duration = 15;
      story.video?.dispatchEvent(new Event('durationchange'));

      await stoodIn();
    });

    it('gives the strip back when the video becomes too narrow for the scrubber, or loses its layout', async () => {
      await measured();
      await stoodIn();

      // 121 pixels is within a pixel of the width below which scrubber.css hides the strip.
      for (const [width, height] of [
        [121, 633],
        [0, 0],
      ] as const) {
        placeAt(story.video as Element, 100, 0, width, height);
        FakeResizeObserver.latest?.report();
        await stoodIn(false);

        placeAt(story.video as Element, 100, 0, 356, 633);
        FakeResizeObserver.latest?.report();
        await stoodIn();
      }
    });

    it('hides nothing on a story too narrow for the scrubber from the start', async () => {
      placeAt(story.video as Element, 100, 0, 110, 633);
      await measured();
      await sleep(10);

      expect(strip().hasAttribute(STOOD_IN_FOR)).toBe(false);
    });

    it('stands in for a strip Facebook adds after the video was measured, once the pointer comes over the story', async () => {
      strip().remove();
      await measured();
      await sleep(10);
      const late = document.createElement('div');
      late.id = 'late-strip';
      story.card.insertBefore(late, story.card.querySelector(HOST_TAG));
      placeAt(late, 100, 621, 356, 12);

      const observer = FakeResizeObserver.latest as FakeResizeObserver;
      // Nothing changed size, so nothing is waiting to be reported.
      observer.report(observer.pending);
      expect(late.hasAttribute(STOOD_IN_FOR)).toBe(false);

      story.card.dispatchEvent(new PointerEvent('pointerenter'));
      observer.report(observer.pending);

      await vi.waitFor(() => expect(late.hasAttribute(STOOD_IN_FOR)).toBe(true));
    });
  });

  describe("standing in for Facebook's bar along the bottom edge", () => {
    let viewer: HTMLElement;
    let player: HTMLElement;
    let media: FakeMedia;
    /** The three elements around Facebook's bar that have its box, outermost first, and the bar. */
    let wrappers: HTMLElement[];

    beforeEach(() => {
      vi.stubGlobal('ResizeObserver', FakeResizeObserver);
      // As in the reel viewer: the bar lies outside the card, three levels down.
      viewer = document.createElement('div');
      viewer.innerHTML = `
        <div data-video-id="1" data-index="0"><div></div><div role="button" id="corner"></div></div>
        <div><div><div><div role="slider" id="bar"></div></div></div></div>`;
      document.body.append(viewer);
      player = viewer.querySelector('[data-video-id]') as HTMLElement;
      const fake = fakeVideo({ duration: 20 });
      media = fake.media;
      player.firstElementChild?.append(fake.video);
      placeAt(fake.video, 0, 0, 600, 400);
      placeAt(viewer, 0, 0, 600, 420);
      placeAt(viewer.querySelector('#corner') as Element, 2, 384, 40, 40);
      const bar = viewer.querySelector('#bar') as HTMLElement;
      wrappers = [
        bar.parentElement?.parentElement?.parentElement,
        bar.parentElement?.parentElement,
        bar.parentElement,
        bar,
      ] as HTMLElement[];
      for (const element of wrappers) {
        placeAt(element, 8, 390, 584, 20);
      }
    });

    const hidden = () => wrappers.filter((element) => element.hasAttribute(STOOD_IN_FOR));

    /** Starts the feature and lets the overlay measure the video. */
    const measured = async (): Promise<void> => {
      await start();
      placeAt(hostIn(player) as Element, 0, 0, 0, 0);
      await sleep(10);
      FakeResizeObserver.latest?.report();
      await vi.waitFor(() => expect(hidden()).not.toEqual([]));
    };

    it("takes the bar's place and hides the outermost element with its box", async () => {
      await measured();

      expect([sliderIn(player)?.style.left, sliderIn(player)?.style.right]).toEqual(['8px', '8px']);
      expect(hidden()).toEqual([wrappers[0]]);
      expect(document.querySelector(`#${STYLE_ID}`)?.textContent).toContain('visibility: hidden');
    });

    it('hides only up to an element that holds another control', async () => {
      const other = document.createElement('div');
      other.setAttribute('role', 'button');
      wrappers[0]?.append(other);

      await measured();

      expect(hidden()).toEqual([wrappers[1]]);
    });

    it('hides nothing around the bar that holds the video, which holds the scrubber', async () => {
      // Two of the elements with the bar's box hold the card, and nothing else holds a control.
      viewer.querySelector('#corner')?.remove();
      wrappers[1]?.prepend(player);

      await measured();

      expect(hidden()).toEqual([wrappers[2]]);
    });

    it('shows the bar again when switched off', async () => {
      await measured();

      await options.set('video_scrubber', false);

      expect(hidden()).toEqual([]);
      expect(document.querySelector(`#${STYLE_ID}`)).toBeNull();
    });

    it('shows the bar again when the video leaves the page', async () => {
      await measured();

      player.querySelector('video')?.remove();

      await vi.waitFor(() => expect(hidden()).toEqual([]));
    });

    it('shows the bar again when the element is given another video', async () => {
      await measured();

      media.duration = Number.NaN;
      player.querySelector('video')?.dispatchEvent(new Event('emptied'));

      await vi.waitFor(() => expect(hidden()).toEqual([]));
    });

    it('shows the bar again when a later measurement finds it off the bottom edge', async () => {
      await measured();

      for (const element of wrappers) {
        placeAt(element, 8, 300, 584, 20);
      }
      FakeResizeObserver.latest?.report();

      await vi.waitFor(() => expect(hidden()).toEqual([]));
      // Clear of the button in the corner, which the bar no longer covers.
      expect(sliderIn(player)?.style.left).toBe('44px');
    });

    it('hides nothing when the scrubber cannot be put on the video', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      vi.spyOn(HTMLElement.prototype, 'attachShadow').mockImplementation(() => {
        throw new Error('no shadow root');
      });

      await start();
      FakeResizeObserver.latest?.report();
      await sleep(10);

      expect(hidden()).toEqual([]);
      expect(hostIn(player)).toBeNull();
    });
  });
});
