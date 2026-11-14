import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FakeMedia } from '../../facebook/testing';
import type { StripPlace } from './layout';
import { Listeners } from '../../core/listeners';
import { createLogger } from '../../core/log';
import { STOOD_IN_FOR } from '../../facebook/selectors';
import { fakeVideo, placeAt } from '../../facebook/testing';
import { AT_BOTTOM } from './layout';
import { Scrubber } from './scrubber';

describe('Scrubber', () => {
  let video: HTMLVideoElement;
  let media: FakeMedia;
  let place: StripPlace;
  let moved: Listeners;

  beforeEach(() => {
    ({ video, media } = fakeVideo({ duration: 100 }));
    place = AT_BOTTOM;
    moved = new Listeners(createLogger('test'));
  });

  afterEach(cleanup);

  /** Marks an element as the feature's `hider` does. */
  const hide = (element: Element) => {
    element.setAttribute(STOOD_IN_FOR, '');
    return () => element.removeAttribute(STOOD_IN_FOR);
  };

  const show = (): void => {
    render(
      <Scrubber
        video={video}
        place={{ get: () => place, subscribe: (listener) => moved.add(listener) }}
        hide={hide}
      />,
    );
  };

  /** The video fires `type`, as the browser does after a change. */
  const fire = (type: string): void => {
    act(() => {
      video.dispatchEvent(new Event(type));
    });
  };

  const slider = () => screen.getByRole('slider', { name: 'Video position' });

  /** Gives the bar a box 400 pixels wide, from 100 to 500. */
  const sizeBar = (): HTMLElement => {
    const bar = slider();
    placeAt(bar, 100, 0, 400, 24);
    return bar;
  };

  it('shows nothing until the video has a length, and nothing for a live video', () => {
    media.duration = Number.NaN;
    show();
    expect(screen.queryByRole('slider')).toBeNull();

    media.duration = 30;
    fire('durationchange');
    expect(slider().getAttribute('aria-valuemax')).toBe('30');

    media.duration = Number.POSITIVE_INFINITY;
    fire('durationchange');
    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('is a slider whose value is the time', () => {
    media.duration = 125;
    video.currentTime = 61.7;
    show();

    const bar = slider();
    expect(bar.tabIndex).toBe(0);
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('125');
    expect(bar.getAttribute('aria-valuenow')).toBe('61');
    expect(bar.getAttribute('aria-valuetext')).toBe('1:01 of 2:05');
    expect(bar.textContent).toContain('1:01 / 2:05');

    video.currentTime = 62;
    fire('timeupdate');
    expect(bar.getAttribute('aria-valuetext')).toBe('1:02 of 2:05');
  });

  it('moves the video with the arrow keys, Home and End', () => {
    video.currentTime = 50;
    show();
    const bar = slider();
    const press = (key: string) => fireEvent.keyDown(bar, { key });

    press('ArrowRight');
    expect(video.currentTime).toBe(55);
    press('ArrowLeft');
    press('ArrowLeft');
    expect(video.currentTime).toBe(45);
    press('End');
    expect(video.currentTime).toBe(100);
    press('ArrowRight');
    expect(video.currentTime).toBe(100);
    press('Home');
    expect(video.currentTime).toBe(0);
    press('ArrowLeft');
    expect(video.currentTime).toBe(0);
    expect(press('a')).toBe(true);
  });

  it('moves the video while it is dragged, one seek at a time, and ends where it is let go', () => {
    show();
    const bar = sizeBar();

    fireEvent.pointerDown(bar, { button: 0, pointerId: 1, clientX: 200 });
    expect(video.currentTime).toBe(25);
    expect(bar.className).toContain('dragging');

    media.seeking = true;
    fireEvent.pointerMove(bar, { pointerId: 1, clientX: 300 });
    fireEvent.pointerMove(bar, { pointerId: 1, clientX: 350 });
    expect(video.currentTime).toBe(25);
    expect(bar.getAttribute('aria-valuenow')).toBe('62');

    media.seeking = false;
    fire('seeked');
    expect(video.currentTime).toBe(62.5);

    fireEvent.pointerUp(bar, { pointerId: 1, clientX: 900 });
    expect(video.currentTime).toBe(100);
    expect(bar.className).not.toContain('dragging');
  });

  it('shows the time under the pointer', () => {
    show();
    const bar = sizeBar();

    fireEvent.pointerEnter(bar, { pointerType: 'mouse', clientX: 300 });

    expect(bar.querySelector('.bubble')?.textContent).toBe('0:50');
    fireEvent.pointerLeave(bar, { pointerType: 'mouse' });
    expect(bar.querySelector('.bubble')).toBeNull();
  });

  it('ignores presses of other buttons', () => {
    show();
    const bar = sizeBar();

    fireEvent.pointerDown(bar, { button: 2, pointerId: 1, clientX: 300 });

    expect(video.currentTime).toBe(0);
  });

  it('runs between the ends it is given, and moves when they change', () => {
    show();
    const { style } = slider();
    expect([style.left, style.right]).toEqual(['0px', '0px']);

    place = { left: 8, right: 8, hides: null };
    act(() => moved.emit());

    expect([style.left, style.right]).toEqual(['8px', '8px']);
  });

  describe("standing in for Facebook's bar", () => {
    let bar: HTMLElement;
    const hidden = () => bar.hasAttribute(STOOD_IN_FOR);

    beforeEach(() => {
      bar = document.createElement('div');
      document.body.append(bar);
      place = { left: 8, right: 8, hides: bar };
    });

    it('hides the bar while it shows, and shows it again when it moves elsewhere', () => {
      show();
      expect(hidden()).toBe(true);

      place = AT_BOTTOM;
      act(() => moved.emit());

      expect(hidden()).toBe(false);
    });

    it('shows the bar again when the element is given another video, and hides it once that has a length', () => {
      show();

      media.duration = Number.NaN;
      fire('emptied');
      expect(hidden()).toBe(false);

      media.duration = 30;
      fire('durationchange');
      expect(hidden()).toBe(true);
    });

    it('never hides the bar of a video it does not show on', () => {
      media.duration = Number.POSITIVE_INFINITY;
      show();

      expect(hidden()).toBe(false);
    });

    it('shows the bar again when it goes', () => {
      show();
      expect(hidden()).toBe(true);

      act(() => cleanup());

      expect(hidden()).toBe(false);
    });
  });

  it('drops a drag when the element is given another video', () => {
    show();
    const bar = sizeBar();
    fireEvent.pointerDown(bar, { button: 0, pointerId: 1, clientX: 200 });

    fire('emptied');
    fireEvent.pointerMove(bar, { pointerId: 1, clientX: 400 });

    expect(video.currentTime).toBe(25);
    expect(bar.className).not.toContain('dragging');
  });

  it('shows what has loaded and what has played', () => {
    media.buffered = [
      [0, 20],
      [50, 75],
    ];
    video.currentTime = 40;
    show();

    const ranges = [...slider().querySelectorAll<HTMLElement>('.buffered')].map(
      ({ style }) => `${style.left} ${style.width}`,
    );
    expect(ranges).toEqual(['0% 20%', '50% 25%']);
    expect(slider().querySelector<HTMLElement>('.played')?.style.transform).toBe('scaleX(0.4)');
  });

  it('glides between time reports only while the video plays', async () => {
    show();
    expect(slider().className).not.toContain('playing');

    await act(() => video.play());

    expect(slider().className).toContain('playing');
  });
});
