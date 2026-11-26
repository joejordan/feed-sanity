import type { Badge } from '../core/platform';
import { isRecord } from '../core/storage';

const BADGE_MESSAGE = 'feed-sanity/badge';

/** Sent from a tab to the background script, which shows `badge` on the toolbar button for that tab. */
export interface BadgeMessage {
  readonly type: typeof BADGE_MESSAGE;
  readonly badge: Badge;
}

export const badgeMessage = (badge: Badge): BadgeMessage => ({ type: BADGE_MESSAGE, badge });

/** Key for the toolbar-visible badge state (`failed` and `paused`); ignores scroll-only `count` updates. */
export const badgeVisualKey = ({ failed, paused }: Badge): string =>
  `${failed ? '1' : '0'}:${paused ? '1' : '0'}`;

export function isBadgeMessage(message: unknown): message is BadgeMessage {
  if (!isRecord(message) || message.type !== BADGE_MESSAGE || !isRecord(message.badge)) {
    return false;
  }
  const { count, failed, paused } = message.badge;
  return (
    Number.isInteger(count) &&
    typeof failed === 'boolean' &&
    (paused === undefined || typeof paused === 'boolean')
  );
}
