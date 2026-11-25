// Layer 2 — Real-Time Viewport-Budgeted Self-Healer.
//
// Catches elements that CSS stylesheet compilation cannot see (inline `style`
// colors, CORS-blocked `<link>` stylesheets, and cross-layer contrast
// collisions like light-on-light text in popovers or profile bios).
//
// Uses strictly batched read-then-write passes with paint-only `data-fs-heal-*`
// attributes (seeding `bgCache` with planned container backgrounds so descendant
// text heals in the same pass), never causes layout thrashing or layout shift,
// never overwrites inline `style`, and reverts 100% cleanly on Site Default.

import type { DomEnvironment } from '../dom-env';
import type { Scope } from '../scope';
import type { RgbaColor } from './color';
import type { ThemeColorScheme, ThemePalette } from './types';
import { parentAcrossShadows } from '../dom';
import { addStyleAcrossRoots, isOwnUiElement, OWN_ATTR, OWN_UI_TAG, SHELL_ATTR } from '../surface';
import {
  colorSchemeOf,
  compositeOver,
  isNeutralColor,
  isOppositePolarityNeutral,
  parseCssColor,
  rgbaContrastRatio,
  rgbToOklch,
  samePalette,
} from './color';
import { withThemeLayerOrder, wrapThemeLayer } from './types';

export const HEAL_BG_ATTR = 'data-fs-heal-bg';
export const HEAL_FG_ATTR = 'data-fs-heal-fg';
export const HEAL_BORDER_ATTR = 'data-fs-heal-border';
export const HEALER_STYLE_ID = 'feed_sanity_healer_theme';
export { isOwnUiElement, OWN_UI_TAG };

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Non-visual and media lowercase tag names (`el.localName`) shared by healer and auditor. */
export const NON_VISUAL_OR_MEDIA_TAGS: ReadonlySet<string> = new Set([
  'script',
  'style',
  'noscript',
  'link',
  'meta',
  'head',
  'img',
  'video',
  'audio',
  'canvas',
  'picture',
  'iframe',
  'br',
  'wbr',
]);

const HEAL_SKIP_TAGS = new Set([
  ...NON_VISUAL_OR_MEDIA_TAGS,
  'html',
  'body',
  'object',
  'embed',
  'source',
  'track',
  'hr',
  'svg',
]);

const INPUT_TAGS = new Set(['input', 'textarea', 'select']);
const MAX_NODES_PER_SLICE = 80;
const MAX_PENDING_QUEUE = 4000;
const MAX_HEALED_BEFORE_PRUNE = 400;
const MAX_SLICE_MS = 4;
const MUTATION_HEAL_DELAY_MS = 120;
const PRIORITY_LANDMARK_SELECTORS = [
  '[role="dialog"]',
  '[role="menu"]',
  'main, [role="main"]',
  'aside',
] as const;

const BORDER_SIDES = [
  ['borderTopWidth', 'borderTopColor'],
  ['borderBottomWidth', 'borderBottomColor'],
  ['borderLeftWidth', 'borderLeftColor'],
  ['borderRightWidth', 'borderRightColor'],
] as const;

export interface ThemeHealerOptions {
  readonly mediaPreserveSelectors?: readonly string[];
  readonly transparentShellSelectors?: readonly string[];
}

export interface ThemeHealer {
  /** Updates the active palette (or clears all healing when `null`) and optional native host polarity. */
  readonly setPalette: (palette: ThemePalette | null, hostScheme?: ThemeColorScheme) => void;
  /** Suppresses opaque background healing on transparent page-shell wrappers while a Studio backdrop is active. */
  readonly setBackdropActive: (active: boolean) => void;
  /** Runs an immediate bounded healing pass across the current document + open Shadow Roots. */
  readonly healNow: () => number;
  readonly dispose: () => void;
}

/** True when computed CSS hides `el` from visual rendering. */
export function isStyleHidden(style: CSSStyleDeclaration): boolean {
  return style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
}

/** True when `el` owns at least one non-whitespace direct text child node. */
export function hasDirectText(el: Element): boolean {
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE && (child.nodeValue?.trim().length ?? 0) > 0) {
      return true;
    }
  }
  return false;
}

/**
 * True for compact high-contrast interactive CTA pills (e.g. "Follow", "Post")
 * whose intentional inverted polarity should be preserved rather than flattened.
 * When `hostScheme` is known, rejects buttons whose background matches the host's
 * native surface polarity (e.g. ordinary dark-mode `#16181c` buttons on dark X
 * must be healed under a Light theme, while white `#eff3f4` pills stay inverted).
 */
export function isIntentionalInvertedPill(
  el: Element,
  bg: RgbaColor,
  fg: RgbaColor | null,
  rect?: DOMRect,
  hostScheme?: ThemeColorScheme,
): boolean {
  const tag = el.localName;
  const role = el.getAttribute('role');
  if (tag !== 'button' && tag !== 'a' && role !== 'button') {
    return false;
  }
  if (hostScheme !== undefined && colorSchemeOf(bg) === hostScheme) {
    return false;
  }
  if (fg && rgbaContrastRatio(fg, bg) >= 5.5) {
    const box = rect ?? el.getBoundingClientRect();
    if (box.width > 0 && box.height > 0 && box.height <= 64 && box.width <= 360) {
      return true;
    }
  }
  return false;
}

/**
 * Walks ancestors across Shadow DOM boundaries to compute the true opaque
 * backdrop color behind `el`, ending at `fallbackBg`. Accepts an optional
 * per-pass cache to avoid redundant `getComputedStyle` walks on shared ancestors.
 */
export function resolveEffectiveBackground(
  el: Element,
  view: Pick<Window, 'getComputedStyle'>,
  fallbackBg: RgbaColor,
  cache?: Map<Element, RgbaColor>,
): RgbaColor {
  const cached = cache?.get(el);
  if (cached) {
    return cached;
  }
  const chain: Array<{ node: Element; bg: RgbaColor | null }> = [];
  let current: Element | null = el;
  let base: RgbaColor = fallbackBg;
  let steps = 0;

  while (current && steps < 25) {
    steps++;
    const hit = cache?.get(current);
    if (hit) {
      base = hit;
      break;
    }
    const bg = parseCssColor(view.getComputedStyle(current).backgroundColor);
    const visible = bg && bg.a > 0.005 ? bg : null;
    chain.push({ node: current, bg: visible });
    if (visible && visible.a >= 0.99) {
      break;
    }
    current = parentAcrossShadows(current);
  }

  let backdrop = base;
  for (let i = chain.length - 1; i >= 0; i--) {
    const entry = chain[i];
    if (!entry) {
      continue;
    }
    if (entry.bg) {
      backdrop = compositeOver(entry.bg, backdrop);
    }
    cache?.set(entry.node, backdrop);
  }
  return backdrop;
}

const WHITE_RGBA: RgbaColor = { r: 255, g: 255, b: 255, a: 1 };
const DARK_RGBA: RgbaColor = { r: 17, g: 17, b: 17, a: 1 };

function buildHealerCss(palette: ThemePalette): string {
  // Single clean attribute selectors inside `@layer fs-healer` strictly outrank
  // `fs-finish`, `fs-reveal`, `fs-mapping`, and `fs-adaptive` without specificity hacks.
  return withThemeLayerOrder([
    wrapThemeLayer(
      'fs-healer',
      [
        `[${HEAL_BG_ATTR}="surface"] { background-color: ${palette.surface} !important; }`,
        `[${HEAL_BG_ATTR}="surface-alt"] { background-color: ${palette.surfaceAlt} !important; }`,
        `[${HEAL_FG_ATTR}="text"] { color: ${palette.text} !important; }`,
        `[${HEAL_FG_ATTR}="muted"] { color: ${palette.textMuted} !important; }`,
        `[${HEAL_FG_ATTR}="contrast-light"] { color: #ffffff !important; }`,
        `[${HEAL_FG_ATTR}="contrast-dark"] { color: #111111 !important; }`,
        `[${HEAL_BORDER_ATTR}="1"] { border-color: ${palette.border} !important; }`,
      ].join('\n'),
    ),
  ]);
}

type HealFgRole = 'muted' | 'text' | 'contrast-light' | 'contrast-dark';

interface PlannedHeal {
  readonly el: Element;
  readonly bgRole?: 'surface' | 'surface-alt';
  readonly fgRole?: HealFgRole;
  readonly border?: boolean;
}

/**
 * Creates a reversible, viewport-budgeted real-time self-healer bound to `env`.
 */
export function createThemeHealer(
  env: DomEnvironment,
  parentScope: Scope,
  options: ThemeHealerOptions = {},
): ThemeHealer {
  const scope = parentScope.child();
  const healedElements = new Set<Element>();
  const pendingQueue = new Set<Element>();
  const mediaSelector = options.mediaPreserveSelectors?.join(', ') ?? '';
  const shellSelectors = options.transparentShellSelectors ?? [];

  let activePalette: ThemePalette | null = null;
  let activeHostScheme: ThemeColorScheme | undefined;
  let backdropActive = false;
  let paletteBgRgba: RgbaColor = { r: 255, g: 255, b: 255, a: 1 };
  let paletteSurfaceRgba: RgbaColor = { r: 255, g: 255, b: 255, a: 1 };
  let paletteSurfaceAltRgba: RgbaColor = { r: 245, g: 245, b: 245, a: 1 };
  let paletteTextRgba: RgbaColor = { r: 0, g: 0, b: 0, a: 1 };
  let paletteMutedRgba: RgbaColor = { r: 100, g: 100, b: 100, a: 1 };
  let removeStyle: (() => void) | undefined;
  let scheduledHandle: { readonly kind: 'idle' | 'timeout'; readonly id: number } | undefined;
  let disposed = false;

  const isTransparentShell = (el: Element): boolean => {
    if (!backdropActive) {
      return false;
    }
    if (el.hasAttribute(SHELL_ATTR)) {
      return true;
    }
    if (shellSelectors.length === 0) {
      return false;
    }
    for (const sel of shellSelectors) {
      try {
        if (el.matches(sel)) {
          return true;
        }
      } catch {
        // Ignore selectors unsupported by non-browser test DOM engines (e.g. `:has()`).
      }
    }
    return false;
  };

  const isSelfExcluded = (el: Element): boolean => {
    if (el.namespaceURI === SVG_NS || HEAL_SKIP_TAGS.has(el.localName) || isOwnUiElement(el)) {
      return true;
    }
    if (mediaSelector) {
      try {
        if (el.matches(mediaSelector)) {
          return true;
        }
      } catch {
        // Ignore invalid custom media preserve selector.
      }
    }
    return false;
  };

  const isEntryExcluded = (el: Element): boolean => {
    if (isSelfExcluded(el) || el.closest(`[${OWN_ATTR}], ${OWN_UI_TAG}`)) {
      return true;
    }
    if (mediaSelector) {
      try {
        if (el.closest(mediaSelector)) {
          return true;
        }
      } catch {
        // Ignore invalid custom media preserve selector.
      }
    }
    return false;
  };

  const clearElementHeal = (el: Element): void => {
    el.removeAttribute(HEAL_BG_ATTR);
    el.removeAttribute(HEAL_FG_ATTR);
    el.removeAttribute(HEAL_BORDER_ATTR);
  };

  const pruneHealed = (): void => {
    if (healedElements.size < MAX_HEALED_BEFORE_PRUNE) {
      return;
    }
    for (const el of healedElements) {
      if (!el.isConnected) {
        healedElements.delete(el);
      }
    }
  };

  const clearAllHeals = (): void => {
    for (const el of healedElements) {
      clearElementHeal(el);
    }
    healedElements.clear();
    pendingQueue.clear();
  };

  const cancelScheduled = (): void => {
    if (scheduledHandle === undefined) {
      return;
    }
    if (scheduledHandle.kind === 'idle' && typeof globalThis.cancelIdleCallback === 'function') {
      globalThis.cancelIdleCallback(scheduledHandle.id);
    } else {
      clearTimeout(scheduledHandle.id);
    }
    scheduledHandle = undefined;
  };

  // Pure read phase: computes needed attribute writes without mutating the DOM.
  const planElementHeal = (
    el: Element,
    bgCache: Map<Element, RgbaColor>,
    checkAncestors: boolean,
  ): PlannedHeal | null => {
    const palette = activePalette;
    if (!palette || !el.isConnected) {
      return null;
    }
    if (checkAncestors ? isEntryExcluded(el) : isSelfExcluded(el)) {
      return null;
    }
    const view = el.ownerDocument?.defaultView ?? env.doc.defaultView ?? globalThis;
    const style = view.getComputedStyle(el);
    if (isStyleHidden(style)) {
      return null;
    }

    const bg = parseCssColor(style.backgroundColor);
    const fg = parseCssColor(style.color);

    const existingBgRole = el.getAttribute(HEAL_BG_ATTR);
    let bgRole: 'surface' | 'surface-alt' | undefined;
    if (
      bg &&
      !isTransparentShell(el) &&
      isOppositePolarityNeutral(bg, palette.colorScheme) &&
      !isIntentionalInvertedPill(el, bg, fg, undefined, activeHostScheme)
    ) {
      const role = el.getAttribute('role') ?? '';
      const desiredBgRole =
        INPUT_TAGS.has(el.localName) || role === 'searchbox' || role === 'combobox'
          ? 'surface-alt'
          : 'surface';
      // Only treat as a pending background change when not already stamped with the
      // same role; if the role is already present yet the computed background is still
      // opposite-polarity (e.g. inline `!important`), leave `plannedBg` unset so text
      // contrast resolves against the true computed backdrop.
      if (desiredBgRole !== existingBgRole) {
        bgRole = desiredBgRole;
      }
    }

    // Seed `bgCache` with the newly planned healed background immediately so descendant
    // text nodes inspected in the same pre-order pass compute contrast against the
    // post-heal surface rather than the stale pre-heal dark/light container.
    let plannedBg: RgbaColor | undefined;
    if (bgRole === 'surface-alt') {
      plannedBg = paletteSurfaceAltRgba;
      bgCache.set(el, plannedBg);
    } else if (bgRole === 'surface') {
      plannedBg = paletteSurfaceRgba;
      bgCache.set(el, plannedBg);
    }

    let fgRole: HealFgRole | undefined;
    if (fg && fg.a >= 0.3 && (INPUT_TAGS.has(el.localName) || hasDirectText(el))) {
      const effectiveBg = plannedBg ?? resolveEffectiveBackground(el, view, paletteBgRgba, bgCache);
      const ratio = rgbaContrastRatio(fg, effectiveBg);
      const fontSize = Number.parseFloat(style.fontSize || '14');
      const fontWeight = Number.parseInt(style.fontWeight || '400', 10);
      const isLarge = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
      const minRatio = isLarge ? 3.0 : 4.5;
      if (ratio < minRatio) {
        const fgOklch = rgbToOklch(fg);
        const isNeutral = isNeutralColor(fg, 0.045, fgOklch);
        const wasMuted = isNeutral && fgOklch.L > 0.3 && fgOklch.L < 0.72;
        const mutedRatio = rgbaContrastRatio(paletteMutedRgba, effectiveBg);
        const textRatio = rgbaContrastRatio(paletteTextRgba, effectiveBg);
        if (wasMuted && mutedRatio >= minRatio) {
          fgRole = 'muted';
        } else if (textRatio >= minRatio) {
          fgRole = 'text';
        } else {
          // When even `palette.text` fails WCAG AA against this backdrop (e.g. a
          // high-chroma custom theme or chromatic link collision), fall back to
          // crisp `#ffffff` or `#111111` — whichever maximizes readability.
          const whiteRatio = rgbaContrastRatio(WHITE_RGBA, effectiveBg);
          const darkRatio = rgbaContrastRatio(DARK_RGBA, effectiveBg);
          const bestFallbackRole: HealFgRole =
            whiteRatio >= darkRatio ? 'contrast-light' : 'contrast-dark';
          const bestFallbackRatio = Math.max(whiteRatio, darkRatio);
          if (bestFallbackRatio > ratio + 0.5) {
            fgRole = bestFallbackRole;
          } else if (textRatio > ratio + 0.5) {
            fgRole = 'text';
          }
        }
      }
    }

    let border = false;
    for (const [widthProp, colorProp] of BORDER_SIDES) {
      if (Number.parseFloat(style[widthProp] || '0') <= 0) {
        continue;
      }
      const borderCol = parseCssColor(style[colorProp]);
      if (borderCol && isOppositePolarityNeutral(borderCol, palette.colorScheme)) {
        border = true;
        break;
      }
    }

    if (!bgRole && !fgRole && !border) {
      return null;
    }
    return {
      el,
      ...(bgRole ? { bgRole } : {}),
      ...(fgRole ? { fgRole } : {}),
      ...(border ? { border } : {}),
    };
  };

  // Batched write phase: applies all planned attribute updates in one sweep (zero layout thrash).
  const applyPlans = (plans: readonly PlannedHeal[]): number => {
    let applied = 0;
    for (const plan of plans) {
      let touched = false;
      if (plan.bgRole && plan.el.getAttribute(HEAL_BG_ATTR) !== plan.bgRole) {
        plan.el.setAttribute(HEAL_BG_ATTR, plan.bgRole);
        touched = true;
      }
      if (plan.fgRole && plan.el.getAttribute(HEAL_FG_ATTR) !== plan.fgRole) {
        plan.el.setAttribute(HEAL_FG_ATTR, plan.fgRole);
        touched = true;
      }
      if (plan.border && plan.el.getAttribute(HEAL_BORDER_ATTR) !== '1') {
        plan.el.setAttribute(HEAL_BORDER_ATTR, '1');
        touched = true;
      }
      if (touched) {
        healedElements.add(plan.el);
        applied++;
      }
    }
    pruneHealed();
    return applied;
  };

  const enqueueSubtree = (
    root: ParentNode,
    limit = 160,
    opts?: {
      readonly visitedShadows?: Set<ShadowRoot>;
      readonly completedSubtrees?: Set<Element>;
      readonly delayMs?: number;
    },
  ): boolean => {
    if (!activePalette || disposed || pendingQueue.size >= MAX_PENDING_QUEUE) {
      return false;
    }
    const visitedShadows = opts?.visitedShadows;
    const completedSubtrees = opts?.completedSubtrees;
    let added = 0;
    let truncated = false;
    const visit = (node: ParentNode): void => {
      if (added >= limit || pendingQueue.size >= MAX_PENDING_QUEUE) {
        truncated = true;
        return;
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element;
        if (completedSubtrees?.has(el)) {
          return;
        }
        if (el.localName !== 'body' && el.localName !== 'html') {
          if (isSelfExcluded(el)) {
            return;
          }
          if (!pendingQueue.has(el)) {
            pendingQueue.add(el);
            added++;
          }
          if (el.shadowRoot && !visitedShadows?.has(el.shadowRoot)) {
            visit(el.shadowRoot);
            if (!truncated) {
              visitedShadows?.add(el.shadowRoot);
            }
          }
        }
      }
      for (const child of node.children) {
        if (added >= limit || pendingQueue.size >= MAX_PENDING_QUEUE) {
          truncated = true;
          return;
        }
        visit(child);
      }
    };
    visit(root);
    scheduleFlush(opts?.delayMs);
    return !truncated;
  };

  const flushSlice = (deadline?: IdleDeadline): void => {
    scheduledHandle = undefined;
    if (!activePalette || disposed || pendingQueue.size === 0) {
      return;
    }
    const started = performance.now();
    const budgetMs = deadline
      ? Math.min(MAX_SLICE_MS, Math.max(1, deadline.timeRemaining()))
      : MAX_SLICE_MS;
    const bgCache = new Map<Element, RgbaColor>();
    const plans: PlannedHeal[] = [];
    let processed = 0;
    for (const el of pendingQueue) {
      pendingQueue.delete(el);
      if (el.isConnected) {
        const plan = planElementHeal(el, bgCache, true);
        if (plan) {
          plans.push(plan);
        }
      }
      processed++;
      if (processed >= MAX_NODES_PER_SLICE || performance.now() - started >= budgetMs) {
        break;
      }
    }
    applyPlans(plans);
    if (pendingQueue.size > 0) {
      scheduleFlush();
    }
  };

  const scheduleFlush = (delayMs = 0): void => {
    if (scheduledHandle !== undefined || disposed || !activePalette || pendingQueue.size === 0) {
      return;
    }
    if (delayMs > 0) {
      scheduledHandle = {
        kind: 'timeout',
        id: Number(
          setTimeout(() => {
            scheduledHandle = undefined;
            scheduleFlush();
          }, delayMs),
        ),
      };
      return;
    }
    if (typeof globalThis.requestIdleCallback === 'function') {
      scheduledHandle = {
        kind: 'idle',
        id: globalThis.requestIdleCallback((deadline) => flushSlice(deadline), { timeout: 400 }),
      };
      return;
    }
    scheduledHandle = { kind: 'timeout', id: Number(setTimeout(() => flushSlice(), 16)) };
  };

  const enqueueAddedElement = (el: Element): void => {
    if (
      !activePalette ||
      disposed ||
      pendingQueue.size >= MAX_PENDING_QUEUE ||
      isEntryExcluded(el)
    ) {
      return;
    }
    // Defer mutation-driven `getComputedStyle` healing briefly so short
    // click/heart micro-animations finish smoothly without synchronous style recalc.
    if (el.childElementCount > 0 || el.shadowRoot) {
      enqueueSubtree(el, 80, { delayMs: MUTATION_HEAL_DELAY_MS });
    } else {
      pendingQueue.add(el);
      scheduleFlush(MUTATION_HEAL_DELAY_MS);
    }
  };

  scope.add(env.watcher.watchTree({ added: enqueueAddedElement }));

  scope.add(
    env.onShadowRoot((shadow, rootScope) => {
      if (isOwnUiElement(shadow.host)) {
        return;
      }
      if (activePalette) {
        enqueueSubtree(shadow, 100);
      }
      // Reuse DomEnvironment's existing per-ShadowRoot PageWatcher instead of creating
      // a duplicate MutationObserver on every open ShadowRoot.
      const shadowWatcher = env.shadowWatcherOf(shadow);
      if (!shadowWatcher) {
        return;
      }
      const stopShadowWatch = shadowWatcher.watchTree({ added: enqueueAddedElement });
      // Chain disposers so disconnecting a ShadowRoot immediately removes its cleanup
      // from `scope` without retaining the ShadowRoot closure until full healer dispose.
      const unbindScope = scope.add(stopShadowWatch);
      rootScope.add(unbindScope);
    }),
  );

  const healNow = (): number => {
    if (!activePalette || disposed) {
      return 0;
    }
    const bgCache = new Map<Element, RgbaColor>();
    const visitedShadows = new Set<ShadowRoot>();
    const plans: PlannedHeal[] = [];

    const walkAndPlan = (root: ParentNode): void => {
      if (root.nodeType === Node.ELEMENT_NODE) {
        const el = root as Element;
        if (el.localName !== 'body' && el.localName !== 'html') {
          if (isSelfExcluded(el)) {
            return;
          }
          const plan = planElementHeal(el, bgCache, false);
          if (plan) {
            plans.push(plan);
          }
          if (el.shadowRoot && !visitedShadows.has(el.shadowRoot)) {
            visitedShadows.add(el.shadowRoot);
            walkAndPlan(el.shadowRoot);
          }
        }
      }
      for (const child of root.children) {
        walkAndPlan(child);
      }
    };

    if (env.doc.body) {
      walkAndPlan(env.doc.body);
    }
    for (const shadow of env.shadowRoots) {
      if (shadow.host.isConnected && !isOwnUiElement(shadow.host) && !visitedShadows.has(shadow)) {
        visitedShadows.add(shadow);
        walkAndPlan(shadow);
      }
    }
    pendingQueue.clear();
    return applyPlans(plans);
  };

  scope.add(() => {
    disposed = true;
    cancelScheduled();
    removeStyle?.();
    removeStyle = undefined;
    clearAllHeals();
  });

  const enqueueDocumentPrioritized = (): void => {
    const visitedShadows = new Set<ShadowRoot>();
    const completedSubtrees = new Set<Element>();
    if (env.doc.body) {
      // Queue primary content, sidebars, and active overlays FIRST so visible surfaces
      // heal in the very first 4ms idle slice on already-loaded tabs, then cover the
      // remainder of the document cleanly in subsequent budgeted slices.
      for (const selector of PRIORITY_LANDMARK_SELECTORS) {
        const landmark = env.doc.querySelector(selector);
        if (
          landmark &&
          !completedSubtrees.has(landmark) &&
          enqueueSubtree(landmark, 1200, { visitedShadows, completedSubtrees })
        ) {
          completedSubtrees.add(landmark);
        }
      }
      enqueueSubtree(env.doc.body, MAX_PENDING_QUEUE, { visitedShadows, completedSubtrees });
    }
    for (const shadow of env.shadowRoots) {
      if (shadow.host.isConnected && !isOwnUiElement(shadow.host) && !visitedShadows.has(shadow)) {
        visitedShadows.add(shadow);
        enqueueSubtree(shadow, 400, { visitedShadows, completedSubtrees });
      }
    }
  };

  return {
    setPalette(palette, hostScheme) {
      const nextHostScheme = palette ? hostScheme : undefined;
      if (
        disposed ||
        (!palette && !activePalette) ||
        (samePalette(palette, activePalette) && nextHostScheme === activeHostScheme)
      ) {
        return;
      }
      cancelScheduled();
      removeStyle?.();
      removeStyle = undefined;
      clearAllHeals();
      activePalette = palette;
      activeHostScheme = nextHostScheme;
      if (!palette) {
        return;
      }
      paletteBgRgba = parseCssColor(palette.background) ?? paletteBgRgba;
      paletteSurfaceRgba = parseCssColor(palette.surface) ?? paletteSurfaceRgba;
      paletteSurfaceAltRgba = parseCssColor(palette.surfaceAlt) ?? paletteSurfaceAltRgba;
      paletteTextRgba = parseCssColor(palette.text) ?? paletteTextRgba;
      paletteMutedRgba = parseCssColor(palette.textMuted) ?? paletteMutedRgba;
      removeStyle = addStyleAcrossRoots(scope, HEALER_STYLE_ID, buildHealerCss(palette), {
        doc: env.doc,
        env,
      });
      enqueueDocumentPrioritized();
    },
    setBackdropActive(active) {
      if (disposed || backdropActive === active) {
        return;
      }
      backdropActive = active;
      if (active) {
        for (const el of healedElements) {
          if (el.isConnected && el.hasAttribute(HEAL_BG_ATTR) && isTransparentShell(el)) {
            el.removeAttribute(HEAL_BG_ATTR);
          }
        }
      } else if (activePalette && env.doc.body) {
        enqueueDocumentPrioritized();
      }
    },
    healNow,
    dispose() {
      scope.dispose();
    },
  };
}
