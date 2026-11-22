import type { DomEnvironment } from '../../core/dom-env';
import type { Locate } from '../../core/locator';
import type { SiteVideo } from '../shared/videos';
import { SiteVideos } from '../shared/videos';
import { X_VIDEO, X_VIDEO_CONTROL } from './selectors';

export type XVideo = SiteVideo;

/** Tracks `<video>` players on X.com via shared `SiteVideos`. */
export class XVideos extends SiteVideos {
  constructor(env: DomEnvironment, locate: Locate) {
    super(env, locate, {
      logName: 'x-videos',
      videoSpec: X_VIDEO,
      controlSpec: X_VIDEO_CONTROL,
      resolveContainer: (element) => {
        const player = element.closest('[data-testid="videoPlayer"]');
        if (player instanceof HTMLElement) {
          return player;
        }
        return element.parentElement ?? element;
      },
      resolveSurface: (element) =>
        element.closest('article[data-testid="tweet"]') ? 'feed' : 'other',
    });
  }
}
