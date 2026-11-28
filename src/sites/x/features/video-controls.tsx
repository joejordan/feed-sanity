import type { XPage } from '../feature';
import { createVideoControlsFeature } from '../../../features/shared/video-controls';

/**
 * Adds Feed Sanity's bottom video scrubber to X timeline videos via the shared
 * `createVideoControlsFeature`. X natively handles click-to-pause on videos, so
 * click interception is omitted to leave native pause and volume slider clicks
 * completely untouched.
 */
export default createVideoControlsFeature<XPage>({
  id: 'x_video_scrubber',
  prefix: 'x',
  scrubberDescription: 'Show a seekable progress bar along the bottom edge of X videos.',
});
