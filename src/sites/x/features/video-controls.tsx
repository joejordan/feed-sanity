import type { XVideo } from '../videos';
import { measureControls } from '../../../features/video-layout';
import { overlayEachVideo } from '../../../features/video-overlay';
import { AT_BOTTOM, placeStrip, samePlace } from '../../../features/video-scrubber/layout';
import { Scrubber } from '../../../features/video-scrubber/scrubber';
import scrubberCss from '../../../features/video-scrubber/scrubber.css?inline';
import { defineXFeature } from '../feature';

const noopHide = () => () => undefined;

/**
 * Adds Feed Sanity's bottom video scrubber overlay to X timeline videos,
 * reusing the shared `overlayEachVideo` and `Scrubber` primitives.
 */
export default defineXFeature({
  id: 'x_video_scrubber',
  options: {
    x_video_scrubber: {
      section: 'Videos',
      title: 'Video scrubber',
      description: 'Show a seekable progress bar along the bottom edge of X videos.',
      default: true,
    },
  },
  enabledBy: 'x_video_scrubber',
  setup({ page, scope, log }) {
    overlayEachVideo<ReturnType<typeof placeStrip>, XVideo>(
      { page, scope, log },
      {
        css: scrubberCss,
        initial: AT_BOTTOM,
        measure: (video) =>
          placeStrip(video.element.getBoundingClientRect(), measureControls(video)),
        same: samePlace,
        render: (video, place) => <Scrubber video={video.element} place={place} hide={noopHide} />,
      },
    );
  },
});
