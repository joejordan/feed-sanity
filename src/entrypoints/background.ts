import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import type { SitePermissionsHost } from '../platform/site-permissions';
import { badgeListener } from '../platform/badge';
import { OPEN_OPTIONS } from '../platform/messages';
import {
  enableSiteForTab,
  sitePermissionsListener,
  syncOptionalSiteScripts,
} from '../platform/site-permissions';
import { optionalSiteForUrl } from '../sites/manifest';

export default defineBackground(() => {
  // Manifest V2, which the Firefox build uses, calls the toolbar button browserAction.
  const action = browser.action ?? browser.browserAction;
  const host = browser as unknown as SitePermissionsHost;

  void syncOptionalSiteScripts(host);
  browser.permissions?.onAdded?.addListener(() => {
    void syncOptionalSiteScripts(host);
  });
  browser.permissions?.onRemoved?.addListener(() => {
    void syncOptionalSiteScripts(host);
  });

  action.onClicked.addListener((tab) => {
    if (tab.id === undefined) {
      return;
    }
    const tabId = tab.id;
    // Check optional sites synchronously before any `await` so Firefox and
    // Chrome both preserve the user-input handler activation for
    // `permissions.request()`. Already-granted origins resolve immediately
    // without prompting and open Options cleanly without double-injecting.
    const optionalSite = tab.url ? optionalSiteForUrl(tab.url) : undefined;
    if (optionalSite) {
      void enableSiteForTab(host, optionalSite, tabId);
      return;
    }
    browser.tabs.sendMessage(tabId, OPEN_OPTIONS).catch(() => {
      // Not a supported or permitted page, so nothing in the tab is listening.
    });
  });

  // The content script cannot reach the toolbar button, so it sends its badge here.
  browser.runtime.onMessage.addListener(badgeListener(action));
  // Options dialog Sites panel queries and revokes optional site permissions here.
  browser.runtime.onMessage.addListener(sitePermissionsListener(host));
});
