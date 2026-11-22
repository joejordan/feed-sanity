import type { PageBridge } from '../core/bridge';
import type { StopFeedRefreshAnswer } from './page-toggles';
import { isRecord } from '../core/storage';
import { STOP_FEED_REFRESH } from './page-toggles';

export type { StopFeedRefreshAnswer };

/**
 * Checks what the page-world toggle sent back: an object with a boolean
 * `enabled` and a list of patched module names, or null for anything else.
 * The page can send the same events, so nothing else in the answer is used.
 */
export function checkStopFeedRefresh(answer: unknown): StopFeedRefreshAnswer | null {
  if (
    !isRecord(answer) ||
    typeof answer.enabled !== 'boolean' ||
    !Array.isArray(answer.patched) ||
    !answer.patched.every((name) => typeof name === 'string')
  ) {
    return null;
  }
  return { enabled: answer.enabled, patched: [...answer.patched] };
}

/**
 * Switches Facebook's automatic feed refreshes off (`enabled = true`) or back
 * on (`enabled = false`) through the page-world bridge.
 */
export async function setStopFeedRefresh(
  bridge: Pick<PageBridge, 'set'>,
  enabled: boolean,
  signal?: AbortSignal,
): Promise<StopFeedRefreshAnswer | null> {
  return checkStopFeedRefresh(await bridge.set(STOP_FEED_REFRESH, enabled, signal));
}
