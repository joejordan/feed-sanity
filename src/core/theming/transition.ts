import { OWN_ATTR } from '../surface';
import { THEME_LAYER_ORDER, wrapThemeLayer } from './types';

/** Style ID for the short-lived theme transition sheet (auto-removed after completion). */
export const THEME_TRANSITION_STYLE_ID = 'feed_sanity_theme_transition';

/** Duration (ms) for smooth palette & live-scene crossfade transitions. */
export const THEME_TRANSITION_MS = 800;
/** Shared easing curve for smooth palette morphs and live backdrop crossfades. */
export const THEME_TRANSITION_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
/** Delay (ms) before stripping temporary transition stylesheets after a morph settles. */
export const THEME_TRANSITION_CLEANUP_MS = THEME_TRANSITION_MS + 90;

/**
 * GPU-composited View Transition rules injected only while `document.startViewTransition()`
 * is running. Uses zero DOM element selectors (zero per-node style recalc / animation
 * overhead on large feeds) and keeps `pointer-events: none` so the Settings dialog stays
 * immediately interactive during the crossfade.
 */
export const VIEW_TRANSITION_CSS = `${THEME_LAYER_ORDER}\n\n${wrapThemeLayer(
  'fs-user',
  `::view-transition,
::view-transition-group(*),
::view-transition-image-pair(*),
::view-transition-old(*),
::view-transition-new(*) {
  pointer-events: none !important;
}
::view-transition-old(*),
::view-transition-new(*) {
  animation-duration: ${THEME_TRANSITION_MS}ms;
  animation-timing-function: ${THEME_TRANSITION_EASING};
}`,
)}`;

/**
 * Lightweight fallback transition CSS used only when `document.startViewTransition`
 * is unavailable. Restricted strictly to top-level structural landmarks (~5-10 nodes)
 * so it never allocates thousands of main-thread CSS transitions across feed DOM trees.
 */
export const HOST_THEME_TRANSITION_CSS = `${THEME_LAYER_ORDER}\n\n${wrapThemeLayer(
  'fs-user',
  `html, body, main, aside, nav, header, footer {
  transition-property: background-color, color, border-color !important;
  transition-duration: ${THEME_TRANSITION_MS}ms !important;
  transition-timing-function: ${THEME_TRANSITION_EASING} !important;
}`,
)}`;

/** Scoped color morph rules for Feed Sanity's own Shadow DOM / standalone Settings chrome. */
export const UI_THEME_TRANSITION_CSS = `.dialog, .sidebar, .pane, .pane-header, .site-header, .site-mark, .site-menu, .search-trigger, .nav-active-pill, .section, .section-icon, .fs-card, .fs-row, .fs-disclosure-trigger, .button, .field, .theme-card, .theme-vibe-card, .theme-library-card, .qp-root, .qp-brand-bar, .qp-header, .qp-footer, .qp-btn {
  transition-property: background-color, color, border-color, box-shadow;
  transition-duration: ${THEME_TRANSITION_MS}ms;
  transition-timing-function: ${THEME_TRANSITION_EASING};
}`;

/** True when smooth theme animations are allowed on `doc` (visible tab, motion not reduced). */
export function canAnimateThemeTransition(doc: Document | undefined): boolean {
  if (!doc || doc.hidden) {
    return false;
  }
  const view = doc.defaultView ?? globalThis;
  const reduced = view.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
  return !reduced;
}

interface ViewTransitionLike {
  readonly ready?: Promise<unknown>;
  readonly finished?: Promise<unknown>;
  readonly skipTransition?: () => void;
}

type DocumentWithViewTransition = Document & {
  startViewTransition?: (updateCallback: () => void | Promise<void>) => ViewTransitionLike;
};

export type ThemeTransitionMode = 'view-transition' | 'css' | 'none';

export interface ThemeTransitionRunOptions {
  /** Whether this update should animate at all (false on initial boot or slider tweaks). */
  readonly animate: boolean;
  /** Roots to receive the lightweight landmark CSS fallback when `startViewTransition` is absent. */
  readonly fallbackRoots?: Iterable<Document | ShadowRoot>;
  /** Invoked once the transition finishes and DOM styles have settled. */
  readonly onSettled?: () => void;
}

export interface ThemeTransitionDriver {
  /**
   * Executes `applyDom` inside a GPU-composited `document.startViewTransition` when supported
   * and `animate` is true, otherwise falls back to a tiny landmark-only CSS transition.
   */
  readonly run: (
    applyDom: (mode: ThemeTransitionMode) => void,
    options: ThemeTransitionRunOptions,
  ) => ThemeTransitionMode;
  /** True while a `startViewTransition` `applyDom` callback is still queued for the next frame. */
  readonly hasPendingApply: () => boolean;
  /** Synchronously applies any queued `applyDom` callback, skips any running View Transition, and runs `onSettled`. */
  readonly flush: () => void;
  /** Cancels active View Transitions and removes transition sheets without running pending callbacks. */
  readonly cancel: () => void;
}

/**
 * Attaches or updates `#feed_sanity_theme_transition` inside `root`, creating the `<style>`
 * in `root`'s own `Document` so same-origin iframes and shadow roots stay realm-safe.
 */
export function attachTransitionStyle(
  fallbackDoc: Document,
  root: Document | ShadowRoot,
  cssText: string,
  activeStyles: Map<Document | ShadowRoot, HTMLStyleElement>,
): HTMLStyleElement | undefined {
  let style = activeStyles.get(root);
  if (!style?.isConnected) {
    const ownerDoc =
      root.nodeType === Node.DOCUMENT_NODE
        ? (root as Document)
        : (root.ownerDocument ?? fallbackDoc);
    style =
      root.querySelector<HTMLStyleElement>(`#${THEME_TRANSITION_STYLE_ID}`) ??
      ownerDoc.createElement('style');
    style.id = THEME_TRANSITION_STYLE_ID;
    style.setAttribute(OWN_ATTR, 'theme-transition');
    const container =
      root.nodeType === Node.DOCUMENT_NODE
        ? ((root as Document).head ?? (root as Document).documentElement)
        : root;
    if (!container) {
      return undefined;
    }
    container.append(style);
    activeStyles.set(root, style);
  }
  if (style.textContent !== cssText) {
    style.textContent = cssText;
  }
  return style;
}

/**
 * Coordinates zero-lockup GPU-composited theme transitions via `document.startViewTransition`
 * (with a tiny landmark-only CSS fallback when View Transitions are unavailable).
 */
export function createThemeTransitionDriver(doc: Document): ThemeTransitionDriver {
  const activeStyles = new Map<Document | ShadowRoot, HTMLStyleElement>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let activeVt: ViewTransitionLike | undefined;
  let pendingApply: (() => void) | undefined;
  let pendingSettled: (() => void) | undefined;
  let seq = 0;

  const clearTimer = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const removeStyles = (): void => {
    for (const style of activeStyles.values()) {
      style.remove();
    }
    activeStyles.clear();
  };

  const runSettledOnce = (): void => {
    const settled = pendingSettled;
    pendingSettled = undefined;
    settled?.();
  };

  const teardown = (runPending: boolean, keepStyles = false): void => {
    seq++;
    clearTimer();
    const queuedApply = pendingApply;
    pendingApply = undefined;
    const vt = activeVt;
    activeVt = undefined;
    if (vt) {
      try {
        vt.skipTransition?.();
      } catch {
        // Ignore already-finished View Transitions.
      }
    }
    if (!keepStyles) {
      removeStyles();
    }
    if (runPending) {
      queuedApply?.();
      runSettledOnce();
    } else {
      pendingSettled = undefined;
    }
  };

  return {
    run(applyDom, { animate, fallbackRoots, onSettled }) {
      if (!animate || !canAnimateThemeTransition(doc)) {
        teardown(false);
        applyDom('none');
        onSettled?.();
        return 'none';
      }

      const vtDoc = doc as DocumentWithViewTransition;
      const useViewTransition = typeof vtDoc.startViewTransition === 'function';
      // Reuse already-connected transition `<style>` when superseding an animated switch.
      teardown(false, useViewTransition);
      const token = ++seq;
      pendingSettled = onSettled;

      const finish = (applyIfNeeded?: () => void): void => {
        if (token !== seq) {
          return;
        }
        clearTimer();
        activeVt = undefined;
        pendingApply = undefined;
        applyIfNeeded?.();
        removeStyles();
        runSettledOnce();
      };

      if (useViewTransition) {
        attachTransitionStyle(doc, doc, VIEW_TRANSITION_CSS, activeStyles);

        let applied = false;
        const applyOnce = (): void => {
          if (applied) {
            return;
          }
          applied = true;
          pendingApply = undefined;
          applyDom('view-transition');
        };
        pendingApply = applyOnce;

        let vt: ViewTransitionLike;
        try {
          vt = vtDoc.startViewTransition!(() => {
            if (token !== seq) {
              return;
            }
            applyOnce();
          });
        } catch {
          pendingApply = undefined;
          removeStyles();
          if (!applied) {
            applied = true;
            applyDom('none');
          }
          runSettledOnce();
          return 'none';
        }

        activeVt = vt;
        // Run `onSettled` (deferred ThemeHealer pass) ONLY when the 800ms GPU crossfade
        // finishes so healer DOM walks/mutations never contend with or re-rasterize the fade.
        const onFinish = (): void => finish(applyOnce);
        void vt.ready?.catch(() => undefined);
        void vt.finished?.then(onFinish, onFinish);
        timer = setTimeout(onFinish, THEME_TRANSITION_CLEANUP_MS + 500);
        return 'view-transition';
      }

      // Fallback for environments without `document.startViewTransition`:
      // transition only top-level landmarks (~5-10 nodes, < 1ms) so large feeds never hitch.
      const roots = fallbackRoots ?? [doc];
      for (const root of roots) {
        attachTransitionStyle(doc, root, HOST_THEME_TRANSITION_CSS, activeStyles);
      }
      applyDom('css');
      timer = setTimeout(() => finish(), THEME_TRANSITION_CLEANUP_MS);
      return 'css';
    },
    hasPendingApply: () => pendingApply !== undefined,
    flush: () => teardown(true),
    cancel: () => teardown(false),
  };
}
