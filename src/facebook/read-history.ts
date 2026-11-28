import type { FeatureData, SavedValue } from '../core/saved';
import { isRecord } from '../core/storage';
import { isPostId } from './post-id';

/**
 * The posts the user marked as read: each post ID with the time it was
 * marked, in milliseconds since the epoch.
 */
export type ReadHistory = Readonly<Record<string, number>>;

/** The saved-data name the read history is kept under. */
export const READ_HISTORY_KEY = 'read_history';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Longer than any ID Facebook hands out, so a huge key is never kept. */
const MAX_ID_LENGTH = 320;

/**
 * True when `id` can be kept in the read history: a post ID as fb-dom reads
 * one, a numeric ID or a `pfbid0…` token (see `isPostId`).
 */
export function isValidPostId(id: string | null | undefined): id is string {
  return typeof id === 'string' && id.length <= MAX_ID_LENGTH && isPostId(id);
}

const isMarkTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/**
 * Turns whatever the store holds into a read history. Anything that is not
 * a plain object reads as empty, and entries with a bad ID or time are dropped.
 */
export function readReadHistory(stored: unknown): ReadHistory {
  if (!isRecord(stored)) {
    return {};
  }
  const prototype: unknown = Object.getPrototypeOf(stored);
  if (prototype !== Object.prototype && prototype !== null) {
    return {};
  }
  const history: Record<string, number> = {};
  for (const [id, time] of Object.entries(stored)) {
    if (isValidPostId(id) && isMarkTime(time)) {
      history[id] = time;
    }
  }
  return history;
}

/** The site's read history. Every caller with the same `SavedData` gets the same object. */
export function savedReadHistory(data: FeatureData): SavedValue<ReadHistory> {
  return data.value(READ_HISTORY_KEY, readReadHistory);
}

/** True when the read history holds `id`. */
export function isPostRead(history: ReadHistory, id: string | null | undefined): boolean {
  // The history holds valid IDs only, so any other key misses.
  return typeof id === 'string' && Object.hasOwn(history, id);
}

/**
 * `history` with each of `ids` marked read at `now`, or unmarked. Returns
 * null when nothing changes. Invalid IDs are ignored, and a post already
 * marked keeps the time it was first marked.
 */
function withPostsRead(
  history: ReadHistory,
  ids: readonly string[],
  read: boolean,
  now: number = Date.now(),
): ReadHistory | null {
  let next: Record<string, number> | null = null;
  for (const id of ids) {
    if (!isValidPostId(id) || Object.hasOwn(history, id) === read) {
      continue;
    }
    next ??= { ...history };
    if (read) {
      next[id] = now;
    } else {
      delete next[id];
    }
  }
  return next;
}

/**
 * Marks each of `ids` read, or unread, with one write. Resolves true when
 * anything changed. Waits for the history to be read first, so the write
 * never replaces marks this tab has not seen.
 */
export async function setPostsRead(
  saved: SavedValue<ReadHistory>,
  ids: readonly string[],
  read: boolean,
  now: number = Date.now(),
): Promise<boolean> {
  await saved.ready;
  const next = withPostsRead(saved.get(), ids, read, now);
  if (!next) {
    return false;
  }
  await saved.set(next);
  return true;
}

/**
 * `history` without the marks older than `keepDays` days, or null when
 * none is. A `keepDays` of zero or less keeps everything.
 */
export function pruneReadHistory(
  history: ReadHistory,
  keepDays: number,
  now: number,
): ReadHistory | null {
  if (!(keepDays > 0) || !Number.isFinite(keepDays)) {
    return null;
  }
  const oldest = now - keepDays * DAY_MS;
  let pruned: Record<string, number> | null = null;
  for (const [id, time] of Object.entries(history)) {
    if (time < oldest) {
      pruned ??= { ...history };
      delete pruned[id];
    }
  }
  return pruned;
}
