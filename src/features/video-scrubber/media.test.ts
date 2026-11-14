import { describe, expect, it, vi } from 'vitest';
import { fakeVideo } from '../../facebook/testing';
import { formatTime, isSeekable, readMedia, Seeker, sameMedia } from './media';

describe('formatTime', () => {
  it('writes minutes and seconds, and hours from an hour on', () => {
    expect([0, 5.9, 65, 600, 3599, 3600, 3725].map(formatTime)).toEqual([
      '0:00',
      '0:05',
      '1:05',
      '10:00',
      '59:59',
      '1:00:00',
      '1:02:05',
    ]);
  });
});

describe('isSeekable', () => {
  it('accepts only a known, finite length', () => {
    expect([Number.NaN, 0, Number.POSITIVE_INFINITY, 12].map(isSeekable)).toEqual([
      false,
      false,
      false,
      true,
    ]);
  });
});

describe('readMedia', () => {
  it("reads the video's time, length, state and buffered ranges", () => {
    const { video } = fakeVideo({
      duration: 30,
      buffered: [
        [0, 4],
        [10, 12],
      ],
    });
    video.currentTime = 3;

    expect(readMedia(video)).toEqual({
      currentTime: 3,
      duration: 30,
      paused: true,
      buffered: [
        [0, 4],
        [10, 12],
      ],
    });
  });
});

describe('sameMedia', () => {
  it('tells states apart only by what the scrubber shows', () => {
    const { video, media } = fakeVideo({ buffered: [[0, 4]] });
    const before = readMedia(video);

    expect(sameMedia(before, readMedia(video))).toBe(true);
    media.buffered = [[0, 5]];
    expect(sameMedia(before, readMedia(video))).toBe(false);
    media.buffered = [[0, 4]];
    video.currentTime = 1;
    expect(sameMedia(before, readMedia(video))).toBe(false);
  });
});

describe('Seeker', () => {
  it('seeks at once while the video is not seeking', () => {
    const { video } = fakeVideo({ duration: 30 });
    const seeker = new Seeker(video);

    seeker.seek(12);

    expect(video.currentTime).toBe(12);
    expect(seeker.pending).toBeUndefined();
  });

  it('keeps only the last time asked for while a seek runs, and seeks to it when that ends', () => {
    const { video, media } = fakeVideo({ duration: 30 });
    const seeker = new Seeker(video);
    seeker.seek(5);
    media.seeking = true;

    seeker.seek(6);
    seeker.seek(7);

    expect(video.currentTime).toBe(5);
    expect(seeker.pending).toBe(7);
    media.seeking = false;
    video.dispatchEvent(new Event('seeked'));
    expect(video.currentTime).toBe(7);
    expect(seeker.pending).toBeUndefined();
  });

  it('seeks to a key frame when asked to be fast and the browser can', () => {
    const { video } = fakeVideo({ duration: 30 });
    const fastSeek = vi.fn();
    Object.defineProperty(video, 'fastSeek', { value: fastSeek });
    const seeker = new Seeker(video);

    seeker.seek(9, true);
    seeker.seek(10);

    expect(fastSeek).toHaveBeenCalledExactlyOnceWith(9);
    expect(video.currentTime).toBe(10);
  });

  it('drops the waiting time when cancelled, and stops when disposed', () => {
    const { video, media } = fakeVideo({ duration: 30 });
    const seeker = new Seeker(video);
    media.seeking = true;
    seeker.seek(8);
    seeker.cancel();
    video.dispatchEvent(new Event('seeked'));
    expect(video.currentTime).toBe(0);

    seeker.seek(9);
    seeker.dispose();
    video.dispatchEvent(new Event('seeked'));
    expect(video.currentTime).toBe(0);
  });
});
