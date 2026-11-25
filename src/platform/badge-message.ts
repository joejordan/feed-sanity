import type { Badge } from '../core/platform';
import { isRecord } from '../core/storage';

const BADGE_MESSAGE = 'feed-sanity/badge';

/** Sent from a tab to the background script, which shows `badge` on the toolbar button for that tab. */
export interface BadgeMessage {
  readonly type: typeof BADGE_MESSAGE;
  readonly badge: Badge;
}

export const badgeMessage = (badge: Badge): BadgeMessage => ({ type: BADGE_MESSAGE, badge });

export function isBadgeMessage(message: unknown): message is BadgeMessage {
  if (!isRecord(message) || message.type !== BADGE_MESSAGE || !isRecord(message.badge)) {
    return false;
  }
  return Number.isInteger(message.badge.count) && typeof message.badge.failed === 'boolean';
}
