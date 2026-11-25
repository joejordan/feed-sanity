import type { PopupTabState } from '../core/platform';
import type { ThemeDocumentV1 } from '../core/theming/document';
import { isRecord } from '../core/storage';
import { parseThemeDocument } from '../core/theming/document';

export type { BadgeMessage } from './badge-message';
export { badgeMessage, isBadgeMessage } from './badge-message';

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

/** Port name used by the toolbar popup to stream live hover-to-preview themes to the active tab. */
export const THEME_PREVIEW_PORT = 'feed-sanity/theme-preview';

export type ThemePreviewMessage =
  | { readonly type: 'preview'; readonly document: ThemeDocumentV1 }
  | { readonly type: 'clear' };

export const themePreviewMessage = (doc: ThemeDocumentV1 | null): ThemePreviewMessage =>
  doc ? { type: 'preview', document: doc } : { type: 'clear' };

export function parseThemePreviewMessage(message: unknown): ThemePreviewMessage | null {
  if (!isRecord(message)) {
    return null;
  }
  if (message.type === 'clear') {
    return { type: 'clear' };
  }
  if (message.type === 'preview') {
    const parsed = parseThemeDocument(message.document);
    return parsed.ok && parsed.document ? { type: 'preview', document: parsed.document } : null;
  }
  return null;
}
