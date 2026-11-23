// Interactive click micro-effects (`ripple`, `spark`, `matrix-burst`, `glow-pulse`).
// Strictly Trusted Types safe (zero innerHTML), pointer-events: none, respects
// `prefers-reduced-motion`, and cleans up every animated particle cleanly.

import type { ThemePalette } from '../theming';
import type { ClickEffectId } from './model';
import { OWN_ATTR } from '../surface';
import { hexWithAlpha } from '../theme';
import { CLICK_FX_OWN_VALUE } from './surfaces';

const MATRIX_BURST_GLYPHS = ['ｱ', 'ｲ', 'ｳ', 'ｴ', 'ｵ', 'ｶ', 'ｷ', 'ｸ', '0', '1', '7', '9', 'Ξ', 'λ'];
const MAX_ACTIVE_NODES = 48;

export interface ClickEffectsController {
  setEffect: (effect: ClickEffectId, palette: ThemePalette | null) => void;
  triggerAt: (clientX: number, clientY: number) => void;
  destroy: () => void;
}

function prefersReducedMotion(doc: Document): boolean {
  return doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function animateAndRemove(
  el: HTMLElement,
  keyframes: Keyframe[],
  duration: number,
  easing = 'cubic-bezier(0.2, 0.8, 0.2, 1)',
): void {
  if (typeof el.animate === 'function') {
    const anim = el.animate(keyframes, { duration, easing, fill: 'forwards' });
    anim.onfinish = () => el.remove();
    anim.oncancel = () => el.remove();
    return;
  }
  setTimeout(() => el.remove(), duration);
}

export function mountClickEffects(
  doc: Document,
  onBurst?: (normX: number, normY: number) => void,
): ClickEffectsController {
  let effect: ClickEffectId = 'none';
  let palette: ThemePalette | null = null;
  let overlay: HTMLDivElement | null = null;
  let disposed = false;
  const abort = new AbortController();

  const ensureOverlay = (): HTMLDivElement | null => {
    if (disposed) {
      return null;
    }
    if (overlay?.isConnected) {
      return overlay;
    }
    const target = doc.documentElement ?? doc.body;
    if (!target) {
      return null;
    }
    overlay = doc.createElement('div');
    overlay.setAttribute(OWN_ATTR, CLICK_FX_OWN_VALUE);
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:2147483645;pointer-events:none;overflow:hidden;contain:strict;';
    target.append(overlay);
    return overlay;
  };

  const removeOverlay = (): void => {
    overlay?.remove();
    overlay = null;
  };

  const spawnAt = (x: number, y: number): void => {
    if (disposed || effect === 'none' || prefersReducedMotion(doc)) {
      return;
    }
    const host = ensureOverlay();
    if (!host) {
      return;
    }
    while (host.childElementCount > MAX_ACTIVE_NODES) {
      host.firstElementChild?.remove();
    }

    const accent = palette?.accent ?? '#3b82f6';
    const alt = palette?.danger ?? '#ec4899';
    const light = palette?.text ?? '#ffffff';

    if (effect === 'ripple') {
      const ring = doc.createElement('span');
      ring.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:999px;border:2px solid ${accent};box-shadow:0 0 12px ${hexWithAlpha(accent, 0.55)};`;
      host.append(ring);
      animateAndRemove(
        ring,
        [
          { transform: 'scale(0.35)', opacity: 0.9 },
          { transform: 'scale(4.6)', opacity: 0 },
        ],
        480,
      );
      return;
    }

    if (effect === 'glow-pulse') {
      const orb = doc.createElement('span');
      orb.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:96px;height:96px;margin:-48px 0 0 -48px;border-radius:999px;background:radial-gradient(circle, ${hexWithAlpha(accent, 0.55)} 0%, ${hexWithAlpha(alt, 0.22)} 45%, transparent 72%);`;
      host.append(orb);
      animateAndRemove(
        orb,
        [
          { transform: 'scale(0.25)', opacity: 0.95 },
          { transform: 'scale(1.85)', opacity: 0 },
        ],
        520,
      );
      return;
    }

    if (effect === 'spark') {
      const colors = [accent, alt, '#ffe600', '#28d7ff', light];
      const count = 10;
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + (i % 2) * 0.18;
        const dist = 28 + (i % 3) * 14;
        const tx = Math.cos(angle) * dist;
        const ty = Math.sin(angle) * dist;
        const spark = doc.createElement('span');
        const color = colors[i % colors.length] ?? accent;
        spark.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:8px;height:3px;margin:-1.5px 0 0 -4px;border-radius:999px;background:${color};box-shadow:0 0 8px ${color};`;
        host.append(spark);
        animateAndRemove(
          spark,
          [
            {
              transform: `translate(0px, 0px) rotate(${angle}rad) scaleX(0.4)`,
              opacity: 1,
            },
            {
              transform: `translate(${tx}px, ${ty}px) rotate(${angle}rad) scaleX(1.3)`,
              opacity: 0,
            },
          ],
          420,
        );
      }
      return;
    }

    // 'matrix-burst'
    const win = doc.defaultView ?? globalThis;
    if (onBurst && win.innerWidth > 0 && win.innerHeight > 0) {
      onBurst(x / win.innerWidth, y / win.innerHeight);
    }
    const glyphColor = palette?.accent ?? '#1fdf64';
    const count = 8;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count - Math.PI / 2;
      const dist = 26 + (i % 3) * 14;
      const tx = Math.cos(angle) * dist;
      const ty = Math.sin(angle) * dist + 14;
      const glyph = doc.createElement('span');
      glyph.textContent = MATRIX_BURST_GLYPHS[i % MATRIX_BURST_GLYPHS.length] ?? '1';
      glyph.style.cssText = `position:absolute;left:${x}px;top:${y}px;margin:-8px 0 0 -5px;font:700 13px/1 ui-monospace,monospace;color:${i % 2 === 0 ? glyphColor : light};text-shadow:0 0 8px ${glyphColor};`;
      host.append(glyph);
      animateAndRemove(
        glyph,
        [
          { transform: 'translate(0px, 0px) scale(0.8)', opacity: 1 },
          { transform: `translate(${tx}px, ${ty}px) scale(1.1)`, opacity: 0 },
        ],
        520,
      );
    }
  };

  doc.addEventListener(
    'pointerdown',
    (event) => {
      const pe = event as PointerEvent;
      if (pe.button !== 0) {
        return;
      }
      spawnAt(pe.clientX, pe.clientY);
    },
    { capture: true, passive: true, signal: abort.signal },
  );

  return {
    setEffect(nextEffect, nextPalette) {
      effect = nextEffect;
      palette = nextPalette;
      if (effect === 'none') {
        removeOverlay();
      }
    },
    triggerAt(clientX, clientY) {
      spawnAt(clientX, clientY);
    },
    destroy() {
      disposed = true;
      abort.abort();
      removeOverlay();
    },
  };
}
