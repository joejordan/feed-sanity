import { describe, expect, it } from 'vitest';
import type { Box, ControlBox } from '../video-layout';
import { BUTTON_SIZE, placeButton } from './layout';

const box = (left: number, top: number, width: number, height: number): Box => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

const control = (left: number, top: number, width: number, height: number): ControlBox => ({
  element: document.createElement('div'),
  box: box(left, top, width, height),
  bar: false,
});

const VIDEO = box(100, 50, 600, 400);

describe('placeButton', () => {
  it('puts the 40 pixel button 8 pixels in from the top left corner, with its tooltip below', () => {
    expect(BUTTON_SIZE).toBe(40);
    expect(placeButton(VIDEO, [])).toEqual({ left: 8, top: 8, tip: 'below-start' });
  });

  it('moves right along the top edge past a control in the corner', () => {
    // Two buttons in the corner, as the reel viewer has.
    const controls = [control(108, 58, 40, 40), control(152, 58, 40, 40)];

    expect(placeButton(VIDEO, controls)).toEqual({ left: 96, top: 8, tip: 'below-start' });
  });

  it('keeps 4 pixels from a control just past its edge', () => {
    expect(placeButton(VIDEO, [control(150, 58, 20, 20)])).toMatchObject({ left: 74 });
  });

  it('moves past a control at fractional places, where rounding leaves the button a hair short of it', () => {
    // 320.56333… + (509.05 − 320.56333… + 4) − 4 is 509.04999…, short of 509.05.
    const video = box(320.563_333_333_333_33, 50, 600, 400);
    const corner = control(328, 58, 181.05, 40);
    const controls = [{ ...corner, box: { ...corner.box, right: 509.05 } }];

    expect(placeButton(video, controls)?.left).toBeCloseTo(509.05 - video.left + 4);
  });

  it('moves down the left edge when the top edge is full', () => {
    const top = [control(100, 50, 290, 60), control(390, 50, 310, 60)];

    expect(placeButton(VIDEO, top)).toEqual({ left: 8, top: 64, tip: 'below-start' });
  });

  it('shows no button when neither edge has room, or the video is too small', () => {
    const top = [control(100, 50, 290, 60), control(390, 50, 310, 60)];
    const left = [control(100, 110, 60, 340)];

    expect(placeButton(VIDEO, [...top, ...left])).toBeNull();
    expect(placeButton(box(0, 0, 110, 200), [])).toBeNull();
    expect(placeButton(box(0, 0, 300, 50), [])).toBeNull();
  });

  it('ignores layers over the whole picture, controls with no size, and controls off the video', () => {
    const controls = [
      control(100, 50, 600, 400),
      control(100, 50, 0, 0),
      control(800, 50, 40, 40),
      control(100, 500, 40, 40),
    ];

    expect(placeButton(VIDEO, controls)).toMatchObject({ left: 8, top: 8 });
  });

  it('puts the tooltip beside the button on a short video, and gives way to the scrubber', () => {
    // Below the button would reach the scrubber's time label, 40 pixels above the bottom.
    expect(placeButton(box(0, 0, 600, 120), [])).toEqual({ left: 8, top: 8, tip: 'beside' });
    expect(placeButton(box(0, 0, 600, 60), [])).toEqual({ left: 8, top: 8, tip: null });
  });

  it('ends the tooltip at the button when the button is far to the right', () => {
    const controls = [control(108, 58, 480, 40)];

    expect(placeButton(VIDEO, controls)).toEqual({ left: 492, top: 8, tip: 'below-end' });
  });

  it('shows no tooltip where it cannot fit inside the video', () => {
    expect(placeButton(box(0, 0, 150, 300), [])).toEqual({ left: 8, top: 8, tip: null });
  });
});
