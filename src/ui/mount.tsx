import { createRoot } from 'react-dom/client';
import type { ReactNode } from 'react';
import { OWN_ATTR } from '../core/surface';
import theme from './theme.css?inline';

/** The tag of every host element, so they are easy to find in the page. */
export const HOST_TAG = 'feed-sanity-ui';

/** Optional site-specific theme overrides (mapping host CSS vars onto `--fs-*`). */
let siteThemeCss = '';

/** Optional user-selected theme overrides applied on top of `siteThemeCss`. */
let userThemeCss = '';

/** Live style elements inside currently mounted shadow roots, updated reactively on theme changes. */
const mountedStyles = new Map<HTMLStyleElement, string>();

const buildShadowCss = (extraCss: string): string =>
  [theme, siteThemeCss, extraCss, userThemeCss].filter(Boolean).join('\n');

const refreshMountedStyles = (): void => {
  for (const [style, extraCss] of mountedStyles) {
    if (!style.isConnected) {
      mountedStyles.delete(style);
      continue;
    }
    style.textContent = buildShadowCss(extraCss);
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
  mountedStyles.set(style, css);
  const container = document.createElement('div');
  shadow.append(style, container);
  const root = createRoot(container);
  root.render(ui);
  return () => {
    mountedStyles.delete(style);
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
