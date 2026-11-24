// Subtle, tactile click micro-effects (`ripple`, `spark`, `matrix-burst`,
// `glow-pulse`). Particles fire only on interactive targets (buttons, links,
// tabs, menu items, switches, inputs) so selecting post text or clicking empty
// space never sprays particles. With Glyphs over a backdrop that reacts to
// bursts (Matrix Rain), plain clicks still cascade it gently, without particles.
// This layer is the only owner of click cascades.
//
// Trusted Types safe (zero innerHTML), pointer-events: none, respects
// `prefers-reduced-motion`, and removes every particle when it finishes.

import type { ThemePalette } from '../theming';
import type { ClickEffectId } from './model';
import { OWN_ATTR } from '../surface';
import { hexWithAlpha } from '../theme';
import { CLICK_FX_OWN_VALUE } from './surfaces';

const MATRIX_BURST_GLYPHS = ['ｱ', 'ｳ', 'ｶ', 'ｷ', 'ﾈ', '0', '1', '7', 'Ξ', 'λ'];
const MAX_ACTIVE_NODES = 40;
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';

/** Targets that earn visual click feedback. */
const INTERACTIVE_CLICK_SELECTOR = [
  'button',
  'a',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="menuitemradio"]',
  '[role="menuitemcheckbox"]',
  '[role="option"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="combobox"]',
  '[role="textbox"]',
  '[contenteditable="true"]',
  'input',
  'textarea',
  'select',
  'summary',
  'label',
].join(', ');

export interface ClickEffectOptions {
  /**
   * The backdrop reacts to bursts and pointer reactions are on. Glyph clicks then
   * cascade it: on interactive targets with particles, elsewhere without.
   */
  readonly cascade?: boolean;
}

export interface ClickEffectsController {
  setEffect: (
    effect: ClickEffectId,
    palette: ThemePalette | null,
    options?: ClickEffectOptions,
  ) => void;
  /** Spawns the active effect at viewport coordinates (bypasses target gating). */
  triggerAt: (clientX: number, clientY: number) => void;
  destroy: () => void;
}

/** True when the event's composed path (including shadow roots) hits an interactive element. */
function isInteractiveClickTarget(event: Event): boolean {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  const nodes = path.length > 0 ? path : [event.target];
  for (const entry of nodes) {
    const node = entry as Partial<Element> | null;
    if (!node || typeof node.matches !== 'function') {
      continue;
    }
    if ((node as Element).localName === 'body') {
      return false;
    }
    if ((node as Element).matches(INTERACTIVE_CLICK_SELECTOR)) {
      return true;
    }
  }
  return false;
}

function animateAndRemove(el: HTMLElement, keyframes: Keyframe[], duration: number): void {
  if (typeof el.animate === 'function') {
    const anim = el.animate(keyframes, { duration, easing: EASE_OUT, fill: 'forwards' });
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
  let cascadeEnabled = false;
  let overlay: HTMLDivElement | null = null;
  let disposed = false;
  const abort = new AbortController();
  const reducedMotion = doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)');
  const prefersReducedMotion = (): boolean => reducedMotion?.matches ?? false;

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

  const cascade = (x: number, y: number): void => {
    const win = doc.defaultView ?? globalThis;
    if (cascadeEnabled && onBurst && win.innerWidth > 0 && win.innerHeight > 0) {
      onBurst(x / win.innerWidth, y / win.innerHeight);
    }
  };

  const particle = (host: HTMLElement, css: string): HTMLSpanElement => {
    const el = doc.createElement('span');
    el.style.cssText = `position:absolute;pointer-events:none;will-change:transform,opacity;${css}`;
    host.append(el);
    return el;
  };

  const spawnAt = (x: number, y: number): void => {
    if (disposed || effect === 'none' || prefersReducedMotion()) {
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
    const text = palette?.text ?? '#ffffff';

    if (effect === 'ripple') {
      // Refined hairline ring: ~32px radius, crisp 320ms ease-out.
      const ring = particle(
        host,
        `left:${x}px;top:${y}px;width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:50%;border:1.25px solid ${hexWithAlpha(accent, 0.9)};box-shadow:0 0 6px ${hexWithAlpha(accent, 0.18)};opacity:0;`,
      );
      animateAndRemove(
        ring,
        [
          { transform: 'scale(0.28)', opacity: 0 },
          { transform: 'scale(0.42)', opacity: 0.55, offset: 0.14 },
          { transform: 'scale(1)', opacity: 0 },
        ],
        320,
      );
      return;
    }

    if (effect === 'glow-pulse') {
      // Whisper-soft radial kiss.
      const orb = particle(
        host,
        `left:${x}px;top:${y}px;width:48px;height:48px;margin:-24px 0 0 -24px;border-radius:50%;background:radial-gradient(circle, ${hexWithAlpha(accent, 0.7)} 0%, ${hexWithAlpha(accent, 0.22)} 42%, transparent 70%);opacity:0;`,
      );
      animateAndRemove(
        orb,
        [
          { transform: 'scale(0.4)', opacity: 0 },
          { transform: 'scale(0.75)', opacity: 0.35, offset: 0.25 },
          { transform: 'scale(1.15)', opacity: 0 },
        ],
        360,
      );
      return;
    }

    if (effect === 'spark') {
      // Slender tapered micro-lines radiating outward (after React Bits ClickSpark).
      const count = 8;
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + Math.PI / count;
        const start = 5;
        const dist = 18 + (i % 2) * 10;
        const color = i % 4 === 3 ? hexWithAlpha(text, 0.85) : accent;
        const spark = particle(
          host,
          `left:${x}px;top:${y}px;width:5px;height:1.5px;margin-top:-0.75px;border-radius:1px;transform-origin:0 50%;background:linear-gradient(90deg, transparent, ${color} 55%);opacity:0;`,
        );
        const mid = start + (dist - start) * 0.45;
        animateAndRemove(
          spark,
          [
            { transform: `rotate(${angle}rad) translateX(${start}px) scaleX(1)`, opacity: 0.95 },
            {
              transform: `rotate(${angle}rad) translateX(${mid}px) scaleX(0.8)`,
              opacity: 0.85,
              offset: 0.4,
            },
            { transform: `rotate(${angle}rad) translateX(${dist}px) scaleX(0.25)`, opacity: 0 },
          ],
          300,
        );
      }
      return;
    }

    // 'matrix-burst': five delicate glyphs drifting gently upward + backdrop cascade.
    cascade(x, y);
    const count = 5;
    for (let i = 0; i < count; i++) {
      const angle = -Math.PI / 2 + ((i - (count - 1) / 2) * Math.PI) / 5;
      const tx = Math.cos(angle) * 22;
      const ty = Math.sin(angle) * 22 + 6;
      const glyph = particle(
        host,
        `left:${x}px;top:${y}px;margin:-6px 0 0 -4px;font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:${i % 2 === 0 ? accent : hexWithAlpha(text, 0.85)};text-shadow:0 0 6px ${hexWithAlpha(accent, 0.45)};opacity:0;`,
      );
      glyph.textContent = MATRIX_BURST_GLYPHS[(i * 3) % MATRIX_BURST_GLYPHS.length] ?? '1';
      animateAndRemove(
        glyph,
        [
          { transform: 'translate(0px, 0px) scale(0.85)', opacity: 0 },
          {
            transform: `translate(${tx * 0.35}px, ${ty * 0.35}px) scale(1)`,
            opacity: 0.7,
            offset: 0.25,
          },
          { transform: `translate(${tx}px, ${ty}px) scale(0.95)`, opacity: 0 },
        ],
        380,
      );
    }
  };

  doc.addEventListener(
    'pointerdown',
    (event) => {
      const pe = event as PointerEvent;
      if (pe.button !== 0 || effect === 'none' || !isInteractiveClickTarget(pe)) {
        return;
      }
      spawnAt(pe.clientX, pe.clientY);
    },
    { capture: true, passive: true, signal: abort.signal },
  );

  // Plain clicks on margins cascade Matrix Rain gently; drags that select text never do.
  doc.addEventListener(
    'click',
    (event) => {
      const me = event as MouseEvent;
      if (
        disposed ||
        effect !== 'matrix-burst' ||
        !cascadeEnabled ||
        me.button !== 0 ||
        // Keyboard activation and scripted `.click()` report detail 0 and (0, 0) coordinates.
        me.detail === 0 ||
        isInteractiveClickTarget(me) ||
        prefersReducedMotion()
      ) {
        return;
      }
      const selection = doc.getSelection?.();
      if (selection && !selection.isCollapsed) {
        return;
      }
      cascade(me.clientX, me.clientY);
    },
    { capture: true, passive: true, signal: abort.signal },
  );

  return {
    setEffect(nextEffect, nextPalette, options) {
      effect = nextEffect;
      palette = nextPalette;
      cascadeEnabled = options?.cascade ?? false;
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
