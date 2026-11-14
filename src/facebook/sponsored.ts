import type { PageBridge } from '../core/bridge';
import { isRecord } from '../core/storage';
import { POST_SPONSORED } from './react-readers';

/**
 * Checks what the page-world reader sent back: true or false for a post
 * whose feed unit was found, and null for anything else, which is how the
 * reader says it found none. The page can send the same events, so nothing
 * else in the answer is used.
 */
export function checkSponsored(answer: unknown): boolean | null {
  return isRecord(answer) && typeof answer.sponsored === 'boolean' ? answer.sponsored : null;
}

/**
 * Asks the page-world side whether the feed post `element` is an ad.
 * Resolves null when it found no feed unit for it, and rejects with the
 * bridge's `BridgeError` when it could not be asked.
 */
export async function postSponsored(
  bridge: Pick<PageBridge, 'ask'>,
  element: Element,
  signal?: AbortSignal,
): Promise<boolean | null> {
  return checkSponsored(await bridge.ask(element, POST_SPONSORED, signal));
}
