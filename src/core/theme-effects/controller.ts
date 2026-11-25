// Coordinates live backdrop mounting, updates, click effects, and zero-residue
// teardown for one host `Document`.

import type { ThemeColorScheme, ThemePalette } from '../theming';
import type { BackdropInstance } from './backdrops';
import type { BackdropEffectId, ThemeEffectsConfig } from './model';
import { OWN_ATTR } from '../surface';
import { BACKDROP_REGISTRY } from './backdrops';
import { mountClickEffects } from './click-fx';
import { DEFAULT_THEME_EFFECTS } from './model';
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
 * Zero `getBoundingClientRect()` or DOM queries; quantizes to 2deg steps,
 * skips touch/hidden tabs, reacts to OS reduced-motion changes, and cleans
 * up immediately when Prism is off or disposed.
 */
function createPrismLightDriver(doc: Document) {
  let active = false;
  let wanted = false;
  let rafId = 0;
  let rafUsesTimeout = false;
  let pendingAngle = -1;
  let lastAngle = -1;
  const reducedMotion = doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)');

  const flush = (): void => {
    rafId = 0;
    if (!active || pendingAngle === lastAngle || pendingAngle < 0) {
      return;
    }
    lastAngle = pendingAngle;
    doc.documentElement?.style.setProperty(PRISM_ANGLE_VAR, `${pendingAngle}deg`);
  };

  const onMove = (event: PointerEvent): void => {
    if (event.pointerType === 'touch' || doc.hidden) {
      return;
    }
    const win = doc.defaultView ?? globalThis;
    if (win.innerWidth <= 0 || win.innerHeight <= 0) {
      return;
    }
    const nx = Math.min(1, Math.max(0, event.clientX / win.innerWidth));
    const ny = Math.min(1, Math.max(0, event.clientY / win.innerHeight));
    // Maps viewport coordinates to a 2deg-quantized 96..174deg specular sheen angle.
    const nextAngle = Math.round((96 + nx * 56 + ny * 22) / 2) * 2;
    if (nextAngle === lastAngle && rafId === 0) {
      return;
    }
    pendingAngle = nextAngle;
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

  const stop = (): void => {
    if (!active) {
      return;
    }
    active = false;
    doc.removeEventListener('pointermove', onMove);
    if (rafId !== 0) {
      const win = doc.defaultView ?? globalThis;
      if (rafUsesTimeout) {
        win.clearTimeout(rafId);
      } else {
        win.cancelAnimationFrame(rafId);
      }
      rafId = 0;
    }
    pendingAngle = -1;
    lastAngle = -1;
    doc.documentElement?.style.removeProperty(PRISM_ANGLE_VAR);
  };

  const reconcile = (): void => {
    const shouldRun = wanted && !(reducedMotion?.matches ?? false);
    if (shouldRun === active) {
      return;
    }
    if (!shouldRun) {
      stop();
      return;
    }
    active = true;
    doc.addEventListener('pointermove', onMove, { passive: true });
  };

  reducedMotion?.addEventListener?.('change', reconcile);

  return {
    sync(enabled: boolean): void {
      wanted = enabled;
      reconcile();
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
      prismLight.sync(effects.surface === 'prism' && effects.interactive && !effects.paused);
      // Clicks cascade Matrix Rain when Glyphs is active, and always feed Tier 2
      // custom-scene click bursts & Tier 3 custom-shader `u_click` when interactive.
      const isCustomBackdrop =
        effects.backdrop === 'custom-scene' || effects.backdrop === 'custom-shader';
      clickFx.setEffect(effects.click, palette, {
        cascade: effects.interactive && Boolean(activeBackdrop?.burst),
        alwaysCascade: effects.interactive && isCustomBackdrop,
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
