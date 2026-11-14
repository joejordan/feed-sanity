import type { Logger } from '../../core/log';
import type { Scope } from '../../core/scope';
import type { Video } from '../../facebook/videos';

/**
 * How soon before a video starts a press or a key press inside its container
 * counts as the person starting it, in milliseconds.
 */
const GESTURE_MS = 1000;

/** After Facebook starts a held video this many times within `RESTARTS_MS`, the video is let go. */
const MAX_RESTARTS = 3;
const RESTARTS_MS = 10_000;

interface Hold {
  /** When Facebook started the video, recently. */
  restarts: number[];
  /** Ends the hold's listeners. */
  readonly scope: Scope;
}

/**
 * Keeps videos the person paused paused. Facebook starts a video again when
 * it scrolls back into view, as it does not know about a pause made from
 * outside its player. A held video that starts with no press or key press
 * of the person's inside its container just before is paused again.
 *
 * A video is let go when the person starts it, when its element is emptied
 * or given another video, when it leaves the page, and when Facebook keeps
 * starting it, so the two never fight in a loop. Every hold ends with
 * `scope`.
 */
export class PauseHolds {
  readonly #scope: Scope;
  readonly #log: Logger;
  readonly #held = new Map<HTMLVideoElement, Hold>();
  #gesture: { time: number; target: EventTarget | null } | undefined;

  constructor(scope: Scope, log: Logger) {
    this.#scope = scope;
    this.#log = log;
  }

  /** Keeps `video` paused until the person starts it. */
  hold(video: Video): void {
    const { element } = video;
    if (this.#held.has(element)) {
      return;
    }
    const hold: Hold = { restarts: [], scope: this.#scope.child() };
    const play = (event: Event): void => this.#played(video, hold, event);
    const emptied = (): void => this.release(element);
    element.addEventListener('play', play);
    element.addEventListener('emptied', emptied);
    hold.scope.add(() => {
      element.removeEventListener('play', play);
      element.removeEventListener('emptied', emptied);
    });
    this.#held.set(element, hold);
  }

  release(element: HTMLVideoElement): void {
    this.#held.get(element)?.scope.dispose();
    this.#held.delete(element);
  }

  /** Notes a press or a key press by the person, which may be what starts a video. */
  gesture(event: Event): void {
    this.#gesture = { time: event.timeStamp, target: event.target };
  }

  #played(video: Video, hold: Hold, event: Event): void {
    const { element } = video;
    const gesture = this.#gesture;
    if (
      gesture &&
      event.timeStamp - gesture.time < GESTURE_MS &&
      gesture.target instanceof Node &&
      video.container?.contains(gesture.target)
    ) {
      this.release(element);
      return;
    }
    hold.restarts = hold.restarts.filter((time) => event.timeStamp - time < RESTARTS_MS);
    hold.restarts.push(event.timeStamp);
    if (hold.restarts.length > MAX_RESTARTS) {
      this.release(element);
      this.#log.debug('let a paused video go: Facebook kept starting it again');
      return;
    }
    element.pause();
  }
}
