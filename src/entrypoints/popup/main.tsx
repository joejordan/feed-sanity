import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { browser } from 'wxt/browser';
import type { PopupTabState } from '../../core/platform';
import type { ThemeDocumentV1 } from '../../core/theming/document';
import { compileUiThemeCss } from '../../core/theming/compile';
import { resolveTheme } from '../../core/theming/config';
import { extensionStore } from '../../platform/extension-store';
import {
  GET_POPUP_STATE,
  isPopupTabState,
  openOptionsMessage,
  THEME_PREVIEW_PORT,
  themePreviewMessage,
} from '../../platform/messages';
import { QuickPopup } from '../../ui/popup/quick-popup';
import quickPopupCss from '../../ui/popup/quick-popup.css?inline';
import { primitivesCss } from '../../ui/primitives';
import baseThemeCss from '../../ui/theme.css?inline';

const POPUP_THEME_TOKENS_CSS = `
:root {
  color-scheme: light;
  --fs-font: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --fs-background: #ffffff;
  --fs-surface: #f5f6f8;
  --fs-dialog-bg: #ffffff;
  --fs-sidebar-bg: #f6f7f9;
  --fs-card-bg: #ffffff;
  --fs-control-bg: #f0f2f5;
  --fs-hover: rgb(0 0 0 / 5%);
  --fs-press: rgb(0 0 0 / 10%);
  --fs-text: #111317;
  --fs-text-secondary: #5c6470;
  --fs-divider: rgba(15, 23, 42, 0.12);
  --fs-accent: #2563eb;
  --fs-accent-surface: rgba(37, 99, 235, 0.12);
  --fs-accent-text: #ffffff;
  --fs-button-secondary: #eef0f3;
  --fs-shadow-2: rgb(0 0 0 / 18%);
}
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --fs-background: #181a1f;
    --fs-surface: #111317;
    --fs-dialog-bg: #16181d;
    --fs-sidebar-bg: #111317;
    --fs-card-bg: #1b1e25;
    --fs-control-bg: #232731;
    --fs-hover: rgb(255 255 255 / 7%);
    --fs-press: rgb(255 255 255 / 13%);
    --fs-text: #eef1f6;
    --fs-text-secondary: #98a2b3;
    --fs-divider: rgba(255, 255, 255, 0.1);
    --fs-accent: #3b82f6;
    --fs-accent-surface: rgba(59, 130, 246, 0.16);
    --fs-accent-text: #ffffff;
    --fs-button-secondary: #232731;
    --fs-shadow-2: rgb(0 0 0 / 45%);
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
  return cssText.replaceAll(':host', ':root').replace(/\ball\s*:\s*initial\s*;/g, '');
}

injectStyle(
  'fs-popup-base-style',
  [POPUP_THEME_TOKENS_CSS, toDocumentCss(baseThemeCss), primitivesCss, quickPopupCss].join('\n'),
);

interface ActiveTabInfo {
  readonly tabId: number;
  readonly state: PopupTabState;
}

function compilePopupUiTheme(doc: ThemeDocumentV1 | null): string {
  const resolved = doc ? resolveTheme(doc) : null;
  return resolved ? toDocumentCss(compileUiThemeCss(resolved)) : '';
}

function PopupApp() {
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState<ActiveTabInfo | null>(null);
  const savedThemeCssRef = useRef('');
  const previewingRef = useRef(false);
  const previewPortRef = useRef<ReturnType<typeof browser.tabs.connect> | null>(null);

  useEffect(() => {
    let alive = true;
    void browser.tabs
      .query({ active: true, currentWindow: true })
      .then(async (activeTabs) => {
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
          return null;
        }
        try {
          const response: unknown = await browser.tabs.sendMessage(tabId, GET_POPUP_STATE);
          if (isPopupTabState(response)) {
            return { tabId, state: response };
          }
        } catch {
          // Unsupported tab or content script not running there.
        }
        return null;
      })
      .catch(() => null)
      .then((result) => {
        if (!alive) {
          return;
        }
        setActive(result);
        if (!result) {
          savedThemeCssRef.current = '';
          previewingRef.current = false;
          injectStyle('fs-popup-user-theme', '');
        }
        setLoaded(true);
      });

    return () => {
      alive = false;
    };
  }, []);

  useEffect(
    () => () => {
      const port = previewPortRef.current;
      previewPortRef.current = null;
      try {
        port?.disconnect();
      } catch {
        // Port already closed.
      }
    },
    [],
  );

  const handleThemeChange = useCallback((doc: ThemeDocumentV1) => {
    const css = compilePopupUiTheme(doc);
    savedThemeCssRef.current = css;
    if (!previewingRef.current) {
      injectStyle('fs-popup-user-theme', css);
    }
  }, []);

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
    return null;
  }

  return (
    <QuickPopup
      store={extensionStore}
      activeTab={active?.state ?? null}
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
