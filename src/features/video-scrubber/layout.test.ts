import { describe, expect, it } from 'vitest';
import type { ControlBox } from './layout';
import { AT_BOTTOM, placeStrip } from './layout';

/** A box `x, y, width, height` from the top left of a video placed at 100, 50 on the screen. */
const box = (x: number, y: number, width: number, height: number) =>
  DOMRect.fromRect({ x: 100 + x, y: 50 + y, width, height });

const control = (bar: boolean, x: number, y: number, width: number, height: number) => {
  const element = document.createElement('div');
  return { element, box: box(x, y, width, height), bar } satisfies ControlBox;
};

const button = (x: number, y: number, width: number, height: number) =>
  control(false, x, y, width, height);

/** A slider running from side to side. One running up and down counts as a button. */
const slider = (x: number, y: number, width: number, height: number) =>
  control(true, x, y, width, height);

describe('placeStrip', () => {
  // Measured on live Facebook on 2026-11-14.
  it("keeps to the bottom edge of a feed video, under Facebook's control row", () => {
    const video = box(0, 0, 680, 500);
    const controls = [
      button(11, 468, 20, 20),
      button(513, 468, 20, 20),
      button(562, 468, 20, 20),
      button(605, 468, 20, 20),
      button(643, 468, 20, 20),
      slider(108, 469, 388, 19),
      button(637, 392, 32, 60),
    ];

    expect(placeStrip(video, controls)).toEqual(AT_BOTTOM);
  });

  it("takes the place of a portrait reel's position bar, over the caption and corner buttons", () => {
    const video = box(0, 0, 415, 737);
    const bar = slider(8, 725, 399, 20);
    const controls = [
      // "See more" at the end of the caption.
      button(259, 700, 60, 19),
      button(2, 717, 40, 40),
      button(373, 717, 40, 40),
      bar,
      // Sliders with no size count for nothing.
      slider(0, 0, 0, 0),
    ];

    expect(placeStrip(video, controls)).toEqual({ left: 8, right: 8, hides: bar.element });
  });

  it('takes the place of the widest bar, kept within the video', () => {
    const video = box(0, 0, 600, 400);
    const wide = slider(-10, 392, 640, 16);
    const controls = [slider(20, 390, 400, 10), wide];

    expect(placeStrip(video, controls)).toEqual({ left: 0, right: 0, hides: wide.element });
  });

  it('stands in for no bar that only dips into the band from above', () => {
    const video = box(0, 0, 680, 500);
    // The feed's position slider of the first test, a pixel lower.
    const controls = [slider(108, 470, 388, 19)];

    expect(placeStrip(video, controls)).toEqual(AT_BOTTOM);
  });

  it('stands in for nothing on a video too narrow to get the strip', () => {
    const video = box(0, 0, 120, 200);
    const controls = [slider(0, 190, 120, 16)];

    expect(placeStrip(video, controls).hides).toBeNull();
  });

  it('keeps clear of the controls in its band when no bar lies over the bottom edge', () => {
    const video = box(0, 0, 600, 400);
    const controls = [
      // A layer over the whole video.
      button(0, 0, 600, 400),
      // Off the video.
      button(0, 410, 40, 40),
      // A narrow slider and a button up and down.
      slider(100, 392, 200, 8),
      button(560, 300, 30, 100),
      // A wide bar above the band.
      slider(0, 370, 600, 18),
    ];

    expect(placeStrip(video, controls)).toEqual({ left: 302, right: 42, hides: null });
  });
});
