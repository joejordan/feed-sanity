import type { DomEnvironment } from '../../core/dom-env';
import type { Locate } from '../../core/locator';
import type { SiteVideo } from '../shared/videos';
import { closestAcrossShadows } from '../../core/dom';
import { SiteVideos } from '../shared/videos';
import { REDDIT_VIDEO, REDDIT_VIDEO_CONTROL } from './selectors';

export type RedditVideo = SiteVideo;

/** Tracks `<video>` players inside Shreddit Web Components and nested Shadow Roots via shared `SiteVideos`. */
export class RedditVideos extends SiteVideos {
  constructor(env: DomEnvironment, locate: Locate) {
    super(env, locate, {
      logName: 'reddit-videos',
      videoSpec: REDDIT_VIDEO,
      controlSpec: REDDIT_VIDEO_CONTROL,
      resolveContainer: (element) => {
        const wrapper = element.closest(
          '[data-testid="shreddit-player-wrapper"], .media-container, .player-shell',
        );
        if (wrapper instanceof HTMLElement) {
          return wrapper;
        }
        return element.parentElement ?? element;
      },
      resolveSurface: (element) =>
        closestAcrossShadows(element, 'shreddit-post, article[data-testid="post-container"]')
          ? 'feed'
          : 'other',
    });
  }
}
