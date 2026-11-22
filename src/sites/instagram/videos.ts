import type { DomEnvironment } from '../../core/dom-env';
import type { Locate } from '../../core/locator';
import type { SiteVideo } from '../shared/videos';
import { SiteVideos } from '../shared/videos';
import { IG_VIDEO, IG_VIDEO_CONTROL } from './selectors';

export type InstagramVideo = SiteVideo;

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
