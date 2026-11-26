import type { Logger } from '../../../core/log';
import type { SavedValue } from '../../../core/saved';
import type { Scope } from '../../../core/scope';
import type { XPage } from '../feature';
import type { SpeedStore } from './video-speed-control';
import type { SavedVideoSpeed } from './video-speed-model';
import { addStyle } from '../../../core/dom';
import { PRESS_EVENTS } from '../../../core/intercept';
import { Listeners } from '../../../core/listeners';
import { OWN_ATTR } from '../../../core/surface';
import { rgbaLuminance } from '../../../core/theming/color';
import { resolveEffectiveBackground } from '../../../core/theming/healer';
import { HOST_TAG, renderInShadow, stopAtHost } from '../../../ui/mount';
import { defineXFeature } from '../feature';
import css from './video-speed.css?inline';
import { CustomSpeedControl } from './video-speed-control';
import {
  clampVideoSpeed,
  formatSpeedLabel,
  isNativeXSpeed,
  parseNativeSpeedLabel,
  readSavedVideoSpeed,
  X_VIDEO_SPEED_KEY,
} from './video-speed-model';

export type { SavedVideoSpeed } from './video-speed-model';
export {
  clampVideoSpeed,
  DEFAULT_VIDEO_SPEED,
  formatSpeedLabel,
  formatSpeedNumber,
  isNativeXSpeed,
  MAX_VIDEO_SPEED,
  MIN_VIDEO_SPEED,
  NATIVE_X_SPEEDS,
  parseNativeSpeedLabel,
  parseSpeedInput,
  readSavedVideoSpeed,
  X_VIDEO_SPEED_KEY,
} from './video-speed-model';

const SAVE_DEBOUNCE_MS = 160;
const SPEED_EPSILON = 0.005;
const MENU_INTERACTION_WINDOW_MS = 500;
const MENU_BURST_WINDOW_MS = 500;
const MENU_BURST_LIMIT = 8;
const MENU_BURST_BACKOFF_MS = 100;
const OWN_ATTR_SELECTOR = `[${OWN_ATTR}]`;
const MENU_CONTAINER_SELECTOR = [
  '[role="menu"]',
  '[role="listbox"]',
  '[data-testid="Dropdown"]',
  '[data-testid="sheetDialog"]',
  '[data-testid="videoPlayer"]',
  '[data-testid="videoComponent"]',
  '#layers > *',
].join(', ');
const VIDEO_MENU_SCOPE_SELECTOR =
  '[role="menu"], [role="listbox"], [data-testid="Dropdown"], [data-testid="sheetDialog"], [data-testid="videoPlayer"], [data-testid="videoComponent"]';
const TWEET_ARTICLE_SELECTOR = 'article[data-testid="tweet"]';
const MAX_LABEL_SCAN_CHARS = 64;
const SPEED_ITEM_SELECTOR =
  '[role="menuitem"], [role="menuitemradio"], [role="radio"], [role="option"], [role="button"], button, label, [tabindex="0"]';
const VIDEO_ENFORCE_EVENTS = ['loadedmetadata', 'play', 'playing', 'ratechange'] as const;
const DOT_SEP = '[·•∙⋅‧\\-–—:/|]';
const NATIVE_SPEED_TOKEN =
  '(?:normal(?:\\s*\\(\\s*1(?:\\.0+)?\\s*[x×]\\s*\\))?|\\d+(?:\\.\\d+)?\\s*[x×](?:\\s*\\(\\s*normal\\s*\\))?)';
const PARENT_SPEED_ROW_RE = new RegExp(
  `^playback\\s+speed(?:\\s*${DOT_SEP}(?:\\s*${NATIVE_SPEED_TOKEN})?|\\s*${NATIVE_SPEED_TOKEN})?$`,
  'i',
);
const PARENT_SPEED_INLINE_RE = new RegExp(
  `^(playback\\s+speed)(?:\\s*${DOT_SEP}(?:\\s*${NATIVE_SPEED_TOKEN})?|\\s+${NATIVE_SPEED_TOKEN})$`,
  'i',
);
const NATIVE_SPEED_VALUE_RE = new RegExp(`^(?:${DOT_SEP}|\\s)*${NATIVE_SPEED_TOKEN}$`, 'i');
const SEPARATOR_ONLY_RE = new RegExp(`^${DOT_SEP}$`);
const NATIVE_HIDDEN_ATTR = 'data-fs-speed-native-hidden';
const HIDE_CHECK_ATTR = 'data-fs-speed-hide-check';
const SELECTED_ROW_ATTR = 'data-fs-speed-selected';
const OWN_PARENT_BADGE_VALUE = 'x-speed-parent-value';
const PAGE_STYLE_ID = 'feed_sanity_x_video_speed';
const PAGE_SPEED_CSS = `
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

interface DetectedSpeedItem {
  readonly el: Element;
  readonly rowEl: Element;
  readonly rate: number;
}

interface DetectedSpeedMenu {
  readonly items: readonly DetectedSpeedItem[];
  readonly parent: Element;
  readonly anchor: Element;
}

interface SpeedMenuActivity {
  readonly isMenuOpen: () => boolean;
  readonly recentlyInteractedRate: () => number | null;
}

function extractVisibleText(root: Node): string {
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

function detectSpeedMenu(
  container: Element,
  speedItems?: readonly Element[],
): DetectedSpeedMenu | null {
  const raw: Array<{ el: Element; rate: number }> = [];
  for (const el of speedItems ?? container.querySelectorAll(SPEED_ITEM_SELECTOR)) {
    if (el.closest(`[${OWN_ATTR}]`)) {
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

function detectParentSpeedRows(container: Element, speedItems?: readonly Element[]): Element[] {
  const candidates: Array<{ el: Element }> = [];
  const seen = new Set<Element>();
  const addCandidate = (el: Element): void => {
    if (!seen.has(el) && el.childElementCount <= 12) {
      seen.add(el);
      candidates.push({ el });
    }
  };
  for (const el of speedItems ?? container.querySelectorAll(SPEED_ITEM_SELECTOR)) {
    if (el.closest(`[${OWN_ATTR}]`)) {
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
    if (el.childElementCount > 6 || el.closest(`[${OWN_ATTR}]`)) {
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

function findPlaybackSpeedLabelHost(rowEl: Element): Element {
  let deepest: Element | null = null;
  for (const child of rowEl.querySelectorAll('*')) {
    if (child.closest(`[${OWN_ATTR}]`) || child.tagName.toUpperCase() === 'SVG') {
      continue;
    }
    const text = extractVisibleText(child);
    if (PARENT_SPEED_ROW_RE.test(text)) {
      deepest = child;
    }
  }
  return deepest ?? rowEl;
}

function findNativeSpeedValueElements(rowEl: Element): Element[] {
  const matches: Array<{ el: Element }> = [];
  for (const child of rowEl.querySelectorAll('*')) {
    if (
      child.closest(`[${OWN_ATTR}]`) ||
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
        !candidate.closest(`[${OWN_ATTR}]`) &&
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
function dismissSpeedMenu(menuContainer: Element, host: HTMLElement, doc: Document): void {
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
    host.closest('[data-testid="videoPlayer"], [data-testid="videoComponent"]') ??
    menuContainer.closest('[data-testid="videoPlayer"], [data-testid="videoComponent"]');
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
function buildMenuPolarityCss(target: Element, doc: Document): string {
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

function isXAnimatedGif(video: HTMLVideoElement): boolean {
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

function applySpeedToVideo(video: HTMLVideoElement, rate: number): void {
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

function createSpeedStore(
  saved: SavedValue<SavedVideoSpeed>,
  log: Logger,
  scope: Scope,
  onRateApplied: (rate: number) => void,
): SpeedStore {
  let current: SavedVideoSpeed = saved.get();
  const listeners = new Listeners<[]>(log);
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  const persist = (next: SavedVideoSpeed): void => {
    void saved.set(next).catch((error: unknown) => log.error('could not save video speed', error));
  };

  const flushSave = (next: SavedVideoSpeed): void => {
    if (saveTimer !== undefined) {
      clearTimeout(saveTimer);
      saveTimer = undefined;
    }
    persist(next);
  };

  scope.add(() => {
    if (saveTimer !== undefined) {
      clearTimeout(saveTimer);
      saveTimer = undefined;
    }
  });

  scope.add(
    saved.onChange((next) => {
      if (next.rate === current.rate && next.custom === current.custom) {
        return;
      }
      current = next;
      onRateApplied(current.rate);
      listeners.emit();
    }),
  );

  return {
    get: () => current,
    flush: () => {
      if (saveTimer !== undefined) {
        flushSave(current);
      }
    },
    set: (next, immediate = false) => {
      const normalized: SavedVideoSpeed = {
        rate: clampVideoSpeed(next.rate),
        custom: next.custom,
      };
      const unchanged = normalized.rate === current.rate && normalized.custom === current.custom;
      if (unchanged) {
        if (immediate && saveTimer !== undefined) {
          flushSave(current);
        }
        return;
      }
      current = normalized;
      onRateApplied(current.rate);
      listeners.emit();
      if (immediate) {
        flushSave(current);
      } else {
        if (saveTimer !== undefined) {
          clearTimeout(saveTimer);
        }
        saveTimer = setTimeout(() => {
          saveTimer = undefined;
          persist(current);
        }, SAVE_DEBOUNCE_MS);
      }
    },
    subscribe: (listener) => listeners.add(listener),
  };
}

function attachVideoSpeedEnforcer(
  page: XPage,
  scope: Scope,
  store: SpeedStore,
  menuActivity: SpeedMenuActivity,
): (rate: number) => void {
  const videoCleanups = new Map<HTMLVideoElement, () => void>();
  const initial = store.get();
  let enforceActive = initial.rate !== 1 || initial.custom;
  let applyingOwnRate = false;

  const writeOwnRate = (video: HTMLVideoElement, rate: number): void => {
    applyingOwnRate = true;
    try {
      applySpeedToVideo(video, rate);
    } finally {
      applyingOwnRate = false;
    }
  };

  scope.add(
    page.videos.onAdd((xVideo) => {
      const video = xVideo.element;
      if (videoCleanups.has(video) || isXAnimatedGif(video)) {
        return;
      }
      const enforce = (event?: Event): void => {
        if (scope.disposed || applyingOwnRate) {
          return;
        }
        const speed = store.get();
        // If X's native speed control changed playbackRate from a user interaction
        // inside a speed menu, adopt it into our store instead of overwriting it.
        if (event?.type === 'ratechange') {
          const nextRate = clampVideoSpeed(video.playbackRate);
          const differs = Math.abs(nextRate - speed.rate) > SPEED_EPSILON;
          const interactedRate = menuActivity.recentlyInteractedRate();
          const matchedInteraction =
            interactedRate !== null && Math.abs(nextRate - interactedRate) <= SPEED_EPSILON;
          const userChangedNative =
            differs &&
            isNativeXSpeed(nextRate) &&
            (matchedInteraction || (menuActivity.isMenuOpen() && nextRate !== 1));
          if (userChangedNative) {
            store.set({ rate: nextRate, custom: false }, true);
            return;
          }
        }
        if (enforceActive || speed.rate !== 1 || speed.custom) {
          writeOwnRate(video, speed.rate);
        }
      };
      enforce();
      for (const type of VIDEO_ENFORCE_EVENTS) {
        video.addEventListener(type, enforce);
      }
      videoCleanups.set(video, () => {
        videoCleanups.delete(video);
        for (const type of VIDEO_ENFORCE_EVENTS) {
          video.removeEventListener(type, enforce);
        }
      });
    }),
  );

  scope.add(page.videos.onRemove((removed) => videoCleanups.get(removed.element)?.()));

  scope.add(() => {
    for (const cleanup of [...videoCleanups.values()]) {
      cleanup();
    }
    videoCleanups.clear();
  });

  return (rate: number): void => {
    enforceActive = true;
    for (const [video, cleanup] of [...videoCleanups]) {
      if (!video.isConnected) {
        cleanup();
        continue;
      }
      writeOwnRate(video, rate);
    }
  };
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

function isIgnorableMutation(records: readonly MutationRecord[]): boolean {
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

const SMALL_POPOVER_SELECTOR =
  '[role="menu"], [role="listbox"], [data-testid="Dropdown"], [data-testid="sheetDialog"]';

function watchSpeedMenus(page: XPage, scope: Scope, store: SpeedStore): SpeedMenuActivity {
  interface MountedMenu {
    readonly host: HTMLElement;
    readonly unmount: () => void;
    items: readonly DetectedSpeedItem[];
  }

  interface EnhancedParentRow {
    readonly badge: HTMLSpanElement;
    readonly hiddenNodes: Set<Element>;
    readonly trimmedTexts: Map<Text, string>;
  }

  scope.add(addStyle(PAGE_STYLE_ID, PAGE_SPEED_CSS, page.doc));

  const menuCleanups = new Map<Element, () => void>();
  const containerSchedulers = new Map<
    Element,
    {
      readonly schedule: () => void;
      readonly hasMounted: () => boolean;
      readonly childObservers: Set<MutationObserver>;
    }
  >();
  let treeWatchStop: (() => void) | undefined;

  const isVideoOrMenuScope = (el: Element): boolean => {
    const role = el.getAttribute('role');
    if (role === 'menu' || role === 'listbox') {
      return true;
    }
    const testId = el.getAttribute('data-testid');
    return (
      testId === 'Dropdown' ||
      testId === 'sheetDialog' ||
      testId === 'videoPlayer' ||
      testId === 'videoComponent'
    );
  };

  const ensureTreeWatch = (): void => {
    if (treeWatchStop || scope.disposed) {
      return;
    }
    // Share the single document-level `PageWatcher` for video players and `#layers > *`
    // instead of attaching a separate `MutationObserver` to every video on the timeline.
    treeWatchStop = page.env.watcher.watchTree({
      added: (el) => {
        if (el.localName === 'video' || el.localName === 'source') {
          return;
        }
        // Single ancestor walk replaces multiple `closest()` scans and finds tracked
        // outer containers even when an inner `[data-testid="videoPlayer"]` is nested.
        let inVideoOrMenu = false;
        for (let cur: Element | null = el; cur; cur = cur.parentElement) {
          if (cur.hasAttribute(OWN_ATTR)) {
            return;
          }
          if (!inVideoOrMenu && isVideoOrMenuScope(cur)) {
            inVideoOrMenu = true;
          }
          // Ignore unrelated timeline/reply tweet mutations (e.g. Like bursts in a #layers photo modal).
          if (
            cur.localName === 'article' &&
            cur.getAttribute('data-testid') === 'tweet' &&
            !inVideoOrMenu
          ) {
            return;
          }
          const entry = containerSchedulers.get(cur);
          if (entry) {
            entry.schedule();
            return;
          }
        }
      },
      removed: (el) => {
        if (
          (mountedByParent.size === 0 && parentRows.size === 0) ||
          el.localName === 'video' ||
          el.localName === 'source'
        ) {
          return;
        }
        for (const [host, entry] of containerSchedulers) {
          if (entry.hasMounted() && host.isConnected) {
            entry.schedule();
          }
        }
      },
    });
  };

  const releaseTreeWatchIfIdle = (): void => {
    if (containerSchedulers.size === 0 && treeWatchStop) {
      treeWatchStop();
      treeWatchStop = undefined;
    }
  };
  const mountedByParent = new Map<Element, MountedMenu>();
  const parentRows = new Map<Element, EnhancedParentRow>();
  const nativeBound = new WeakSet<Element>();
  const clickAbort = new AbortController();
  let lastMenuInteractionAt = 0;
  let lastInteractedRate: number | null = null;
  scope.add(() => clickAbort.abort());

  const clearNativeItemDecorations = (items: readonly DetectedSpeedItem[]): void => {
    for (const { rowEl } of items) {
      rowEl.removeAttribute(HIDE_CHECK_ATTR);
      rowEl.removeAttribute(SELECTED_ROW_ATTR);
    }
  };

  const syncNativeSpeedItems = (items: readonly DetectedSpeedItem[]): void => {
    const speed = store.get();
    const hasMatchingNative =
      !speed.custom && items.some((item) => Math.abs(item.rate - speed.rate) < SPEED_EPSILON);
    for (const { rowEl, rate } of items) {
      const isSelected = hasMatchingNative && Math.abs(rate - speed.rate) < SPEED_EPSILON;
      if (isSelected) {
        rowEl.removeAttribute(HIDE_CHECK_ATTR);
        rowEl.setAttribute(SELECTED_ROW_ATTR, 'true');
      } else {
        rowEl.setAttribute(HIDE_CHECK_ATTR, 'true');
        rowEl.removeAttribute(SELECTED_ROW_ATTR);
      }
    }
  };

  const teardownParentMenu = (parent: Element): void => {
    const entry = mountedByParent.get(parent);
    if (!entry) {
      return;
    }
    mountedByParent.delete(parent);
    clearNativeItemDecorations(entry.items);
    entry.unmount();
    entry.host.remove();
  };

  const teardownParentRow = (rowEl: Element): void => {
    const entry = parentRows.get(rowEl);
    if (!entry) {
      return;
    }
    parentRows.delete(rowEl);
    entry.badge.remove();
    for (const node of entry.hiddenNodes) {
      node.removeAttribute(NATIVE_HIDDEN_ATTR);
    }
    entry.hiddenNodes.clear();
    for (const [textNode, original] of entry.trimmedTexts) {
      if (textNode.isConnected) {
        textNode.nodeValue = original;
      }
    }
    entry.trimmedTexts.clear();
  };

  const formatParentBadgeText = (rate: number): string => ` · ${formatSpeedLabel(rate)}`;

  const syncParentRow = (rowEl: Element): void => {
    let entry = parentRows.get(rowEl);
    if (!entry) {
      const badge = page.doc.createElement('span');
      badge.setAttribute(OWN_ATTR, OWN_PARENT_BADGE_VALUE);
      entry = { badge, hiddenNodes: new Set(), trimmedTexts: new Map() };
      parentRows.set(rowEl, entry);
    }
    for (const nativeValueEl of findNativeSpeedValueElements(rowEl)) {
      if (nativeValueEl.getAttribute(NATIVE_HIDDEN_ATTR) !== 'true') {
        nativeValueEl.setAttribute(NATIVE_HIDDEN_ATTR, 'true');
      }
      entry.hiddenNodes.add(nativeValueEl);
    }
    const labelHost = findPlaybackSpeedLabelHost(rowEl);
    // Handle single-text-node rows like `<span>Playback speed · 1.75x</span>` cleanly.
    for (let child = labelHost.firstChild; child; child = child.nextSibling) {
      if (child.nodeType !== Node.TEXT_NODE) {
        continue;
      }
      const textNode = child as Text;
      const val = textNode.nodeValue ?? '';
      const inlineMatch = PARENT_SPEED_INLINE_RE.exec(val.trim());
      if (inlineMatch?.[1]) {
        if (!entry.trimmedTexts.has(textNode)) {
          entry.trimmedTexts.set(textNode, val);
        }
        textNode.nodeValue = inlineMatch[1];
      }
    }
    if (entry.badge.parentElement !== labelHost) {
      labelHost.append(entry.badge);
    }
    const nextText = formatParentBadgeText(store.get().rate);
    if (entry.badge.textContent !== nextText) {
      entry.badge.textContent = nextText;
    }
  };

  scope.add(
    store.subscribe(() => {
      if (scope.disposed) {
        return;
      }
      const nextText = formatParentBadgeText(store.get().rate);
      for (const [rowEl, entry] of [...parentRows]) {
        if (!rowEl.isConnected) {
          teardownParentRow(rowEl);
          continue;
        }
        if (entry.badge.textContent !== nextText) {
          entry.badge.textContent = nextText;
        }
      }
      for (const [parent, entry] of [...mountedByParent]) {
        if (!parent.isConnected) {
          teardownParentMenu(parent);
          continue;
        }
        syncNativeSpeedItems(entry.items);
      }
    }),
  );

  const findTrackedAncestor = (el: Element): Element | null => {
    let cur = el.parentElement;
    while (cur) {
      if (menuCleanups.has(cur)) {
        return cur;
      }
      cur = cur.parentElement;
    }
    return null;
  };

  const bindNativeSpeedOption = (targetEl: Element, labelEl: Element): void => {
    if (nativeBound.has(targetEl)) {
      return;
    }
    nativeBound.add(targetEl);
    const applyNativeChoice = (): void => {
      if (scope.disposed) {
        return;
      }
      // Re-parse on interaction so React reusing the DOM node for another submenu item
      // never applies a stale speed closure.
      const currentRate =
        parseNativeSpeedLabel(extractVisibleText(labelEl)) ??
        parseNativeSpeedLabel(extractVisibleText(targetEl));
      if (currentRate !== null) {
        lastMenuInteractionAt = Date.now();
        lastInteractedRate = currentRate;
        store.set({ rate: currentRate, custom: false }, true);
      }
    };
    targetEl.addEventListener(
      'pointerdown',
      (event) => {
        if ((event as PointerEvent).button === 0) {
          applyNativeChoice();
        }
      },
      { capture: true, signal: clickAbort.signal },
    );
    targetEl.addEventListener('click', applyNativeChoice, {
      capture: true,
      signal: clickAbort.signal,
    });
    targetEl.addEventListener('change', applyNativeChoice, {
      capture: true,
      signal: clickAbort.signal,
    });
    targetEl.addEventListener(
      'keydown',
      (event) => {
        const key = (event as KeyboardEvent).key;
        if (key === 'Enter' || key === ' ') {
          applyNativeChoice();
        }
      },
      { capture: true, signal: clickAbort.signal },
    );
  };

  const attachMenuWatcher = (menu: Element): void => {
    if (menuCleanups.has(menu)) {
      return;
    }
    const isSmallPopover = menu.matches(SMALL_POPOVER_SELECTOR);
    const trackedAncestor = findTrackedAncestor(menu);
    if (trackedAncestor) {
      // Portaled `#layers > *` and inline `[data-testid="videoPlayer"]` containers
      // share `PageWatcher` (`childList` only). Attach a lightweight `characterData`
      // observer directly on nested open popovers so in-place React text updates
      // still re-sync the speed badge/menu.
      if (isSmallPopover && !trackedAncestor.matches(SMALL_POPOVER_SELECTOR)) {
        const ancestorEntry = containerSchedulers.get(trackedAncestor);
        if (ancestorEntry) {
          const charObserver = new MutationObserver((records) => {
            if (!scope.disposed && !isIgnorableMutation(records)) {
              ancestorEntry.schedule();
            }
          });
          charObserver.observe(menu, { characterData: true, subtree: true });
          ancestorEntry.childObservers.add(charObserver);
          menuCleanups.set(menu, () => {
            charObserver.disconnect();
            ancestorEntry.childObservers.delete(charObserver);
            menuCleanups.delete(menu);
          });
        }
      }
      return;
    }
    let ownedParent: Element | null = null;
    const ownedRows = new Set<Element>();

    const teardownOwnedMenu = (): void => {
      if (!ownedParent) {
        return;
      }
      teardownParentMenu(ownedParent);
      ownedParent = null;
    };

    const teardownOwnedRows = (keep?: ReadonlySet<Element>): void => {
      for (const row of [...ownedRows]) {
        if (keep?.has(row)) {
          continue;
        }
        ownedRows.delete(row);
        teardownParentRow(row);
      }
    };

    const resolveScanRoots = (): Element[] => {
      // Full-screen photo/reply modals inside `#layers > *` contain dozens of
      // comment tweets; never scan the whole modal — only scan actual menu or
      // video player subtrees inside it.
      if (!menu.matches(VIDEO_MENU_SCOPE_SELECTOR) && menu.querySelector(TWEET_ARTICLE_SELECTOR)) {
        return [...menu.querySelectorAll(VIDEO_MENU_SCOPE_SELECTOR)];
      }
      return [menu];
    };

    const syncMenu = (): void => {
      if (scope.disposed || !menu.isConnected) {
        teardownOwnedMenu();
        teardownOwnedRows();
        return;
      }
      const scanRoots = resolveScanRoots();
      const rootItems = scanRoots.map((root) => [...root.querySelectorAll(SPEED_ITEM_SELECTOR)]);
      let detected: DetectedSpeedMenu | null = null;
      for (let i = 0; i < scanRoots.length; i++) {
        const root = scanRoots[i];
        if (!root) {
          continue;
        }
        detected = detectSpeedMenu(root, rootItems[i]);
        if (detected) {
          break;
        }
      }
      if (!detected) {
        teardownOwnedMenu();
        const foundRows = new Set<Element>();
        for (let i = 0; i < scanRoots.length; i++) {
          const root = scanRoots[i];
          if (!root) {
            continue;
          }
          for (const row of detectParentSpeedRows(root, rootItems[i])) {
            foundRows.add(row);
          }
        }
        teardownOwnedRows(foundRows);
        for (const rowEl of foundRows) {
          ownedRows.add(rowEl);
          syncParentRow(rowEl);
        }
        return;
      }

      teardownOwnedRows();
      const { parent, anchor, items } = detected;
      for (const { el, rowEl } of items) {
        bindNativeSpeedOption(rowEl, el);
        if (el !== rowEl) {
          bindNativeSpeedOption(el, el);
        }
      }
      const existing = mountedByParent.get(parent);
      if (existing) {
        existing.items = items;
        syncNativeSpeedItems(items);
        if (existing.host.previousElementSibling !== anchor) {
          anchor.after(existing.host);
        }
        return;
      }
      if (ownedParent && ownedParent !== parent) {
        teardownOwnedMenu();
      }
      // Read computed polarity from the list parent BEFORE mutating DOM to avoid style thrash.
      const polarityCss = buildMenuPolarityCss(parent, page.doc);
      const host = page.doc.createElement(HOST_TAG);
      host.setAttribute(OWN_ATTR, 'x-video-speed');
      stopAtHost(host, PRESS_EVENTS);
      anchor.after(host);
      const unmount = renderInShadow(
        host,
        <CustomSpeedControl
          store={store}
          onConfirm={() => dismissSpeedMenu(menu, host, page.doc)}
        />,
        polarityCss ? `${polarityCss}\n${css}` : css,
      );
      mountedByParent.set(parent, { host, unmount, items });
      ownedParent = parent;
      syncNativeSpeedItems(items);
    };

    let syncTimer: ReturnType<typeof setTimeout> | undefined;
    let observer: MutationObserver | undefined;
    const childObservers = new Set<MutationObserver>();
    let burstCount = 0;
    let burstWindowStart = 0;

    const runSync = (): void => {
      try {
        syncMenu();
      } finally {
        // Discard any mutations caused by our own badge/attribute/text updates so
        // `syncMenu` can never trigger a self-feeding MutationObserver loop.
        observer?.takeRecords();
        for (const childObs of childObservers) {
          childObs.takeRecords();
        }
      }
    };

    const scheduleSync = (): void => {
      if (syncTimer !== undefined || scope.disposed) {
        return;
      }
      const now = Date.now();
      if (now - burstWindowStart > MENU_BURST_WINDOW_MS) {
        burstWindowStart = now;
        burstCount = 0;
      }
      burstCount++;
      // Yield via a macrotask (`setTimeout`) rather than `queueMicrotask` so menu
      // observers can never starve input/paint or freeze the tab. Back off if the
      // host mutates continuously inside a popover.
      const delay = burstCount > MENU_BURST_LIMIT ? MENU_BURST_BACKOFF_MS : 0;
      syncTimer = setTimeout(() => {
        syncTimer = undefined;
        runSync();
      }, delay);
    };

    // Only attach a dedicated `characterData` observer on actual open popover menus
    // (0 while scrolling, at most 1 when open). Video players and `#layers > *` share
    // the document-level `PageWatcher` via `containerSchedulers`.
    if (isSmallPopover) {
      observer = new MutationObserver((records) => {
        if (syncTimer !== undefined || scope.disposed) {
          return;
        }
        if (!isIgnorableMutation(records)) {
          scheduleSync();
        }
      });
      observer.observe(menu, { childList: true, subtree: true, characterData: true });
      runSync();
    } else {
      containerSchedulers.set(menu, {
        schedule: scheduleSync,
        hasMounted: () => ownedParent !== null || ownedRows.size > 0,
        childObservers,
      });
      ensureTreeWatch();
      // Skip initial scan only on bare `<div data-testid="videoPlayer"><video/></div>` mounts while scrolling.
      const isBareVideoMount =
        menu.matches('[data-testid="videoPlayer"], [data-testid="videoComponent"]') &&
        menu.childElementCount <= 1 &&
        (menu.childElementCount === 0 || menu.firstElementChild?.localName === 'video');
      if (!isBareVideoMount) {
        runSync();
      }
    }

    menuCleanups.set(menu, () => {
      if (syncTimer !== undefined) {
        clearTimeout(syncTimer);
        syncTimer = undefined;
      }
      observer?.disconnect();
      for (const childObs of childObservers) {
        childObs.disconnect();
      }
      childObservers.clear();
      if (containerSchedulers.delete(menu)) {
        releaseTreeWatchIfIdle();
      }
      teardownOwnedMenu();
      teardownOwnedRows();
      menuCleanups.delete(menu);
    });
  };

  scope.add(
    page.watch(MENU_CONTAINER_SELECTOR, {
      added: (menu) => attachMenuWatcher(menu),
      removed: (menu) => menuCleanups.get(menu)?.(),
    }),
  );

  scope.add(() => {
    treeWatchStop?.();
    treeWatchStop = undefined;
    containerSchedulers.clear();
    for (const cleanup of [...menuCleanups.values()]) {
      cleanup();
    }
    menuCleanups.clear();
    for (const parent of [...mountedByParent.keys()]) {
      teardownParentMenu(parent);
    }
    for (const rowEl of [...parentRows.keys()]) {
      teardownParentRow(rowEl);
    }
  });

  return {
    isMenuOpen: () => mountedByParent.size > 0,
    recentlyInteractedRate: () =>
      Date.now() - lastMenuInteractionAt < MENU_INTERACTION_WINDOW_MS ? lastInteractedRate : null,
  };
}

/**
 * Adds a divider and native-looking Custom playback speed slider, editable
 * numeric input, and Set button beneath X's native video Settings -> Playback
 * speed options, keeping native choices and Feed Sanity's toolbar popup synced.
 */
export default defineXFeature({
  id: 'x_video_speed',
  options: {
    x_video_speed: {
      section: 'Media',
      group: 'Videos',
      title: 'Custom video playback speed',
      description:
        "Add a custom speed slider and exact numeric input (e.g. 1.17×, 2.23×, 0.78×) to X's video Playback speed menu and remember your preferred speed.",
      keywords: ['speed', 'rate', 'playback', 'video'],
      default: true,
    },
  },
  enabledBy: 'x_video_speed',
  setup({ page, data, log, scope }) {
    const saved = data.value(X_VIDEO_SPEED_KEY, readSavedVideoSpeed);
    let applyToAllVideos: (rate: number) => void = () => undefined;
    const store = createSpeedStore(saved, log, scope, (rate) => applyToAllVideos(rate));
    const menuActivity = watchSpeedMenus(page, scope, store);
    applyToAllVideos = attachVideoSpeedEnforcer(page, scope, store, menuActivity);
  },
});
