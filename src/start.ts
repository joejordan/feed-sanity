import type { Platform } from './core/platform';
import { startFeatures } from './core/app';
import { createLogger } from './core/log';
import { Options } from './core/options';
import { SavedData } from './core/saved';
import { createPage } from './facebook/feature';
import { currentUserId } from './facebook/user';
import { features, optionsPanels } from './features';
import { openOptionsDialog } from './ui/options-dialog';

/** Starts every feature on the current page. Shared by the extension and the userscript. */
export function start(platform: Platform): Promise<string[]> {
  const user = currentUserId();
  const options = new Options(platform.store, `${user}/options`);
  const data = new SavedData(platform.store, user);
  const panels = optionsPanels(data);
  // Registers the features' options before its first await, so the dialog
  // can open once the saved values are read rather than after the slowest
  // feature has started.
  const started = startFeatures(features, options, createPage(data), data);
  platform.onOpenOptions(() => {
    openOptionsDialog(options, panels).catch((error: unknown) => {
      createLogger('options').error('could not open the options dialog', error);
    });
  });
  return started;
}
