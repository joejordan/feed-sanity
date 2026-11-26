// Reddit (Shreddit) MAIN-world runtime: installs a zero-polling `attachShadow`
// hook (`engines/shadow`) so `DomEnvironment` immediately discovers late-mounted
// Shreddit open Shadow Roots, scans SSR hydration JSON (`engines/hydration`) for
// promoted/recommended post IDs before first paint, and serves the
// `reddit-post-meta` reader over `PageBridge`.

import type { PageReaders, PageToggles, PageWorldEmitter } from '../../core/page-world';
import type { ShadowHookHost } from '../../engines/shadow';
import { servePageWorld } from '../../core/page-world';
import { watchHydrationScripts } from '../../engines/hydration';
import { isObject } from '../../engines/react';
import { watchOpenShadowAttachments } from '../../engines/shadow';

export interface RedditPostMeta {
  readonly id: string | null;
  readonly isAd: boolean;
  readonly isSuggested: boolean;
}

export interface RedditRuntimeStats {
  readonly scannedScripts: number;
  readonly indexedAds: number;
  readonly indexedSuggested: number;
  readonly shadowAttachments: number;
}

const MAX_INDEX_SIZE = 500;
const MAX_WALK_DEPTH = 10;
const MAX_WALK_NODES = 3000;
const THING_ID = /^t3_[a-z0-9_-]+$/i;
const HYDRATION_HINT = /"promoted"|"isAd"|"is_promoted"|"adPayload"|"isRecommended"|"t3_/i;

function extractThingId(obj: Record<string, unknown>): string | null {
  for (const key of ['id', 'postId', 'thingId', 'fullname', 'name']) {
    const val = obj[key];
    if (typeof val === 'string' && THING_ID.test(val)) {
      return val.toLowerCase();
    }
  }
  return null;
}

/**
 * Walks an SSR hydration JSON object to collect promoted and recommended
 * Reddit post IDs (`t3_*`). Bounded against deep or cyclic structures.
 */
export function indexRedditHydrationPayload(
  payload: unknown,
  ads: Set<string>,
  suggested: Set<string>,
): void {
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

    const id = extractThingId(node);
    if (id) {
      if (
        (node.promoted === true ||
          node.isPromoted === true ||
          node.isAd === true ||
          node.is_promoted === true ||
          isObject(node.adPayload)) &&
        ads.size < MAX_INDEX_SIZE
      ) {
        ads.add(id);
      }
      if (
        (node.isRecommended === true ||
          node.isSuggested === true ||
          typeof node.recommendationSource === 'string') &&
        suggested.size < MAX_INDEX_SIZE
      ) {
        suggested.add(id);
      }
    }

    if (depth >= MAX_WALK_DEPTH) {
      return;
    }
    for (const key of Object.keys(node)) {
      if (visited >= MAX_WALK_NODES) {
        break;
      }
      const value = node[key];
      if (isObject(value)) {
        walk(value, depth + 1);
      }
    }
  };

  walk(payload, 0);
}

function readPostMetaFromElement(
  element: Element,
  ads: ReadonlySet<string>,
  suggested: ReadonlySet<string>,
): RedditPostMeta {
  const host = element as unknown as Record<string, unknown>;
  const rawId =
    (typeof host.postId === 'string' && host.postId) ||
    (typeof host.thingId === 'string' && host.thingId) ||
    element.getAttribute('id') ||
    element.getAttribute('thing-id') ||
    element.getAttribute('post-id') ||
    null;
  const id = rawId ? rawId.toLowerCase() : null;
  const isAd =
    host.promoted === true ||
    host.isPromoted === true ||
    host.isAd === true ||
    (id !== null && ads.has(id));
  const isSuggested =
    host.isRecommended === true || host.isSuggested === true || (id !== null && suggested.has(id));
  return { id, isAd, isSuggested };
}

export interface RedditPageWorldHandle {
  readonly emitter: PageWorldEmitter;
  readonly dispose: () => void;
}

export interface RedditPageWorldOptions {
  /** When false, stays passive at `document_start` until activated via the `reddit-active` toggle. */
  readonly startActive?: boolean;
}

/**
 * Starts Reddit's MAIN-world bridge: zero-polling `attachShadow` hook, SSR
 * hydration ad/recommendation scanner, and `reddit-post-meta` custom-element
 * property reader.
 */
export function startRedditPageWorld(
  host: ShadowHookHost = globalThis,
  doc: Document = document,
  options: RedditPageWorldOptions = {},
): RedditPageWorldHandle {
  const indexedAds = new Set<string>();
  const indexedSuggested = new Set<string>();
  let scannedScripts = 0;
  let shadowAttachments = 0;
  let stopHydration: (() => void) | undefined;
  let stopShadowWatch: (() => void) | undefined;
  let active = false;

  let emitter!: PageWorldEmitter;

  const emitStats = (): void => {
    emitter.emit('reddit:runtime-stats', {
      scannedScripts,
      indexedAds: indexedAds.size,
      indexedSuggested: indexedSuggested.size,
      shadowAttachments,
    } satisfies RedditRuntimeStats);
  };

  const setActive = (enabled: boolean): { enabled: boolean } => {
    if (enabled === active) {
      return { enabled };
    }
    active = enabled;
    if (enabled) {
      stopHydration = watchHydrationScripts(doc, { textHint: HYDRATION_HINT }, (payloads) => {
        scannedScripts += payloads.length;
        for (const payload of payloads) {
          indexRedditHydrationPayload(payload.data, indexedAds, indexedSuggested);
        }
        emitStats();
      });
      // `watchOpenShadowAttachments` dispatches `SHADOW_ATTACHED_EVENT` in O(1) directly to
      // `DomEnvironment`; avoid per-batch JSON bridge spam on every Web Component mount.
      stopShadowWatch = watchOpenShadowAttachments((count) => {
        shadowAttachments += count;
      }, host);
    } else {
      stopHydration?.();
      stopHydration = undefined;
      stopShadowWatch?.();
      stopShadowWatch = undefined;
    }
    return { enabled };
  };

  const readers: PageReaders = {
    'reddit-post-meta': (element) => readPostMetaFromElement(element, indexedAds, indexedSuggested),
  };
  const toggles: PageToggles = {
    'reddit-active': setActive,
  };
  emitter = servePageWorld(readers, toggles);

  if (options.startActive !== false) {
    setActive(true);
  }

  const cleanup = (): void => {
    setActive(false);
  };
  emitter.onDispose(cleanup);

  return {
    emitter,
    dispose() {
      emitter.dispose();
    },
  };
}
