import type { Platform } from '../core/platform';
import { OPTIONS_TITLE } from '../../project';
import { createLogger } from '../core/log';
import { addMenuCommand, userscriptStore } from './userscript-gm';

const log = createLogger('userscript');

/** The userscript build. */
export const userscriptPlatform: Platform = {
  store: userscriptStore,
  build: 'userscript',
  onOpenOptions(listener) {
    if (!addMenuCommand(OPTIONS_TITLE, listener)) {
      log.error('this userscript manager has no menu, so the options cannot be opened');
    }
  },
  setBadge() {
    // A userscript has no toolbar button. The Diagnostics section shows what the badge would.
  },
};
