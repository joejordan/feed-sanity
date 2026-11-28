import type { ThemeDocumentV1 } from '../core/theming/document';
import { compileUiThemeCss } from '../core/theming/compile-ui';
import { resolveTheme } from '../core/theming/config';
import {
  canAnimateThemeTransition,
  THEME_TRANSITION_CLEANUP_MS,
  UI_THEME_TRANSITION_CSS,
} from '../core/theming/transition';

/**
 * Default light/dark palette tokens for standalone extension documents
 * (`popup.html`, `options.html`), aligned with Feed Sanity Paper (light)
 * and Night Edition (dark) brand tokens. Overridden live by `compileUiThemeCss`
 * whenever a site theme is active or previewed.
 */
export const EXTENSION_THEME_TOKENS_CSS = `
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

/** Injects or updates a cached `<style id>` element in `document.head` without Trusted Types sinks. */
export function injectDocumentStyle(id: string, text: string): void {
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

/**
 * Adapts `:host` rules from `baseThemeCss` and `compileUiThemeCss` to `:root`
 * for extension pages without resetting `<html>` layout via Shadow DOM's `all: initial`.
 */
export function toDocumentCss(cssText: string): string {
  return cssText
    .replace(/:host\(([^)]+)\)/g, ':root$1')
    .replaceAll(':host', ':root')
    .replace(/\ball\s*:\s*initial\s*;/g, '');
}

/** Compiles a `ThemeDocumentV1` into document-scoped `:root` UI theme tokens. */
export function compileDocumentUiTheme(doc: ThemeDocumentV1 | null): string {
  const resolved = doc ? resolveTheme(doc) : null;
  return resolved ? toDocumentCss(compileUiThemeCss(resolved)) : '';
}

const TRANSITION_STYLE_ID = 'fs-doc-theme-transition';
let docTransitionTimer: ReturnType<typeof setTimeout> | undefined;

/** Smoothly morphs standalone extension UI colors for ~0.85s when switching themes. */
export function triggerDocumentThemeTransition(): void {
  if (!canAnimateThemeTransition(document)) {
    return;
  }
  injectDocumentStyle(TRANSITION_STYLE_ID, UI_THEME_TRANSITION_CSS);
  if (docTransitionTimer !== undefined) {
    clearTimeout(docTransitionTimer);
  }
  docTransitionTimer = setTimeout(() => {
    docTransitionTimer = undefined;
    injectDocumentStyle(TRANSITION_STYLE_ID, '');
  }, THEME_TRANSITION_CLEANUP_MS);
}
