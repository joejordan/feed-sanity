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
import { resolveEffectiveBackground, rgbaLuminance } from '../../../core/theme';
import { HOST_TAG, renderInShadow, stopAtHost } from '../../../ui/mount';
import { defineXFeature } from '../feature';
import css from './video-speed.css?inline';
import { CustomSpeedControl } from './video-speed-control';
import {
  clampVideoSpeed,
  formatSpeedLabel,
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
  MAX_VIDEO_SPEED,
  MIN_VIDEO_SPEED,
  parseNativeSpeedLabel,
  parseSpeedInput,
  readSavedVideoSpeed,
  X_VIDEO_SPEED_KEY,
} from './video-speed-model';

const SAVE_DEBOUNCE_MS = 160;
const SPEED_EPSILON = 0.005;
const MENU_CONTAINER_SELECTOR = [
  '[role="menu"]',
  '[role="listbox"]',
  '[role="dialog"]',
  '[data-testid="Dropdown"]',
  '[data-testid="sheetDialog"]',
  '[data-testid="videoPlayer"]',
  '[data-testid="videoComponent"]',
  '#layers > *',
].join(', ');
const SPEED_ITEM_SELECTOR =
  '[role="menuitem"], [role="menuitemradio"], [role="radio"], [role="option"], [role="button"], button, label, [tabindex="0"]';
const VIDEO_ENFORCE_EVENTS = ['loadedmetadata', 'play', 'playing', 'ratechange'] as const;
const PARENT_SPEED_ROW_RE =
  /^playback\s+speed(?:\s*[·•-]?\s*(?:normal(?:\s*\(\s*1(?:\.0+)?\s*[x×]\s*\))?|\d+(?:\.\d+)?\s*[x×](?:\s*\(\s*normal\s*\))?))?$/i;
const PARENT_SPEED_LABEL_RE = /^playback\s+speed$/i;
const NATIVE_HIDDEN_ATTR = 'data-fs-speed-native-hidden';
const HIDE_CHECK_ATTR = 'data-fs-speed-hide-check';
const OWN_PARENT_BADGE_VALUE = 'x-speed-parent-value';
const OWN_NATIVE_CHECK_VALUE = 'x-speed-native-check';
const PAGE_STYLE_ID = 'feed_sanity_x_video_speed';
const PAGE_SPEED_CSS = `
[${NATIVE_HIDDEN_ATTR}="true"] {
  display: none !important;
}
[${HIDE_CHECK_ATTR}="true"] svg:not([data-feed-sanity-icon]) {
  visibility: hidden !important;
}
[${OWN_ATTR}="${OWN_PARENT_BADGE_VALUE}"] {
  font-weight: 500;
  opacity: 0.82;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
[${OWN_ATTR}="${OWN_NATIVE_CHECK_VALUE}"] {
  display: inline-flex;
  align-items: center;
  margin-left: auto;
  padding-left: 8px;
  color: var(--fs-accent, rgb(29, 155, 240));
  flex-shrink: 0;
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

function extractVisibleText(root: Node): string {
  let out = '';
  for (let child = root.firstChild; child; child = child.nextSibling) {
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

function detectSpeedMenu(container: Element): DetectedSpeedMenu | null {
  const raw: Array<{ el: Element; rate: number }> = [];
  for (const el of container.querySelectorAll(SPEED_ITEM_SELECTOR)) {
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

function detectParentSpeedRows(container: Element): Element[] {
  const candidates: Array<{ el: Element }> = [];
  for (const el of container.querySelectorAll(SPEED_ITEM_SELECTOR)) {
    if (el.closest(`[${OWN_ATTR}]`)) {
      continue;
    }
    if (PARENT_SPEED_ROW_RE.test(extractVisibleText(el))) {
      candidates.push({ el });
    }
  }
  return keepInnermost(candidates).map((item) => item.el);
}

function findPlaybackSpeedLabelHost(rowEl: Element): Element {
  let deepest: Element | null = null;
  for (const child of rowEl.querySelectorAll('*')) {
    if (child.closest(`[${OWN_ATTR}]`) || child.tagName.toUpperCase() === 'SVG') {
      continue;
    }
    if (PARENT_SPEED_LABEL_RE.test(extractVisibleText(child))) {
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
    if (parseNativeSpeedLabel(extractVisibleText(child)) !== null) {
      matches.push({ el: child });
    }
  }
  return keepInnermost(matches).map((item) => item.el);
}

function createNativeCheckBadge(doc: Document): HTMLSpanElement {
  const span = doc.createElement('span');
  span.setAttribute(OWN_ATTR, OWN_NATIVE_CHECK_VALUE);
  span.setAttribute('aria-hidden', 'true');
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('data-feed-sanity-icon', 'check');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const poly = doc.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  poly.setAttribute('points', '20 6 9 17 4 12');
  svg.append(poly);
  span.append(svg);
  return span;
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
  --fs-input: rgb(255 255 255 / 6%);
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
  const needsDefault = Math.abs(video.defaultPlaybackRate - rate) > 0.005;
  const needsRate = Math.abs(video.playbackRate - rate) > 0.005;
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
  getSpeed: () => SavedVideoSpeed,
): (rate: number) => void {
  const videoCleanups = new Map<HTMLVideoElement, () => void>();
  const initial = getSpeed();
  let enforceActive = initial.rate !== 1 || initial.custom;

  scope.add(
    page.videos.onAdd((xVideo) => {
      const video = xVideo.element;
      if (videoCleanups.has(video) || isXAnimatedGif(video)) {
        return;
      }
      const enforce = (): void => {
        if (scope.disposed) {
          return;
        }
        const speed = getSpeed();
        if (enforceActive || speed.rate !== 1 || speed.custom) {
          applySpeedToVideo(video, speed.rate);
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
      applySpeedToVideo(video, rate);
    }
  };
}

function isOnlyOwnMutation(records: readonly MutationRecord[]): boolean {
  for (const rec of records) {
    for (const node of rec.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE || !(node as Element).hasAttribute(OWN_ATTR)) {
        return false;
      }
    }
    for (const node of rec.removedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE || !(node as Element).hasAttribute(OWN_ATTR)) {
        return false;
      }
    }
  }
  return true;
}

function watchSpeedMenus(page: XPage, scope: Scope, store: SpeedStore): void {
  interface MountedMenu {
    readonly host: HTMLElement;
    readonly unmount: () => void;
    items: readonly DetectedSpeedItem[];
  }

  interface EnhancedParentRow {
    readonly badge: HTMLSpanElement;
    readonly hiddenNodes: Set<Element>;
  }

  scope.add(addStyle(PAGE_STYLE_ID, PAGE_SPEED_CSS, page.doc));

  const menuCleanups = new Map<Element, () => void>();
  const mountedByParent = new Map<Element, MountedMenu>();
  const parentRows = new Map<Element, EnhancedParentRow>();
  const nativeBound = new WeakSet<Element>();
  const clickAbort = new AbortController();
  scope.add(() => clickAbort.abort());

  const clearNativeItemDecorations = (items: readonly DetectedSpeedItem[]): void => {
    for (const { rowEl } of items) {
      rowEl.removeAttribute(HIDE_CHECK_ATTR);
      rowEl.querySelector(`[${OWN_ATTR}="${OWN_NATIVE_CHECK_VALUE}"]`)?.remove();
    }
  };

  const syncNativeSpeedItems = (items: readonly DetectedSpeedItem[]): void => {
    const speed = store.get();
    const hasMatchingNative =
      !speed.custom && items.some((item) => Math.abs(item.rate - speed.rate) < SPEED_EPSILON);
    for (const { el, rowEl, rate } of items) {
      const isSelected = hasMatchingNative && Math.abs(rate - speed.rate) < SPEED_EPSILON;
      if (isSelected) {
        rowEl.removeAttribute(HIDE_CHECK_ATTR);
        const hasNativeSvg = rowEl.querySelector('svg:not([data-feed-sanity-icon])') !== null;
        const ownCheck = rowEl.querySelector(`[${OWN_ATTR}="${OWN_NATIVE_CHECK_VALUE}"]`);
        if (hasNativeSvg) {
          ownCheck?.remove();
        } else if (!ownCheck) {
          el.append(createNativeCheckBadge(page.doc));
        }
      } else {
        rowEl.setAttribute(HIDE_CHECK_ATTR, 'true');
        rowEl.querySelector(`[${OWN_ATTR}="${OWN_NATIVE_CHECK_VALUE}"]`)?.remove();
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
  };

  const formatParentBadgeText = (rate: number): string => ` · ${formatSpeedLabel(rate)}`;

  const syncParentRow = (rowEl: Element): void => {
    let entry = parentRows.get(rowEl);
    if (!entry) {
      const badge = page.doc.createElement('span');
      badge.setAttribute(OWN_ATTR, OWN_PARENT_BADGE_VALUE);
      entry = { badge, hiddenNodes: new Set() };
      parentRows.set(rowEl, entry);
    }
    for (const nativeValueEl of findNativeSpeedValueElements(rowEl)) {
      nativeValueEl.setAttribute(NATIVE_HIDDEN_ATTR, 'true');
      entry.hiddenNodes.add(nativeValueEl);
    }
    const labelHost = findPlaybackSpeedLabelHost(rowEl);
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

  const hasTrackedAncestor = (el: Element): boolean => {
    let cur = el.parentElement;
    while (cur) {
      if (menuCleanups.has(cur)) {
        return true;
      }
      cur = cur.parentElement;
    }
    return false;
  };

  const bindNativeSpeedOption = (el: Element): void => {
    if (nativeBound.has(el)) {
      return;
    }
    nativeBound.add(el);
    const applyNativeChoice = (): void => {
      if (scope.disposed) {
        return;
      }
      // Re-parse on interaction so React reusing the DOM node for another submenu item
      // never applies a stale speed closure.
      const currentRate = parseNativeSpeedLabel(extractVisibleText(el));
      if (currentRate !== null) {
        store.set({ rate: currentRate, custom: false }, true);
      }
    };
    el.addEventListener('click', applyNativeChoice, { capture: true, signal: clickAbort.signal });
    el.addEventListener(
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
    if (menuCleanups.has(menu) || hasTrackedAncestor(menu)) {
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

    const syncMenu = (): void => {
      if (scope.disposed || !menu.isConnected) {
        teardownOwnedMenu();
        teardownOwnedRows();
        return;
      }
      const detected = detectSpeedMenu(menu);
      if (!detected) {
        teardownOwnedMenu();
        const foundRows = new Set(detectParentSpeedRows(menu));
        teardownOwnedRows(foundRows);
        for (const rowEl of foundRows) {
          ownedRows.add(rowEl);
          syncParentRow(rowEl);
        }
        return;
      }

      teardownOwnedRows();
      const { parent, anchor, items } = detected;
      for (const { el } of items) {
        bindNativeSpeedOption(el);
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
        <CustomSpeedControl store={store} />,
        polarityCss ? `${polarityCss}\n${css}` : css,
      );
      mountedByParent.set(parent, { host, unmount, items });
      ownedParent = parent;
      syncNativeSpeedItems(items);
    };

    const observer = new MutationObserver((records) => {
      if (!isOnlyOwnMutation(records)) {
        syncMenu();
      }
    });
    observer.observe(menu, { childList: true, subtree: true });
    syncMenu();

    menuCleanups.set(menu, () => {
      observer.disconnect();
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
}

/**
 * Adds a divider and native-looking Custom playback speed slider + numeric
 * input box beneath X's native video Settings -> Playback speed options,
 * persisting the chosen speed across videos and reloads.
 */
export default defineXFeature({
  id: 'x_video_speed',
  options: {
    x_video_speed: {
      section: 'Media',
      group: 'Videos',
      title: 'Custom video playback speed',
      description:
        'Add a custom speed slider and exact numeric input (e.g. 1.17x, 2.23x, 0.78x) to X’s video Playback speed menu and remember your preferred speed.',
      keywords: ['speed', 'rate', 'playback', 'video'],
      default: true,
    },
  },
  enabledBy: 'x_video_speed',
  setup({ page, data, log, scope }) {
    const saved = data.value(X_VIDEO_SPEED_KEY, readSavedVideoSpeed);
    let applyToAllVideos: (rate: number) => void = () => undefined;
    const store = createSpeedStore(saved, log, scope, (rate) => applyToAllVideos(rate));
    applyToAllVideos = attachVideoSpeedEnforcer(page, scope, store.get);
    watchSpeedMenus(page, scope, store);
  },
});
