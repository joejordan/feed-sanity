// Cross-site capability feature mounting Feed Sanity's `<DownloadButton>`
// overlay on any site exposing `MediaCapability` + a video-source reader.

import type { CapablePage, MediaItem, MediaSources } from '../../capabilities';
import type { BridgeStatus } from '../../core/bridge';
import type { Feature } from '../../core/feature';
import type { Watched } from '../../ui/watched';
import type { Placement } from '../video-download/download-button';
import { defineCapabilityFeature } from '../../capabilities';
import { Listeners } from '../../core/listeners';
import { DownloadButton, samePlacement } from '../video-download/download-button';
import css from '../video-download/download-button.css?inline';
import { placeButton } from '../video-download/layout';
import { measureControls } from '../video-layout';
import { overlayEachVideo } from '../video-overlay';

export interface VideoDownloadBridge {
  readonly status: () => BridgeStatus;
  readonly onStatus: (listener: (status: BridgeStatus) => void) => () => void;
  readonly videoSources: (
    element: HTMLVideoElement,
    signal?: AbortSignal,
  ) => Promise<MediaSources | null>;
}

export interface VideoDownloadPage extends CapablePage {
  readonly bridge: VideoDownloadBridge;
}

export interface SharedVideoDownloadConfig {
  readonly id: string;
  /** Option key name (e.g. `'ig_video_download'`). */
  readonly optionKey: string;
  readonly siteName: string;
  /** Filename prefix for saved videos (defaults to a slugified `siteName`). */
  readonly filePrefix?: string;
  readonly description?: string;
  /** Validates that resolved video file URLs belong to this site's trusted CDNs. */
  readonly isAllowedUrl: (address: string) => boolean;
}

function measurePlacement(video: MediaItem): Placement {
  return {
    button: placeButton(video.element.getBoundingClientRect(), measureControls(video)),
    container: video.container,
  };
}

/**
 * Factory for cross-site video saving built on `defineCapabilityFeature`
 * (`requires: ['media']`), reusing `<DownloadButton>` and `overlayEachVideo`.
 */
export function createVideoDownloadFeature<P extends VideoDownloadPage>(
  config: SharedVideoDownloadConfig,
): Feature<P> {
  const optionsSpec = {
    [config.optionKey]: {
      section: 'Media',
      group: 'Videos',
      title: 'Save button',
      description:
        config.description ??
        `Show a button in the top left corner of each ${config.siteName} video while hovering that saves the video as a file.`,
      keywords: ['download', 'mp4', 'video'],
      default: true,
    },
  };

  return defineCapabilityFeature<typeof optionsSpec, 'media', P>({
    id: config.id,
    requires: ['media'],
    options: optionsSpec,
    enabledBy: config.optionKey,
    setup({ page, caps, scope, log }) {
      const { media } = caps;
      const statusChanged = new Listeners(log);
      let following = false;
      const bridge: Watched<BridgeStatus> = {
        get: () => page.bridge.status(),
        subscribe: (listener) => statusChanged.add(listener),
      };
      const follow = (): void => {
        if (!following) {
          following = true;
          scope.add(
            page.bridge.onStatus(() => {
              statusChanged.emit();
            }),
          );
        }
      };
      const filePrefix =
        config.filePrefix ?? config.siteName.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');

      overlayEachVideo<Placement, MediaItem>(
        { page: { videos: media }, scope, log },
        {
          css,
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
                isAllowedUrl={config.isAllowedUrl}
                filePrefix={filePrefix}
                siteName={config.siteName}
              />
            );
          },
        },
      );
    },
  });
}
