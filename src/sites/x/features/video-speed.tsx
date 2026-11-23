import { useState, useSyncExternalStore } from 'react';
import type { Logger } from '../../../core/log';
import type { SavedValue } from '../../../core/saved';
import type { Scope } from '../../../core/scope';
import type { XPage } from '../feature';
import { PRESS_EVENTS } from '../../../core/intercept';
import { Listeners } from '../../../core/listeners';
import { OWN_ATTR } from '../../../core/surface';
import { resolveEffectiveBackground, rgbaLuminance } from '../../../core/theme';
import { HOST_TAG, renderInShadow, stopAtHost } from '../../../ui/mount';
import { defineXFeature } from '../feature';
import css from './video-speed.css?inline';

export const X_VIDEO_SPEED_KEY = 'x_video_speed';

export const MIN_VIDEO_SPEED = 0.1;
export const MAX_VIDEO_SPEED = 16;
const SLIDER_MIN = 0.25;
const SLIDER_MAX = 4;
const SLIDER_STEP = 0.01;
const BUTTON_STEP = 0.05;
const SAVE_DEBOUNCE_MS = 160;
const SPEED_MENU_SELECTOR = '[role="menu"], [role="listbox"], [data-testid="Dropdown"]';
const SPEED_ITEM_SELECTOR = '[role="menuitem"], [role="menuitemradio"], button';
const VIDEO_ENFORCE_EVENTS = ['loadedmetadata', 'play', 'playing', 'ratechange'] as const;

export interface SavedVideoSpeed {
  readonly rate: number;
  readonly custom: boolean;
}

export const DEFAULT_VIDEO_SPEED: SavedVideoSpeed = {
  rate: 1,
  custom: false,
};

/** Rounds a playback speed to 2 decimals and clamps it within `[0.1, 16]`. */
export function clampVideoSpeed(rate: number): number {
  const clamped = Math.max(MIN_VIDEO_SPEED, Math.min(MAX_VIDEO_SPEED, rate));
  return Math.round(clamped * 100) / 100;
}

/** Formats a numeric speed cleanly without trailing zeros (e.g. `1.17` -> `'1.17'`). */
export function formatSpeedNumber(rate: number): string {
  return String(clampVideoSpeed(rate));
}

function parseBoundedSpeed(numeric: string): number | null {
  const value = Number.parseFloat(numeric);
  if (!Number.isFinite(value) || value < MIN_VIDEO_SPEED || value > MAX_VIDEO_SPEED) {
    return null;
  }
  return clampVideoSpeed(value);
}

/** Parses user-typed speed input (e.g. `'1.17'`, `'2.23x'`, `'0.78×'`). */
export function parseSpeedInput(raw: string): number | null {
  const cleaned = raw
    .trim()
    .replace(/[x×]\s*$/i, '')
    .trim();
  if (!/^\d*(?:\.\d*)?$/.test(cleaned) || cleaned === '' || cleaned === '.') {
    return null;
  }
  return parseBoundedSpeed(cleaned);
}

/** Parses an X native speed option label (`'Normal'`, `'0.25x'`, `'1.5x'`, `'2x'`, etc.). */
export function parseNativeSpeedLabel(text: string): number | null {
  const trimmed = text.trim();
  if (/^normal$/i.test(trimmed)) {
    return 1;
  }
  const match = /^(\d+(?:\.\d+)?)\s*[x×]$/i.exec(trimmed);
  return match?.[1] ? parseBoundedSpeed(match[1]) : null;
}

/** Safely validates persisted `SavedVideoSpeed` data from storage. */
export function readSavedVideoSpeed(raw: unknown): SavedVideoSpeed {
  if (typeof raw !== 'object' || raw === null) {
    return { ...DEFAULT_VIDEO_SPEED };
  }
  const obj = raw as Record<string, unknown>;
  const rate =
    typeof obj.rate === 'number' && Number.isFinite(obj.rate)
      ? clampVideoSpeed(obj.rate)
      : DEFAULT_VIDEO_SPEED.rate;
  const custom = typeof obj.custom === 'boolean' ? obj.custom : rate !== 1;
  return { rate, custom };
}

interface SpeedStore {
  get: () => SavedVideoSpeed;
  set: (next: SavedVideoSpeed, immediate?: boolean) => void;
  flush: () => void;
  subscribe: (listener: () => void) => () => void;
}

function CustomSpeedControl({ store }: { readonly store: SpeedStore }) {
  const speed = useSyncExternalStore(store.subscribe, store.get);
  const [draft, setDraft] = useState<string | null>(null);

  const displayText = draft ?? formatSpeedNumber(speed.rate);
  const inputInvalid = draft !== null && draft.trim() !== '' && parseSpeedInput(draft) === null;

  const sliderValue = Math.max(SLIDER_MIN, Math.min(SLIDER_MAX, speed.rate));
  const sliderPct = ((sliderValue - SLIDER_MIN) / (SLIDER_MAX - SLIDER_MIN)) * 100;
  const sliderTrack = `linear-gradient(to right, var(--fs-accent) 0%, var(--fs-accent) ${sliderPct}%, var(--fs-divider) ${sliderPct}%, var(--fs-divider) 100%)`;

  const handleSlider = (raw: string, immediate: boolean): void => {
    const val = Number.parseFloat(raw);
    if (!Number.isFinite(val)) {
      return;
    }
    setDraft(null);
    store.set({ rate: clampVideoSpeed(val), custom: true }, immediate);
  };

  const commitDraft = (): void => {
    if (draft !== null) {
      const parsed = parseSpeedInput(draft);
      if (parsed !== null) {
        store.set({ rate: parsed, custom: true }, true);
      }
      setDraft(null);
    }
  };

  const stepBy = (dir: -1 | 1, fine: boolean): void => {
    setDraft(null);
    const delta = dir * (fine ? SLIDER_STEP : BUTTON_STEP);
    store.set({ rate: clampVideoSpeed(speed.rate + delta), custom: true }, true);
  };

  const resetNormal = (): void => {
    setDraft(null);
    store.set({ rate: 1, custom: false }, true);
  };

  return (
    <>
      <hr className="fs-speed-divider" />
      <div className="fs-speed-section" role="group" aria-label="Custom playback speed">
        <div className="fs-speed-header">
          <span className="fs-speed-title-group">
            <span className="fs-speed-title">Custom</span>
            <span className="fs-speed-badge">{formatSpeedNumber(speed.rate)}×</span>
          </span>
          <span className="fs-speed-header-right">
            {speed.rate !== 1 && (
              <button
                type="button"
                className="fs-speed-reset"
                aria-label="Reset playback speed to 1x"
                onClick={resetNormal}
              >
                1×
              </button>
            )}
            {speed.custom && (
              <svg
                className="fs-speed-check"
                viewBox="0 0 24 24"
                aria-label="Custom speed active"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </span>
        </div>

        <div className="fs-speed-slider-wrap">
          <input
            type="range"
            className="fs-speed-slider"
            aria-label="Playback speed slider"
            min={SLIDER_MIN}
            max={SLIDER_MAX}
            step={SLIDER_STEP}
            value={sliderValue}
            style={{ background: sliderTrack }}
            onInput={(event) => handleSlider(event.currentTarget.value, false)}
            onPointerUp={() => store.flush()}
            onKeyUp={() => store.flush()}
            onBlur={() => store.flush()}
          />
          <div className="fs-speed-ticks" aria-hidden="true">
            <span>0.25×</span>
            <span>1×</span>
            <span>2×</span>
            <span>4×</span>
          </div>
        </div>

        <div className="fs-speed-input-row">
          <button
            type="button"
            className="fs-speed-step"
            aria-label="Decrease playback speed"
            onClick={(event) => stepBy(-1, event.shiftKey)}
          >
            −
          </button>
          <label className="fs-speed-field" data-invalid={inputInvalid ? 'true' : undefined}>
            <input
              type="text"
              inputMode="decimal"
              className="fs-speed-input"
              aria-label="Custom playback speed"
              placeholder="1.00"
              value={displayText}
              onFocus={() => setDraft(formatSpeedNumber(speed.rate))}
              onInput={(event) => {
                const raw = event.currentTarget.value;
                setDraft(raw);
                const parsed = parseSpeedInput(raw);
                if (parsed !== null) {
                  store.set({ rate: parsed, custom: true }, false);
                }
              }}
              onBlur={commitDraft}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitDraft();
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  stepBy(1, event.shiftKey);
                } else if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  stepBy(-1, event.shiftKey);
                }
              }}
            />
            <span className="fs-speed-suffix" aria-hidden="true">
              ×
            </span>
          </label>
          <button
            type="button"
            className="fs-speed-step"
            aria-label="Increase playback speed"
            onClick={(event) => stepBy(1, event.shiftKey)}
          >
            +
          </button>
        </div>
      </div>
    </>
  );
}

interface DetectedSpeedMenu {
  readonly items: ReadonlyArray<{ readonly el: Element; readonly rate: number }>;
  readonly anchor: Element;
}

function detectSpeedMenu(menu: Element): DetectedSpeedMenu | null {
  const items: Array<{ el: Element; rate: number }> = [];
  for (const el of menu.querySelectorAll(SPEED_ITEM_SELECTOR)) {
    if (el.closest(`[${OWN_ATTR}]`)) {
      continue;
    }
    const rate = parseNativeSpeedLabel(el.textContent ?? '');
    if (rate !== null) {
      items.push({ el, rate });
    }
  }
  const last = items.length >= 3 ? items.at(-1) : undefined;
  return last ? { items, anchor: last.el } : null;
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
        if (speed.rate !== 1 || speed.custom) {
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
  }

  const menuCleanups = new Map<Element, () => void>();
  const mountedByParent = new Map<Element, MountedMenu>();
  const nativeBound = new WeakSet<Element>();
  const clickAbort = new AbortController();
  scope.add(() => clickAbort.abort());

  const teardownParent = (parent: Element): void => {
    const entry = mountedByParent.get(parent);
    if (!entry) {
      return;
    }
    mountedByParent.delete(parent);
    entry.unmount();
    entry.host.remove();
  };

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

  const attachMenuWatcher = (menu: Element): void => {
    if (menuCleanups.has(menu) || hasTrackedAncestor(menu)) {
      return;
    }
    let ownedParent: Element | null = null;

    const teardownOwned = (): void => {
      if (!ownedParent) {
        return;
      }
      teardownParent(ownedParent);
      ownedParent = null;
    };

    const syncMenu = (): void => {
      if (scope.disposed || !menu.isConnected) {
        teardownOwned();
        return;
      }
      const detected = detectSpeedMenu(menu);
      const parent = detected?.anchor.parentElement ?? null;
      if (!detected || !parent) {
        teardownOwned();
        return;
      }
      for (const { el } of detected.items) {
        if (!nativeBound.has(el)) {
          nativeBound.add(el);
          el.addEventListener(
            'click',
            () => {
              if (scope.disposed) {
                return;
              }
              // Re-parse on click so React reusing the DOM node for another submenu item
              // never applies a stale speed closure.
              const currentRate = parseNativeSpeedLabel(el.textContent ?? '');
              if (currentRate !== null) {
                store.set({ rate: currentRate, custom: false }, true);
              }
            },
            { capture: true, signal: clickAbort.signal },
          );
        }
      }
      const existing = mountedByParent.get(parent);
      if (existing) {
        if (existing.host.previousElementSibling !== detected.anchor) {
          detected.anchor.after(existing.host);
        }
        return;
      }
      if (ownedParent && ownedParent !== parent) {
        teardownOwned();
      }
      // Read computed polarity from the list parent BEFORE mutating DOM to avoid style thrash.
      const polarityCss = buildMenuPolarityCss(parent, page.doc);
      const host = page.doc.createElement(HOST_TAG);
      host.setAttribute(OWN_ATTR, 'x-video-speed');
      stopAtHost(host, PRESS_EVENTS);
      detected.anchor.after(host);
      const unmount = renderInShadow(
        host,
        <CustomSpeedControl store={store} />,
        polarityCss ? `${polarityCss}\n${css}` : css,
      );
      mountedByParent.set(parent, { host, unmount });
      ownedParent = parent;
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
      teardownOwned();
      menuCleanups.delete(menu);
    });
  };

  scope.add(
    page.watch(SPEED_MENU_SELECTOR, {
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
      teardownParent(parent);
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
      section: 'Videos',
      title: 'Custom video playback speed',
      description:
        'Add a custom speed slider and exact numeric input (e.g. 1.17x, 2.23x, 0.78x) to X’s video Playback speed menu and remember your preferred speed.',
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
