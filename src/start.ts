import type { Platform } from './core/platform';
import { startFeatures } from './core/app';
import { createLogger } from './core/log';
import { Options } from './core/options';
import { createPage } from './facebook/feature';
import { currentUserId } from './facebook/user';
import { features } from './features';

/** Starts every feature on the current page. Shared by the extension and the userscript. */
export function start(platform: Platform): Promise<string[]> {
  const options = new Options(platform.store, `${currentUserId()}/options`);
  // Registers the features' options before its first await, so the dialog
  // can open once the saved values are read rather than after the slowest
  // feature has started.
  const started = startFeatures(features, options, createPage());
  platform.onOpenOptions(() => {
    // The dialog is imported on first use, so React does not start on every
    // page load. It waits for the saved values, so that it shows them and a
    // save does not overwrite the ones not read yet.
    Promise.all([options.loaded, import('./ui/options-dialog')])
      .then(([, { openOptionsDialog }]) => openOptionsDialog(options))
      .catch((error: unknown) => {
        createLogger('options').error('could not open the options dialog', error);
      });
  });
  return started;
}
