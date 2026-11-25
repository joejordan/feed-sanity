import type { Video } from '../../facebook/videos';
import { intercept, isPlainPress, PRESS_EVENTS } from '../../core/intercept';
import { defineFeature } from '../../facebook/feature';
import { STORY_ID, VIDEO_CONTROL, VIDEO_POST } from '../../facebook/selectors';
import { storyCardOf, storyMenuOpen, storyPauseButton } from '../../facebook/stories';
import { hasControlAt, isVideoInFullscreen, pointIn } from '../video-layout';
import { PauseHolds } from './hold';

/**
 * A second press on the same video this soon after a click goes to
 * Facebook, so a double click opens the video as Facebook would. Windows
 * counts clicks this close together as a double click unless the user has
 * changed it.
 */
const DOUBLE_CLICK_MS = 500;

/** A press that moves further than this, in pixels, is a drag and pauses nothing. */
const DRAG_DISTANCE = 5;

/** What a press on a picture is for: a video in a post, or a story in the stories viewer. */
type Pressed =
  | { readonly kind: 'video'; readonly video: Video }
  | {
      readonly kind: 'story';
      readonly card: HTMLElement;
      /** The story's ID when the press began, as the card is given the next story when one ends. */
      readonly id: string | null;
      readonly pause: Element;
    };

interface Press {
  readonly pointerId: number;
  readonly on: Pressed;
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

const isPlain = (event: PointerEvent): boolean => event.isPrimary && isPlainPress(event);

const distance = (a: { x: number; y: number }, event: MouseEvent): number =>
  Math.hypot(event.clientX - a.x, event.clientY - a.y);

/**
 * Clicking a video in a post pauses it or plays it again, where Facebook
 * would open it in a viewer with the sound on. Clicking a story in the
 * stories viewer, video or photo, pauses or plays it with the story's own
 * pause and play button, so Facebook's timer and progress bar stay in step.
 * New in this project.
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
      section: 'Media',
      group: 'Videos',
      title: 'Click to pause',
      description:
        "Clicking a video in a post pauses or plays it, where Facebook would open it in a viewer; double-click to open the viewer. Clicking a story pauses or plays it; the story's own buttons still go to the next or previous one.",
      default: true,
    },
  },
  enabledBy: 'video_click_pauses',
  setup({ page, scope, log }) {
    const holds = new PauseHolds(scope, log);
    scope.add(page.videos.onRemove((video) => holds.release(video.element)));
    // Following the videos is what makes `around` find them.
    scope.add(page.videos.onAdd(() => undefined));
    const controls = page.locate(VIDEO_CONTROL);
    const posts = page.locate(VIDEO_POST);

    /** Stories with no pause button found, which have been reported once. */
    const noPauseButton = new WeakSet<Element>();

    /** True when something meant for clicking lies over `below` at the pointer, which is on `picture`. */
    const controlAt = (x: number, y: number, below: Element, picture: DOMRect): boolean =>
      hasControlAt(x, y, below, picture, controls);

    /**
     * True when a press on the story is meant to close something first: its
     * open menu, or the reply box or other field outside the card that has
     * focus. Facebook hears such a press, and the story is left as it is.
     */
    const pressCloses = (card: Element): boolean => {
      const focused = document.activeElement;
      const typing =
        focused instanceof HTMLInputElement ||
        focused instanceof HTMLTextAreaElement ||
        (focused instanceof HTMLElement && focused.isContentEditable);
      return (typing && !card.contains(focused)) || storyMenuOpen(card, page.locate);
    };

    /**
     * The story whose picture is at the pointer, with nothing meant for
     * clicking over it, and its pause button. The picture is the story card,
     * so a photo story counts as well as a video story. Header buttons
     * outside the card, the next and previous buttons and the reply area are
     * not in it.
     */
    const storyAt = ({ target, clientX: x, clientY: y }: MouseEvent): Pressed | undefined => {
      const card = target instanceof Element ? storyCardOf(target, page.locate) : null;
      if (!card) {
        return undefined;
      }
      const picture = card.getBoundingClientRect();
      if (!pointIn(picture, x, y) || controlAt(x, y, card, picture) || pressCloses(card)) {
        return undefined;
      }
      const pause = storyPauseButton(card, page.locate);
      if (!pause) {
        if (!noPauseButton.has(card)) {
          noPauseButton.add(card);
          log.debug('found no pause button for a story, so clicks on it go to Facebook');
        }
        return undefined;
      }
      return { kind: 'story', card, id: card.getAttribute(STORY_ID), pause };
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
      // Leave native fullscreen controls and scrubbers untouched.
      if (isVideoInFullscreen(video.element)) {
        return undefined;
      }
      const picture = video.element.getBoundingClientRect();
      if (!pointIn(picture, x, y) || controlAt(x, y, video.element, picture)) {
        return undefined;
      }
      return video;
    };

    let press: Press | undefined;
    let lastClick: Click | undefined;
    /** The story the last click paused or played. */
    let lastStoryClick: { card: Element; time: number } | undefined;

    const pressed = (event: PointerEvent): boolean => {
      press = undefined;
      if (!isPlain(event)) {
        return false;
      }
      const start = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        moved: false,
      };
      // Every click on a story counts, so a double click pauses and plays it again.
      const story = storyAt(event);
      if (story) {
        press = { ...start, on: story };
        return true;
      }
      const video = pictureAt(event);
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
      press = { ...start, on: { kind: 'video', video } };
      return true;
    };

    const clicked = (event: MouseEvent, { on, moved }: Press): void => {
      press = undefined;
      event.preventDefault();
      if (moved) {
        return;
      }
      if (on.kind === 'story') {
        // The story ended under the press and the card shows the next one.
        if (on.card.getAttribute(STORY_ID) !== on.id) {
          return;
        }
        // The button may have been drawn again since the press began.
        const pause = on.pause.isConnected ? on.pause : storyPauseButton(on.card, page.locate);
        if (pause instanceof HTMLElement) {
          // Its click passes this listener, as no press is going on.
          pause.click();
        }
        lastStoryClick = { card: on.card, time: event.timeStamp };
        return;
      }
      const { video } = on;
      if (!video.element.isConnected) {
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
      [...PRESS_EVENTS, 'dblclick', 'keydown'],
      (event) => {
        // A double click on a story has toggled it twice; Facebook does not hear of it.
        if (event.type === 'dblclick') {
          const story = lastStoryClick;
          return (
            story !== undefined &&
            event.timeStamp - story.time < DOUBLE_CLICK_MS &&
            event.target instanceof Node &&
            story.card.contains(event.target)
          );
        }
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
