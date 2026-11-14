// Readers of the data React keeps on Facebook's elements. They run in the
// page's own world, as part of the page-world side of the bridge (see
// `src/page-world.ts`), so this file imports nothing but types and keeps to
// plain reads. The content script asks for them by name and checks what
// comes back; see `src/facebook/video-sources.ts`.
//
// The names and depths here are Facebook's and React's, and they change.
// Each reader looks for a shape, walks no further than its limits, and
// returns null when the shape is not there.

import type { PageReaders } from '../core/page-world';

/** The reader that finds a video's files. */
export const VIDEO_SOURCES = 'video-sources';

/**
 * How many steps up from a video's own fiber the search goes. The player's
 * props were 12 steps up in the news feed and the reel viewer on 2026-11-14.
 */
export const MAX_FIBER_DEPTH = 30;

/** How many of the player's implementations are looked at. */
export const MAX_IMPLEMENTATIONS = 20;

/** React puts the fiber on the element under this name, with a random suffix after the `$`. */
const FIBER_PREFIX = '__reactFiber$';

/** What the video-sources reader sends back. The content side checks every field. */
export interface VideoSourcesAnswer {
  /** The progressive file in high definition: one MP4 with sound and picture. */
  hdSrc: string | null;
  /** The same in standard definition. */
  sdSrc: string | null;
  /** True when the player has a DASH manifest, or its address, where audio and video are apart. */
  manifest: boolean;
  /** Facebook's ID for the video. */
  videoId: string | null;
}

type Loose = Record<string, unknown>;

const isObject = (value: unknown): value is Loose => typeof value === 'object' && value !== null;

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

/** The fiber React keeps on `element`, if it keeps one. */
function fiberOf(element: Element): unknown {
  for (const key of Object.keys(element)) {
    if (key.startsWith(FIBER_PREFIX)) {
      return (element as unknown as Loose)[key];
    }
  }
  return undefined;
}

/** Reads the sources out of the player's props, which hold `implementations`. */
function fromPlayerProps(props: Loose, implementations: unknown[]): VideoSourcesAnswer {
  const answer: VideoSourcesAnswer = { hdSrc: null, sdSrc: null, manifest: false, videoId: null };
  // Found by their fields: the progressive one was not always at the same place in the list.
  for (let index = 0; index < Math.min(implementations.length, MAX_IMPLEMENTATIONS); index++) {
    const implementation = implementations[index];
    const data = isObject(implementation) ? implementation.data : undefined;
    if (!isObject(data)) {
      continue;
    }
    answer.hdSrc ??= text(data.hdSrc);
    answer.sdSrc ??= text(data.sdSrc);
    if (text(data.manifest) || text(data.manifestUrl)) {
      answer.manifest = true;
    }
  }
  const meta = props.coreVideoPlayerMetaData;
  answer.videoId = isObject(meta) ? text(meta.videoFBID) : null;
  return answer;
}

/**
 * The files of the video `element` is: walks up from its fiber to the first
 * one whose props hold a list of `implementations`, and reads the
 * progressive files, whether there is a manifest, and the video's ID from
 * there. Null when no such props are within `MAX_FIBER_DEPTH` steps.
 */
export function readVideoSources(element: Element): VideoSourcesAnswer | null {
  let fiber = fiberOf(element);
  for (let depth = 0; depth <= MAX_FIBER_DEPTH && isObject(fiber); depth++) {
    const props = fiber.memoizedProps;
    if (isObject(props) && Array.isArray(props.implementations)) {
      return fromPlayerProps(props, props.implementations);
    }
    fiber = fiber.return;
  }
  return null;
}

/** Every reader the page-world side offers. */
export const PAGE_READERS: PageReaders = { [VIDEO_SOURCES]: readVideoSources };
