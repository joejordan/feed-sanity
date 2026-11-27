import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { browser } from 'wxt/browser';
import type { PopupTabState } from '../../core/platform';
import type { ThemeDocumentV1 } from '../../core/theming/document';
import type { UnattachedSupportedTab } from '../../ui/popup/quick-popup';
import { compileUiThemeCss } from '../../core/theming/compile-ui';
import { resolveTheme } from '../../core/theming/config';
import { matchAttachableSite } from '../../platform/auto-attach';
import { extensionStore } from '../../platform/extension-store';
import {
  attachTabMessage,
  GET_POPUP_STATE,
  isAttachTabReply,
  isPopupTabState,
  openOptionsMessage,
  THEME_PREVIEW_PORT,
  themePreviewMessage,
} from '../../platform/messages';
import { SITE_MANIFEST } from '../../sites/manifest';
import { QuickPopup } from '../../ui/popup/quick-popup';
import quickPopupCss from '../../ui/popup/quick-popup.css?inline';
import { BrandMark, BrandWordmark, primitivesCss } from '../../ui/primitives';
import baseThemeCss from '../../ui/theme.css?inline';

// Default popup palette aligned with Feed Sanity Paper (light) and Night Edition (dark)
// brand tokens; overridden live by `compileUiThemeCss` whenever the active tab has a theme.
const POPUP_THEME_TOKENS_CSS = `
:root {
  color-scheme: light;
  --fs-font: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --fs-background: #f8fafc;
  --fs-surface: #eef3f9;
  --fs-sidebar-bg: #eef3f9;
  --fs-card-bg: #ffffff;
  --fs-control-bg: #f1f5f9;
  --fs-hover: rgb(7 11 31 / 5%);
  --fs-press: rgb(7 11 31 / 10%);
  --fs-text: #070b1f;
  --fs-text-secondary: #4a5a7a;
  --fs-divider: rgba(23, 54, 102, 0.14);
  --fs-accent: #0b6b8f;
  --fs-accent-surface: rgba(11, 107, 143, 0.12);
  --fs-accent-text: #ffffff;
  --fs-button-secondary: #e7eef6;
  --fs-shadow-2: rgb(7 11 31 / 18%);
}
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --fs-background: #070b1f;
    --fs-surface: #0e1a3d;
    --fs-sidebar-bg: #0c1633;
    --fs-card-bg: #0e1a3d;
    --fs-control-bg: #152854;
    --fs-hover: rgb(255 252 238 / 7%);
    --fs-press: rgb(255 252 238 / 13%);
    --fs-text: #fffcee;
    --fs-text-secondary: #9fb3d1;
    --fs-divider: rgba(159, 179, 209, 0.18);
    --fs-accent: #5be9e0;
    --fs-accent-surface: rgba(91, 233, 224, 0.15);
    --fs-accent-text: #070b1f;
    --fs-button-secondary: #173666;
    --fs-shadow-2: rgb(0 0 0 / 50%);
  }
}
`;

const styleCache = new Map<string, HTMLStyleElement>();

function injectStyle(id: string, text: string): void {
  let el = styleCache.get(id);
  if (!el?.isConnected) {
    el = document.querySelector<HTMLStyleElement>(`#${id}`) ?? undefined;
    if (!el) {
      el = document.createElement('style');
      el.id = id;
      document.head.append(el);
    }
    styleCache.set(id, el);
  }
  if (el.textContent !== text) {
    el.textContent = text;
  }
}

// Adapt `:host` rules from baseThemeCss and compileUiThemeCss to `:root` for the
// popup document without resetting `<html>` layout via Shadow DOM's `all: initial`.
function toDocumentCss(cssText: string): string {
  return cssText
    .replace(/:host\(([^)]+)\)/g, ':root$1')
    .replaceAll(':host', ':root')
    .replace(/\ball\s*:\s*initial\s*;/g, '');
}

injectStyle(
  'fs-popup-base-style',
  [toDocumentCss(baseThemeCss), POPUP_THEME_TOKENS_CSS, primitivesCss, quickPopupCss].join('\n'),
);

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

function compilePopupUiTheme(doc: ThemeDocumentV1 | null): string {
  const resolved = doc ? resolveTheme(doc) : null;
  return resolved ? toDocumentCss(compileUiThemeCss(resolved)) : '';
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
        injectStyle('fs-popup-user-theme', '');
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
      const css = compilePopupUiTheme(doc);
      savedThemeCssRef.current = css;
      if (meta?.committed) {
        previewingRef.current = false;
      }
      if (!previewingRef.current) {
        injectStyle('fs-popup-user-theme', css);
      }
    },
    [],
  );

  const handlePreviewTheme = useCallback(
    (doc: ThemeDocumentV1 | null) => {
      previewingRef.current = doc !== null;
      injectStyle('fs-popup-user-theme', doc ? compilePopupUiTheme(doc) : savedThemeCssRef.current);
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
        }
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
