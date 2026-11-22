// Instagram MAIN-world runtime: combines generic React fiber inspection
// (`src/engines/react/`) with the passive Network Tap (`src/engines/network-tap/`)
// to surface structured post/ad/suggested metadata and progressive video URLs
// over the PageBridge without touching personal text or mutating host requests.

import type { PageReaders, PageWorldEmitter } from '../../core/page-world';
import type { NetworkTap, NetworkTapHost } from '../../engines/network-tap';
import type { Loose } from '../../engines/react';
import { servePageWorld } from '../../core/page-world';
import { createNetworkTap } from '../../engines/network-tap';
import { isObject, walkFiberUp } from '../../engines/react';
import { isInstagramMediaAddress } from './urls';

export interface InstagramPostMeta {
  readonly id: string | null;
  readonly isAd: boolean;
  readonly isSuggested: boolean;
}

export interface InstagramVideoSources {
  readonly url: string | null;
  readonly videoId: string | null;
}

export interface InstagramNetworkStats {
  readonly matchedResponses: number;
  readonly cachedItems: number;
}

interface CachedMediaMeta {
  isAd?: boolean;
  isSuggested?: boolean;
  videoUrl?: string;
}

const MAX_CACHE = 200;
const MAX_WALK_DEPTH = 10;
const MAX_WALK_NODES = 4000;
const FIBER_DEPTH = 25;

const IG_API_PATTERN = /\/(?:graphql\/query|api\/v1\/(?:feed|clips|media))\b/i;
const VIDEO_URL_KEYS = [
  'hdSrc',
  'browserNativeHdUrl',
  'sdSrc',
  'browserNativeSdUrl',
  'src',
] as const;

function stringId(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0 && value.length <= 64) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function hasOwnAdSignal(obj: Loose): boolean {
  return Boolean(
    obj.ad_id ||
      obj.adId ||
      obj.is_ad === true ||
      obj.isSponsored === true ||
      obj.is_sponsored === true ||
      obj.product_type === 'ad',
  );
}

function hasAdMeta(obj: Loose): boolean {
  return Boolean(hasOwnAdSignal(obj) || obj.ad || obj.injected);
}

function hasOwnSuggestedSignal(obj: Loose): boolean {
  return Boolean(
    obj.isSuggested === true ||
      obj.is_suggested === true ||
      obj.is_unified_video_suggestion === true,
  );
}

function hasSuggestedMeta(obj: Loose): boolean {
  return Boolean(hasOwnSuggestedSignal(obj) || obj.explore_story);
}

function bestVideoVersionUrl(versions: unknown): string | undefined {
  if (!Array.isArray(versions)) {
    return undefined;
  }
  let bestUrl: string | undefined;
  let bestWidth = -1;
  for (const item of versions) {
    if (!isObject(item) || typeof item.url !== 'string') {
      continue;
    }
    if (!isInstagramMediaAddress(item.url)) {
      continue;
    }
    const width = typeof item.width === 'number' ? item.width : 0;
    if (width >= bestWidth) {
      bestWidth = width;
      bestUrl = item.url;
    }
  }
  return bestUrl;
}

const STRUCTURAL_CHILD_KEYS = new Set([
  'media',
  'media_or_ad',
  'item',
  'items',
  'node',
  'carousel_media',
]);

/**
 * Extracts ad/suggested flags and progressive video URLs from a parsed
 * Instagram GraphQL or REST feed payload into `cache`. Returns the number of
 * new or updated cache entries.
 */
export function indexInstagramPayload(
  payload: unknown,
  cache: Map<string, CachedMediaMeta>,
): number {
  let changed = 0;
  let visitedCount = 0;
  const seen = new Set<unknown>();

  const upsert = (key: string, patch: CachedMediaMeta): void => {
    const existing = cache.get(key);
    if (existing) {
      if (patch.isAd && !existing.isAd) {
        existing.isAd = true;
        changed++;
      }
      if (patch.isSuggested && !existing.isSuggested) {
        existing.isSuggested = true;
        changed++;
      }
      if (patch.videoUrl && existing.videoUrl !== patch.videoUrl) {
        existing.videoUrl = patch.videoUrl;
        changed++;
      }
      return;
    }
    if (cache.size >= MAX_CACHE) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) {
        cache.delete(oldest);
      }
    }
    cache.set(key, { ...patch });
    changed++;
  };

  const walk = (
    node: unknown,
    depth: number,
    inheritedAd: boolean,
    inheritedSuggested: boolean,
  ): void => {
    if (visitedCount >= MAX_WALK_NODES || !isObject(node) || seen.has(node)) {
      return;
    }
    seen.add(node);
    visitedCount++;

    if (Array.isArray(node)) {
      if (depth >= MAX_WALK_DEPTH) {
        return;
      }
      for (const item of node) {
        if (visitedCount >= MAX_WALK_NODES) {
          break;
        }
        walk(item, depth + 1, inheritedAd, inheritedSuggested);
      }
      return;
    }

    const pk = stringId(node.pk);
    const fullId = stringId(node.id);
    const primaryId = pk ?? fullId;
    const code = stringId(node.code);
    const selfAd = inheritedAd || hasOwnAdSignal(node);
    const selfSuggested = inheritedSuggested || hasOwnSuggestedSignal(node);
    const isAd = selfAd || Boolean(node.ad || node.injected);
    const isSuggested = selfSuggested || Boolean(node.explore_story);
    const videoUrl = bestVideoVersionUrl(node.video_versions);

    if ((isAd || isSuggested || videoUrl) && (primaryId || code)) {
      const patch: CachedMediaMeta = {
        ...(isAd ? { isAd: true } : {}),
        ...(isSuggested ? { isSuggested: true } : {}),
        ...(videoUrl ? { videoUrl } : {}),
      };
      if (primaryId) {
        upsert(primaryId, patch);
      }
      if (fullId && fullId !== primaryId) {
        upsert(fullId, patch);
      }
      if (code && code !== primaryId && code !== fullId) {
        upsert(code, patch);
      }
    }

    if (depth >= MAX_WALK_DEPTH) {
      return;
    }
    for (const key of Object.keys(node)) {
      if (visitedCount >= MAX_WALK_NODES) {
        break;
      }
      if (key === 'video_versions') {
        continue;
      }
      const value = node[key];
      if (!isObject(value)) {
        continue;
      }
      if (key === 'ad' || key === 'injected') {
        walk(value, depth + 1, true, false);
      } else if (key === 'explore_story') {
        walk(value, depth + 1, false, true);
      } else if (STRUCTURAL_CHILD_KEYS.has(key)) {
        walk(value, depth + 1, selfAd, selfSuggested);
      } else {
        walk(value, depth + 1, false, false);
      }
    }
  };

  walk(payload, 0, false, false);
  return changed;
}

function readPostMetaFromFiber(
  element: Element,
  cache: ReadonlyMap<string, CachedMediaMeta>,
): InstagramPostMeta {
  let id: string | null = null;
  let isAd = false;
  let isSuggested = false;

  const inspectCandidate = (candidate: unknown): void => {
    if (!isObject(candidate)) {
      return;
    }
    id ??= stringId(candidate.pk) ?? stringId(candidate.id) ?? stringId(candidate.code);
    if (hasAdMeta(candidate)) {
      isAd = true;
    }
    if (hasSuggestedMeta(candidate)) {
      isSuggested = true;
    }
  };

  walkFiberUp(
    element,
    (fiber) => {
      const props = fiber.memoizedProps;
      if (!isObject(props)) {
        return;
      }
      if (hasAdMeta(props)) {
        isAd = true;
      }
      if (hasSuggestedMeta(props)) {
        isSuggested = true;
      }
      inspectCandidate(props.adFragmentKey);
      inspectCandidate(props.adProps);
      inspectCandidate(props.mediaFragmentKey);
      inspectCandidate(props.media);
      inspectCandidate(props.post);
      inspectCandidate(props.item);
      return id && (isAd || isSuggested) ? true : undefined;
    },
    FIBER_DEPTH,
  );

  if (!id) {
    const link = element.querySelector('a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"]');
    const href = link?.getAttribute('href');
    if (href) {
      const match = /\/(?:p|reel|reels)\/([A-Za-z0-9_-]{4,})/.exec(href);
      if (match?.[1]) {
        id = match[1];
      }
    }
  }

  if (id) {
    const cached = cache.get(id);
    if (cached?.isAd) {
      isAd = true;
    }
    if (cached?.isSuggested) {
      isSuggested = true;
    }
  }
  return { id, isAd, isSuggested };
}

function extractUrlFromMeta(meta: Loose): string | null {
  for (const key of VIDEO_URL_KEYS) {
    const value = meta[key];
    if (typeof value === 'string' && isInstagramMediaAddress(value)) {
      return value;
    }
  }
  if (Array.isArray(meta.implementations)) {
    for (const impl of meta.implementations) {
      if (!isObject(impl) || !isObject(impl.data)) {
        continue;
      }
      const found = extractUrlFromMeta(impl.data);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function readVideoSourcesFromFiber(
  element: Element,
  cache: ReadonlyMap<string, CachedMediaMeta>,
): InstagramVideoSources {
  let url: string | null = null;
  let videoId: string | null = null;

  walkFiberUp(
    element,
    (fiber) => {
      const props = fiber.memoizedProps;
      if (!isObject(props)) {
        return;
      }
      const coreProps = isObject(props.coreVideoPlayerProps) ? props.coreVideoPlayerProps : props;
      const meta = isObject(coreProps.coreVideoPlayerMetaData)
        ? coreProps.coreVideoPlayerMetaData
        : undefined;
      if (meta) {
        videoId ??= stringId(meta.videoFBID);
        url ??= extractUrlFromMeta(meta);
      }
      if (!url) {
        const media = isObject(props.media) ? props.media : undefined;
        if (media) {
          videoId ??= stringId(media.pk) ?? stringId(media.id);
          url ??= bestVideoVersionUrl(media.video_versions) ?? null;
        }
      }
      return url ? true : undefined;
    },
    FIBER_DEPTH,
  );

  if (!url && videoId) {
    url = cache.get(videoId)?.videoUrl ?? null;
  }
  if (!url) {
    const article = element.closest('article');
    if (article) {
      const postMeta = readPostMetaFromFiber(article, cache);
      if (postMeta.id) {
        videoId ??= postMeta.id;
        url = cache.get(postMeta.id)?.videoUrl ?? null;
      }
    }
  }
  return { url, videoId };
}

export interface InstagramPageWorldHandle {
  readonly emitter: PageWorldEmitter;
  readonly dispose: () => void;
}

/**
 * Starts the Instagram MAIN-world bridge with React fiber readers and a
 * passive Network Tap indexing GraphQL/REST feed responses.
 */
export function startInstagramPageWorld(
  host: NetworkTapHost = globalThis,
): InstagramPageWorldHandle {
  const cache = new Map<string, CachedMediaMeta>();
  let matchedResponses = 0;

  const readers: PageReaders = {
    'ig-post-meta': (element) => readPostMetaFromFiber(element, cache),
    'ig-video-sources': (element) => readVideoSourcesFromFiber(element, cache),
  };

  const emitter = servePageWorld(readers);
  const tap: NetworkTap = createNetworkTap(host);

  const parseAndIndex = (raw: string): number => {
    const cleaned = raw.startsWith('for (;;);') ? raw.slice(9) : raw;
    try {
      return indexInstagramPayload(JSON.parse(cleaned), cache);
    } catch {
      if (!cleaned.includes('\n')) {
        return 0;
      }
      let total = 0;
      for (const line of cleaned.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        try {
          const slice = trimmed.startsWith('for (;;);') ? trimmed.slice(9) : trimmed;
          total += indexInstagramPayload(JSON.parse(slice), cache);
        } catch {
          // Skip non-JSON streamed chunks.
        }
      }
      return total;
    }
  };

  const removeRule = tap.addRule({
    id: 'ig-feed-metadata',
    match: (url) => IG_API_PATTERN.test(url),
    onResponse: ({ text }) => {
      matchedResponses++;
      const updated = parseAndIndex(text);
      if (updated > 0) {
        emitter.emit('ig:network-stats', {
          matchedResponses,
          cachedItems: cache.size,
        } satisfies InstagramNetworkStats);
      }
    },
  });

  return {
    emitter,
    dispose() {
      removeRule();
      tap.dispose();
      cache.clear();
    },
  };
}
