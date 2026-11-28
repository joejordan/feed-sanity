// Coordinates live backdrop mounting, updates, click effects, and zero-residue
// teardown for one host `Document`.

import type { ThemeColorScheme, ThemePalette } from '../theming';
import type { BackdropInstance } from './backdrops';
import type { BackdropEffectId, ThemeEffectsConfig } from './model';
import { OWN_ATTR } from '../surface';
import {
  canAnimateThemeTransition,
  THEME_TRANSITION_EASING,
  THEME_TRANSITION_MS,
} from '../theming/transition';
import { BACKDROP_REGISTRY } from './backdrops';
import { mountClickEffects } from './click-fx';
import { DEFAULT_THEME_EFFECTS, getSurfaceParamSpecs, resolveEffectParams } from './model';
import { BACKDROP_OWN_VALUE, PRISM_ANGLE_VAR } from './surfaces';

const BACKDROP_FADE_MS = THEME_TRANSITION_MS + 50;
const BACKDROP_FADE_CLEANUP_MS = BACKDROP_FADE_MS + 60;
const BACKDROP_FADE_TRANSITION = `opacity ${BACKDROP_FADE_MS}ms ${THEME_TRANSITION_EASING}`;
const BACKDROP_EXITING_OWN_VALUE = 'theme-backdrop-exiting';

export interface EffectsSyncOptions {
  /** Smoothly crossfades live backdrop switches (~0.9s) when motion is allowed. */
  readonly transition?: boolean;
}

export interface EffectsLayerController {
  sync: (
    effects: ThemeEffectsConfig | undefined,
    palette: ThemePalette | null,
    hostScheme: ThemeColorScheme,
    options?: EffectsSyncOptions,
  ) => void;
  /** True when the live backdrop container is currently connected to the host document. */
  isBackdropConnected: () => boolean;
  dispose: () => void;
}

/**
 * Lightweight rAF-coalesced pointer angle driver for `surface: 'prism'`.
 * Zero `getBoundingClientRect()` or DOM queries; quantizes to 4deg steps at
 * ~15 Hz, pauses during scroll, skips touch/hidden tabs, reacts to OS
 * reduced-motion changes, and cleans up immediately when Prism is off or disposed.
 */
const DEFAULT_PRISM_ANGLE = 132;
const DEFAULT_PRISM_SWEEP = 56;
const PRISM_MIN_FLUSH_MS = 66;
const PRISM_SCROLL_PAUSE_MS = 150;

function createPrismLightDriver(doc: Document) {
  const win = doc.defaultView ?? globalThis;
  let active = false;
  let wanted = false;
  let baseAngle = DEFAULT_PRISM_ANGLE;
  let sweep = DEFAULT_PRISM_SWEEP;
  let rafId = 0;
  let rafUsesTimeout = false;
  let lastClientX = -1;
  let lastClientY = -1;
  let lastAngle = -1;
  let lastFlushAt = 0;
  let scrollPausedUntil = 0;
  const reducedMotion = doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)');

  const flush = (): void => {
    rafId = 0;
    if (!active || doc.hidden || lastClientX < 0) {
      return;
    }
    const now = performance.now();
    const throttleWait = lastFlushAt === 0 ? 0 : PRISM_MIN_FLUSH_MS - (now - lastFlushAt);
    const waitMs = Math.max(scrollPausedUntil - now, throttleWait);
    if (waitMs > 0) {
      rafUsesTimeout = true;
      rafId = Number(win.setTimeout(flush, Math.ceil(waitMs)));
      return;
    }
    if (win.innerWidth <= 0 || win.innerHeight <= 0) {
      return;
    }
    const nx = Math.min(1, Math.max(0, lastClientX / win.innerWidth));
    const ny = Math.min(1, Math.max(0, lastClientY / win.innerHeight));
    // Maps viewport coordinates to a 4deg-quantized specular sheen angle centered on `baseAngle`.
    const rawAngle = baseAngle + (nx - 0.5) * sweep + (ny - 0.5) * (sweep * 0.4);
    const normalized = ((rawAngle % 360) + 360) % 360;
    const nextAngle = Math.round(normalized / 4) * 4;
    if (nextAngle === lastAngle) {
      return;
    }
    lastAngle = nextAngle;
    lastFlushAt = now;
    doc.documentElement?.style.setProperty(PRISM_ANGLE_VAR, `${nextAngle}deg`);
  };

  const onMove = (event: PointerEvent): void => {
    if (event.pointerType === 'touch' || doc.hidden) {
      return;
    }
    lastClientX = event.clientX;
    lastClientY = event.clientY;
    if (rafId === 0) {
      if (typeof win.requestAnimationFrame === 'function') {
        rafUsesTimeout = false;
        rafId = win.requestAnimationFrame(flush);
      } else {
        rafUsesTimeout = true;
        rafId = Number(win.setTimeout(flush, 16));
      }
    }
  };

  const onScroll = (): void => {
    scrollPausedUntil = performance.now() + PRISM_SCROLL_PAUSE_MS;
  };

  const cancelPendingAngle = (): void => {
    if (rafId !== 0) {
      if (rafUsesTimeout) {
        win.clearTimeout(rafId);
      } else {
        win.cancelAnimationFrame(rafId);
      }
      rafId = 0;
    }
    lastClientX = -1;
    lastClientY = -1;
    lastAngle = -1;
    lastFlushAt = 0;
    scrollPausedUntil = 0;
    doc.documentElement?.style.removeProperty(PRISM_ANGLE_VAR);
  };

  const stop = (): void => {
    if (!active) {
      return;
    }
    active = false;
    doc.removeEventListener('pointermove', onMove);
    win.removeEventListener('scroll', onScroll);
    cancelPendingAngle();
  };

  const reconcile = (): void => {
    const shouldRun = wanted && sweep > 0 && !(reducedMotion?.matches ?? false);
    if (shouldRun === active) {
      return;
    }
    if (!shouldRun) {
      stop();
      return;
    }
    active = true;
    doc.addEventListener('pointermove', onMove, { passive: true });
    win.addEventListener('scroll', onScroll, { passive: true });
  };

  reducedMotion?.addEventListener?.('change', reconcile);

  return {
    sync(
      enabled: boolean,
      nextBaseAngle = DEFAULT_PRISM_ANGLE,
      nextSweep = DEFAULT_PRISM_SWEEP,
    ): void {
      const angleChanged = nextBaseAngle !== baseAngle;
      wanted = enabled;
      baseAngle = nextBaseAngle;
      sweep = nextSweep;
      reconcile();
      if (active && angleChanged) {
        // Clear any stale inline pointer angle so the updated CSS fallback angle applies immediately.
        cancelPendingAngle();
      }
    },
    dispose(): void {
      wanted = false;
      reducedMotion?.removeEventListener?.('change', reconcile);
      stop();
    },
  };
}

export function createEffectsLayerController(doc: Document): EffectsLayerController {
  const win = doc.defaultView ?? globalThis;
  let backdropHost: HTMLDivElement | null = null;
  let activeBackdropId: BackdropEffectId = 'none';
  let activeBackdrop: BackdropInstance | null = null;
  let exitingHost: HTMLDivElement | null = null;
  let exitingBackdrop: BackdropInstance | null = null;
  let exitingTimer: ReturnType<typeof setTimeout> | undefined;
  let fadeRafId = 0;
  let targetHostOpacity = 1;
  let disposed = false;

  const prismLight = createPrismLightDriver(doc);
  const clickFx = mountClickEffects(doc, (normX, normY) => {
    activeBackdrop?.burst?.(normX, normY);
  });

  const cancelFadeRaf = (): void => {
    if (fadeRafId !== 0) {
      win.cancelAnimationFrame?.(fadeRafId);
      fadeRafId = 0;
    }
  };

  const clearActiveFadeStyle = (): void => {
    if (backdropHost) {
      backdropHost.style.transition = '';
      backdropHost.style.willChange = '';
    }
  };

  const flushExiting = (): void => {
    if (exitingTimer !== undefined) {
      clearTimeout(exitingTimer);
      exitingTimer = undefined;
    }
    if (fadeRafId !== 0) {
      cancelFadeRaf();
      if (backdropHost) {
        backdropHost.style.opacity = String(targetHostOpacity);
      }
    }
    clearActiveFadeStyle();
    exitingBackdrop?.destroy();
    exitingBackdrop = null;
    exitingHost?.remove();
    exitingHost = null;
  };

  const stripRendererAttrs = (el: HTMLElement): void => {
    el.removeAttribute('data-fs-backdrop');
    el.removeAttribute('data-fs-renderer');
    for (const child of el.querySelectorAll('[data-fs-renderer], [data-fs-backdrop]')) {
      child.removeAttribute('data-fs-renderer');
      child.removeAttribute('data-fs-backdrop');
    }
  };

  const createBackdropHost = (
    opacity: number,
    insertAfter?: HTMLDivElement | null,
  ): HTMLDivElement | null => {
    if (disposed) {
      return null;
    }
    const target = doc.body ?? doc.documentElement;
    if (!target) {
      return null;
    }
    const host = doc.createElement('div');
    host.setAttribute(OWN_ATTR, BACKDROP_OWN_VALUE);
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = `position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden;contain:strict;opacity:${opacity};`;
    if (insertAfter?.isConnected) {
      insertAfter.after(host);
    } else {
      target.prepend(host);
    }
    return host;
  };

  const promoteActiveToExiting = (): HTMLDivElement | null => {
    if (!activeBackdrop || !backdropHost?.isConnected) {
      return null;
    }
    const host = backdropHost;
    const instance = activeBackdrop;
    backdropHost = null;
    activeBackdrop = null;
    activeBackdropId = 'none';
    host.setAttribute(OWN_ATTR, BACKDROP_EXITING_OWN_VALUE);
    host.setAttribute('data-fs-exiting', 'true');
    host.style.willChange = 'opacity';
    stripRendererAttrs(host);
    exitingHost = host;
    exitingBackdrop = instance;
    return host;
  };

  const teardownBackdrop = (animate = false): void => {
    cancelFadeRaf();
    flushExiting();
    if (animate) {
      const outgoing = promoteActiveToExiting();
      if (outgoing) {
        if (typeof win.requestAnimationFrame === 'function') {
          fadeRafId = win.requestAnimationFrame(() => {
            fadeRafId = 0;
            if (!disposed && exitingHost === outgoing) {
              outgoing.style.transition = BACKDROP_FADE_TRANSITION;
              outgoing.style.opacity = '0';
            }
          });
        } else {
          outgoing.style.transition = BACKDROP_FADE_TRANSITION;
          outgoing.style.opacity = '0';
        }
        exitingTimer = setTimeout(flushExiting, BACKDROP_FADE_CLEANUP_MS);
        return;
      }
    }
    activeBackdrop?.destroy();
    activeBackdrop = null;
    activeBackdropId = 'none';
    backdropHost?.remove();
    backdropHost = null;
  };

  const syncBackdrop = (
    effects: ThemeEffectsConfig,
    palette: ThemePalette | null,
    hostScheme: ThemeColorScheme,
    animate: boolean,
  ): void => {
    if (effects.backdrop === 'none') {
      teardownBackdrop(animate);
      return;
    }

    // The page detached our host: the live backdrop went with it, so remount fresh.
    if (backdropHost && !backdropHost.isConnected) {
      teardownBackdrop(false);
    }

    if (activeBackdrop && backdropHost?.isConnected && activeBackdropId === effects.backdrop) {
      targetHostOpacity = effects.intensity;
      if (fadeRafId === 0) {
        backdropHost.style.opacity = String(effects.intensity);
      }
      backdropHost.dataset.fsBackdrop = effects.backdrop;
      activeBackdrop.update({ doc, container: backdropHost, palette, hostScheme, effects });
      return;
    }

    cancelFadeRaf();
    flushExiting();

    const shouldCrossfade = animate && typeof win.requestAnimationFrame === 'function';
    let outgoing: HTMLDivElement | null = null;
    if (shouldCrossfade) {
      outgoing = promoteActiveToExiting();
    } else {
      activeBackdrop?.destroy();
      activeBackdrop = null;
      backdropHost?.remove();
      backdropHost = null;
    }

    targetHostOpacity = effects.intensity;
    const incomingHost = createBackdropHost(shouldCrossfade ? 0 : effects.intensity, outgoing);
    if (!incomingHost) {
      flushExiting();
      return;
    }
    incomingHost.dataset.fsBackdrop = effects.backdrop;
    backdropHost = incomingHost;
    activeBackdrop = BACKDROP_REGISTRY[effects.backdrop].mount({
      doc,
      container: incomingHost,
      palette,
      hostScheme,
      effects,
    });
    activeBackdropId = effects.backdrop;

    if (shouldCrossfade) {
      incomingHost.style.willChange = 'opacity';
      fadeRafId = win.requestAnimationFrame(() => {
        fadeRafId = 0;
        if (disposed || backdropHost !== incomingHost) {
          return;
        }
        incomingHost.style.transition = BACKDROP_FADE_TRANSITION;
        incomingHost.style.opacity = String(targetHostOpacity);
        if (outgoing && exitingHost === outgoing) {
          outgoing.style.transition = BACKDROP_FADE_TRANSITION;
          outgoing.style.opacity = '0';
        }
      });
      exitingTimer = setTimeout(flushExiting, BACKDROP_FADE_CLEANUP_MS);
    }
  };

  return {
    sync(rawEffects, palette, hostScheme, options) {
      if (disposed) {
        return;
      }
      const animate = Boolean(options?.transition) && canAnimateThemeTransition(doc);
      const effects = rawEffects ?? DEFAULT_THEME_EFFECTS;
      syncBackdrop(effects, palette, hostScheme, animate);
      if (effects.surface === 'prism' && effects.interactive && !effects.paused) {
        const prismParams = resolveEffectParams(
          getSurfaceParamSpecs('prism'),
          effects.surfaceParams,
        );
        prismLight.sync(
          true,
          (prismParams.baseAngle as number | undefined) ?? DEFAULT_PRISM_ANGLE,
          (prismParams.sweep as number | undefined) ?? DEFAULT_PRISM_SWEEP,
        );
      } else {
        prismLight.sync(false);
      }
      // Clicks cascade Matrix Rain when Glyphs is active, and always feed backdrops that
      // react to clicks themselves (Tier 2 scenes, Tier 3 `u_click`, Jungle Canopy) when interactive.
      const reactsToClicks =
        effects.backdrop !== 'none' && Boolean(BACKDROP_REGISTRY[effects.backdrop].reactsToClicks);
      clickFx.setEffect(effects.click, palette, {
        cascade: effects.interactive && Boolean(activeBackdrop?.burst),
        alwaysCascade: effects.interactive && reactsToClicks,
        ...(effects.clickParams ? { params: effects.clickParams } : {}),
      });
    },
    isBackdropConnected: () => Boolean(backdropHost?.isConnected),
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      prismLight.dispose();
      teardownBackdrop(false);
      clickFx.destroy();
    },
  };
}
