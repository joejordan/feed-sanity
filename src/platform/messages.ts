import type { Badge, PopupTabState } from '../core/platform';
import { isRecord } from '../core/storage';

/** Sent from the background script or toolbar popup to a tab to open the options dialog. */
export const OPEN_OPTIONS = 'feed-sanity/open-options';

/** Optional structured payload for `OPEN_OPTIONS` when jumping directly to a section. */
export interface OpenOptionsMessage {
  readonly type: typeof OPEN_OPTIONS;
  readonly section?: string;
}

export function openOptionsMessage(section?: string): OpenOptionsMessage {
  return section ? { type: OPEN_OPTIONS, section } : { type: OPEN_OPTIONS };
}

export function parseOpenOptionsMessage(
  message: unknown,
): { readonly matched: true; readonly section?: string } | { readonly matched: false } {
  if (message === OPEN_OPTIONS) {
    return { matched: true };
  }
  if (isRecord(message) && message.type === OPEN_OPTIONS) {
    return typeof message.section === 'string' && message.section.length > 0
      ? { matched: true, section: message.section }
      : { matched: true };
  }
  return { matched: false };
}

/** Sent from the toolbar popup to the active tab to inspect site, account prefix, and hidden count. */
export const GET_POPUP_STATE = 'feed-sanity/get-popup-state';

export function isPopupTabState(value: unknown): value is PopupTabState {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.siteId === 'string' &&
    typeof value.displayName === 'string' &&
    typeof value.storagePrefix === 'string' &&
    typeof value.enabled === 'boolean' &&
    typeof value.hiddenCount === 'number' &&
    Number.isFinite(value.hiddenCount)
  );
}

/** Sent from a tab to the background script, which shows `badge` on the toolbar button for that tab. */
export interface BadgeMessage {
  readonly type: 'feed-sanity/badge';
  readonly badge: Badge;
}

export const badgeMessage = (badge: Badge): BadgeMessage => ({ type: 'feed-sanity/badge', badge });

export function isBadgeMessage(message: unknown): message is BadgeMessage {
  if (!isRecord(message) || message.type !== 'feed-sanity/badge' || !isRecord(message.badge)) {
    return false;
  }
  return Number.isInteger(message.badge.count) && typeof message.badge.failed === 'boolean';
}
