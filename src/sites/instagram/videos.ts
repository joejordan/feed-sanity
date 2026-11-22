import type { DomEnvironment } from '../../core/dom-env';
import type { Locate } from '../../core/locator';
import type { SiteVideo } from '../shared/videos';
import { OWN_ATTR } from '../../core/surface';
import { SiteVideos } from '../shared/videos';
import { IG_VIDEO, IG_VIDEO_CONTROL } from './selectors';

export type InstagramVideo = SiteVideo;

const CONTAINER_STOP_TAGS = new Set(['ARTICLE', 'MAIN', 'SECTION', 'BODY', 'HTML']);
const MAX_CONTAINER_ASCENT = 12;

function hasMultipleNonOwnChildren(element: Element): boolean {
  let count = 0;
  for (let child = element.firstElementChild; child; child = child.nextElementSibling) {
    if (!child.hasAttribute(OWN_ATTR) && ++count > 1) {
      return true;
    }
  }
  return false;
}

function hasSiblingVideo(parent: Element, excludedBranch: Element): boolean {
  for (let child = parent.firstElementChild; child; child = child.nextElementSibling) {
    if (child === excludedBranch || child.hasAttribute(OWN_ATTR)) {
      continue;
    }
    if (child.tagName === 'VIDEO' || child.querySelector('video') !== null) {
      return true;
    }
  }
  return false;
}

/**
 * Finds the Instagram player wrapper above the single-child `z-index: 0`
 * stacking-context wrappers that enclose `<video>`, stopping at the first
 * ancestor that holds sibling overlay/control layers alongside this single
 * video (works for both feed posts and Reels).
 */
export function resolveInstagramVideoContainer(video: HTMLVideoElement): HTMLElement {
  const fallback = video.parentElement ?? video;
  let prev: Element = video;
  let current: HTMLElement | null = video.parentElement;
  for (let depth = 0; current && depth < MAX_CONTAINER_ASCENT; depth++) {
    if (CONTAINER_STOP_TAGS.has(current.tagName)) {
      break;
    }
    if (hasMultipleNonOwnChildren(current)) {
      return hasSiblingVideo(current, prev) ? fallback : current;
    }
    prev = current;
    current = current.parentElement;
  }
  return fallback;
}

/**
 * Tracks `<video>` elements on Instagram via shared `SiteVideos` so video
 * controls (scrubber, click-to-pause) work across feed posts and Reels.
 */
export class InstagramVideos extends SiteVideos {
  constructor(env: DomEnvironment, locate: Locate) {
    super(env, locate, {
      logName: 'ig-videos',
      videoSpec: IG_VIDEO,
      controlSpec: IG_VIDEO_CONTROL,
      resolveContainer: resolveInstagramVideoContainer,
      resolveSurface: (element) => {
        if (element.closest('article')) {
          return 'feed';
        }
        if (location.pathname.startsWith('/reels')) {
          return 'reel';
        }
        if (location.pathname.startsWith('/stories')) {
          return 'story';
        }
        return 'other';
      },
    });
  }
}
