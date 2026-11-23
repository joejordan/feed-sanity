import type { SiteSettingsClient } from './site-settings';
import type { Store } from './storage';

/** What the toolbar button's badge shows for the page. */
export interface Badge {
  /** The sum of the numbers the features report, such as the posts hidden. 0 shows nothing. */
  readonly count: number;
  /** True when a feature has failed. Its mark is shown in place of the count. */
  readonly failed: boolean;
}

/** Live state of the active supported tab, returned to the toolbar popup. */
export interface PopupTabState {
  readonly siteId: string;
  readonly displayName: string;
  readonly storagePrefix: string;
  readonly enabled: boolean;
  readonly hiddenCount: number;
}

/** Arguments passed when mounting the Userscript quick-controls overlay. */
export interface QuickPopupRequest {
  readonly store: Store;
  readonly activeTab: PopupTabState;
  readonly siteSettings: SiteSettingsClient;
  readonly onOpenSettings: (section?: string) => void;
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
   * toolbar button or popup in the extension, or the userscript manager's menu.
   * When `section` is supplied, the dialog opens directly to that section.
   */
  onOpenOptions: (listener: (section?: string) => void) => void;
  /**
   * Optional quick-control popup registration (used by the userscript build so
   * browser extension content scripts do not bundle the popup UI).
   */
  registerQuickPopup?: (getRequest: () => Promise<QuickPopupRequest>) => void;
  /**
   * Optional handler answering the extension toolbar popup's state query so the
   * popup can bind to the active tab's site and account-scoped storage prefix
   * without requesting extra host or `tabs` permissions.
   */
  onPopupStateRequest?: (handler: () => Promise<PopupTabState>) => void;
  /**
   * Shows `badge` on the toolbar button, for this tab only. The userscript
   * has no toolbar button, and there it does nothing.
   */
  setBadge: (badge: Badge) => void;
  /**
   * Puts the page-world side of the bridge, `startPageWorld` in
   * `src/page-world.ts`, in the page, where it runs with the page's own
   * scripts. Rejects when the page refuses it. Resolves once it has been
   * added, or at once in a build whose manifest adds it by itself. Whether
   * it runs is known only once it answers; see `PageBridge` in
   * `src/core/bridge.ts`. Called at most once per page load.
   */
  installPageWorld: () => Promise<void>;
}
