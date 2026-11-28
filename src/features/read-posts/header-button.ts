import type { Locate } from '../../core/locator';
import type { Post } from '../../facebook/posts';
import { POST_MENU_BUTTON } from '../../facebook/selectors';

/** Class of the per-post read button. */
export const BUTTON_CLASS = 'feed-sanity-mark-read';
/** Added to the button when no header action row was found and it sits in the post's corner. */
export const FALLBACK_CLASS = 'feed-sanity-mark-read-fallback';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Creates the 20x20 inline checkmark icon (solid circle when read, outline check when unread). */
export function createCheckIcon(read: boolean, temporary: boolean): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');

  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('cx', '10');
  circle.setAttribute('cy', '10');
  circle.setAttribute('r', '8');
  circle.setAttribute('stroke', 'currentColor');
  circle.setAttribute('stroke-width', '1.6');
  if (read) {
    circle.setAttribute('fill', 'currentColor');
    circle.setAttribute('fill-opacity', '0.16');
  } else if (temporary) {
    circle.setAttribute('stroke-dasharray', '2.5 2');
  }

  const check = document.createElementNS(SVG_NS, 'path');
  check.setAttribute('d', 'M6.5 10.2 8.9 12.6 13.7 7.6');
  check.setAttribute('stroke', 'currentColor');
  check.setAttribute('stroke-width', '1.8');
  check.setAttribute('stroke-linecap', 'round');
  check.setAttribute('stroke-linejoin', 'round');

  svg.append(circle, check);
  return svg;
}

/**
 * Finds the post header's flex action cell (`...` button wrapper) so the read
 * button sits natively beside Facebook's own header buttons.
 */
export function findHeaderAnchor(
  post: Post,
  locate: Locate,
): { readonly row: HTMLElement; readonly before: HTMLElement } | null {
  const menuBtn = locate(POST_MENU_BUTTON).first<HTMLElement>(post.content);
  if (!menuBtn) {
    return null;
  }
  const nestedArticle = menuBtn.closest('[role=article]');
  if (nestedArticle && nestedArticle !== post.content && nestedArticle !== post.element) {
    return null;
  }
  let cell: HTMLElement | null = menuBtn;
  while (cell && cell.parentElement && cell.parentElement !== post.content) {
    const parent: HTMLElement = cell.parentElement;
    // Skip single-child wrapper divs before forcing a synchronous `getComputedStyle`.
    if (parent.children.length >= 2) {
      const inlineDisplay = parent.style.display;
      const inlineDir = parent.style.flexDirection;
      if (
        (inlineDisplay === 'flex' || inlineDisplay === 'inline-flex') &&
        (inlineDir === '' || inlineDir === 'row')
      ) {
        return { row: parent, before: cell };
      }
      const style = getComputedStyle(parent);
      if (
        (style.display === 'flex' || style.display === 'inline-flex') &&
        style.flexDirection === 'row'
      ) {
        return { row: parent, before: cell };
      }
    }
    cell = parent;
  }
  return null;
}

export function mountButton(post: Post, button: HTMLButtonElement, locate: Locate): void {
  // Already mounted cleanly in the post header — avoid walking ancestors with `getComputedStyle`.
  if (
    button.isConnected &&
    post.element.contains(button) &&
    !button.classList.contains(FALLBACK_CLASS)
  ) {
    return;
  }
  const anchor = findHeaderAnchor(post, locate);
  if (anchor) {
    button.classList.remove(FALLBACK_CLASS);
    if (button.parentElement !== anchor.row || button.nextElementSibling !== anchor.before) {
      anchor.row.insertBefore(button, anchor.before);
    }
    return;
  }
  button.classList.add(FALLBACK_CLASS);
  if (button.parentElement !== post.element) {
    post.element.append(button);
  }
}
