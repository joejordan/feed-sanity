import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { startFeatures } from '../../core/app';
import { Options } from '../../core/options';
import { SavedData } from '../../core/saved';
import { bindPage } from '../../facebook/feature';
import { fakeVideo, placeAt, videoPage } from '../../facebook/testing';
import { extensionStore } from '../../platform/extension-store';
import videoClickPauses from '.';

const PRESS = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'] as const;

interface PressOptions {
  x?: number;
  y?: number;
  /** Where the pointer is let go, when it moved. */
  upX?: number;
  button?: number;
  ctrlKey?: boolean;
  /** The events' time stamp, in milliseconds. */
  time?: number;
}

const byId = (id: string) => document.querySelector(`#${id}`) as HTMLElement;

describe('video_click_pauses', () => {
  let options: Options;
  let video: HTMLVideoElement;
  /** What `document.elementsFromPoint` returns, top first. */
  let stack: Element[];
  /** The press events the page heard. */
  let heard: string[];
  let lastClick: MouseEvent | undefined;
  const onPage = (event: Event): void => {
    heard.push(event.type);
  };

  beforeEach(async () => {
    fakeBrowser.reset();
    history.replaceState({}, '', '/');
    document.body.innerHTML = `
      <div aria-posinset="1" id="post">
        <p id="text">A video</p>
        <div data-video-id="1" id="player">
          <div id="frame"></div>
          <div role="presentation" id="layer"></div>
          <div id="controls"><div role="button" aria-label="Pause" id="pause"></div></div>
        </div>
      </div>`;
    ({ video } = fakeVideo({ duration: 20 }));
    byId('frame').append(video);
    placeAt(video, 0, 0, 400, 300);
    placeAt(byId('pause'), 0, 280, 24, 20);
    stack = [byId('layer'), byId('player'), byId('post'), document.body];
    Object.defineProperty(document, 'elementsFromPoint', {
      value: () => stack,
      configurable: true,
    });
    heard = [];
    for (const type of PRESS) {
      document.addEventListener(type, onPage);
    }
    await video.play();

    options = new Options(extensionStore, 'u/options');
    const data = new SavedData(extensionStore, 'u');
    expect(await startFeatures([videoClickPauses], options, bindPage(videoPage()), data)).toEqual(
      [],
    );
  });

  afterEach(async () => {
    await options.set('video_click_pauses', false);
    for (const type of PRESS) {
      document.removeEventListener(type, onPage);
    }
    Reflect.deleteProperty(document, 'elementsFromPoint');
  });

  /** Presses and lets go of the primary button on `target`, as a click does. */
  function press(
    target: Element = stack[0] as Element,
    { x = 200, y = 150, upX = x, button = 0, ctrlKey = false, time = 0 }: PressOptions = {},
  ): void {
    for (const type of PRESS) {
      const at = { clientX: type === 'pointerdown' || type === 'mousedown' ? x : upX, clientY: y };
      // A click made with the pointer counts as the first of a run of clicks.
      const detail = type === 'click' ? 1 : 0;
      const init = { ...at, button, ctrlKey, detail, bubbles: true, cancelable: true };
      const event = type.startsWith('pointer')
        ? new PointerEvent(type, { ...init, pointerId: 1, isPrimary: true })
        : new MouseEvent(type, init);
      Object.defineProperty(event, 'timeStamp', { value: time });
      if (type === 'click') {
        lastClick = event;
      }
      target.dispatchEvent(event);
    }
  }

  it('pauses a feed video when its picture is clicked, and keeps the click from Facebook', () => {
    press();

    expect(video.paused).toBe(true);
    expect(heard).toEqual([]);
    expect(lastClick?.defaultPrevented).toBe(true);
  });

  it('lets a keyboard click through after a press that ended without a click', () => {
    const down = { clientX: 200, clientY: 150, button: 0, bubbles: true };
    byId('layer').dispatchEvent(
      new PointerEvent('pointerdown', { ...down, pointerId: 1, isPrimary: true }),
    );
    expect(heard).toEqual([]);

    byId('text').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    press(undefined, { time: 5000 });

    expect(heard).toEqual(['click']);
    expect(video.paused).toBe(true);
  });

  describe('after a click has paused a video', () => {
    beforeEach(() => {
      press();
      expect(video.paused).toBe(true);
    });

    it('pauses it again when Facebook starts it by itself', async () => {
      await video.play();

      expect(video.paused).toBe(true);
    });

    it.each([
      ['a press', () => new PointerEvent('pointerdown', { bubbles: true, isPrimary: true })],
      ['a key press', () => new KeyboardEvent('keydown', { bubbles: true, key: 'k' })],
      // A long press: the click that starts the video comes well after the press.
      ['a click', () => new MouseEvent('click', { bubbles: true, detail: 1 })],
    ])("lets the person start it with %s on Facebook's controls", async (_, gesture) => {
      stack = ['pause', 'controls', 'player', 'post'].map(byId);
      byId('pause').dispatchEvent(gesture());
      await video.play();
      expect(video.paused).toBe(false);

      // Let go for good.
      video.pause();
      await video.play();
      expect(video.paused).toBe(false);
    });

    it('does not count a press outside the video', async () => {
      byId('text').dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, isPrimary: true }),
      );
      await video.play();

      expect(video.paused).toBe(true);
    });

    it('lets it go when the second click of a double click opens the viewer', async () => {
      press(undefined, { time: 300 });
      expect(heard).toEqual([...PRESS]);

      await video.play();

      expect(video.paused).toBe(false);
    });

    it('lets it go when the element is given another video', async () => {
      video.dispatchEvent(new Event('emptied'));
      await video.play();

      expect(video.paused).toBe(false);
    });

    it('lets it go, once, when Facebook keeps starting it', async () => {
      const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
      for (let restart = 0; restart < 3; restart++) {
        await video.play();
        expect(video.paused).toBe(true);
      }

      await video.play();
      video.pause();
      await video.play();

      expect(video.paused).toBe(false);
      expect(
        debug.mock.calls.filter((call) => String(call[1]).includes('let a paused video go')),
      ).toHaveLength(1);
    });
  });

  it('plays it again on the next click', () => {
    press(undefined, { time: 1000 });
    press(undefined, { time: 2000 });

    expect(video.paused).toBe(false);
    expect(heard).toEqual([]);
  });

  it('finds the video when it is under the pointer itself', () => {
    stack = [video, byId('frame'), byId('player'), byId('post')];

    press();

    expect(video.paused).toBe(true);
  });

  it('lets the second click of a double click open the viewer', () => {
    press(undefined, { time: 1000 });
    press(undefined, { time: 1300 });

    expect(video.paused).toBe(true);
    expect(heard).toEqual([...PRESS]);
    // The next click is a click of its own again.
    press(undefined, { time: 1400 });
    expect(video.paused).toBe(false);
  });

  it('counts a control that covers the whole picture as the picture', () => {
    byId('layer').setAttribute('role', 'button');
    placeAt(byId('layer'), 0, 0, 400, 300);

    press();

    expect(video.paused).toBe(true);
  });

  it.each<[string, string[] | null, PressOptions]>([
    ['a click with a modifier key', null, { ctrlKey: true }],
    ['another button', null, { button: 1 }],
    ["Facebook's controls", ['pause', 'controls', 'player', 'post'], { y: 290 }],
    ['the text beside the video', ['text', 'post'], { y: 320 }],
  ])('leaves %s alone', (_, ids, pressOptions) => {
    if (ids) {
      stack = ids.map(byId);
    }

    press(undefined, pressOptions);

    expect(video.paused).toBe(false);
    expect(heard).toEqual([...PRESS]);
  });

  it("leaves this project's own UI alone", () => {
    const host = document.createElement('feed-sanity-ui');
    host.setAttribute('data-feed-sanity', '');
    byId('player').append(host);
    stack = [host, byId('player'), byId('post')];

    press(host);

    expect(video.paused).toBe(false);
    expect(heard).toEqual([...PRESS]);
  });

  it('leaves a video outside a post alone', () => {
    byId('post').removeAttribute('aria-posinset');

    press();

    expect(video.paused).toBe(false);
    expect(heard).toEqual([...PRESS]);
  });

  it('pauses nothing for a drag that starts on the picture, and keeps it from Facebook', () => {
    press(undefined, { upX: 260 });

    expect(video.paused).toBe(false);
    expect(heard).toEqual([]);
  });

  it('leaves clicks alone once switched off', async () => {
    await options.set('video_click_pauses', false);

    press();

    expect(video.paused).toBe(false);
    expect(heard).toEqual([...PRESS]);
  });
});
