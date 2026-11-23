import type { InstagramPage } from '../feature';
import { createVideoDownloadFeature } from '../../../features/shared/video-download';
import { isInstagramMediaAddress } from '../urls';

/**
 * Adds a hover Save button onto Instagram videos backed by the shared
 * `<DownloadButton>` and Instagram's MAIN-world `ig-video-sources` reader
 * (React fibers + hydration/Network Tap progressive video cache).
 */
export default createVideoDownloadFeature<InstagramPage>({
  id: 'ig_video_download',
  optionKey: 'ig_video_download',
  siteName: 'Instagram',
  isAllowedUrl: isInstagramMediaAddress,
});
