import type { Store } from './storage';

/** What the toolbar button's badge shows for the page. */
export interface Badge {
  /** The sum of the numbers the features report, such as the posts hidden. 0 shows nothing. */
  readonly count: number;
  /** True when a feature has failed. Its mark is shown in place of the count. */
  readonly failed: boolean;
}

/**
 * What the extension and the userscript each provide, in `src/platform/`.
 */
export interface Platform {
  store: Store;
  /** Which build this is, such as `Chrome extension` or `userscript`, for the diagnostics. */
  build: string;
  /**
   * Calls `listener` when the user asks for the options dialog: from the
   * toolbar button in the extension, or the userscript manager's menu.
   */
  onOpenOptions: (listener: () => void) => void;
  /**
   * Shows `badge` on the toolbar button, for this tab only. The userscript
   * has no toolbar button, and there it does nothing.
   */
  setBadge: (badge: Badge) => void;
}
