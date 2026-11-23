// X.com MAIN-world runtime: combines generic React fiber inspection
// (`src/engines/react/`) with an opt-in transforming Network Tap
// (`src/engines/network-tap/`) that strips promoted entries from GraphQL
// timeline payloads before React Native Web measures virtualized row heights.

import type { PageReaders, PageToggles, PageWorldEmitter } from '../../core/page-world';
import type { NetworkTap, NetworkTapHost } from '../../engines/network-tap';
import type { ShadowHookHost } from '../../engines/shadow';
import { servePageWorld } from '../../core/page-world';
import { createNetworkTap } from '../../engines/network-tap';
import { isObject, walkFiberUp } from '../../engines/react';
import { watchOpenShadowAttachments } from '../../engines/shadow';

export interface XTweetMeta {
  readonly id: string | null;
  readonly isAd: boolean;
  readonly isSuggested: boolean;
}

export interface XNetworkStats {
  readonly matchedResponses: number;
  readonly strippedPromoted: number;
  readonly errors?: number;
}

const FIBER_DEPTH = 25;
const MAX_WALK_DEPTH = 14;
const MAX_WALK_NODES = 6000;

const X_TIMELINE_API =
  /\/i\/api\/graphql\/[^/]+\/(?:HomeTimeline|HomeLatestTimeline|UserTweets|UserTweetsAndReplies|TweetDetail|SearchTimeline|ListLatestTweetsTimeline)\b/i;

const PROMOTED_ENTRY_ID = /^(?:promoted[-_]|promotedTweet[-_])/i;
const PROMOTED_TEXT_HINT = /"promotedMetadata"|"entryId"\s*:\s*"promoted(?:[-_]|Tweet[-_])/i;
const COLLECTION_KEYS = ['entries', 'items', 'moduleItems'] as const;

// Tweet/user leaf subtrees never contain nested timeline `entries`/`items`;
// skipping them keeps the node budget focused on instruction/module containers.
const SKIP_KEYS = new Set([
  'itemContent',
  'tweet_results',
  'user_results',
  'legacy',
  'core',
  'entities',
  'card',
  'clientEventInfo',
  'feedbackInfo',
  'quoted_status_result',
  'retweeted_status_result',
  'promotedMetadata',
]);

function isPromotedEntry(entry: unknown): boolean {
  if (!isObject(entry)) {
    return false;
  }
  if (typeof entry.entryId === 'string' && PROMOTED_ENTRY_ID.test(entry.entryId)) {
    return true;
  }
  const content = isObject(entry.content) ? entry.content : undefined;
  const itemContent = content && isObject(content.itemContent) ? content.itemContent : undefined;
  if (itemContent && isObject(itemContent.promotedMetadata)) {
    return true;
  }
  const item = isObject(entry.item) ? entry.item : undefined;
  const nestedItemContent = item && isObject(item.itemContent) ? item.itemContent : undefined;
  return Boolean(nestedItemContent && isObject(nestedItemContent.promotedMetadata));
}

/**
 * Strips promoted timeline entries from a parsed X GraphQL JSON payload in
 * place and returns the number of entries removed. Bounded against deep or
 * cyclic structures and skips leaf tweet/user subtrees.
 */
export function stripPromotedEntries(payload: unknown): number {
  let removed = 0;
  let visited = 0;
  const seen = new Set<unknown>();

  const walk = (node: unknown, depth: number): void => {
    if (visited >= MAX_WALK_NODES || !isObject(node) || seen.has(node)) {
      return;
    }
    seen.add(node);
    visited++;

    if (Array.isArray(node)) {
      if (depth >= MAX_WALK_DEPTH) {
        return;
      }
      for (const item of node) {
        if (visited >= MAX_WALK_NODES) {
          break;
        }
        walk(item, depth + 1);
      }
      return;
    }

    for (const listKey of COLLECTION_KEYS) {
      if (!Object.hasOwn(node, listKey)) {
        continue;
      }
      const orig = node[listKey];
      if (!Array.isArray(orig)) {
        continue;
      }
      let kept: unknown[] | undefined;
      for (let i = 0; i < orig.length; i++) {
        const entry = orig[i];
        if (isPromotedEntry(entry)) {
          kept ??= orig.slice(0, i);
          removed++;
        } else if (kept) {
          kept.push(entry);
        }
      }
      if (kept) {
        node[listKey] = kept;
      }
    }

    if (depth >= MAX_WALK_DEPTH) {
      return;
    }
    for (const key of Object.keys(node)) {
      if (visited >= MAX_WALK_NODES) {
        break;
      }
      if (SKIP_KEYS.has(key)) {
        continue;
      }
      const value = node[key];
      if (isObject(value)) {
        walk(value, depth + 1);
      }
    }
  };

  walk(payload, 0);
  return removed;
}

/**
 * Transforms an X GraphQL timeline JSON text response by removing promoted
 * entries. Returns `undefined` without parsing when no promoted signal exists
 * in the raw response text, or when JSON is invalid/untouched.
 */
export function stripPromotedFromTimelineJson(
  text: string,
): { text: string; removed: number } | undefined {
  if (!PROMOTED_TEXT_HINT.test(text)) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const removed = stripPromotedEntries(parsed);
  if (removed === 0) {
    return undefined;
  }
  return { text: JSON.stringify(parsed), removed };
}

function readTweetMetaFromFiber(element: Element): XTweetMeta {
  let id: string | null = null;
  let isAd = false;
  let isSuggested = false;

  walkFiberUp(
    element,
    (fiber) => {
      const props = fiber.memoizedProps;
      if (!isObject(props)) {
        return;
      }
      if (props.promotedContent || props.promotedContentAdvertiser) {
        isAd = true;
      }
      if (isObject(props.socialContext)) {
        const ctxType = props.socialContext.type;
        if (typeof ctxType === 'string' && /topic|recommend|community/i.test(ctxType)) {
          isSuggested = true;
        }
      }
      if (!id && isObject(props.tweet)) {
        const rawId = props.tweet.id_str ?? props.tweet.rest_id;
        if (typeof rawId === 'string' && rawId.length > 0) {
          id = rawId;
        }
      }
      return id && isAd && isSuggested ? true : undefined;
    },
    FIBER_DEPTH,
  );

  return { id, isAd, isSuggested };
}

export interface XPageWorldHandle {
  readonly emitter: PageWorldEmitter;
  readonly dispose: () => void;
}

export type XPageWorldHost = NetworkTapHost & ShadowHookHost;

/**
 * Starts X.com's MAIN-world bridge with React fiber tweet inspection,
 * zero-polling Shadow Root attachment notifications (`engines/shadow`), and a
 * toggleable Network Tap that strips promoted timeline entries before React
 * Native Web lays them out.
 */
export function startXPageWorld(host: XPageWorldHost = globalThis): XPageWorldHandle {
  let removeStripRule: (() => void) | undefined;
  let matchedResponses = 0;
  let strippedPromoted = 0;

  let emitter!: PageWorldEmitter;

  const emitNetworkStats = (): void => {
    const totalErrors = tap.stats().totalErrors;
    emitter.emit('x:network-stats', {
      matchedResponses,
      strippedPromoted,
      ...(totalErrors > 0 ? { errors: totalErrors } : {}),
    } satisfies XNetworkStats);
  };

  const tap: NetworkTap = createNetworkTap(host, {
    onError: () => emitNetworkStats(),
  });

  const setStripPromoted = (enabled: boolean): { enabled: boolean } => {
    if (enabled && !removeStripRule) {
      removeStripRule = tap.addRule({
        id: 'x-strip-promoted',
        match: (url) => X_TIMELINE_API.test(url),
        transformResponseText: ({ text }) => {
          matchedResponses++;
          const result = stripPromotedFromTimelineJson(text);
          if (result) {
            strippedPromoted += result.removed;
          }
          emitNetworkStats();
          return result?.text;
        },
      });
    } else if (!enabled && removeStripRule) {
      removeStripRule();
      removeStripRule = undefined;
    }
    return { enabled };
  };

  const readers: PageReaders = {
    'x-tweet-meta': (element) => readTweetMetaFromFiber(element),
  };
  const toggles: PageToggles = {
    'x-strip-promoted': setStripPromoted,
  };

  emitter = servePageWorld(readers, toggles);

  const stopShadowWatch = watchOpenShadowAttachments(() => {
    emitter.emit('x:shadow-attached', { attached: true });
  }, host);

  return {
    emitter,
    dispose() {
      stopShadowWatch();
      removeStripRule?.();
      removeStripRule = undefined;
      tap.dispose();
    },
  };
}
