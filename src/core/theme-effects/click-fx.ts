// Subtle, tactile click micro-effects (`ripple`, `spark`, `matrix-burst`,
// `glow-pulse`, `supernova`). Particles fire only on interactive targets (buttons, links,
// tabs, menu items, switches, inputs) so selecting post text or clicking empty
// space never sprays particles. With Glyphs over a backdrop that reacts to
// bursts (Matrix Rain), plain clicks still cascade it gently, without particles.
// This layer is the only owner of click cascades.
//
// Trusted Types safe (zero innerHTML), pointer-events: none, respects
// `prefers-reduced-motion`, and removes every particle when it finishes.

import type { ThemePalette } from '../theming';
import type { ClickEffectId, EffectParamValues } from './model';
import { OWN_ATTR } from '../surface';
import { hexWithAlpha } from '../theming/color';
import { getClickParamSpecs, resolveEffectParams } from './model';
import { CLICK_FX_OWN_VALUE } from './surfaces';

const MATRIX_BURST_GLYPHS = ['ｱ', 'ｳ', 'ｶ', 'ｷ', 'ﾈ', '0', '1', '7', 'Ξ', 'λ'];
const MAX_ACTIVE_NODES = 40;
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';

const SUPERNOVA_INNER_KEYFRAMES: Keyframe[] = [
  { transform: 'scale(0.22)', opacity: 0 },
  { transform: 'scale(0.55)', opacity: 0.78, offset: 0.16 },
  { transform: 'scale(1.2)', opacity: 0 },
];

const SUPERNOVA_OUTER_KEYFRAMES: Keyframe[] = [
  { transform: 'scale(0.18)', opacity: 0 },
  { transform: 'scale(0.62)', opacity: 0.48, offset: 0.24 },
  { transform: 'scale(1.28)', opacity: 0 },
];

function buildSupernovaEmberKeyframes(scale: number): readonly Keyframe[][] {
  return Array.from({ length: 6 }, (_, i) => {
    const baseAngle = (Math.PI * 2 * i) / 6;
    const midAngle = baseAngle + 0.32;
    const endAngle = baseAngle + 0.68;
    const dist = (24 + (i % 2) * 10) * scale;
    return [
      { transform: 'translate(0px, 0px) scale(0.5)', opacity: 0.95 },
      {
        transform: `translate(${(Math.cos(midAngle) * dist * 0.55).toFixed(2)}px, ${(Math.sin(midAngle) * dist * 0.55).toFixed(2)}px) scale(1.05)`,
        opacity: 0.85,
        offset: 0.42,
      },
      {
        transform: `translate(${(Math.cos(endAngle) * dist).toFixed(2)}px, ${(Math.sin(endAngle) * dist).toFixed(2)}px) scale(0.2)`,
        opacity: 0,
      },
    ];
  });
}

const SUPERNOVA_EMBER_KEYFRAMES: readonly Keyframe[][] = buildSupernovaEmberKeyframes(1);

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
  /**
   * Forward primary non-selection clicks to `onBurst` regardless of the active
   * `ClickEffectId` (used by Tier 2 `custom-scene` click bursts and Tier 3 `u_click`).
   */
  readonly alwaysCascade?: boolean;
  /** Optional validated click-effect parameter overrides (`scale`, `count`, `glyphs`, `style`). */
  readonly params?: EffectParamValues;
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
  let resolvedParams: Readonly<Record<string, unknown>> = {};
  let matrixGlyphPool: readonly string[] = MATRIX_BURST_GLYPHS;
  let supernovaEmberFrames: readonly Keyframe[][] = SUPERNOVA_EMBER_KEYFRAMES;
  let cascadeEnabled = false;
  let alwaysCascade = false;
  let overlay: HTMLDivElement | null = null;
  let particleRoot: ParentNode | null = null;
  let disposed = false;
  const abort = new AbortController();
  const reducedMotion = doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)');
  const prefersReducedMotion = (): boolean => reducedMotion?.matches ?? false;

  const ensureOverlay = (): ParentNode | null => {
    if (disposed) {
      return null;
    }
    if (overlay?.isConnected && particleRoot) {
      return particleRoot;
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
    // Isolate particles in a Shadow Root so spawning/removing click effects never
    // triggers light-DOM MutationObservers or host stylesheet recalculations.
    particleRoot =
      typeof overlay.attachShadow === 'function' ? overlay.attachShadow({ mode: 'open' }) : overlay;
    target.append(overlay);
    return particleRoot;
  };

  const removeOverlay = (): void => {
    overlay?.remove();
    overlay = null;
    particleRoot = null;
  };

  const cascade = (x: number, y: number): void => {
    const win = doc.defaultView ?? globalThis;
    if (cascadeEnabled && onBurst && win.innerWidth > 0 && win.innerHeight > 0) {
      onBurst(x / win.innerWidth, y / win.innerHeight);
    }
  };

  const particle = (host: ParentNode, css: string): HTMLSpanElement => {
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
    const secondary = palette?.accentSecondary ?? palette?.danger ?? '#a855f7';
    const text = palette?.text ?? '#ffffff';
    const scale = (resolvedParams.scale as number | undefined) ?? 1;
    const circleParticle = (parent: ParentNode, diameter: number, css: string): HTMLSpanElement =>
      particle(
        parent,
        `left:${x}px;top:${y}px;width:${diameter}px;height:${diameter}px;margin:${-diameter / 2}px 0 0 ${-diameter / 2}px;border-radius:50%;${css}`,
      );

    if (effect === 'supernova') {
      const style = (resolvedParams.style as string | undefined) ?? 'both';
      const showRings = style === 'both' || style === 'rings';
      const showEmbers = style === 'both' || style === 'embers';
      // Dual-ring gravitational lensing pulse + 6 orbital photon embers (batched DOM insert).
      const batch = doc.createDocumentFragment();
      const animations: Array<[HTMLSpanElement, Keyframe[], number]> = [];
      if (showRings) {
        animations.push(
          [
            circleParticle(
              batch,
              Math.round(54 * scale),
              `border:1.5px solid ${hexWithAlpha(accent, 0.95)};box-shadow:0 0 10px ${hexWithAlpha(accent, 0.45)};opacity:0;`,
            ),
            SUPERNOVA_INNER_KEYFRAMES,
            360,
          ],
          [
            circleParticle(
              batch,
              Math.round(84 * scale),
              `border:1px solid ${hexWithAlpha(secondary, 0.8)};box-shadow:0 0 16px ${hexWithAlpha(secondary, 0.28)};opacity:0;`,
            ),
            SUPERNOVA_OUTER_KEYFRAMES,
            430,
          ],
        );
      }
      if (showEmbers) {
        const emberSize = Math.max(3, Math.round(4 * scale));
        const emberColors = [accent, secondary, hexWithAlpha(text, 0.9)] as const;
        for (let i = 0; i < supernovaEmberFrames.length; i++) {
          const frames = supernovaEmberFrames[i];
          if (!frames) {
            continue;
          }
          const color = emberColors[i % emberColors.length] ?? accent;
          animations.push([
            circleParticle(
              batch,
              emberSize,
              `background:${color};box-shadow:0 0 7px ${color};opacity:0;`,
            ),
            frames,
            410,
          ]);
        }
      }
      host.append(batch);
      for (const [el, frames, duration] of animations) {
        animateAndRemove(el, frames, duration);
      }
      return;
    }

    if (effect === 'ripple') {
      // Refined hairline ring: ~32px radius scaled by `scale`, crisp 320ms ease-out.
      const ring = circleParticle(
        host,
        Math.round(64 * scale),
        `border:1.25px solid ${hexWithAlpha(accent, 0.9)};box-shadow:0 0 6px ${hexWithAlpha(accent, 0.18)};opacity:0;`,
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
      const orb = circleParticle(
        host,
        Math.round(48 * scale),
        `background:radial-gradient(circle, ${hexWithAlpha(accent, 0.7)} 0%, ${hexWithAlpha(accent, 0.22)} 42%, transparent 70%);opacity:0;`,
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
      const count = Math.round((resolvedParams.count as number | undefined) ?? 8);
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + Math.PI / count;
        const start = 5 * scale;
        const dist = (18 + (i % 2) * 10) * scale;
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
    const pool = matrixGlyphPool;
    const count = 5;
    for (let i = 0; i < count; i++) {
      const angle = -Math.PI / 2 + ((i - (count - 1) / 2) * Math.PI) / 5;
      const tx = Math.cos(angle) * 22;
      const ty = Math.sin(angle) * 22 + 6;
      const glyph = particle(
        host,
        `left:${x}px;top:${y}px;margin:-6px 0 0 -4px;font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:${i % 2 === 0 ? accent : hexWithAlpha(text, 0.85)};text-shadow:0 0 6px ${hexWithAlpha(accent, 0.45)};opacity:0;`,
      );
      glyph.textContent = pool[(i * 3) % pool.length] ?? '1';
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
      if (pe.button !== 0 || !isInteractiveClickTarget(pe)) {
        return;
      }
      if (effect !== 'none') {
        spawnAt(pe.clientX, pe.clientY);
      }
      if (alwaysCascade && effect !== 'matrix-burst' && !prefersReducedMotion()) {
        cascade(pe.clientX, pe.clientY);
      }
    },
    { capture: true, passive: true, signal: abort.signal },
  );

  // Plain clicks on margins cascade interactive backdrops gently; drags that select text never do.
  doc.addEventListener(
    'click',
    (event) => {
      const me = event as MouseEvent;
      if (
        disposed ||
        (!alwaysCascade && effect !== 'matrix-burst') ||
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
      resolvedParams = resolveEffectParams(getClickParamSpecs(nextEffect), options?.params);
      if (nextEffect === 'matrix-burst') {
        const customGlyphs = Array.from(String(resolvedParams.glyphs ?? '').replace(/\s+/g, ''));
        matrixGlyphPool = customGlyphs.length > 0 ? customGlyphs : MATRIX_BURST_GLYPHS;
      } else if (nextEffect === 'supernova') {
        const nextScale = (resolvedParams.scale as number | undefined) ?? 1;
        supernovaEmberFrames =
          nextScale === 1 ? SUPERNOVA_EMBER_KEYFRAMES : buildSupernovaEmberKeyframes(nextScale);
      }
      cascadeEnabled = options?.cascade ?? false;
      alwaysCascade = Boolean(options?.alwaysCascade);
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
