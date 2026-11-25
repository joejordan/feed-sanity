// Native host document dark/light polarity probing (separated from pure `color.ts`
// so popup/document code never depends on DOM probing helpers).

import type { ThemeColorScheme } from './types';
import { colorSchemeOf, parseCssColor } from './color';

function schemeFromBackground(raw: string): ThemeColorScheme | null {
  const bg = parseCssColor(raw);
  return bg && bg.a >= 0.5 ? colorSchemeOf(bg) : null;
}

const DARK_CLASS_RE = /(?:^|[\s_-])dark(?:mode)?(?:$|[\s_-])/i;
const LIGHT_CLASS_RE = /(?:^|[\s_-])light(?:mode)?(?:$|[\s_-])/i;
const THEME_VALUE_ATTRS = [
  'data-theme',
  'data-color-mode',
  'data-color-scheme',
  'data-bs-theme',
] as const;

/** Root attributes inspected by `detectConfirmedHostColorScheme` (reused by `MutationObserver` filters). */
export const HOST_SCHEME_ATTRS = ['dark', 'light', ...THEME_VALUE_ATTRS] as const;

const SPA_CANVAS_SELECTORS = [
  '#react-root',
  '#root',
  '#app',
  '#__next',
  'main',
  '[role="main"]',
] as const;

function hasEnabledFlagAttr(el: Element, name: string): boolean {
  const value = el.getAttribute(name)?.toLowerCase();
  return value !== undefined && value !== 'false' && value !== '0';
}

function schemeFromRootAttributes(el: Element): ThemeColorScheme | null {
  if (hasEnabledFlagAttr(el, 'dark')) {
    return 'dark';
  }
  if (hasEnabledFlagAttr(el, 'light')) {
    return 'light';
  }
  for (const attr of THEME_VALUE_ATTRS) {
    const value = el.getAttribute(attr)?.toLowerCase();
    if (!value) {
      continue;
    }
    if (value.includes('dark') || value.includes('dim')) {
      return 'dark';
    }
    if (value.includes('light')) {
      return 'light';
    }
  }
  const cls = typeof el.className === 'string' ? el.className : '';
  const hasDark = DARK_CLASS_RE.test(cls);
  const hasLight = LIGHT_CLASS_RE.test(cls);
  if (hasDark !== hasLight) {
    return hasDark ? 'dark' : 'light';
  }
  return null;
}

/**
 * Detects the host document's native polarity (`'dark' | 'light'`) only when an
 * explicit signal exists (opaque root/app background, `color-scheme`, or root
 * theme attribute/class). Returns `null` when the document is still unstyled
 * (e.g. `document_start` before host stylesheets load) so callers never lock an
 * unconfirmed `'light'` fallback.
 */
export function detectConfirmedHostColorScheme(doc: Document): ThemeColorScheme | null {
  const view = doc.defaultView ?? globalThis;
  const roots = [doc.body, doc.documentElement].filter((el): el is HTMLElement => el !== null);
  for (const el of roots) {
    try {
      const style = view.getComputedStyle(el);
      const bgScheme = schemeFromBackground(style.backgroundColor);
      if (bgScheme) {
        return bgScheme;
      }
      const scheme = style.colorScheme?.toLowerCase() ?? '';
      if (scheme.includes('dark') && !scheme.includes('light')) {
        return 'dark';
      }
      if (scheme.includes('light') && !scheme.includes('dark')) {
        return 'light';
      }
    } catch {
      // Ignore detached or non-styled test documents.
    }
  }
  for (const el of [doc.documentElement, doc.body]) {
    if (!el) {
      continue;
    }
    const attrScheme = schemeFromRootAttributes(el);
    if (attrScheme) {
      return attrScheme;
    }
  }
  // Fallback probe for SPAs (e.g. X, React/Next/Vue apps) that leave `body`
  // transparent and paint the canvas on an app mount container or main landmark.
  for (const selector of SPA_CANVAS_SELECTORS) {
    const container = doc.querySelector(selector);
    if (!container) {
      continue;
    }
    try {
      const bgScheme = schemeFromBackground(view.getComputedStyle(container).backgroundColor);
      if (bgScheme) {
        return bgScheme;
      }
    } catch {
      // Ignore detached/non-styled containers.
    }
  }
  return null;
}

/**
 * Infers the host document's native polarity (`'dark' | 'light'`) from
 * computed `body` / `documentElement` styles before our theme styles run,
 * defaulting to `'light'` when no explicit signal is present yet.
 */
export function detectHostColorScheme(doc: Document): ThemeColorScheme {
  return detectConfirmedHostColorScheme(doc) ?? 'light';
}
