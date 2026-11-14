/** What the scrubber shows of a video at one moment. */
export interface MediaState {
  readonly currentTime: number;
  /** NaN while it is not known yet, and Infinity for a live video. */
  readonly duration: number;
  readonly paused: boolean;
  /** The buffered ranges, each as start and end in seconds. */
  readonly buffered: readonly (readonly [number, number])[];
}

/** The events after which a video's state can differ. The browser fires `timeupdate` only while it plays. */
const MEDIA_EVENTS = [
  'durationchange',
  'emptied',
  'ended',
  'loadedmetadata',
  'pause',
  'play',
  'progress',
  'seeked',
  'seeking',
  'timeupdate',
] as const;

export function readMedia(video: HTMLMediaElement): MediaState {
  const ranges: [number, number][] = [];
  const { buffered } = video;
  for (let index = 0; index < buffered.length; index++) {
    ranges.push([buffered.start(index), buffered.end(index)]);
  }
  return {
    currentTime: video.currentTime,
    duration: video.duration,
    paused: video.paused,
    buffered: ranges,
  };
}

/** True when `a` and `b` would show the same. */
export function sameMedia(a: MediaState, b: MediaState): boolean {
  return (
    a.currentTime === b.currentTime &&
    // NaN is a length too, while it is not known.
    Object.is(a.duration, b.duration) &&
    a.paused === b.paused &&
    a.buffered.length === b.buffered.length &&
    a.buffered.every(
      ([start, end], index) => start === b.buffered[index]?.[0] && end === b.buffered[index]?.[1],
    )
  );
}

/** Calls `listener` after each event that can change the video's state. Returns a function that stops it. */
export function watchMedia(video: HTMLMediaElement, listener: () => void): () => void {
  for (const type of MEDIA_EVENTS) {
    video.addEventListener(type, listener);
  }
  return () => {
    for (const type of MEDIA_EVENTS) {
      video.removeEventListener(type, listener);
    }
  };
}

/** True for a duration the scrubber can show: known, and not that of a live video. */
export const isSeekable = (duration: number): boolean => Number.isFinite(duration) && duration > 0;

/** `1:05`, or `1:02:05` from an hour on. */
export function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const pad = (value: number): string => String(value).padStart(2, '0');
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = pad(whole % 60);
  return hours > 0 ? `${hours}:${pad(minutes)}:${rest}` : `${minutes}:${rest}`;
}

/**
 * Moves a video to new times without asking for a seek while the last one
 * is still running. Times asked for meanwhile replace each other, and the
 * last one is used when the running seek ends, so a drag sends the video as
 * many seeks as it can handle and ends at the time it was let go at.
 */
export class Seeker {
  readonly #video: HTMLMediaElement;
  #pending: { time: number; fast: boolean } | undefined;

  constructor(video: HTMLMediaElement) {
    this.#video = video;
    video.addEventListener('seeked', this.#next);
  }

  /** The time waiting for the running seek to end, if any. */
  get pending(): number | undefined {
    return this.#pending?.time;
  }

  /**
   * Moves the video to `time`. With `fast`, a browser that can seek to the
   * nearest key frame does, which suits a drag.
   */
  seek(time: number, fast = false): void {
    if (this.#video.seeking) {
      this.#pending = { time, fast };
    } else {
      this.#apply(time, fast);
    }
  }

  /** Drops the time waiting, as when the video element is given another video. */
  cancel(): void {
    this.#pending = undefined;
  }

  dispose(): void {
    this.cancel();
    this.#video.removeEventListener('seeked', this.#next);
  }

  readonly #next = (): void => {
    const pending = this.#pending;
    this.#pending = undefined;
    if (pending) {
      this.#apply(pending.time, pending.fast);
    }
  };

  #apply(time: number, fast: boolean): void {
    if (fast && typeof this.#video.fastSeek === 'function') {
      this.#video.fastSeek(time);
    } else {
      this.#video.currentTime = time;
    }
  }
}
