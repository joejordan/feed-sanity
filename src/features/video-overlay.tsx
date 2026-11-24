import type { ReactNode } from 'react';
import type { Logger } from '../core/log';
import type { Scope } from '../core/scope';
import type { Video } from '../facebook/videos';
import type { MountedOverlay } from '../ui/overlay';
import type { Watched } from '../ui/watched';
import { Listeners } from '../core/listeners';
import { mountOverlay } from '../ui/overlay';

/** Minimal video shape required by `overlayEachVideo`. */
export type OverlayVideo = Pick<Video, 'element' | 'container'>;

export interface VideoOverlaySource<V extends OverlayVideo = Video> {
  readonly onAdd: (listener: (video: V) => void) => () => void;
  readonly onRemove: (listener: (video: V) => void) => () => void;
  readonly onControls?: (listener: (video: V) => void) => () => void;
}

export interface VideoOverlayOptions<T, V extends OverlayVideo = Video> {
  /** Style sheet for the overlay's shadow root. */
  css: string;
  /** The place before the first measurement. */
  initial: T;
  /**
   * Where the UI goes on `video`. It runs while the overlays are measured
   * (see `onMeasure` in `src/ui/overlay.tsx`), so it may read the page's
   * layout but must not change the page.
   */
  measure: (video: V) => T;
  same: (a: T, b: T) => boolean;
  /** The UI for `video`. */
  render: (video: V, place: Watched<T>) => ReactNode;
}

/**
 * Lays UI over every video on the page, and each one that comes later,
 * with `mountOverlay` in the video's container. The UI's place is measured
 * when the overlay is, again when the tracker reports that host controls
 * may have moved, and again each time the pointer comes over the container.
 * The overlay goes when its video leaves the page, and every one goes when
 * `scope` is disposed.
 */
const POINTER_MEASURE_COOLDOWN_MS = 250;

export function overlayEachVideo<T, V extends OverlayVideo = Video>(
  { page, scope, log }: { page: { videos: VideoOverlaySource<V> }; scope: Scope; log: Logger },
  { css, initial, measure, same, render }: VideoOverlayOptions<T, V>,
): void {
  const shown = new Map<V, MountedOverlay & { stop: () => void }>();
  const remove = (video: V): void => {
    const overlay = shown.get(video);
    overlay?.stop();
    overlay?.();
    shown.delete(video);
  };
  scope.add(() => {
    for (const video of shown.keys()) {
      remove(video);
    }
  });
  const measureAll = (): void => {
    for (const overlay of shown.values()) {
      overlay.measure();
    }
  };
  document.addEventListener('fullscreenchange', measureAll);
  scope.add(() => document.removeEventListener('fullscreenchange', measureAll));
  if (page.videos.onControls) {
    scope.add(page.videos.onControls((video) => shown.get(video)?.measure()));
  }
  scope.add(page.videos.onRemove(remove));
  // Also called at once with the videos already on the page.
  scope.add(
    page.videos.onAdd((video) => {
      let place = initial;
      let lastEnterAt = -POINTER_MEASURE_COOLDOWN_MS;
      const moved = new Listeners(log);
      const ui = render(video, { get: () => place, subscribe: (listener) => moved.add(listener) });
      /** The container the pointer is listened for on. */
      let entered: Element | null = null;
      const enter = (): void => {
        const now = performance.now();
        if (now - lastEnterAt < POINTER_MEASURE_COOLDOWN_MS) {
          return;
        }
        lastEnterAt = now;
        shown.get(video)?.measure();
      };
      const follow = (container: Element | null): void => {
        if (container !== entered) {
          entered?.removeEventListener('pointerenter', enter);
          container?.addEventListener('pointerenter', enter, { passive: true });
          entered = container;
        }
      };
      const overlay = mountOverlay(video.element, ui, {
        container: () => video.container,
        css,
        onMeasure: () => {
          follow(video.container);
          const next = measure(video);
          if (!same(place, next)) {
            place = next;
            moved.emit();
          }
        },
      });
      shown.set(video, Object.assign(overlay, { stop: () => follow(null) }));
    }),
  );
}
