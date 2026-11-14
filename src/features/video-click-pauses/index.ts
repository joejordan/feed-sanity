import type { Video } from '../../facebook/videos';
import { intercept } from '../../core/intercept';
import { defineFeature } from '../../facebook/feature';
import { OWN_ELEMENT, VIDEO_CONTROL, VIDEO_POST } from '../../facebook/selectors';
import { PauseHolds } from './hold';

/**
 * The events of one press. Facebook opens the viewer from one of them, and
 * all of them are kept from it so that it is not left half way through a
 * press it never saw end.
 */
const PRESS_EVENTS = [
  'pointerdown',
  'touchstart',
  'mousedown',
  'pointerup',
  'touchend',
  'mouseup',
  'click',
  'pointercancel',
] as const;

/**
 * A second press on the same video this soon after a click goes to
 * Facebook, so a double click opens the video as Facebook would. Windows
 * counts clicks this close together as a double click unless the user has
 * changed it.
 */
const DOUBLE_CLICK_MS = 500;

/** A press that moves further than this, in pixels, is a drag and pauses nothing. */
const DRAG_DISTANCE = 5;

interface Press {
  readonly pointerId: number;
  readonly video: Video;
  readonly x: number;
  readonly y: number;
  moved: boolean;
}

interface Click {
  readonly video: Video;
  readonly time: number;
  readonly x: number;
  readonly y: number;
}

const isPlain = (event: PointerEvent): boolean =>
  event.isPrimary &&
  event.button === 0 &&
  !(event.altKey || event.ctrlKey || event.metaKey || event.shiftKey);

const distance = (a: { x: number; y: number }, event: MouseEvent): number =>
  Math.hypot(event.clientX - a.x, event.clientY - a.y);

/**
 * Clicking a video in a post pauses it or plays it again, where Facebook
 * would open it in a viewer with the sound on. New in this project.
 *
 * Only a plain click on the picture counts. Presses on Facebook's player
 * controls, links and this project's own UI, presses of other buttons and
 * presses with a modifier key all go on to Facebook as before, and so does
 * the second click of a double click, which opens the viewer.
 *
 * Whether a press is kept from Facebook is settled when it starts. A press
 * on the picture that then moves is a drag: it is kept from Facebook all
 * the same, so Facebook never sees the end of a press whose start it
 * missed, and it pauses nothing.
 *
 * A video paused this way stays paused until the person starts it; see
 * `PauseHolds`.
 */
export default defineFeature({
  id: 'video_click_pauses',
  options: {
    video_click_pauses: {
      section: 'Videos',
      title: 'Click to pause',
      description:
        'Clicking a video in a post pauses or plays it, where Facebook would open it in a viewer. Double-click to open the viewer.',
      default: true,
    },
  },
  enabledBy: 'video_click_pauses',
  setup({ page, scope, log }) {
    const holds = new PauseHolds(scope, log);
    page.videos.onRemove((video) => holds.release(video.element));
    // Following the videos is what makes `around` find them.
    page.videos.onAdd(() => undefined);
    const controls = page.locate(VIDEO_CONTROL);
    const posts = page.locate(VIDEO_POST);

    /**
     * True for something over the picture that a click is meant for. A
     * control that covers most of the picture is the layer Facebook takes
     * the click with, which is the picture as far as the user can tell.
     */
    const isControlOver = (element: Element, picture: DOMRect): boolean => {
      if (element.matches(OWN_ELEMENT)) {
        return true;
      }
      if (!controls.matches(element)) {
        return false;
      }
      const control = element.getBoundingClientRect();
      return control.width * control.height < (picture.width * picture.height) / 2;
    };

    /** The feed video whose picture is at the pointer, with nothing meant for clicking over it. */
    const pictureAt = ({ target, clientX: x, clientY: y }: MouseEvent): Video | undefined => {
      if (!(target instanceof Element)) {
        return undefined;
      }
      const post = posts.closest(target);
      if (!post) {
        return undefined;
      }
      // Facebook lays an element over the video to take the click, and the
      // video may take no pointer events of its own, so the video is found
      // from what was pressed.
      const video = page.videos.around(target, post);
      if (video?.surface !== 'feed') {
        return undefined;
      }
      const picture = video.element.getBoundingClientRect();
      if (x < picture.left || x > picture.right || y < picture.top || y > picture.bottom) {
        return undefined;
      }
      // What is under the pointer, top first. The video's ancestors come after it.
      const stack = document.elementsFromPoint(x, y);
      const { element } = video;
      const below = stack.findIndex((item) => item === element || item.contains(element));
      const over = below === -1 ? stack : stack.slice(0, below);
      return over.some((item) => isControlOver(item, picture)) ? undefined : video;
    };

    let press: Press | undefined;
    let lastClick: Click | undefined;

    const pressed = (event: PointerEvent): boolean => {
      press = undefined;
      const video = isPlain(event) ? pictureAt(event) : undefined;
      if (!video) {
        return false;
      }
      const previous = lastClick;
      lastClick = undefined;
      if (
        previous?.video === video &&
        event.timeStamp - previous.time < DOUBLE_CLICK_MS &&
        distance(previous, event) <= DRAG_DISTANCE
      ) {
        // The person asked for the viewer, and Facebook may start this
        // video again when it closes.
        holds.release(video.element);
        return false;
      }
      press = {
        pointerId: event.pointerId,
        video,
        x: event.clientX,
        y: event.clientY,
        moved: false,
      };
      return true;
    };

    const clicked = (event: MouseEvent, { video, moved }: Press): void => {
      press = undefined;
      event.preventDefault();
      if (moved || !video.element.isConnected) {
        return;
      }
      lastClick = { video, time: event.timeStamp, x: event.clientX, y: event.clientY };
      const { element } = video;
      if (element.paused) {
        holds.release(element);
        element.play().catch((error: unknown) => log.debug('could not play the video', error));
      } else {
        element.pause();
        holds.hold(video);
      }
    };

    intercept(
      scope,
      [...PRESS_EVENTS, 'keydown'],
      (event) => {
        // A press or key press that goes to Facebook may start a held video.
        if (event.type === 'keydown') {
          holds.gesture(event);
          return false;
        }
        if (event.type === 'pointerdown') {
          const taken = pressed(event as PointerEvent);
          if (!taken) {
            holds.gesture(event);
          }
          return taken;
        }
        const current = press;
        if (!current) {
          // Facebook can start a video on the release or on the click, and
          // the press may have begun long before.
          holds.gesture(event);
          return false;
        }
        // Another finger or pen. Chrome's clicks carry a pointer ID too, but
        // only the pointer events of the press are matched against it.
        const pointer = event.type === 'pointerup' || event.type === 'pointercancel';
        if (pointer && (event as PointerEvent).pointerId !== current.pointerId) {
          return false;
        }
        switch (event.type) {
          case 'pointercancel':
            press = undefined;
            return false;
          case 'pointerup':
            current.moved = distance(current, event as PointerEvent) > DRAG_DISTANCE;
            return true;
          case 'click':
            // A click made with the keyboard does not end a press. One that
            // ended without a click, as when let go outside the window, is
            // over by now.
            if ((event as MouseEvent).detail === 0) {
              press = undefined;
              return false;
            }
            clicked(event as MouseEvent, current);
            return true;
          default:
            return true;
        }
      },
      log,
    );
  },
});
