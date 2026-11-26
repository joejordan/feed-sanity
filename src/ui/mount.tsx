import { createRoot } from 'react-dom/client';
import type { ReactNode } from 'react';
import { OWN_ATTR } from '../core/surface';
import { colorSchemeOf, parseCssColor } from '../core/theming/color';
import { HOST_SCHEME_ATTRS } from '../core/theming/host-scheme';
import theme from './theme.css?inline';

/** The tag of every host element, so they are easy to find in the page. */
export const HOST_TAG = 'feed-sanity-ui';

const BRAND_SCHEME_ATTR = 'data-fs-brand-scheme';
const ROOT_SCHEME_ATTRS = ['class', 'style', ...HOST_SCHEME_ATTRS];

/** Optional site-specific theme overrides (mapping host CSS vars onto `--fs-*`). */
let siteThemeCss = '';

/** Optional user-selected theme overrides applied on top of `siteThemeCss`. */
let userThemeCss = '';

interface MountedEntry {
  readonly host: HTMLElement;
  readonly extraCss: string;
}

/** Live style elements inside currently mounted shadow roots, updated reactively on theme changes. */
const mountedStyles = new Map<HTMLStyleElement, MountedEntry>();

/** Per-document scheme watchers active only while at least one shadow root is mounted in that document. */
const docWatchers = new Map<Document, () => void>();

const buildShadowCss = (extraCss: string): string =>
  [theme, siteThemeCss, extraCss, userThemeCss].filter(Boolean).join('\n');

function detectShadowUiScheme(host: HTMLElement): 'dark' | 'light' | null {
  if (!host.isConnected) {
    return null;
  }
  try {
    const view = host.ownerDocument.defaultView ?? globalThis;
    const style = view.getComputedStyle(host);
    for (const token of ['--fs-background', '--fs-surface'] as const) {
      const parsed = parseCssColor(style.getPropertyValue(token));
      if (parsed && parsed.a >= 0.5) {
        return colorSchemeOf(parsed);
      }
    }
  } catch {
    // Ignore detached or non-styled test hosts.
  }
  return null;
}

function syncBrandScheme(host: HTMLElement): void {
  const scheme = detectShadowUiScheme(host);
  if (scheme === null) {
    if (host.hasAttribute(BRAND_SCHEME_ATTR)) {
      host.removeAttribute(BRAND_SCHEME_ATTR);
    }
    return;
  }
  if (host.getAttribute(BRAND_SCHEME_ATTR) !== scheme) {
    host.setAttribute(BRAND_SCHEME_ATTR, scheme);
  }
}

function syncDocumentBrandSchemes(doc: Document): void {
  let hasMountedInDoc = false;
  for (const [style, entry] of mountedStyles) {
    if (!style.isConnected) {
      mountedStyles.delete(style);
      continue;
    }
    if (entry.host.ownerDocument === doc) {
      hasMountedInDoc = true;
      syncBrandScheme(entry.host);
    }
  }
  if (!hasMountedInDoc) {
    releaseDocumentWatcher(doc);
  }
}

function ensureDocumentWatcher(doc: Document): void {
  if (docWatchers.has(doc)) {
    return;
  }
  const cleanups: Array<() => void> = [];
  const rootEl = doc.documentElement;
  if (rootEl && typeof MutationObserver === 'function') {
    const observer = new MutationObserver(() => syncDocumentBrandSchemes(doc));
    observer.observe(rootEl, { attributes: true, attributeFilter: ROOT_SCHEME_ATTRS });
    cleanups.push(() => observer.disconnect());
  }
  const view = doc.defaultView ?? globalThis;
  const media =
    typeof view.matchMedia === 'function' ? view.matchMedia('(prefers-color-scheme: dark)') : null;
  if (media && typeof media.addEventListener === 'function') {
    const onChange = (): void => syncDocumentBrandSchemes(doc);
    media.addEventListener('change', onChange);
    cleanups.push(() => media.removeEventListener('change', onChange));
  }
  docWatchers.set(doc, () => {
    for (const stop of cleanups) {
      stop();
    }
  });
}

function releaseDocumentWatcher(doc: Document): void {
  for (const entry of mountedStyles.values()) {
    if (entry.host.ownerDocument === doc) {
      return;
    }
  }
  const stop = docWatchers.get(doc);
  if (stop) {
    docWatchers.delete(doc);
    stop();
  }
}

const refreshMountedStyles = (): void => {
  const touchedDocs = new Set<Document>();
  for (const [style, entry] of mountedStyles) {
    if (!style.isConnected) {
      mountedStyles.delete(style);
      touchedDocs.add(entry.host.ownerDocument);
      continue;
    }
    style.textContent = buildShadowCss(entry.extraCss);
    syncBrandScheme(entry.host);
  }
  for (const doc of touchedDocs) {
    releaseDocumentWatcher(doc);
  }
};

/** Registers the active site's CSS token layer injected into every shadow root. */
export function setSiteThemeCss(css: string): void {
  if (css === siteThemeCss) {
    return;
  }
  siteThemeCss = css;
  refreshMountedStyles();
}

/** Applies or clears user-selected theme overrides across all active and future shadow roots. */
export function setUserThemeCss(css: string): void {
  if (css === userThemeCss) {
    return;
  }
  userThemeCss = css;
  refreshMountedStyles();
}

/**
 * Keys typed into this project's inputs stop at the host element. Otherwise
 * they would reach Facebook's keyboard shortcuts, which listen on the
 * document.
 */
const KEY_EVENTS = ['keydown', 'keypress', 'keyup'] as const;

const stop = (event: Event): void => event.stopPropagation();

/** Keeps events of these types that start inside `host` from going further up the page. */
export function stopAtHost(host: HTMLElement, types: readonly string[]): void {
  for (const type of types) {
    host.addEventListener(type, stop);
  }
}

export interface MountOptions {
  /** The host element's ID. */
  id: string;
  /** Style sheet for inside the shadow root, added after the shared themes. */
  css?: string;
}

/**
 * Renders `ui` into a new shadow root on `host`, with the shared themes and
 * then `css`. Keys typed inside stop at the host. Returns a function that
 * unmounts the UI and leaves the host where it is.
 */
export function renderInShadow(host: HTMLElement, ui: ReactNode, css = ''): () => void {
  stopAtHost(host, KEY_EVENTS);
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = buildShadowCss(css);
  mountedStyles.set(style, { host, extraCss: css });
  const container = document.createElement('div');
  shadow.append(style, container);
  syncBrandScheme(host);
  ensureDocumentWatcher(host.ownerDocument);
  const root = createRoot(container);
  root.render(ui);
  return () => {
    mountedStyles.delete(style);
    releaseDocumentWatcher(host.ownerDocument);
    root.unmount();
  };
}

/**
 * Renders `ui` into a new shadow root at the end of the page body, where
 * host styles cannot reach it and its own styles stay inside. Returns a
 * function that unmounts it and removes the host element.
 *
 * The toolbar button and the userscript menu work while the page is still
 * loading, so before the body exists the host goes on the root element.
 */
export function mount(ui: ReactNode, { id, css = '' }: MountOptions): () => void {
  const host = document.createElement(HOST_TAG);
  host.id = id;
  host.setAttribute(OWN_ATTR, 'ui');
  (document.body ?? document.documentElement).append(host);
  const unmount = renderInShadow(host, ui, css);
  return () => {
    unmount();
    host.remove();
  };
}
