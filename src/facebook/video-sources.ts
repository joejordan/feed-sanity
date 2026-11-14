import type { PageBridge } from '../core/bridge';
import { isRecord } from '../core/storage';
import { VIDEO_SOURCES } from './react-readers';
import { isFacebookAddress } from './urls';

/** A video's files, as read from React's data in the page and checked. */
export interface VideoSources {
  /**
   * The best progressive file, one MP4 with sound and picture: the high
   * definition one, else the standard one. Null when there is none, or when
   * its address is not on one of Facebook's own domains.
   */
  readonly file: string | null;
  readonly quality: 'hd' | 'sd' | null;
  /** True when the player has a DASH manifest, where sound and picture come apart. */
  readonly manifest: boolean;
  /** Facebook's ID for the video, all digits, or null. */
  readonly videoId: string | null;
}

const VIDEO_ID = /^\d{1,30}$/;

const address = (value: unknown): string | null =>
  typeof value === 'string' && isFacebookAddress(value) ? value : null;

/**
 * Checks what the page-world reader sent back. Anything not of the expected
 * shape counts as missing, and an address must be an `https:` address on
 * one of Facebook's own domains. Null when the answer is not an object,
 * which is how the reader says it found no player data.
 */
export function checkVideoSources(answer: unknown): VideoSources | null {
  if (!isRecord(answer)) {
    return null;
  }
  const hd = address(answer.hdSrc);
  const sd = address(answer.sdSrc);
  let quality: VideoSources['quality'] = null;
  if (hd) {
    quality = 'hd';
  } else if (sd) {
    quality = 'sd';
  }
  const { videoId } = answer;
  return {
    file: hd ?? sd,
    quality,
    manifest: answer.manifest === true,
    videoId: typeof videoId === 'string' && VIDEO_ID.test(videoId) ? videoId : null,
  };
}

/**
 * Asks the page-world side for the files of the video `element`. Resolves
 * null when it found no player data for it, and rejects with the bridge's
 * `BridgeError` when it could not be asked.
 */
export async function videoSources(
  bridge: Pick<PageBridge, 'ask'>,
  element: HTMLVideoElement,
  signal?: AbortSignal,
): Promise<VideoSources | null> {
  return checkVideoSources(await bridge.ask(element, VIDEO_SOURCES, signal));
}
