import type { Badge } from '../core/platform';

/** Sent from the background script to a tab when the toolbar button is clicked. */
export const OPEN_OPTIONS = 'feed-sanity/open-options';

/** Sent from a tab to the background script, which shows `badge` on the toolbar button for that tab. */
export interface BadgeMessage {
  readonly type: 'feed-sanity/badge';
  readonly badge: Badge;
}

export const badgeMessage = (badge: Badge): BadgeMessage => ({ type: 'feed-sanity/badge', badge });

export function isBadgeMessage(message: unknown): message is BadgeMessage {
  if (typeof message !== 'object' || message === null) {
    return false;
  }
  const { type, badge } = message as Partial<BadgeMessage>;
  return (
    type === 'feed-sanity/badge' &&
    typeof badge === 'object' &&
    badge !== null &&
    Number.isInteger(badge.count) &&
    typeof badge.failed === 'boolean'
  );
}
