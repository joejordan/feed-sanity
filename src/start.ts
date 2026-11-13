import { startFeatures } from './core/app';
import { Options } from './core/options';
import type { Store } from './core/storage';
import { currentUserId } from './facebook/user';
import { features } from './features';

/** Starts every feature on the current page. Shared by the extension and the userscript. */
export function start(store: Store): Promise<string[]> {
  return startFeatures(features, new Options(store, `${currentUserId()}/options`));
}
