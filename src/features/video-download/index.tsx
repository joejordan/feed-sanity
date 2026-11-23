import type { BridgeStatus } from '../../core/bridge';
import type { Video } from '../../facebook/videos';
import type { Watched } from '../../ui/watched';
import type { Placement } from './download-button';
import { Listeners } from '../../core/listeners';
import { defineFeature } from '../../facebook/feature';
import { isFacebookAddress } from '../../facebook/urls';
import { measureControls } from '../video-layout';
import { overlayEachVideo } from '../video-overlay';
import { DownloadButton, samePlacement } from './download-button';
import css from './download-button.css?inline';
import { placeButton } from './layout';

/** Where the button goes on `video`, from where the video and Facebook's controls are. Reads layout only. */
function measurePlacement(video: Video): Placement {
  return {
    button: placeButton(video.element.getBoundingClientRect(), measureControls(video)),
    container: video.container,
  };
}

/**
 * Puts a button on every video that saves the video's file. New in this
 * project.
 *
 * The video's address is in React's data, which only the page's own world
 * can read, so the button asks the page-world bridge for it. Only a
 * progressive file, one MP4 with sound and picture, can be saved. It is
 * fetched from Facebook's file server when the person presses the button,
 * and nothing else is sent anywhere. See `DownloadButton` for what it shows.
 */
export default defineFeature({
  id: 'video_download',
  options: {
    video_download: {
      section: 'Media',
      group: 'Videos',
      title: 'Save button',
      description:
        'Show a button in the top left corner of each video, while the pointer is over it, that saves the video as a file.',
      keywords: ['download', 'mp4'],
      default: true,
    },
  },
  enabledBy: 'video_download',
  setup(ctx) {
    const { page, log } = ctx;
    // One subscription for every button, made for the first video, since
    // it starts the bridge.
    let status = page.bridge.status();
    const statusChanged = new Listeners(log);
    let following = false;
    const bridge: Watched<BridgeStatus> = {
      get: () => status,
      subscribe: (listener) => statusChanged.add(listener),
    };
    const follow = (): void => {
      if (!following) {
        following = true;
        page.bridge.onStatus((next) => {
          status = next;
          statusChanged.emit();
        });
      }
    };
    overlayEachVideo(ctx, {
      css,
      // Measured once the overlay is in place.
      initial: { button: null, container: null },
      measure: measurePlacement,
      same: samePlacement,
      render: (video, placement) => {
        follow();
        return (
          <DownloadButton
            video={video.element}
            placement={placement}
            bridge={bridge}
            sources={(signal) => page.bridge.videoSources(video.element, signal)}
            isAllowedUrl={isFacebookAddress}
            siteName="Facebook"
          />
        );
      },
    });
  },
});
