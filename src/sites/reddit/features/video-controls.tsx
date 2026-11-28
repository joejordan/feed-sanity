import type { RedditPage } from '../feature';
import { createVideoControlsFeature } from '../../../features/shared/video-controls';
import { REDDIT_VIDEO_CONTROL } from '../selectors';

/**
 * Adds Feed Sanity's bottom video scrubber and click-to-pause behavior to
 * Reddit Shreddit `<shreddit-player>` videos (including inside Shadow Roots).
 */
export default createVideoControlsFeature<RedditPage>({
  id: 'reddit_video_scrubber',
  prefix: 'reddit',
  scrubberDescription: 'Show a seekable progress bar along the bottom edge of Reddit videos.',
  clickToPause: {
    description: 'Click a Reddit feed video to pause or resume playback.',
    postSelector: 'shreddit-post, article[data-testid="post-container"]',
    controlSpec: REDDIT_VIDEO_CONTROL,
  },
});
