import type { InstagramPage } from '../feature';
import { createVideoControlsFeature } from '../../../features/shared/video-controls';
import { IG_VIDEO_CONTROL } from '../selectors';

/**
 * Adds Feed Sanity's bottom video scrubber and click-to-pause behavior to
 * Instagram feed and Reels videos via the shared `createVideoControlsFeature`.
 */
export default createVideoControlsFeature<InstagramPage>({
  id: 'ig_video_controls',
  prefix: 'ig',
  scrubberDescription:
    'Show a seekable progress bar along the bottom edge of Instagram videos and Reels.',
  clickToPauseDescription: 'Click an Instagram feed video to pause or resume playback.',
  postSelector: 'article',
  controlSpec: IG_VIDEO_CONTROL,
});
