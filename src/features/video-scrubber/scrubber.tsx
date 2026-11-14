import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { StripPlace } from './layout';
import type { MediaState } from './media';
import { STRIP_HEIGHT } from './layout';
import { formatTime, isSeekable, readMedia, Seeker, sameMedia, watchMedia } from './media';

/** How far the arrow keys move the video, in seconds. */
const KEY_STEP = 5;

/** Keeps the time bubble this far from the ends of the bar, in pixels, so it is not cut off. */
const BUBBLE_MARGIN = 20;

/** A value that can change, with a way to hear when it does. */
export interface Watched<T> {
  get: () => T;
  subscribe: (onChange: () => void) => () => void;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const percent = (fraction: number): string => `${clamp(fraction, 0, 1) * 100}%`;

/**
 * The video's state, read each time it is asked for. A read that finds
 * nothing shown has changed, such as after a `progress` while a paused video
 * loads the same ranges, keeps the old state, so nothing renders again.
 *
 * It is read in `get` because preact/compat checks the snapshot before it
 * subscribes. A change made between the render and the subscription, such
 * as the length arriving, is seen only that way.
 */
function useMedia(video: HTMLMediaElement): MediaState {
  const store = useMemo<Watched<MediaState>>(() => {
    let state = readMedia(video);
    return {
      get: () => {
        const next = readMedia(video);
        if (!sameMedia(state, next)) {
          state = next;
        }
        return state;
      },
      subscribe: (onChange) => watchMedia(video, onChange),
    };
  }, [video]);
  return useSyncExternalStore(store.subscribe, store.get);
}

interface ScrubberProps {
  video: HTMLVideoElement;
  /** Where the strip goes along the bottom of the video, and what of Facebook's it stands in for. */
  place: Watched<StripPlace>;
  /** Hides one of Facebook's elements, and returns a function that shows it again. */
  hide: (element: Element) => () => void;
}

/**
 * A thin bar along the bottom of a video that shows what has played and
 * what has loaded. It grows upward when the pointer comes onto its strip,
 * and a click or a drag on the strip moves the video. It is a slider for
 * the keyboard too.
 *
 * It shows nothing while the video's length is not known, or for a live
 * video, which has no end to measure against. Facebook's bar that it stands
 * in for is hidden only while it shows, so that bar is never hidden with
 * nothing in its place.
 */
export function Scrubber({ video, place, hide }: ScrubberProps) {
  const media = useMedia(video);
  const { left, right, hides } = useSyncExternalStore(place.subscribe, place.get);
  const seeker = useMemo(() => new Seeker(video), [video]);
  const zone = useRef<HTMLDivElement>(null);
  /** The bar's box, read when the pointer comes onto it or presses it, and dropped when the bar moves. */
  const box = useRef<DOMRect | null>(null);
  const placedAt = useRef('');
  const placeKey = `${left} ${right}`;
  if (placedAt.current !== placeKey) {
    placedAt.current = placeKey;
    box.current = null;
  }
  const dragging = useRef(false);
  /** Where the pointer is along the bar, in pixels, while it is over the bar or dragging. */
  const [pointer, setPointer] = useState<number | null>(null);
  /** The time being dragged to. */
  const [dragTime, setDragTime] = useState<number | null>(null);

  useEffect(() => () => seeker.dispose(), [seeker]);

  // Facebook can give the same element another video. What was going on
  // with the old one stops.
  useEffect(() => {
    const reset = (): void => {
      seeker.cancel();
      dragging.current = false;
      setDragTime(null);
      setPointer(null);
    };
    video.addEventListener('emptied', reset);
    return () => video.removeEventListener('emptied', reset);
  }, [video, seeker]);

  const { duration } = media;
  const shows = isSeekable(duration);
  // Preact runs this after the next paint, so for a frame Facebook's bar and
  // the strip can both show, or neither. The feature's hider shows the bar
  // again at once when the feature stops.
  useEffect(() => (shows && hides ? hide(hides) : undefined), [shows, hides, hide]);

  if (!shows) {
    return null;
  }

  const measure = (): DOMRect | null => {
    box.current = zone.current?.getBoundingClientRect() ?? null;
    return box.current;
  };
  /** The pointer's place along the bar, in pixels from its start. */
  const along = (clientX: number): number => {
    const rect = box.current ?? measure();
    return rect ? clamp(clientX - rect.left, 0, rect.width) : 0;
  };
  const timeAt = (x: number): number => {
    const width = box.current?.width ?? 0;
    return width > 0 ? (x / width) * duration : 0;
  };
  const dragTo = (clientX: number, done: boolean): void => {
    const x = along(clientX);
    const time = timeAt(x);
    setPointer(x);
    seeker.seek(time, !done);
    setDragTime(done ? null : time);
  };
  const endDrag = (): void => {
    dragging.current = false;
    setDragTime(null);
  };

  const shown = dragTime ?? seeker.pending ?? media.currentTime;
  const fraction = clamp(shown / duration, 0, 1);
  const width = box.current?.width ?? 0;
  const classes = ['zone'];
  if (dragTime !== null) {
    classes.push('dragging');
  } else if (!media.paused && seeker.pending === undefined) {
    classes.push('playing');
  }

  return (
    <div
      ref={zone}
      className={classes.join(' ')}
      style={{
        left: `${left}px`,
        right: `${right}px`,
        height: `${STRIP_HEIGHT}px`,
      }}
      role="slider"
      tabIndex={0}
      aria-label="Video position"
      aria-valuemin={0}
      aria-valuemax={Math.floor(duration)}
      aria-valuenow={Math.floor(shown)}
      aria-valuetext={`${formatTime(shown)} of ${formatTime(duration)}`}
      onPointerEnter={(event) => {
        measure();
        if (event.pointerType !== 'touch') {
          setPointer(along(event.clientX));
        }
      }}
      onPointerMove={(event) => {
        if (dragging.current) {
          dragTo(event.clientX, false);
        } else if (event.pointerType !== 'touch') {
          setPointer(along(event.clientX));
        }
      }}
      onPointerLeave={() => {
        if (!dragging.current) {
          setPointer(null);
        }
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return;
        }
        event.currentTarget.setPointerCapture(event.pointerId);
        dragging.current = true;
        measure();
        dragTo(event.clientX, false);
      }}
      onPointerUp={(event) => {
        if (!dragging.current) {
          return;
        }
        dragging.current = false;
        dragTo(event.clientX, true);
        if (event.pointerType === 'touch') {
          setPointer(null);
        }
      }}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onKeyDown={(event) => {
        const now = seeker.pending ?? video.currentTime;
        let time: number;
        if (event.key === 'ArrowLeft') {
          time = now - KEY_STEP;
        } else if (event.key === 'ArrowRight') {
          time = now + KEY_STEP;
        } else if (event.key === 'Home') {
          time = 0;
        } else if (event.key === 'End') {
          time = duration;
        } else {
          return;
        }
        event.preventDefault();
        seeker.seek(clamp(time, 0, duration));
      }}
    >
      <div className="track">
        {media.buffered.map(([start, end]) => (
          <div
            key={start}
            className="buffered"
            style={{ left: percent(start / duration), width: percent((end - start) / duration) }}
          />
        ))}
        <div className="played" style={{ transform: `scaleX(${fraction})` }} />
        <div className="head" style={{ transform: `translateX(${percent(fraction)})` }}>
          <div className="thumb" />
        </div>
      </div>
      <div className="time">
        {formatTime(shown)} / {formatTime(duration)}
      </div>
      {pointer !== null && (
        <div
          className="bubble"
          style={{
            left: `${clamp(pointer, BUBBLE_MARGIN, Math.max(BUBBLE_MARGIN, width - BUBBLE_MARGIN))}px`,
          }}
        >
          {formatTime(timeAt(pointer))}
        </div>
      )}
    </div>
  );
}
