import pageWorldScript from 'virtual:page-world-script';
import type { Platform } from '../core/platform';
import { OPTIONS_TITLE } from '../../project';
import { createLogger } from '../core/log';
import { openQuickPopup } from '../ui/popup';
import { runInPage } from './page-script';
import { addMenuCommand, userscriptStore } from './userscript-gm';

const log = createLogger('userscript');

/** The userscript build. */
export const userscriptPlatform: Platform = {
  store: userscriptStore,
  build: 'userscript',
  onOpenOptions(listener) {
    if (!addMenuCommand(OPTIONS_TITLE, () => listener())) {
      log.error('this userscript manager has no menu, so the options cannot be opened');
    }
  },
  registerQuickPopup(getRequest) {
    addMenuCommand('Feed Sanity quick controls', () => {
      void getRequest()
        .then((req) => openQuickPopup(req))
        .catch((error: unknown) => log.error('could not open quick controls', error));
    });
  },
  setBadge() {
    // A userscript has no toolbar button. The Diagnostics section shows what the badge would.
  },
  // Whichever world the manager runs the userscript in, a script element
  // runs in the page's.
  installPageWorld: () => runInPage(pageWorldScript),
};
