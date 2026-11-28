import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { browser } from 'wxt/browser';
import type { PopupTabState } from '../../core/platform';
import type { ThemeDocumentV1 } from '../../core/theming/document';
import type { UnattachedSupportedTab } from '../../ui/popup/quick-popup';
import { matchAttachableSite } from '../../platform/auto-attach';
import { extensionStore } from '../../platform/extension-store';
import {
  attachTabMessage,
  GET_POPUP_STATE,
  isAttachTabReply,
  isPopupTabState,
  navigateOptionsMessage,
  openOptionsMessage,
  THEME_PREVIEW_PORT,
  themePreviewMessage,
} from '../../platform/messages';
import { SITE_MANIFEST } from '../../sites/manifest';
import {
  compileDocumentUiTheme,
  EXTENSION_THEME_TOKENS_CSS,
  injectDocumentStyle,
  toDocumentCss,
} from '../../ui/document-theme';
import { QuickPopup } from '../../ui/popup/quick-popup';
import quickPopupCss from '../../ui/popup/quick-popup.css?inline';
import { BrandMark, BrandWordmark, primitivesCss } from '../../ui/primitives';
import baseThemeCss from '../../ui/theme.css?inline';

injectDocumentStyle(
  'fs-popup-base-style',
  [toDocumentCss(baseThemeCss), EXTENSION_THEME_TOKENS_CSS, primitivesCss, quickPopupCss].join(
    '\n',
  ),
);

const STANDALONE_WINDOW_WIDTH = 980;
const STANDALONE_WINDOW_HEIGHT = 720;

async function openStandaloneSettingsWindow(args: {
  readonly siteId?: string;
  readonly section?: string;
}): Promise<void> {
  const baseUrl = browser.runtime.getURL('/options.html');
  const url = new URL(baseUrl);
  if (args.siteId) {
    url.searchParams.set('site', args.siteId);
  }
  if (args.section) {
    url.searchParams.set('section', args.section);
  }
  const targetUrl = url.toString();

  // Focus and navigate an existing standalone Settings window if one is already open.
  try {
    const existingTabs = await browser.tabs.query({ url: `${baseUrl}*` });
    const existing = existingTabs.find((tab) => tab.id !== undefined);
    if (existing?.id !== undefined) {
      let navigated = false;
      try {
        const reply: unknown = await browser.tabs.sendMessage(
          existing.id,
          navigateOptionsMessage(args),
        );
        navigated = Boolean(reply);
      } catch {
        // Tab may still be loading; fall back to updating its URL directly.
      }
      const tabUpdate = browser.tabs.update(
        existing.id,
        navigated ? { active: true } : { url: targetUrl, active: true },
      );
      const windowUpdate =
        existing.windowId !== undefined && typeof browser.windows?.update === 'function'
          ? browser.windows.update(existing.windowId, { focused: true }).catch(() => undefined)
          : undefined;
      await Promise.all([tabUpdate, windowUpdate]);
      return;
    }
  } catch {
    // Fall through to creating a fresh window/tab.
  }

  if (typeof browser.windows?.create === 'function') {
    try {
      await browser.windows.create({
        url: targetUrl,
        type: 'popup',
        width: STANDALONE_WINDOW_WIDTH,
        height: STANDALONE_WINDOW_HEIGHT,
        focused: true,
      });
      return;
    } catch {
      // Mobile or restricted browser environments fall back to opening a tab.
    }
  }
  await browser.tabs.create({ url: targetUrl });
}

interface ActiveTabInfo {
  readonly tabId: number;
  readonly state: PopupTabState;
}

interface UnattachedTabInfo extends UnattachedSupportedTab {
  readonly tabId: number;
}

type TabConnectionResult =
  | { readonly kind: 'active'; readonly active: ActiveTabInfo }
  | { readonly kind: 'unattached'; readonly unattached: UnattachedTabInfo }
  | { readonly kind: 'unsupported' };

/** Upper bound on waiting for the active tab's content script before falling back to the launcher. */
const POPUP_STATE_TIMEOUT_MS = 1200;

async function queryTabPopupState(tabId: number): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      browser.tabs.sendMessage(tabId, GET_POPUP_STATE),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), POPUP_STATE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function PopupApp() {
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState<ActiveTabInfo | null>(null);
  const [unattached, setUnattached] = useState<UnattachedTabInfo | null>(null);
  const connectSeqRef = useRef(0);
  const savedThemeCssRef = useRef('');
  const previewingRef = useRef(false);
  const previewPortRef = useRef<ReturnType<typeof browser.tabs.connect> | null>(null);

  const connectActiveTab = useCallback((): Promise<boolean> => {
    const seq = ++connectSeqRef.current;
    return browser.tabs
      .query({ active: true, currentWindow: true })
      .then(async (activeTabs): Promise<TabConnectionResult> => {
        const ownOrigin = browser.runtime.getURL('');
        let targetTab = activeTabs[0];
        // When `popup.html` is opened directly in a tab (e.g., dev inspection or E2E),
        // target the most recent non-extension tab in the same window instead of itself.
        if (targetTab?.url?.startsWith(ownOrigin)) {
          const windowTabs = await browser.tabs.query({ currentWindow: true });
          targetTab = windowTabs.find(
            (tab) => tab.id !== targetTab?.id && !tab.url?.startsWith(ownOrigin),
          );
        }
        const tabId = targetTab?.id;
        if (tabId === undefined) {
          return { kind: 'unsupported' };
        }
        try {
          const response: unknown = await queryTabPopupState(tabId);
          if (isPopupTabState(response)) {
            return { kind: 'active', active: { tabId, state: response } };
          }
        } catch {
          // Content script may not be attached yet (e.g. tab predated install/reload
          // or user just granted per-site permission on Safari); ask background to attach.
        }
        try {
          const attachReply: unknown = await browser.runtime.sendMessage(attachTabMessage(tabId));
          if (isAttachTabReply(attachReply) && attachReply.attached) {
            const retried: unknown = await queryTabPopupState(tabId);
            if (isPopupTabState(retried)) {
              return { kind: 'active', active: { tabId, state: retried } };
            }
          }
        } catch {
          // Unsupported tab or background unavailable.
        }
        const matched = matchAttachableSite(targetTab?.url);
        if (matched) {
          const entry = SITE_MANIFEST.find((site) => site.id === matched.siteId);
          return {
            kind: 'unattached',
            unattached: {
              tabId,
              siteId: matched.siteId,
              displayName: entry?.displayName ?? matched.siteId,
              origins: matched.matches,
            },
          };
        }
        return { kind: 'unsupported' };
      })
      .catch((): TabConnectionResult => ({ kind: 'unsupported' }))
      .then((result) => {
        if (seq !== connectSeqRef.current) {
          return false;
        }
        if (result.kind === 'active') {
          setActive(result.active);
          setUnattached(null);
          setLoaded(true);
          return true;
        }
        setActive(null);
        setUnattached(result.kind === 'unattached' ? result.unattached : null);
        savedThemeCssRef.current = '';
        previewingRef.current = false;
        injectDocumentStyle('fs-popup-user-theme', '');
        setLoaded(true);
        return false;
      });
  }, []);

  useEffect(() => {
    void connectActiveTab();
    return () => {
      connectSeqRef.current++;
    };
  }, [connectActiveTab]);

  useEffect(() => {
    const disconnectPreview = (): void => {
      const port = previewPortRef.current;
      previewPortRef.current = null;
      try {
        port?.disconnect();
      } catch {
        // Port already closed.
      }
    };
    globalThis.addEventListener('pagehide', disconnectPreview);
    return () => {
      globalThis.removeEventListener('pagehide', disconnectPreview);
      disconnectPreview();
    };
  }, []);

  const handleThemeChange = useCallback(
    (doc: ThemeDocumentV1, meta?: { readonly committed?: boolean }) => {
      const css = compileDocumentUiTheme(doc);
      savedThemeCssRef.current = css;
      if (meta?.committed) {
        previewingRef.current = false;
      }
      if (!previewingRef.current) {
        injectDocumentStyle('fs-popup-user-theme', css);
      }
    },
    [],
  );

  const handlePreviewTheme = useCallback(
    (doc: ThemeDocumentV1 | null) => {
      previewingRef.current = doc !== null;
      injectDocumentStyle(
        'fs-popup-user-theme',
        doc ? compileDocumentUiTheme(doc) : savedThemeCssRef.current,
      );
      if (!active) {
        return;
      }
      if (!doc && !previewPortRef.current) {
        return;
      }
      let port = previewPortRef.current;
      try {
        if (!port) {
          port = browser.tabs.connect(active.tabId, { name: THEME_PREVIEW_PORT });
          previewPortRef.current = port;
          port.onDisconnect.addListener(() => {
            if (previewPortRef.current === port) {
              previewPortRef.current = null;
            }
          });
        }
        port.postMessage(themePreviewMessage(doc));
      } catch {
        if (previewPortRef.current === port) {
          previewPortRef.current = null;
        }
        try {
          port?.disconnect();
        } catch {
          // Port already disconnected.
        }
      }
    },
    [active],
  );

  if (!loaded) {
    return (
      <div className="qp-loading" role="status">
        <span className="qp-brand-lockup" aria-hidden="true">
          <BrandMark size={26} />
          <BrandWordmark height={19} />
        </span>
        <span className="qp-loading-text">Connecting to tab…</span>
      </div>
    );
  }

  const canRequestPermissions = typeof browser.permissions?.request === 'function';

  return (
    <QuickPopup
      store={extensionStore}
      activeTab={active?.state ?? null}
      unattachedTab={unattached}
      {...(unattached && canRequestPermissions
        ? {
            onRequestAccess: async () => {
              try {
                const granted = await browser.permissions.request({
                  origins: [...unattached.origins],
                });
                if (!granted) {
                  return false;
                }
                return await connectActiveTab();
              } catch {
                return false;
              }
            },
          }
        : {})}
      {...(unattached
        ? {
            onRetryConnect: () => {
              void connectActiveTab();
            },
            onReloadTab: () => {
              void browser.tabs.reload(unattached.tabId).finally(() => window.close());
            },
          }
        : {})}
      onThemeChange={handleThemeChange}
      {...(active ? { onPreviewTheme: handlePreviewTheme } : {})}
      onOpenSettings={(section) => {
        if (active) {
          void browser.tabs
            .sendMessage(active.tabId, openOptionsMessage(section))
            .catch(() => undefined)
            .finally(() => window.close());
          return;
        }
        void openStandaloneSettingsWindow({
          ...(unattached ? { siteId: unattached.siteId } : {}),
          ...(section ? { section } : {}),
        })
          .catch(() => undefined)
          .finally(() => window.close());
      }}
      onOpenSiteUrl={(url) => {
        void browser.tabs.create({ url }).finally(() => window.close());
      }}
    />
  );
}

const rootEl = document.querySelector('#root');
if (rootEl) {
  createRoot(rootEl).render(<PopupApp />);
}
