import type { Scope } from '../../../core/scope';
import type { InstagramVideo } from '../videos';
import { intercept, isPlainPress, PRESS_EVENTS } from '../../../core/intercept';
import { PauseHolds } from '../../../features/video-click-pauses/hold';
import { hasControlAt, measureControls, pointIn } from '../../../features/video-layout';
import { overlayEachVideo } from '../../../features/video-overlay';
import { AT_BOTTOM, placeStrip, samePlace } from '../../../features/video-scrubber/layout';
import { Scrubber } from '../../../features/video-scrubber/scrubber';
import scrubberCss from '../../../features/video-scrubber/scrubber.css?inline';
import { defineInstagramFeature } from '../feature';
import { IG_VIDEO_CONTROL } from '../selectors';

const noopHide = () => () => undefined;
const DRAG_DISTANCE = 5;

interface Press {
  readonly pointerId: number;
  readonly video: InstagramVideo;
  readonly x: number;
  readonly y: number;
  moved: boolean;
}

const isPlainPointer = (event: PointerEvent): boolean => event.isPrimary && isPlainPress(event);

const distance = (a: { x: number; y: number }, event: MouseEvent): number =>
  Math.hypot(event.clientX - a.x, event.clientY - a.y);

/**
 * Adds Feed Sanity's bottom video scrubber and click-to-pause behavior to
 * Instagram feed and Reels videos, reusing the shared `overlayEachVideo`,
 * `Scrubber`, `hasControlAt`, and `PauseHolds` primitives.
 */
export default defineInstagramFeature({
  id: 'ig_video_controls',
  options: {
    ig_video_scrubber: {
      section: 'Videos',
      title: 'Video scrubber',
      description:
        'Show a seekable progress bar along the bottom edge of Instagram videos and Reels.',
      default: true,
    },
    ig_video_click_pauses: {
      section: 'Videos',
      title: 'Click to pause',
      description: 'Click an Instagram feed video to pause or resume playback.',
      default: true,
    },
  },
  setup({ page, options, scope, log }) {
    let scrubberScope: Scope | undefined;
    let clickScope: Scope | undefined;

    const startClickToPause = (subScope: Scope): void => {
      const holds = new PauseHolds(subScope, log);
      const controls = page.locate(IG_VIDEO_CONTROL);
      subScope.add(page.videos.onRemove((video) => holds.release(video.element)));
      subScope.add(page.videos.onAdd(() => undefined));

      const videoAt = (event: MouseEvent): InstagramVideo | undefined => {
        if (!(event.target instanceof Element)) {
          return undefined;
        }
        const article = event.target.closest('article');
        if (!article) {
          return undefined;
        }
        const video = page.videos.around(event.target, article);
        if (!video || video.surface !== 'feed') {
          return undefined;
        }
        const box = video.element.getBoundingClientRect();
        if (
          !pointIn(box, event.clientX, event.clientY) ||
          hasControlAt(event.clientX, event.clientY, video.element, box, controls, page.doc)
        ) {
          return undefined;
        }
        return video;
      };

      let press: Press | undefined;

      intercept(
        subScope,
        [...PRESS_EVENTS, 'keydown'],
        (event) => {
          if (event.type === 'keydown') {
            holds.gesture(event);
            return false;
          }
          if (event.type === 'pointerdown') {
            press = undefined;
            const pointer = event as PointerEvent;
            if (!isPlainPointer(pointer)) {
              holds.gesture(event);
              return false;
            }
            const video = videoAt(pointer);
            if (!video) {
              holds.gesture(event);
              return false;
            }
            press = {
              pointerId: pointer.pointerId,
              video,
              x: pointer.clientX,
              y: pointer.clientY,
              moved: false,
            };
            return true;
          }
          const current = press;
          if (!current) {
            holds.gesture(event);
            return false;
          }
          const isPointer = event.type === 'pointerup' || event.type === 'pointercancel';
          if (isPointer && (event as PointerEvent).pointerId !== current.pointerId) {
            return false;
          }
          switch (event.type) {
            case 'pointercancel':
              press = undefined;
              return false;
            case 'pointerup':
              current.moved = distance(current, event as PointerEvent) > DRAG_DISTANCE;
              return true;
            case 'click': {
              press = undefined;
              const mouse = event as MouseEvent;
              if (mouse.detail === 0) {
                return false;
              }
              mouse.preventDefault();
              if (current.moved || !current.video.element.isConnected) {
                return true;
              }
              const el = current.video.element;
              if (el.paused) {
                holds.release(el);
                el.play().catch((error: unknown) => log.debug('could not play the video', error));
              } else {
                el.pause();
                holds.hold(current.video);
              }
              return true;
            }
            default:
              return true;
          }
        },
        log,
      );
    };

    options.watch('ig_video_scrubber', (enabled) => {
      if (enabled && !scrubberScope) {
        scrubberScope = scope.child();
        overlayEachVideo<ReturnType<typeof placeStrip>, InstagramVideo>(
          { page, scope: scrubberScope, log },
          {
            css: scrubberCss,
            initial: AT_BOTTOM,
            measure: (video) =>
              placeStrip(video.element.getBoundingClientRect(), measureControls(video)),
            same: samePlace,
            render: (video, place) => (
              <Scrubber video={video.element} place={place} hide={noopHide} />
            ),
          },
        );
      } else if (!enabled && scrubberScope) {
        scrubberScope.dispose();
        scrubberScope = undefined;
      }
    });

    options.watch('ig_video_click_pauses', (enabled) => {
      if (enabled && !clickScope) {
        clickScope = scope.child();
        startClickToPause(clickScope);
      } else if (!enabled && clickScope) {
        clickScope.dispose();
        clickScope = undefined;
      }
    });
  },
});
