// Pure DOM menu detection, dismissal, polarity CSS, and video-rate helpers for
// X's custom playback speed feature (`video-speed.tsx`).

import { OWN_ATTR } from '../../../core/surface';
import { rgbaLuminance } from '../../../core/theming/color';
import { resolveEffectiveBackground } from '../../../core/theming/healer';
import { parseNativeSpeedLabel, SPEED_EPSILON } from './video-speed-model';

const OWN_ATTR_SELECTOR = `[${OWN_ATTR}]`;
export const SMALL_POPOVER_SELECTOR =
  '[role="menu"], [role="listbox"], [data-testid="Dropdown"], [data-testid="sheetDialog"]';
export const VIDEO_PLAYER_SELECTOR = '[data-testid="videoPlayer"], [data-testid="videoComponent"]';
export const VIDEO_MENU_SCOPE_SELECTOR = `${SMALL_POPOVER_SELECTOR}, ${VIDEO_PLAYER_SELECTOR}`;
export const MENU_CONTAINER_SELECTOR = `${VIDEO_MENU_SCOPE_SELECTOR}, #layers > *`;
export const TWEET_ARTICLE_SELECTOR = 'article[data-testid="tweet"]';
export const SPEED_ITEM_SELECTOR =
  '[role="menuitem"], [role="menuitemradio"], [role="radio"], [role="option"], [role="button"], button, label, [tabindex="0"]';

const MAX_LABEL_SCAN_CHARS = 64;
const DOT_SEP = '[·•∙⋅‧\\-–—:/|]';
const NATIVE_SPEED_TOKEN =
  '(?:normal(?:\\s*\\(\\s*1(?:\\.0+)?\\s*[x×]\\s*\\))?|\\d+(?:\\.\\d+)?\\s*[x×](?:\\s*\\(\\s*normal\\s*\\))?)';
const PARENT_SPEED_ROW_RE = new RegExp(
  `^playback\\s+speed(?:\\s*${DOT_SEP}(?:\\s*${NATIVE_SPEED_TOKEN})?|\\s*${NATIVE_SPEED_TOKEN})?$`,
  'i',
);
export const PARENT_SPEED_INLINE_RE = new RegExp(
  `^(playback\\s+speed)(?:\\s*${DOT_SEP}(?:\\s*${NATIVE_SPEED_TOKEN})?|\\s+${NATIVE_SPEED_TOKEN})$`,
  'i',
);
const NATIVE_SPEED_VALUE_RE = new RegExp(`^(?:${DOT_SEP}|\\s)*${NATIVE_SPEED_TOKEN}$`, 'i');
const SEPARATOR_ONLY_RE = new RegExp(`^${DOT_SEP}$`);

export const NATIVE_HIDDEN_ATTR = 'data-fs-speed-native-hidden';
export const HIDE_CHECK_ATTR = 'data-fs-speed-hide-check';
export const SELECTED_ROW_ATTR = 'data-fs-speed-selected';
export const OWN_PARENT_BADGE_VALUE = 'x-speed-parent-value';
export const PAGE_STYLE_ID = 'feed_sanity_x_video_speed';

export const PAGE_SPEED_CSS = `
[${NATIVE_HIDDEN_ATTR}="true"] {
  display: none !important;
}
[${HIDE_CHECK_ATTR}="true"] svg:not([data-feed-sanity-icon]) {
  visibility: hidden !important;
}
[${HIDE_CHECK_ATTR}="true"] input[type="radio"] {
  opacity: 0.45 !important;
}
[${SELECTED_ROW_ATTR}="true"] {
  color: var(--fs-accent, rgb(29, 155, 240)) !important;
  font-weight: 700 !important;
}
[${OWN_ATTR}="${OWN_PARENT_BADGE_VALUE}"] {
  font-weight: 500;
  opacity: 0.82;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
`;

export interface DetectedSpeedItem {
  readonly el: Element;
  readonly rowEl: Element;
  readonly rate: number;
}

export interface DetectedSpeedMenu {
  readonly items: readonly DetectedSpeedItem[];
  readonly parent: Element;
  readonly anchor: Element;
}

export function extractVisibleText(root: Node): string {
  let out = '';
  for (let child = root.firstChild; child; child = child.nextSibling) {
    if (out.length > MAX_LABEL_SCAN_CHARS) {
      break;
    }
    if (child.nodeType === Node.TEXT_NODE) {
      out += child.nodeValue ?? '';
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element;
      const tag = el.tagName.toUpperCase();
      if (
        tag === 'SVG' ||
        tag === 'STYLE' ||
        tag === 'SCRIPT' ||
        el.hasAttribute(OWN_ATTR) ||
        el.hasAttribute(NATIVE_HIDDEN_ATTR)
      ) {
        continue;
      }
      out += extractVisibleText(el);
    }
  }
  return out.trim();
}

function keepInnermost<T extends { readonly el: Element }>(candidates: readonly T[]): T[] {
  return candidates.filter(
    (candidate) =>
      !candidates.some((other) => other !== candidate && candidate.el.contains(other.el)),
  );
}

function groupSpeedItems(
  candidates: ReadonlyArray<{ readonly el: Element; readonly rate: number }>,
  resolveGroup: (el: Element) => { readonly parent: Element; readonly rowEl: Element } | null,
): DetectedSpeedMenu | null {
  const byParent = new Map<Element, DetectedSpeedItem[]>();
  for (const candidate of candidates) {
    const resolved = resolveGroup(candidate.el);
    if (!resolved) {
      continue;
    }
    const list = byParent.get(resolved.parent) ?? [];
    list.push({ el: candidate.el, rowEl: resolved.rowEl, rate: candidate.rate });
    byParent.set(resolved.parent, list);
  }
  for (const [parent, items] of byParent) {
    const distinctRates = new Set(items.map((item) => item.rate));
    if (distinctRates.size >= 3) {
      const last = items.at(-1);
      if (last) {
        return { items, parent, anchor: last.rowEl };
      }
    }
  }
  return null;
}

export function detectSpeedMenu(
  container: Element,
  speedItems?: readonly Element[],
): DetectedSpeedMenu | null {
  const raw: Array<{ el: Element; rate: number }> = [];
  for (const el of speedItems ?? container.querySelectorAll(SPEED_ITEM_SELECTOR)) {
    if (el.closest(OWN_ATTR_SELECTOR)) {
      continue;
    }
    const rate = parseNativeSpeedLabel(extractVisibleText(el));
    if (rate !== null) {
      raw.push({ el, rate });
    }
  }
  if (raw.length < 3) {
    return null;
  }
  const candidates = keepInnermost(raw);
  return (
    groupSpeedItems(candidates, (el) =>
      el.parentElement ? { parent: el.parentElement, rowEl: el } : null,
    ) ??
    groupSpeedItems(candidates, (el) => {
      const wrapper = el.parentElement;
      const list = wrapper?.parentElement;
      return wrapper && list ? { parent: list, rowEl: wrapper } : null;
    })
  );
}

const FALLBACK_TEXT_TAGS = new Set(['span', 'div', 'p', 'li', 'a']);
const MAX_FALLBACK_MENU_NODES = 80;

/** Collects up to `MAX_FALLBACK_MENU_NODES` candidate text elements, aborting early if exceeded. */
function collectBoundedMenuNodes(container: Element): Element[] | null {
  const matched: Element[] = [];
  const stack: Element[] = [];
  for (let c = container.lastElementChild; c; c = c.previousElementSibling) {
    stack.push(c);
  }
  while (stack.length > 0) {
    const el = stack.pop();
    if (!el) {
      continue;
    }
    if (FALLBACK_TEXT_TAGS.has(el.localName)) {
      matched.push(el);
      if (matched.length > MAX_FALLBACK_MENU_NODES) {
        return null;
      }
    }
    for (let c = el.lastElementChild; c; c = c.previousElementSibling) {
      stack.push(c);
    }
  }
  return matched;
}

export function detectParentSpeedRows(
  container: Element,
  speedItems?: readonly Element[],
): Element[] {
  const candidates: Array<{ el: Element }> = [];
  const seen = new Set<Element>();
  const addCandidate = (el: Element): void => {
    if (!seen.has(el) && el.childElementCount <= 12) {
      seen.add(el);
      candidates.push({ el });
    }
  };
  for (const el of speedItems ?? container.querySelectorAll(SPEED_ITEM_SELECTOR)) {
    if (el.closest(OWN_ATTR_SELECTOR)) {
      continue;
    }
    if (PARENT_SPEED_ROW_RE.test(extractVisibleText(el))) {
      addCandidate(el);
    }
  }
  if (
    candidates.length > 0 ||
    container.childElementCount > 16 ||
    container.querySelector(TWEET_ARTICLE_SELECTOR)
  ) {
    return keepInnermost(candidates).map((item) => item.el);
  }
  // Fallback for video settings popovers whose rows are plain clickable <div>s
  // without ARIA menuitem/button roles or tabindex="0". Aborts early once
  // > 80 nodes are seen so large non-menu subtrees are never walked completely.
  const menuNodes = collectBoundedMenuNodes(container);
  if (!menuNodes) {
    return [];
  }
  for (const el of menuNodes) {
    if (el.childElementCount > 6 || el.closest(OWN_ATTR_SELECTOR)) {
      continue;
    }
    const text = extractVisibleText(el);
    if (!PARENT_SPEED_ROW_RE.test(text)) {
      continue;
    }
    let row: Element = el;
    for (let depth = 0; depth < 3; depth++) {
      const parent = row.parentElement;
      if (
        !parent ||
        parent === container ||
        parent.childElementCount > 12 ||
        !PARENT_SPEED_ROW_RE.test(extractVisibleText(parent))
      ) {
        break;
      }
      row = parent;
    }
    addCandidate(row);
  }
  return keepInnermost(candidates).map((item) => item.el);
}

export function findPlaybackSpeedLabelHost(rowEl: Element): Element {
  let deepest: Element | null = null;
  for (const child of rowEl.querySelectorAll('*')) {
    if (child.closest(OWN_ATTR_SELECTOR) || child.tagName.toUpperCase() === 'SVG') {
      continue;
    }
    const text = extractVisibleText(child);
    if (PARENT_SPEED_ROW_RE.test(text)) {
      deepest = child;
    }
  }
  return deepest ?? rowEl;
}

export function findNativeSpeedValueElements(rowEl: Element): Element[] {
  const matches: Array<{ el: Element }> = [];
  for (const child of rowEl.querySelectorAll('*')) {
    if (
      child.closest(OWN_ATTR_SELECTOR) ||
      child.hasAttribute(NATIVE_HIDDEN_ATTR) ||
      child.tagName.toUpperCase() === 'SVG'
    ) {
      continue;
    }
    const text = extractVisibleText(child);
    if (parseNativeSpeedLabel(text) !== null || NATIVE_SPEED_VALUE_RE.test(text)) {
      matches.push({ el: child });
    }
  }
  const innermost = keepInnermost(matches).map((item) => item.el);
  const result = new Set<Element>(innermost);
  for (const el of innermost) {
    // Also hide a standalone separator sibling (e.g. `<span>·</span><span>1.75x</span>`)
    // so replacing the native speed never leaves a dangling middot.
    for (const candidate of [el.previousElementSibling, el.parentElement?.previousElementSibling]) {
      if (
        candidate &&
        rowEl.contains(candidate) &&
        !candidate.closest(OWN_ATTR_SELECTOR) &&
        SEPARATOR_ONLY_RE.test(extractVisibleText(candidate))
      ) {
        result.add(candidate);
      }
    }
  }
  return [...result];
}

function dispatchSyntheticClick(target: EventTarget, shouldContinue?: () => boolean): void {
  const init = {
    button: 0,
    buttons: 1,
    clientX: 0,
    clientY: 0,
    bubbles: true,
    cancelable: true,
    composed: true,
  };
  const steps: ReadonlyArray<() => Event> = [
    ...(typeof PointerEvent === 'function'
      ? [
          () => new PointerEvent('pointerdown', { ...init, isPrimary: true }),
          () => new PointerEvent('pointerup', { ...init, buttons: 0, isPrimary: true }),
        ]
      : []),
    () => new MouseEvent('mousedown', init),
    () => new MouseEvent('mouseup', { ...init, buttons: 0 }),
    // Keep `detail: 0` (matching scripted `.click()`) so `click-fx.ts` ignores it.
    () => new MouseEvent('click', { ...init, buttons: 0, detail: 0 }),
  ];
  for (const createEvent of steps) {
    if (shouldContinue && !shouldContinue()) {
      return;
    }
    target.dispatchEvent(createEvent());
  }
}

/**
 * Dismisses X's Playback speed submenu cleanly after the user confirms a custom
 * speed, matching the behavior of clicking one of X's native radio options.
 * Each fallback yields a macrotask so React 18 finishes committing any unmount
 * before deciding whether the next fallback is needed.
 */
export function dismissSpeedMenu(menuContainer: Element, host: HTMLElement, doc: Document): void {
  const escInit: KeyboardEventInit = {
    key: 'Escape',
    code: 'Escape',
    keyCode: 27,
    bubbles: true,
    cancelable: true,
    composed: true,
  };
  // Dispatch a single bubbling Escape from the mounted speed menu host so inner
  // menu handlers catch it first without closing an enclosing video lightbox/modal.
  let escTarget: EventTarget = doc;
  if (host.parentElement?.isConnected) {
    escTarget = host.parentElement;
  } else if (menuContainer.isConnected) {
    escTarget = menuContainer;
  }
  escTarget.dispatchEvent(new KeyboardEvent('keydown', escInit));

  const isStillOpen = (): boolean => host.isConnected;
  const layer = host.closest('#layers > *') ?? menuContainer.closest('#layers > *');
  const inDialogLayer = Boolean(layer?.querySelector('[role="dialog"]'));
  const player =
    host.closest(VIDEO_PLAYER_SELECTOR) ?? menuContainer.closest(VIDEO_PLAYER_SELECTOR);
  const findSettingsButton = (): HTMLElement | null => {
    const btn =
      player?.querySelector<HTMLElement>(
        'button[aria-label*="Settings" i], [role="button"][aria-label*="Settings" i]',
      ) ??
      doc.querySelector<HTMLElement>(
        'button[aria-label*="Settings" i][aria-expanded="true"], [role="button"][aria-label*="Settings" i][aria-expanded="true"]',
      );
    return btn && !btn.closest(OWN_ATTR_SELECTOR) ? btn : null;
  };

  const clickSettingsButton = (): boolean => {
    const btn = findSettingsButton();
    if (!btn) {
      return false;
    }
    btn.click();
    return true;
  };

  const fallbacks: Array<() => boolean> = [];
  if (layer && !inDialogLayer) {
    const mask = layer.querySelector<HTMLElement>('[data-testid="mask"]');
    if (mask) {
      fallbacks.push(() => {
        dispatchSyntheticClick(mask, isStillOpen);
        return true;
      });
    }
  }
  if (player) {
    fallbacks.push(clickSettingsButton);
  }
  if (!inDialogLayer && doc.body && !menuContainer.contains(doc.body)) {
    fallbacks.push(() => {
      dispatchSyntheticClick(doc.body, isStillOpen);
      return true;
    });
  }
  if (!player) {
    fallbacks.push(clickSettingsButton);
  }

  const runFallback = (index: number): void => {
    setTimeout(() => {
      if (!isStillOpen() || index >= fallbacks.length) {
        return;
      }
      const fired = fallbacks[index]?.() ?? false;
      if (index + 1 < fallbacks.length && isStillOpen()) {
        if (fired) {
          runFallback(index + 1);
        } else {
          // Skipped unavailable fallback immediately without waiting an extra tick.
          for (let next = index + 1; next < fallbacks.length; next++) {
            if (!isStillOpen()) {
              return;
            }
            if (fallbacks[next]?.()) {
              if (next + 1 < fallbacks.length) {
                runFallback(next + 1);
              }
              return;
            }
          }
        }
      }
    }, 0);
  };
  runFallback(0);
}

/**
 * Matches the shadow host's fallback tokens to the live menu's actual light/dark
 * polarity when X's account theme differs from the OS `prefers-color-scheme`.
 * `renderInShadow` places `userThemeCss` after `extraCss`, so any active Feed
 * Sanity user color palette automatically overrides these defaults.
 */
export function buildMenuPolarityCss(target: Element, doc: Document): string {
  const win = doc.defaultView;
  if (!win) {
    return '';
  }
  const bg = resolveEffectiveBackground(target, win, { r: 255, g: 255, b: 255, a: 1 });
  if (rgbaLuminance(bg) < 0.25) {
    return `:host {
  --fs-background: #000000;
  --fs-surface: #16181c;
  --fs-hover: rgb(231 233 234 / 10%);
  --fs-press: rgb(231 233 234 / 16%);
  --fs-text: #e7e9ea;
  --fs-text-secondary: #71767b;
  --fs-divider: #2f3336;
  --fs-button-secondary: rgb(231 233 234 / 10%);
  --fs-input: rgb(255 255 255 / 8%);
}`;
  }
  return `:host {
  --fs-background: #ffffff;
  --fs-surface: #f7f9f9;
  --fs-hover: rgb(15 20 25 / 6%);
  --fs-press: rgb(15 20 25 / 12%);
  --fs-text: #0f1419;
  --fs-text-secondary: #536471;
  --fs-divider: #eff3f4;
  --fs-button-secondary: rgb(15 20 25 / 8%);
  --fs-input: #f7f9f9;
}`;
}

export function isXAnimatedGif(video: HTMLVideoElement): boolean {
  if (video.closest('[data-testid="gifPlayer"]')) {
    return true;
  }
  const aria = video.getAttribute('aria-label') ?? '';
  if (/\bgif\b/i.test(aria)) {
    return true;
  }
  if (!video.loop) {
    return false;
  }
  const player = video.closest('[data-testid="videoPlayer"]');
  if (!player) {
    return false;
  }
  for (const span of player.querySelectorAll('span')) {
    if ((span.textContent ?? '').trim() === 'GIF') {
      return true;
    }
  }
  return false;
}

export function applySpeedToVideo(video: HTMLVideoElement, rate: number): void {
  const needsDefault = Math.abs(video.defaultPlaybackRate - rate) > SPEED_EPSILON;
  const needsRate = Math.abs(video.playbackRate - rate) > SPEED_EPSILON;
  if (!needsDefault && !needsRate) {
    return;
  }
  if (isXAnimatedGif(video)) {
    return;
  }
  try {
    if (needsDefault) {
      video.defaultPlaybackRate = rate;
    }
    if (needsRate) {
      video.playbackRate = rate;
    }
  } catch {
    // Ignore media elements that reject playbackRate transitions while unready.
  }
}

function hasVideoOrMenuNode(nodes: NodeList): boolean {
  for (const node of nodes) {
    if (
      node.nodeType === Node.ELEMENT_NODE &&
      ((node as Element).matches(VIDEO_MENU_SCOPE_SELECTOR) ||
        (node as Element).querySelector(VIDEO_MENU_SCOPE_SELECTOR) !== null)
    ) {
      return true;
    }
  }
  return false;
}

export function isIgnorableMutation(records: readonly MutationRecord[]): boolean {
  for (const rec of records) {
    const scopeEl =
      rec.target.nodeType === Node.ELEMENT_NODE
        ? (rec.target as Element)
        : rec.target.parentElement;
    // Ignore any mutation inside our own injected UI/badge nodes (such as updating
    // `entry.badge.textContent`, which inserts a Text node under `entry.badge`).
    if (scopeEl?.closest(OWN_ATTR_SELECTOR)) {
      continue;
    }
    const inUnrelatedTweet =
      Boolean(scopeEl?.closest(TWEET_ARTICLE_SELECTOR)) &&
      !scopeEl?.closest(VIDEO_MENU_SCOPE_SELECTOR);
    if (rec.type === 'characterData') {
      // Comment/timeline tweet updates (e.g. clicking Like on /photo/1 replies)
      // outside any video player or menu popover cannot affect video speed menus.
      if (inUnrelatedTweet) {
        continue;
      }
      return false;
    }
    if (
      inUnrelatedTweet &&
      !hasVideoOrMenuNode(rec.addedNodes) &&
      !hasVideoOrMenuNode(rec.removedNodes)
    ) {
      continue;
    }
    for (const node of rec.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE || !(node as Element).hasAttribute(OWN_ATTR)) {
        return false;
      }
    }
    // Never filter OWN_ATTR from removedNodes: our injected host/badge relies on
    // removal notifications to self-heal if React reconciles them away.
    if (rec.removedNodes.length > 0) {
      return false;
    }
  }
  return true;
}
