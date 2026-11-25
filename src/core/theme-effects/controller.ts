// Coordinates live backdrop mounting, updates, click effects, and zero-residue
// teardown for one host `Document`.

import type { ThemeColorScheme, ThemePalette } from '../theming';
import type { BackdropInstance } from './backdrops';
import type { BackdropEffectId, ThemeEffectsConfig } from './model';
import { OWN_ATTR } from '../surface';
import { BACKDROP_REGISTRY } from './backdrops';
import { mountClickEffects } from './click-fx';
import { DEFAULT_THEME_EFFECTS, getSurfaceParamSpecs, resolveEffectParams } from './model';
import { BACKDROP_OWN_VALUE, PRISM_ANGLE_VAR } from './surfaces';

export interface EffectsLayerController {
  sync: (
    effects: ThemeEffectsConfig | undefined,
    palette: ThemePalette | null,
    hostScheme: ThemeColorScheme,
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
  let backdropHost: HTMLDivElement | null = null;
  let activeBackdropId: BackdropEffectId = 'none';
  let activeBackdrop: BackdropInstance | null = null;
  let disposed = false;

  const prismLight = createPrismLightDriver(doc);
  const clickFx = mountClickEffects(doc, (normX, normY) => {
    activeBackdrop?.burst?.(normX, normY);
  });

  const teardownBackdrop = (): void => {
    activeBackdrop?.destroy();
    activeBackdrop = null;
    activeBackdropId = 'none';
    backdropHost?.remove();
    backdropHost = null;
  };

  const ensureBackdropHost = (): HTMLDivElement | null => {
    if (disposed) {
      return null;
    }
    if (backdropHost?.isConnected) {
      return backdropHost;
    }
    // The page detached our host: the live backdrop went with it, so remount it
    // in the fresh host instead of updating a renderer nobody can see.
    if (backdropHost) {
      teardownBackdrop();
    }
    const target = doc.body ?? doc.documentElement;
    if (!target) {
      return null;
    }
    backdropHost = doc.createElement('div');
    backdropHost.setAttribute(OWN_ATTR, BACKDROP_OWN_VALUE);
    backdropHost.setAttribute('aria-hidden', 'true');
    backdropHost.style.cssText =
      'position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden;contain:strict;';
    target.prepend(backdropHost);
    return backdropHost;
  };

  const syncBackdrop = (
    effects: ThemeEffectsConfig,
    palette: ThemePalette | null,
    hostScheme: ThemeColorScheme,
  ): void => {
    if (effects.backdrop === 'none') {
      teardownBackdrop();
      return;
    }
    const host = ensureBackdropHost();
    if (!host) {
      return;
    }
    host.style.opacity = String(effects.intensity);
    host.dataset.fsBackdrop = effects.backdrop;

    const ctx = { doc, container: host, palette, hostScheme, effects };
    if (activeBackdrop && activeBackdropId === effects.backdrop) {
      activeBackdrop.update(ctx);
      return;
    }
    activeBackdrop?.destroy();
    activeBackdrop = BACKDROP_REGISTRY[effects.backdrop].mount(ctx);
    activeBackdropId = effects.backdrop;
  };

  return {
    sync(rawEffects, palette, hostScheme) {
      if (disposed) {
        return;
      }
      const effects = rawEffects ?? DEFAULT_THEME_EFFECTS;
      syncBackdrop(effects, palette, hostScheme);
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
      // Clicks cascade Matrix Rain when Glyphs is active, and always feed Tier 2
      // custom-scene click bursts & Tier 3 custom-shader `u_click` when interactive.
      const isCustomBackdrop =
        effects.backdrop === 'custom-scene' || effects.backdrop === 'custom-shader';
      clickFx.setEffect(effects.click, palette, {
        cascade: effects.interactive && Boolean(activeBackdrop?.burst),
        alwaysCascade: effects.interactive && isCustomBackdrop,
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
      teardownBackdrop();
      clickFx.destroy();
    },
  };
}
