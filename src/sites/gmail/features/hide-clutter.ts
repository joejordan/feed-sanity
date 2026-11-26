import type { GmailPage } from '../feature';
import { createHideClutterFeature } from '../../../features/shared/hide-clutter';
import { GMAIL_CATEGORY_TABS, GMAIL_CHAT_MEET, GMAIL_GEMINI, GMAIL_SIDE_PANEL } from '../selectors';

/** Hides optional Gmail workspace clutter (Side panel, Chat/Meet, Gemini, category tabs) via zero-flash CSS rules. */
export default createHideClutterFeature<GmailPage>({
  id: 'gmail_hide_clutter',
  section: 'Workspace',
  group: 'Hide from Gmail',
  rules: [
    {
      key: 'gmail_hide_side_panel',
      spec: GMAIL_SIDE_PANEL,
      title: 'Right side panel',
      description: 'Calendar, Keep, Tasks, and Contacts add-on strip.',
    },
    {
      key: 'gmail_hide_chat_meet',
      spec: GMAIL_CHAT_MEET,
      title: 'Chat and Meet rail',
      description: 'Chat, Spaces, and Meet switcher rail on the left.',
    },
    {
      key: 'gmail_hide_gemini',
      spec: GMAIL_GEMINI,
      title: 'Gemini',
      description: 'Ask Gemini header button and side-panel triggers.',
    },
    {
      key: 'gmail_hide_category_tabs',
      spec: GMAIL_CATEGORY_TABS,
      title: 'Inbox category tabs',
      description: 'Primary, Promotions, and Social tab bar above your inbox.',
    },
  ],
});
