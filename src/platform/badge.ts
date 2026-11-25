import type { Badge } from '../core/platform';
import { ACTIVE_ICON_PATHS, OPTIONS_TITLE, PAUSED_ICON_PATHS } from '../../project';
import { isBadgeMessage } from './badge-message';

export { ACTIVE_ICON_PATHS, PAUSED_ICON_PATHS };

export type ToolbarIconPath = string | Record<number, string>;

/**
 * The parts of the toolbar button's API the badge uses. Manifest V3 calls
 * it `action` and Manifest V2, which the Firefox build uses, `browserAction`.
 * Neither needs a permission, only the button in the manifest.
 */
export interface ToolbarButton {
  setBadgeText: (details: { tabId: number; text: string }) => Promise<void>;
  setBadgeBackgroundColor: (details: { tabId: number; color: string }) => Promise<void>;
  setTitle: (details: { tabId: number; title: string }) => Promise<void>;
  setIcon: (details: { tabId: number; path: ToolbarIconPath }) => Promise<void>;
}

/** The mark shown when a feature has failed. */
export const FAILED_MARK = '!';

/** Facebook's red, for the failed mark. */
const FAILED_COLOUR = '#e41e3f';

/** The badge's text: the failed mark when a feature has stopped working, otherwise nothing. */
export function badgeText({ failed }: Badge): string {
  return failed ? FAILED_MARK : '';
}

function badgeTitle({ failed, paused }: Badge): string {
  if (failed) {
    return `${OPTIONS_TITLE}. A feature has stopped working: see Diagnostics in the options.`;
  }
  if (paused) {
    return `${OPTIONS_TITLE} (paused on this site)`;
  }
  return OPTIONS_TITLE;
}

/** Who sent a message, as `runtime.onMessage` reports it. */
interface Sender {
  tab?: { id?: number | undefined } | undefined;
}

/**
 * A `runtime.onMessage` listener for the background script that shows each
 * badge a tab sends on that tab's button. Other messages are left alone, and
 * so are messages that do not come from a tab.
 */
export function badgeListener(
  button: ToolbarButton,
  activeIcon: Readonly<Record<number, string>> | string = ACTIVE_ICON_PATHS,
): (message: unknown, sender: Sender) => void {
  return (message, sender) => {
    const tabId = sender.tab?.id;
    if (!isBadgeMessage(message) || tabId === undefined) {
      return;
    }
    showBadge(button, tabId, message.badge, activeIcon).catch(() => {
      // The tab was closed before the badge reached it.
    });
  };
}

function toIconPath(path: Readonly<Record<number, string>> | string): ToolbarIconPath {
  return typeof path === 'string' ? path : { ...path };
}

/** Shows `badge` on `button` for the tab `tabId` only. */
export async function showBadge(
  button: ToolbarButton,
  tabId: number,
  badge: Badge,
  activeIcon: Readonly<Record<number, string>> | string = ACTIVE_ICON_PATHS,
): Promise<void> {
  const iconPath = toIconPath(badge.paused ? PAUSED_ICON_PATHS : activeIcon);
  await Promise.all([
    button.setBadgeText({ tabId, text: badgeText(badge) }),
    ...(badge.failed ? [button.setBadgeBackgroundColor({ tabId, color: FAILED_COLOUR })] : []),
    button.setTitle({ tabId, title: badgeTitle(badge) }),
    button.setIcon({ tabId, path: iconPath }),
  ]);
}
