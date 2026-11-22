import type { LocatorSpec } from '../../core/locator';

/** Inbox/category/label thread rows inside Gmail's main thread grid. */
export const GMAIL_THREAD_ROW: LocatorSpec = {
  name: 'gmail-thread-row',
  mode: 'any',
  strategies: [
    {
      selector: 'div[role="main"] tr[role="row"]',
      seen: '2026-11-22',
      note: 'Primary Gmail ARIA thread grid rows inside the active view.',
    },
    {
      selector: 'div[role="main"] table[role="grid"] tbody > tr',
      seen: '2026-11-22',
      note: 'Fallback structural grid rows when role="row" is omitted.',
    },
  ],
};

/** Right-hand Google Workspace Side Panel (Calendar, Keep, Tasks, Contacts). */
export const GMAIL_SIDE_PANEL: LocatorSpec = {
  name: 'gmail-side-panel',
  mode: 'any',
  strategies: [
    {
      selector: '[role="complementary"][aria-label*="Side panel" i], div[aria-label="Side panel"]',
      seen: '2026-11-22',
    },
  ],
};

/** Left rail Google Chat and Meet workspace switches. */
export const GMAIL_CHAT_MEET: LocatorSpec = {
  name: 'gmail-chat-meet',
  mode: 'any',
  strategies: [
    {
      selector:
        '[role="navigation"][aria-label*="Chat" i], [role="navigation"][aria-label*="Meet" i], [data-tooltip="Chat"], [data-tooltip="Meet"]',
      seen: '2026-11-22',
    },
  ],
};

/** Gemini / "Ask Gemini" chrome buttons and side panel (scoped out of email rows/labels). */
export const GMAIL_GEMINI: LocatorSpec = {
  name: 'gmail-gemini',
  mode: 'any',
  strategies: [
    {
      selector:
        'header[role="banner"] [aria-label*="Gemini" i], header[role="banner"] [data-tooltip*="Gemini" i], [role="complementary"][aria-label*="Gemini" i], button[aria-label*="Ask Gemini" i], [role="button"][aria-label*="Ask Gemini" i], button[data-tooltip*="Ask Gemini" i], [role="button"][data-tooltip*="Ask Gemini" i]',
      seen: '2026-11-22',
    },
  ],
};

/** Inbox category tab bar (Primary / Promotions / Social / Updates). */
export const GMAIL_CATEGORY_TABS: LocatorSpec = {
  name: 'gmail-category-tabs',
  mode: 'any',
  strategies: [
    {
      selector: 'div[role="main"] [role="tablist"]',
      seen: '2026-11-22',
    },
  ],
};
