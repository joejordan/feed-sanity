import type { Store } from './storage';

/**
 * What the extension and the userscript each provide, in `src/platform/`.
 */
export interface Platform {
  store: Store;
  /**
   * Calls `listener` when the user asks for the options dialog: from the
   * toolbar button in the extension, or the userscript manager's menu.
   */
  onOpenOptions: (listener: () => void) => void;
}
