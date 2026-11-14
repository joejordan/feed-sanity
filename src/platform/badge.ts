import type { Badge } from '../core/platform';
import { OPTIONS_TITLE } from '../../project';
import { isBadgeMessage } from './messages';

/**
 * The parts of the toolbar button's API the badge uses. Manifest V3 calls
 * it `action` and Manifest V2, which the Firefox build uses, `browserAction`.
 * Neither needs a permission, only the button in the manifest.
 */
export interface ToolbarButton {
  setBadgeText: (details: { tabId: number; text: string }) => Promise<void>;
  setBadgeBackgroundColor: (details: { tabId: number; color: string }) => Promise<void>;
  setTitle: (details: { tabId: number; title: string }) => Promise<void>;
}

/** The mark shown when a feature has failed. */
export const FAILED_MARK = '!';

/** Facebook's red, for the failed mark. */
const FAILED_COLOUR = '#e41e3f';

/** Facebook's grey for secondary text, for a count. */
const COUNT_COLOUR = '#65686c';

/** A badge has room for about four characters. */
const MOST_SHOWN = 999;

/** The badge's text: the failed mark, the count, or nothing. */
export function badgeText({ count, failed }: Badge): string {
  if (failed) {
    return FAILED_MARK;
  }
  if (count > MOST_SHOWN) {
    return `${MOST_SHOWN}+`;
  }
  return count > 0 ? String(count) : '';
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
export function badgeListener(button: ToolbarButton): (message: unknown, sender: Sender) => void {
  return (message, sender) => {
    const tabId = sender.tab?.id;
    if (!isBadgeMessage(message) || tabId === undefined) {
      return;
    }
    showBadge(button, tabId, message.badge).catch(() => {
      // The tab was closed before the badge reached it.
    });
  };
}

/** Shows `badge` on `button` for the tab `tabId` only. */
export async function showBadge(button: ToolbarButton, tabId: number, badge: Badge): Promise<void> {
  const title = badge.failed
    ? `${OPTIONS_TITLE}. A feature has stopped working: see Diagnostics in the options.`
    : OPTIONS_TITLE;
  await Promise.all([
    button.setBadgeText({ tabId, text: badgeText(badge) }),
    button.setBadgeBackgroundColor({ tabId, color: badge.failed ? FAILED_COLOUR : COUNT_COLOUR }),
    button.setTitle({ tabId, title }),
  ]);
}
