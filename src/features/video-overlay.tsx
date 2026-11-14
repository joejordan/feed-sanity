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
  /** The UI for `video`. `remeasure` asks for its place to be measured again soon. */
  render: (video: Video, place: Watched<T>, remeasure: () => void) => ReactNode;
}

/**
 * Lays UI over every video on the page, and each one that comes later,
 * with `mountOverlay` in the video's container. The UI's place is measured
 * when the overlay is, and again when the tracker reports that Facebook's
 * controls may have moved. The overlay goes when its video leaves the page,
 * and every one goes when `scope` is disposed.
 */
export function overlayEachVideo<T>(
  { page, scope, log }: { page: FacebookPage; scope: Scope; log: Logger },
  { css, initial, measure, same, render }: VideoOverlayOptions<T>,
): void {
  const shown = new Map<Video, MountedOverlay>();
  const remove = (video: Video): void => {
    shown.get(video)?.();
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
    const ui = render(
      video,
      { get: () => place, subscribe: (listener) => moved.add(listener) },
      () => shown.get(video)?.measure(),
    );
    const overlay = mountOverlay(video.element, ui, {
      container: () => video.container,
      css,
      onMeasure: () => {
        const next = measure(video);
        if (!same(place, next)) {
          place = next;
          moved.emit();
        }
      },
    });
    shown.set(video, overlay);
  });
}
