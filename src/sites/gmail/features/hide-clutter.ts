import type { GmailPage } from '../feature';
import { createHideClutterFeature } from '../../../features/shared/hide-clutter';
import { GMAIL_CATEGORY_TABS, GMAIL_CHAT_MEET, GMAIL_GEMINI, GMAIL_SIDE_PANEL } from '../selectors';

/** Hides optional Gmail workspace clutter (Side panel, Chat/Meet, Gemini, category tabs) via zero-flash CSS rules. */
export default createHideClutterFeature<GmailPage>({
  id: 'gmail_hide_clutter',
  rules: [
    {
      key: 'gmail_hide_side_panel',
      spec: GMAIL_SIDE_PANEL,
      section: 'Workspace',
      title: 'Hide Google Workspace side panel',
      description: 'Hide the right-hand Calendar, Keep, Tasks, and Contacts side panel.',
    },
    {
      key: 'gmail_hide_chat_meet',
      spec: GMAIL_CHAT_MEET,
      section: 'Workspace',
      title: 'Hide Chat and Meet rail',
      description: 'Hide Google Chat, Spaces, and Meet navigation switches.',
    },
    {
      key: 'gmail_hide_gemini',
      spec: GMAIL_GEMINI,
      section: 'Workspace',
      title: 'Hide Gemini buttons and panel',
      description: 'Hide Ask Gemini header buttons and side-panel triggers.',
    },
    {
      key: 'gmail_hide_category_tabs',
      spec: GMAIL_CATEGORY_TABS,
      section: 'Workspace',
      title: 'Hide inbox category tabs',
      description: 'Hide the Primary / Promotions / Social tab bar above the inbox.',
    },
  ],
});
