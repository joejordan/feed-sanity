import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { FakeStory } from '../../facebook/testing';
import { startFeatures } from '../../core/app';
import { Options } from '../../core/options';
import { SavedData } from '../../core/saved';
import { bindPage } from '../../facebook/feature';
import { addStory, fakeVideo, placeAt, videoPage } from '../../facebook/testing';
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

  it('pauses a shared reel covered by a sibling link outside the video container without opening it', () => {
    const link = document.createElement('a');
    link.id = 'reel-cover';
    link.href = 'https://www.facebook.com/reel/999/';
    link.target = '_blank';
    byId('post').append(link);
    placeAt(link, 0, 0, 400, 300);
    stack = [link, byId('player'), byId('post'), document.body];

    press(link);

    expect(video.paused).toBe(true);
    expect(heard).toEqual([]);
    expect(lastClick?.defaultPrevented).toBe(true);
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

  it('leaves clicks alone while the video player is in fullscreen mode', () => {
    Object.defineProperty(document, 'fullscreenElement', {
      value: byId('player'),
      configurable: true,
    });
    try {
      press();
      expect(video.paused).toBe(false);
      expect(heard).toEqual([...PRESS]);
    } finally {
      Reflect.deleteProperty(document, 'fullscreenElement');
    }
  });

  it('leaves clicks alone once switched off', async () => {
    await options.set('video_click_pauses', false);

    press();

    expect(video.paused).toBe(false);
    expect(heard).toEqual([...PRESS]);
  });

  describe('in the stories viewer', () => {
    /** Presses of the story's own pause button. */
    let paused: number;
    let story: FakeStory;

    const useStory = (options?: Parameters<typeof addStory>[0]): void => {
      story = addStory(options);
      paused = 0;
      story.part('pause').addEventListener('click', () => {
        paused++;
      });
      stack = [story.part('frame'), story.card, document.body];
    };

    /** A press in the lower part of the story, clear of its header and sticker. */
    const pressStory = (target: Element = story.part('frame')): void =>
      press(target, { x: 250, y: 450 });

    it("pauses and plays a video story with the story's own button, and keeps the press from Facebook", () => {
      useStory();

      pressStory();
      expect(paused).toBe(1);
      // Facebook heard only the click on its own button.
      expect(heard).toEqual(['click']);
      expect(lastClick?.defaultPrevented).toBe(true);
      pressStory();

      expect(paused).toBe(2);
    });

    it("keeps every event of a press, with a mouse or a finger, from the story's tap zones", () => {
      useStory();
      const types = [
        'pointerdown',
        'touchstart',
        'pointerup',
        'touchend',
        'mousedown',
        'mouseup',
        'click',
      ] as const;
      const zone: string[] = [];
      for (const type of types) {
        story.card.addEventListener(type, () => zone.push(type));
      }

      // On the left third of the card, where Facebook goes back.
      press(story.part('frame'), { x: 120, y: 450 });
      // A tap: pointer events first, then touch events, then the mouse events made from them.
      const at = { clientX: 120, clientY: 450, button: 0, bubbles: true, cancelable: true };
      const eventFor = (type: (typeof types)[number]): Event => {
        if (type.startsWith('pointer')) {
          return new PointerEvent(type, {
            ...at,
            pointerId: 2,
            isPrimary: true,
            pointerType: 'touch',
          });
        }
        if (type.startsWith('touch')) {
          return new Event(type, at);
        }
        return new MouseEvent(type, { ...at, detail: type === 'click' ? 1 : 0 });
      };
      for (const type of types) {
        story.part('frame').dispatchEvent(eventFor(type));
      }

      expect(zone).toEqual([]);
      expect(paused).toBe(2);
    });

    it('pauses a photo story the same way', () => {
      useStory({ photo: true });
      stack = [story.part('photo'), story.part('frame'), story.card, document.body];

      pressStory(story.part('photo'));

      expect(paused).toBe(1);
    });

    it('does nothing on a story with no pause button found, and says so once', () => {
      const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
      useStory({ pause: false });

      pressStory();
      pressStory();

      expect(paused).toBe(0);
      expect(heard).toEqual([...PRESS, ...PRESS]);
      expect(debug).toHaveBeenCalledTimes(1);
    });

    it("lets presses on the header, a sticker, this project's UI and the buttons around the card through", () => {
      useStory();
      const host = document.createElement('feed-sanity-ui');
      host.setAttribute('data-feed-sanity', '');
      story.card.append(host);
      const targets: [Element, Element[]][] = [
        [story.part('avatar'), [story.part('avatar'), story.card]],
        [story.part('sticker'), [story.part('sticker'), story.card]],
        [host, [host, story.part('frame'), story.card]],
        [story.part('menu'), [story.part('menu')]],
        [story.part('next'), [story.part('next')]],
      ];

      for (const [target, under] of targets) {
        stack = under;
        heard = [];
        pressStory(target);
        expect(heard, target.id || target.tagName).toEqual([...PRESS]);
      }
      expect(paused).toBe(0);
    });

    it("lets a press close the story's open menu, or leave a focused reply box, with no toggle", () => {
      useStory();
      const reply = document.createElement('input');
      document.body.append(reply);

      story.part('menu').setAttribute('aria-expanded', 'true');
      pressStory();
      expect(heard).toEqual([...PRESS]);
      story.part('menu').setAttribute('aria-expanded', 'false');

      reply.focus();
      heard = [];
      pressStory();
      expect(heard).toEqual([...PRESS]);
      expect(paused).toBe(0);
      reply.remove();
    });

    it('does not toggle the next story when the press outlived the one it began on', () => {
      useStory();
      story.part('frame').dispatchEvent(
        new PointerEvent('pointerdown', {
          clientX: 250,
          clientY: 450,
          button: 0,
          bubbles: true,
          pointerId: 1,
          isPrimary: true,
        }),
      );
      // Facebook gives the card the next story while the button is held.
      story.card.setAttribute('data-id', 'story-2');
      for (const type of ['pointerup', 'mouseup', 'click'] as const) {
        const init = { clientX: 250, clientY: 450, bubbles: true, cancelable: true, detail: 1 };
        story
          .part('frame')
          .dispatchEvent(
            type === 'pointerup'
              ? new PointerEvent(type, { ...init, pointerId: 1, isPrimary: true })
              : new MouseEvent(type, init),
          );
      }

      expect(paused).toBe(0);
    });

    it('toggles twice on a double click, and keeps the double click from Facebook', () => {
      useStory();
      const doubled = vi.fn();
      document.addEventListener('dblclick', doubled);

      pressStory();
      pressStory();
      const dblclick = new MouseEvent('dblclick', { clientX: 250, clientY: 450, bubbles: true });
      // At the time of the presses, as `press` gives them.
      Object.defineProperty(dblclick, 'timeStamp', { value: 0 });
      story.part('frame').dispatchEvent(dblclick);

      expect(paused).toBe(2);
      expect(doubled).not.toHaveBeenCalled();
      document.removeEventListener('dblclick', doubled);
    });
  });
});
