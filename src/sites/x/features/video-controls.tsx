import type { XPage } from '../feature';
import { createVideoControlsFeature } from '../../../features/shared/video-controls';
import { X_VIDEO_CONTROL } from '../selectors';

/**
 * Adds Feed Sanity's bottom video scrubber and click-to-pause behavior to X
 * timeline videos via the shared `createVideoControlsFeature`.
 */
export default createVideoControlsFeature<XPage>({
  id: 'x_video_scrubber',
  prefix: 'x',
  scrubberDescription: 'Show a seekable progress bar along the bottom edge of X videos.',
  clickToPauseDescription: 'Click an X timeline video to pause or resume playback.',
  postSelector: 'article[data-testid="tweet"]',
  controlSpec: X_VIDEO_CONTROL,
});
