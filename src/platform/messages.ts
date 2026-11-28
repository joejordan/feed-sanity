import type { PopupTabState } from '../core/platform';
import type { ThemeDocumentV1 } from '../core/theming/document';
import type { ThemeUrlFetchResult } from '../core/theming/url-import';
import { isRecord } from '../core/storage';
import { parseThemeDocument } from '../core/theming/document';

export type { AttachTabMessage, AttachTabReply } from './auto-attach';
export type { BadgeMessage } from './badge-message';
export type { RequestPageWorldMessage, RequestPageWorldReply } from './safari-page-world';
export {
  ATTACH_TAB,
  attachTabMessage,
  isAttachTabMessage,
  isAttachTabReply,
} from './auto-attach';
export { badgeMessage, badgeVisualKey, isBadgeMessage } from './badge-message';
export {
  isRequestPageWorldMessage,
  isRequestPageWorldReply,
  REQUEST_PAGE_WORLD,
  requestPageWorldMessage,
} from './safari-page-world';

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

/** Sent from the toolbar popup to an already-open standalone Settings window to switch site/section. */
export const NAVIGATE_OPTIONS = 'feed-sanity/navigate-options';

export interface NavigateOptionsMessage {
  readonly type: typeof NAVIGATE_OPTIONS;
  readonly siteId?: string;
  readonly section?: string;
}

export function navigateOptionsMessage(args: {
  readonly siteId?: string;
  readonly section?: string;
}): NavigateOptionsMessage {
  return {
    type: NAVIGATE_OPTIONS,
    ...(args.siteId ? { siteId: args.siteId } : {}),
    ...(args.section ? { section: args.section } : {}),
  };
}

export function parseNavigateOptionsMessage(
  message: unknown,
): { readonly siteId?: string; readonly section?: string } | null {
  if (!isRecord(message) || message.type !== NAVIGATE_OPTIONS) {
    return null;
  }
  const siteId =
    typeof message.siteId === 'string' && message.siteId.length > 0 ? message.siteId : undefined;
  const section =
    typeof message.section === 'string' && message.section.length > 0 ? message.section : undefined;
  return {
    ...(siteId ? { siteId } : {}),
    ...(section ? { section } : {}),
  };
}

/** Sent from the toolbar popup to the active tab to inspect site, account prefix, and hidden count. */
export const GET_POPUP_STATE = 'feed-sanity/get-popup-state';

/** Sent by a content script to verify its own extension background runtime is still alive. */
export const PING_RUNTIME = 'feed-sanity/ping';

/** Sent by Appearance's Import-by-URL UI so fetches bypass host-page `connect-src` CSP. */
export const FETCH_THEME_URL = 'feed-sanity/fetch-theme-url';

export interface FetchThemeUrlMessage {
  readonly type: typeof FETCH_THEME_URL;
  readonly url: string;
}

export function fetchThemeUrlMessage(url: string): FetchThemeUrlMessage {
  return { type: FETCH_THEME_URL, url };
}

export function parseFetchThemeUrlMessage(message: unknown): string | null {
  if (
    isRecord(message) &&
    message.type === FETCH_THEME_URL &&
    typeof message.url === 'string' &&
    message.url.length > 0
  ) {
    return message.url;
  }
  return null;
}

export function isThemeUrlFetchResult(value: unknown): value is ThemeUrlFetchResult {
  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    return false;
  }
  if (value.ok) {
    return typeof value.text === 'string' && typeof value.finalUrl === 'string';
  }
  return typeof value.error === 'string';
}

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
