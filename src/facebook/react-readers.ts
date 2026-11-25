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

let cachedFiberKey: string | undefined;

/** The fiber React keeps on `element`, if it keeps one. */
function fiberOf(element: Element): unknown {
  const host = element as unknown as Loose;
  if (cachedFiberKey && cachedFiberKey in host) {
    return host[cachedFiberKey];
  }
  for (const key of Object.keys(element)) {
    if (key.startsWith(FIBER_PREFIX)) {
      cachedFiberKey = key;
      return host[key];
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

/** The reader that says whether a feed post is an ad. */
export const POST_SPONSORED = 'post-sponsored';

/**
 * How many steps up from a post's own fiber the search for its feed unit
 * goes. On 2026-11-14 it was 14 steps up, on the news feed and on the
 * Feeds pages.
 */
export const MAX_FEED_UNIT_DEPTH = 30;

/** What the post-sponsored reader sends back. The content side checks it. */
export interface PostSponsoredAnswer {
  /** True when the post's feed unit has `sponsored_data`. */
  sponsored: boolean;
}

/**
 * Whether the post `element` is an ad: walks up from its fiber to the
 * first one whose props hold a `feedUnit` with a `sponsored_data` field,
 * which is null on ordinary and suggested posts and an object on ads. Null
 * when no such props are within `MAX_FEED_UNIT_DEPTH` steps.
 */
export function readPostSponsored(element: Element): PostSponsoredAnswer | null {
  let fiber = fiberOf(element);
  for (let depth = 0; depth <= MAX_FEED_UNIT_DEPTH && isObject(fiber); depth++) {
    const props = fiber.memoizedProps;
    const unit = isObject(props) ? props.feedUnit : undefined;
    if (isObject(unit) && 'sponsored_data' in unit) {
      return { sponsored: isObject(unit.sponsored_data) };
    }
    fiber = fiber.return;
  }
  return null;
}

/** The reader that returns the signed-in user's short name and ID for the inline post composer. */
export const COMPOSER_INFO = 'composer-info';

/** What the composer-info reader sends back. The content side checks every field. */
export interface ComposerInfoAnswer {
  shortName: string | null;
  userId: string | null;
}

/**
 * Reads `SHORT_NAME` and `USER_ID` from Facebook's `CurrentUserInitialData`
 * module, if loaded. Null when Facebook's module loader or user data is not
 * present.
 */
export function readComposerInfo(): ComposerInfoAnswer | null {
  const loader = globalThis as { require?: unknown };
  if (typeof loader.require !== 'function') {
    return null;
  }
  try {
    const data = (loader.require as (name: string) => unknown)('CurrentUserInitialData');
    if (!isObject(data)) {
      return null;
    }
    const shortName = text(data.SHORT_NAME);
    const userId = text(data.USER_ID);
    return shortName || userId ? { shortName, userId } : null;
  } catch {
    return null;
  }
}

/** The reader that says whether a Right Rail card unit is a Sponsored ad unit. */
export const RIGHT_RAIL_SPONSORED = 'right-rail-sponsored';

const MAX_RIGHT_RAIL_UP = 6;
const MAX_RIGHT_RAIL_DEPTH = 16;
const MAX_RIGHT_RAIL_NODES = 240;

const AD_UNIT_PATTERN =
  /CometAdsSideFeed|CometHomeRightSideEgo|CometRightSideFeedEgo|CometRightRailAds/;

function componentName(type: unknown): string | undefined {
  if (typeof type === 'function') {
    const fn = type as { displayName?: unknown; name?: unknown };
    if (typeof fn.displayName === 'string') {
      return fn.displayName;
    }
    return typeof fn.name === 'string' ? fn.name : undefined;
  }
  if (isObject(type) && typeof type.displayName === 'string') {
    return type.displayName;
  }
  return undefined;
}

/**
 * Whether a Right Rail unit element renders Facebook's right-rail ad components
 * (`CometAdsSideFeedUnitItem` or `CometHomeRightSideEgo`). Checks immediate
 * parent fibers and runs a bounded breadth-first search down the element's
 * React fiber subtree so shallow wrapper components are found before deep leaf
 * subtrees.
 */
export function readRightRailSponsored(element: Element): PostSponsoredAnswer | null {
  const root = fiberOf(element);
  if (!isObject(root)) {
    return null;
  }
  let up: unknown = root.return;
  for (let step = 0; step < MAX_RIGHT_RAIL_UP && isObject(up); step++) {
    const name = componentName(up.type);
    if (name && AD_UNIT_PATTERN.test(name)) {
      return { sponsored: true };
    }
    up = up.return;
  }
  const fibers: Loose[] = [root];
  const depths: number[] = [0];
  let head = 0;
  while (head < fibers.length && head < MAX_RIGHT_RAIL_NODES) {
    const fiber = fibers[head];
    const depth = depths[head] ?? 0;
    head++;
    if (!fiber) {
      break;
    }
    const name = componentName(fiber.type);
    if (name && AD_UNIT_PATTERN.test(name)) {
      return { sponsored: true };
    }
    if (depth < MAX_RIGHT_RAIL_DEPTH) {
      let child: unknown = fiber.child;
      while (isObject(child) && fibers.length < MAX_RIGHT_RAIL_NODES) {
        fibers.push(child);
        depths.push(depth + 1);
        child = child.sibling;
      }
    }
  }
  return { sponsored: false };
}

/** Every reader the page-world side offers. */
export const PAGE_READERS: PageReaders = {
  [VIDEO_SOURCES]: readVideoSources,
  [POST_SPONSORED]: readPostSponsored,
  [COMPOSER_INFO]: readComposerInfo,
  [RIGHT_RAIL_SPONSORED]: readRightRailSponsored,
};
