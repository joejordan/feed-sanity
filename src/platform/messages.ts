import type { Badge, SitePermissionStatus } from '../core/platform';

export type { SitePermissionStatus };

/** Sent from the background script to a tab when the toolbar button is clicked. */
export const OPEN_OPTIONS = 'feed-sanity/open-options';

/** Sent from a content script to ask which sites currently have host permissions. */
export const SITE_PERMISSIONS_GET = 'feed-sanity/site-permissions-get';

export interface SitePermissionRevokeMessage {
  readonly type: 'feed-sanity/site-permissions-revoke';
  readonly siteId: string;
}

export const sitePermissionRevokeMessage = (siteId: string): SitePermissionRevokeMessage => ({
  type: 'feed-sanity/site-permissions-revoke',
  siteId,
});

export function isSitePermissionRevokeMessage(
  message: unknown,
): message is SitePermissionRevokeMessage {
  if (typeof message !== 'object' || message === null) {
    return false;
  }
  const { type, siteId } = message as Partial<SitePermissionRevokeMessage>;
  return type === 'feed-sanity/site-permissions-revoke' && typeof siteId === 'string';
}

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
