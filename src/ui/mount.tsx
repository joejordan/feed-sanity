import { createRoot } from 'react-dom/client';
import type { ReactNode } from 'react';
import facebookTheme from '../facebook/theme.css?inline';
import theme from './theme.css?inline';

/** The tag of every host element, so they are easy to find in the page. */
export const HOST_TAG = 'feed-sanity-ui';

/**
 * Keys typed into this project's inputs stop at the host element. Otherwise
 * they would reach Facebook's keyboard shortcuts, which listen on the
 * document.
 */
const KEY_EVENTS = ['keydown', 'keypress', 'keyup'] as const;

const stop = (event: Event): void => event.stopPropagation();

export interface MountOptions {
  /** The host element's ID. */
  id: string;
  /** Style sheet for inside the shadow root, added after the shared themes. */
  css?: string;
}

/**
 * Renders `ui` into a new shadow root at the end of the page body, where
 * Facebook's styles cannot reach it and its own styles stay inside. Returns a
 * function that unmounts it and removes the host element.
 *
 * The toolbar button and the userscript menu work while the page is still
 * loading, so before the body exists the host goes on the root element.
 */
export function mount(ui: ReactNode, { id, css = '' }: MountOptions): () => void {
  const host = document.createElement(HOST_TAG);
  host.id = id;
  for (const type of KEY_EVENTS) {
    host.addEventListener(type, stop);
  }

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `${theme}\n${facebookTheme}\n${css}`;
  const container = document.createElement('div');
  shadow.append(style, container);
  (document.body ?? document.documentElement).append(host);

  const root = createRoot(container);
  root.render(ui);
  return () => {
    root.unmount();
    host.remove();
  };
}
