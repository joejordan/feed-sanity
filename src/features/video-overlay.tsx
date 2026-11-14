import type { ReactNode } from 'react';
import type { Logger } from '../core/log';
import type { Scope } from '../core/scope';
import type { FacebookPage } from '../facebook/feature';
import type { Video } from '../facebook/videos';
import type { MountedOverlay } from '../ui/overlay';
import type { Watched } from '../ui/watched';
import { Listeners } from '../core/listeners';
import { mountOverlay } from '../ui/overlay';

export interface VideoOverlayOptions<T> {
  /** Style sheet for the overlay's shadow root. */
  css: string;
  /** The place before the first measurement. */
  initial: T;
  /**
   * Where the UI goes on `video`. It runs while the overlays are measured
   * (see `onMeasure` in `src/ui/overlay.tsx`), so it may read the page's
   * layout but must not change the page.
   */
  measure: (video: Video) => T;
  same: (a: T, b: T) => boolean;
  /** The UI for `video`. */
  render: (video: Video, place: Watched<T>) => ReactNode;
}

/**
 * Lays UI over every video on the page, and each one that comes later,
 * with `mountOverlay` in the video's container. The UI's place is measured
 * when the overlay is, again when the tracker reports that Facebook's
 * controls may have moved, and again each time the pointer comes over the
 * container, since Facebook's controls fade in then and its elements can
 * change without a resize. The overlay goes when its video leaves the page,
 * and every one goes when `scope` is disposed.
 */
export function overlayEachVideo<T>(
  { page, scope, log }: { page: FacebookPage; scope: Scope; log: Logger },
  { css, initial, measure, same, render }: VideoOverlayOptions<T>,
): void {
  const shown = new Map<Video, MountedOverlay & { stop: () => void }>();
  const remove = (video: Video): void => {
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
  page.videos.onControls((video) => shown.get(video)?.measure());
  page.videos.onRemove(remove);
  // Also called at once with the videos already on the page.
  page.videos.onAdd((video) => {
    let place = initial;
    const moved = new Listeners(log);
    const ui = render(video, { get: () => place, subscribe: (listener) => moved.add(listener) });
    /** The container the pointer is listened for on. */
    let entered: Element | null = null;
    const enter = (): void => shown.get(video)?.measure();
    const follow = (container: Element | null): void => {
      if (container !== entered) {
        entered?.removeEventListener('pointerenter', enter);
        container?.addEventListener('pointerenter', enter);
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
  });
}
