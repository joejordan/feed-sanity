// Subtle, tactile click micro-effects (`ripple`, `spark`, `matrix-burst`,
// `glow-pulse`, `supernova`, `tide`, `petals`, `seafoam`). Particles fire only on interactive targets (buttons, links,
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
import { hexWithAlpha, SUNLIGHT } from '../theming/color';
import { GOLDEN_ANGLE } from './digital-rain/math';
import { getClickParamSpecs, resolveEffectParams } from './model';
import { CLICK_FX_OWN_VALUE } from './surfaces';

const MATRIX_BURST_GLYPHS = ['ｱ', 'ｳ', 'ｶ', 'ｷ', 'ﾈ', '0', '1', '7', 'Ξ', 'λ'];
const MAX_ACTIVE_NODES = 24;
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';

const RIPPLE_KEYFRAMES: Keyframe[] = [
  { transform: 'scale(0.28)', opacity: 0 },
  { transform: 'scale(0.42)', opacity: 0.55, offset: 0.14 },
  { transform: 'scale(1)', opacity: 0 },
];

const GLOW_PULSE_KEYFRAMES: Keyframe[] = [
  { transform: 'scale(0.4)', opacity: 0 },
  { transform: 'scale(0.75)', opacity: 0.35, offset: 0.25 },
  { transform: 'scale(1.15)', opacity: 0 },
];

const MATRIX_BURST_KEYFRAMES: readonly Keyframe[][] = Array.from({ length: 5 }, (_, i) => {
  const angle = -Math.PI / 2 + ((i - 2) * Math.PI) / 5;
  const tx = Math.cos(angle) * 22;
  const ty = Math.sin(angle) * 22 + 6;
  return [
    { transform: 'translate(0px, 0px) scale(0.85)', opacity: 0 },
    {
      transform: `translate(${(tx * 0.35).toFixed(2)}px, ${(ty * 0.35).toFixed(2)}px) scale(1)`,
      opacity: 0.7,
      offset: 0.25,
    },
    { transform: `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(0.95)`, opacity: 0 },
  ];
});

function buildSparkKeyframes(count: number, scale: number): readonly Keyframe[][] {
  return Array.from({ length: count }, (_, i) => {
    const angle = (Math.PI * 2 * i) / count + Math.PI / count;
    const start = 5 * scale;
    const dist = (18 + (i % 2) * 10) * scale;
    const mid = start + (dist - start) * 0.45;
    return [
      { transform: `rotate(${angle}rad) translateX(${start}px) scaleX(1)`, opacity: 0.95 },
      {
        transform: `rotate(${angle}rad) translateX(${mid}px) scaleX(0.8)`,
        opacity: 0.85,
        offset: 0.4,
      },
      { transform: `rotate(${angle}rad) translateX(${dist}px) scaleX(0.25)`, opacity: 0 },
    ];
  });
}

const DEFAULT_SPARK_KEYFRAMES: readonly Keyframe[][] = buildSparkKeyframes(8, 1);

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

const TIDE_INNER_KEYFRAMES: Keyframe[] = [
  { transform: 'scale(0.2)', opacity: 0 },
  { transform: 'scale(0.48)', opacity: 0.75, offset: 0.2 },
  { transform: 'scale(1)', opacity: 0 },
];

const TIDE_OUTER_KEYFRAMES: Keyframe[] = [
  { transform: 'scale(0.16)', opacity: 0 },
  { transform: 'scale(0.55)', opacity: 0.42, offset: 0.28 },
  { transform: 'scale(1.12)', opacity: 0 },
];

const TIDE_MOTE_COUNT = 7;
/** Ripple rings are drawn as ovals, the way a ring on water looks from the shore. */
const TIDE_RING_FLATTEN = 0.62;

interface TideMote {
  /** Offset from the click point in CSS pixels. */
  readonly dx: number;
  readonly dy: number;
  readonly frames: Keyframe[];
}

/**
 * Sea-sparkle motes laid out on a golden-angle spiral so they look scattered
 * without any per-click randomness: each one blinks on, drifts up, and fades.
 */
function buildTideMotes(scale: number): readonly TideMote[] {
  return Array.from({ length: TIDE_MOTE_COUNT }, (_, i) => {
    const angle = i * GOLDEN_ANGLE + 0.6;
    const radius = (8 + 22 * Math.sqrt((i + 0.5) / TIDE_MOTE_COUNT)) * scale;
    const rise = (9 + (i % 3) * 4) * scale;
    const drift = (i % 2 === 0 ? 3 : -3) * scale;
    return {
      dx: Math.cos(angle) * radius,
      dy: Math.sin(angle) * radius * TIDE_RING_FLATTEN,
      frames: [
        { transform: 'translate(0px, 0px) scale(0.3)', opacity: 0 },
        {
          transform: `translate(${(drift * 0.3).toFixed(2)}px, ${(-rise * 0.25).toFixed(2)}px) scale(1.15)`,
          opacity: 1,
          offset: 0.22,
        },
        {
          transform: `translate(${drift.toFixed(2)}px, ${(-rise).toFixed(2)}px) scale(0.4)`,
          opacity: 0,
        },
      ],
    };
  });
}

const TIDE_MOTES: readonly TideMote[] = buildTideMotes(1);

const DEW_RING_KEYFRAMES: Keyframe[] = [
  { transform: 'scale(0.2)', opacity: 0 },
  { transform: 'scale(0.5)', opacity: 0.7, offset: 0.2 },
  { transform: 'scale(1)', opacity: 0 },
];

const DEW_BEAD_KEYFRAMES: Keyframe[] = [
  { transform: 'scale(0.4)', opacity: 0.95 },
  { transform: 'scale(1)', opacity: 0.75, offset: 0.35 },
  { transform: 'scale(1.5)', opacity: 0 },
];

const PETAL_COUNT = 6;

/**
 * Petals shaken loose by a click: each leaves on a golden-angle heading, lifts,
 * then flutters down while turning over. Laid out without per-click randomness.
 * The shared ease-out spends its first tenth on the lift and the long tail on
 * the drift down, so the keyframes put most of the travel early.
 */
function buildPetalKeyframes(scale: number): readonly Keyframe[][] {
  return Array.from({ length: PETAL_COUNT }, (_, i) => {
    const angle = i * GOLDEN_ANGLE - 0.9;
    const dx = Math.cos(angle) * (26 + (i % 3) * 9) * scale;
    const lift = -(12 + Math.abs(Math.sin(angle)) * 12) * scale;
    const fall = (30 + (i % 2) * 14) * scale;
    const spin = (i % 2 === 0 ? 1 : -1) * (150 + i * 24);
    const at = (x: number, y: number, turn: number, size: number): string =>
      `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${Math.round(turn)}deg) scale(${size})`;
    return [
      { transform: at(0, 0, 0, 0.3), opacity: 0 },
      { transform: at(dx * 0.6, lift, spin * 0.3, 1), opacity: 1, offset: 0.45 },
      {
        transform: at(dx * 0.9, lift * 0.3 + fall * 0.3, spin * 0.65, 1),
        opacity: 0.95,
        offset: 0.8,
      },
      { transform: at(dx, fall, spin, 0.75), opacity: 0 },
    ];
  });
}

const PETAL_KEYFRAMES: readonly Keyframe[][] = buildPetalKeyframes(1);

const SEAFOAM_CREST_KEYFRAMES: Keyframe[] = [
  { transform: 'scale(0.24)', opacity: 0 },
  { transform: 'scale(0.58)', opacity: 0.82, offset: 0.18 },
  { transform: 'scale(1.06)', opacity: 0 },
];

const SEAFOAM_HALO_KEYFRAMES: Keyframe[] = [
  { transform: 'scale(0.18)', opacity: 0 },
  { transform: 'scale(0.62)', opacity: 0.45, offset: 0.26 },
  { transform: 'scale(1.22)', opacity: 0 },
];

const SEAFOAM_BUBBLE_COUNT = 7;

interface SeafoamBubble {
  readonly dx: number;
  readonly dy: number;
  readonly size: number;
  readonly frames: Keyframe[];
}

/**
 * Buoyant glossy sea-bubbles laid out deterministically along a golden-angle
 * splash arc: each pops out, wobbles upward on an S-curve, and bursts cleanly.
 */
function buildSeafoamBubbles(scale: number): readonly SeafoamBubble[] {
  return Array.from({ length: SEAFOAM_BUBBLE_COUNT }, (_, i) => {
    const angle = i * GOLDEN_ANGLE + 0.35;
    const radius = (8 + 18 * Math.sqrt((i + 0.4) / SEAFOAM_BUBBLE_COUNT)) * scale;
    const rise = (18 + (i % 3) * 8) * scale;
    const wobble = (i % 2 === 0 ? 6 : -6) * scale;
    const size = Math.max(5, Math.round((5 + (i % 3) * 2.5) * scale));
    return {
      dx: Math.cos(angle) * radius,
      dy: Math.sin(angle) * radius * 0.72,
      size,
      frames: [
        { transform: 'translate(0px, 0px) scale(0.35)', opacity: 0 },
        {
          transform: `translate(${(wobble * 0.55).toFixed(2)}px, ${(-rise * 0.35).toFixed(2)}px) scale(1.05)`,
          opacity: 0.92,
          offset: 0.28,
        },
        {
          transform: `translate(${(-wobble * 0.45).toFixed(2)}px, ${(-rise * 0.78).toFixed(2)}px) scale(1)`,
          opacity: 0.72,
          offset: 0.72,
        },
        {
          transform: `translate(${(wobble * 0.2).toFixed(2)}px, ${(-rise).toFixed(2)}px) scale(1.25)`,
          opacity: 0,
        },
      ],
    };
  });
}

const SEAFOAM_BUBBLES: readonly SeafoamBubble[] = buildSeafoamBubbles(1);

/** O(1) tag & role lookup sets for interactive targets that earn click feedback. */
const INTERACTIVE_TAGS = new Set([
  'button',
  'a',
  'input',
  'textarea',
  'select',
  'summary',
  'label',
]);

const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'tab',
  'menuitem',
  'menuitemradio',
  'menuitemcheckbox',
  'option',
  'checkbox',
  'radio',
  'switch',
  'combobox',
  'textbox',
]);

export interface ClickEffectOptions {
  /**
   * The backdrop reacts to bursts and pointer reactions are on. Glyph clicks then
   * cascade it: on interactive targets with particles, elsewhere without.
   */
  readonly cascade?: boolean;
  /**
   * Forward primary non-selection clicks to `onBurst` regardless of the active
   * `ClickEffectId` (used by backdrops that react to clicks themselves: Tier 2
   * `custom-scene` click bursts, Tier 3 `u_click`, Jungle Canopy, and Coral Shoreline).
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
    if (!node || typeof node.getAttribute !== 'function' || typeof node.localName !== 'string') {
      continue;
    }
    if (node.localName === 'body') {
      return false;
    }
    if (INTERACTIVE_TAGS.has(node.localName)) {
      return true;
    }
    const role = node.getAttribute('role');
    if (role !== null && INTERACTIVE_ROLES.has(role)) {
      return true;
    }
    if (node.getAttribute('contenteditable') === 'true') {
      return true;
    }
  }
  return false;
}

function animateAndRemove(
  el: HTMLElement,
  keyframes: Keyframe[],
  duration: number,
  delay = 0,
): void {
  if (typeof el.animate === 'function') {
    const anim = el.animate(keyframes, { duration, delay, easing: EASE_OUT, fill: 'forwards' });
    anim.onfinish = () => el.remove();
    anim.oncancel = () => el.remove();
    return;
  }
  setTimeout(() => el.remove(), duration + delay);
}

/** One particle with its keyframes, duration, and start delay (ms). */
type ParticleAnimation = readonly [HTMLSpanElement, Keyframe[], number, number];

export function mountClickEffects(
  doc: Document,
  onBurst?: (normX: number, normY: number) => void,
): ClickEffectsController {
  let effect: ClickEffectId = 'none';
  let palette: ThemePalette | null = null;
  let resolvedParams: Readonly<Record<string, unknown>> = {};
  let matrixGlyphPool: readonly string[] = MATRIX_BURST_GLYPHS;
  let supernovaEmberFrames: readonly Keyframe[][] = SUPERNOVA_EMBER_KEYFRAMES;
  let sparkFrames: readonly Keyframe[][] = DEFAULT_SPARK_KEYFRAMES;
  let tideMotes: readonly TideMote[] = TIDE_MOTES;
  let petalFrames: readonly Keyframe[][] = PETAL_KEYFRAMES;
  let seafoamBubbles: readonly SeafoamBubble[] = SEAFOAM_BUBBLES;
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
    if (!disposed && cascadeEnabled && onBurst && win.innerWidth > 0 && win.innerHeight > 0) {
      onBurst(x / win.innerWidth, y / win.innerHeight);
    }
  };

  const particle = (host: ParentNode, css: string): HTMLSpanElement => {
    const el = doc.createElement('span');
    el.style.cssText = `position:absolute;pointer-events:none;${css}`;
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
    const sun = palette && !palette.accentSecondary ? SUNLIGHT[palette.colorScheme] : secondary;
    const text = palette?.text ?? '#ffffff';
    const scale = (resolvedParams.scale as number | undefined) ?? 1;
    const ovalParticle = (
      parent: ParentNode,
      width: number,
      height: number,
      css: string,
      dx = 0,
      dy = 0,
    ): HTMLSpanElement =>
      particle(
        parent,
        `left:${x + dx}px;top:${y + dy}px;width:${width}px;height:${height}px;margin:${-height / 2}px 0 0 ${-width / 2}px;border-radius:50%;${css}`,
      );
    const circleParticle = (parent: ParentNode, diameter: number, css: string): HTMLSpanElement =>
      ovalParticle(parent, diameter, diameter, css);
    const runBatch = (
      build: (
        batch: DocumentFragment,
        queue: (el: HTMLSpanElement, frames: Keyframe[], duration: number, delay?: number) => void,
      ) => void,
    ): void => {
      const batch = doc.createDocumentFragment();
      const animations: ParticleAnimation[] = [];
      build(batch, (el, frames, duration, delay = 0) =>
        animations.push([el, frames, duration, delay]),
      );
      host.append(batch);
      for (const [el, frames, duration, delay] of animations) {
        animateAndRemove(el, frames, duration, delay);
      }
    };

    if (effect === 'tide') {
      const style = (resolvedParams.style as string | undefined) ?? 'both';
      // Two oval ripple rings spreading across the water, plus sea-sparkle motes
      // that blink on one after another and drift up as they fade.
      runBatch((batch, queue) => {
        if (style !== 'sparkle') {
          const inner = Math.round(46 * scale);
          const outer = Math.round(78 * scale);
          queue(
            ovalParticle(
              batch,
              inner,
              Math.round(inner * TIDE_RING_FLATTEN),
              `border:1.25px solid ${hexWithAlpha(accent, 0.85)};box-shadow:0 0 8px ${hexWithAlpha(accent, 0.35)},inset 0 0 8px ${hexWithAlpha(accent, 0.22)};opacity:0;`,
            ),
            TIDE_INNER_KEYFRAMES,
            520,
          );
          queue(
            ovalParticle(
              batch,
              outer,
              Math.round(outer * TIDE_RING_FLATTEN),
              `border:1px solid ${hexWithAlpha(secondary, 0.7)};box-shadow:0 0 10px ${hexWithAlpha(secondary, 0.24)};opacity:0;`,
            ),
            TIDE_OUTER_KEYFRAMES,
            700,
            80,
          );
        }
        if (style !== 'ripples') {
          const moteColors = [accent, secondary, hexWithAlpha(text, 0.95)] as const;
          for (let i = 0; i < tideMotes.length; i++) {
            const mote = tideMotes[i];
            if (!mote) {
              continue;
            }
            const size = Math.max(2, Math.round((i % 3 === 0 ? 4 : 3) * scale));
            const color = moteColors[i % moteColors.length] ?? accent;
            queue(
              ovalParticle(
                batch,
                size,
                size,
                `background:radial-gradient(circle, ${color} 0%, ${color} 55%, transparent 100%);opacity:0;`,
                mote.dx,
                mote.dy,
              ),
              mote.frames,
              620,
              40 + i * 45,
            );
          }
        }
      });
      return;
    }

    if (effect === 'petals') {
      const style = (resolvedParams.style as string | undefined) ?? 'both';
      // A dewdrop landing (one ring and a bright bead) and a scatter of petals and
      // small leaves that lift, turn over, and drift down.
      runBatch((batch, queue) => {
        if (style !== 'petals') {
          queue(
            circleParticle(
              batch,
              Math.round(44 * scale),
              `border:1.25px solid ${hexWithAlpha(accent, 0.8)};box-shadow:inset 0 0 6px ${hexWithAlpha(accent, 0.25)};opacity:0;`,
            ),
            DEW_RING_KEYFRAMES,
            460,
          );
          queue(
            circleParticle(
              batch,
              Math.max(6, Math.round(9 * scale)),
              `background:radial-gradient(circle at 35% 30%, ${hexWithAlpha(text, 0.95)} 0%, ${hexWithAlpha(accent, 0.55)} 55%, transparent 100%);opacity:0;`,
            ),
            DEW_BEAD_KEYFRAMES,
            380,
          );
        }
        if (style !== 'dew') {
          // Without a secondary accent `sun` uses sunbeam gold instead of repeating danger red.
          const petalColors = [sun, palette?.danger ?? '#fb7185', accent] as const;
          for (let i = 0; i < petalFrames.length; i++) {
            const frames = petalFrames[i];
            if (!frames) {
              continue;
            }
            const size = Math.max(5, Math.round((i % 3 === 0 ? 10 : 8) * scale));
            const color = petalColors[i % petalColors.length] ?? accent;
            queue(
              particle(
                batch,
                // Two opposite corners rounded fully make a petal (or a small leaf).
                `left:${x}px;top:${y}px;width:${size}px;height:${size}px;margin:${-size / 2}px 0 0 ${-size / 2}px;border-radius:0 100% 0 100%;background:linear-gradient(135deg, ${color} 0%, ${hexWithAlpha(color, 0.55)} 100%);opacity:0;`,
              ),
              frames,
              980,
              i * 28,
            );
          }
        }
      });
      return;
    }

    if (effect === 'seafoam') {
      const style = (resolvedParams.style as string | undefined) ?? 'both';
      const pearl = palette?.colorScheme === 'light' ? '#ffffff' : text;
      // A crisp sunlit surf crest splash + buoyant hollow glossy sea-bubbles.
      runBatch((batch, queue) => {
        if (style !== 'bubbles') {
          queue(
            circleParticle(
              batch,
              Math.round(48 * scale),
              `border:1.5px solid ${hexWithAlpha(accent, 0.85)};box-shadow:0 0 8px ${hexWithAlpha(pearl, 0.55)},inset 0 0 8px ${hexWithAlpha(accent, 0.24)};opacity:0;`,
            ),
            SEAFOAM_CREST_KEYFRAMES,
            460,
          );
          queue(
            circleParticle(
              batch,
              Math.round(74 * scale),
              `border:1px solid ${hexWithAlpha(sun, 0.65)};box-shadow:inset 0 0 6px ${hexWithAlpha(pearl, 0.45)};opacity:0;`,
            ),
            SEAFOAM_HALO_KEYFRAMES,
            600,
            60,
          );
        }
        if (style !== 'spray') {
          const pearlCore = hexWithAlpha(pearl, 0.95);
          const pearlMid = hexWithAlpha(pearl, 0.25);
          const pearlInner = hexWithAlpha(pearl, 0.7);
          const bubbleStyle = (rimColor: string): string =>
            `border:1px solid ${hexWithAlpha(rimColor, 0.82)};background:radial-gradient(circle at 32% 28%, ${pearlCore} 0%, ${pearlMid} 38%, ${hexWithAlpha(rimColor, 0.16)} 100%);box-shadow:inset 0 0 3px ${pearlInner};opacity:0;`;
          const accentBubbleCss = bubbleStyle(accent);
          const sunBubbleCss = bubbleStyle(sun);
          for (let i = 0; i < seafoamBubbles.length; i++) {
            const bubble = seafoamBubbles[i];
            if (!bubble) {
              continue;
            }
            queue(
              ovalParticle(
                batch,
                bubble.size,
                bubble.size,
                i % 3 === 0 ? sunBubbleCss : accentBubbleCss,
                bubble.dx,
                bubble.dy,
              ),
              bubble.frames,
              760,
              25 + i * 32,
            );
          }
        }
      });
      return;
    }

    if (effect === 'supernova') {
      const style = (resolvedParams.style as string | undefined) ?? 'both';
      const showRings = style === 'both' || style === 'rings';
      const showEmbers = style === 'both' || style === 'embers';
      // Dual-ring gravitational lensing pulse + 6 orbital photon embers (batched DOM insert).
      runBatch((batch, queue) => {
        if (showRings) {
          queue(
            circleParticle(
              batch,
              Math.round(54 * scale),
              `border:1.5px solid ${hexWithAlpha(accent, 0.95)};box-shadow:0 0 6px ${hexWithAlpha(accent, 0.45)};opacity:0;`,
            ),
            SUPERNOVA_INNER_KEYFRAMES,
            360,
          );
          queue(
            circleParticle(
              batch,
              Math.round(84 * scale),
              `border:1px solid ${hexWithAlpha(secondary, 0.8)};box-shadow:0 0 8px ${hexWithAlpha(secondary, 0.28)};opacity:0;`,
            ),
            SUPERNOVA_OUTER_KEYFRAMES,
            430,
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
            queue(
              circleParticle(
                batch,
                emberSize,
                `background:radial-gradient(circle, ${color} 0%, ${color} 55%, transparent 100%);opacity:0;`,
              ),
              frames,
              410,
            );
          }
        }
      });
      return;
    }

    if (effect === 'ripple') {
      // Refined hairline ring: ~32px radius scaled by `scale`, crisp 320ms ease-out.
      const ring = circleParticle(
        host,
        Math.round(64 * scale),
        `border:1.25px solid ${hexWithAlpha(accent, 0.9)};box-shadow:0 0 6px ${hexWithAlpha(accent, 0.18)};opacity:0;`,
      );
      animateAndRemove(ring, RIPPLE_KEYFRAMES, 320);
      return;
    }

    if (effect === 'glow-pulse') {
      // Whisper-soft radial kiss.
      const orb = circleParticle(
        host,
        Math.round(48 * scale),
        `background:radial-gradient(circle, ${hexWithAlpha(accent, 0.7)} 0%, ${hexWithAlpha(accent, 0.22)} 42%, transparent 70%);opacity:0;`,
      );
      animateAndRemove(orb, GLOW_PULSE_KEYFRAMES, 360);
      return;
    }

    if (effect === 'spark') {
      // Slender tapered micro-lines radiating outward (after React Bits ClickSpark).
      const bright = hexWithAlpha(text, 0.85);
      runBatch((batch, queue) => {
        for (let i = 0; i < sparkFrames.length; i++) {
          const frames = sparkFrames[i];
          if (!frames) {
            continue;
          }
          const color = i % 4 === 3 ? bright : accent;
          queue(
            particle(
              batch,
              `left:${x}px;top:${y}px;width:5px;height:1.5px;margin-top:-0.75px;border-radius:1px;transform-origin:0 50%;background:linear-gradient(90deg, transparent, ${color} 55%);opacity:0;`,
            ),
            frames,
            300,
          );
        }
      });
      return;
    }

    // 'matrix-burst': five delicate glyphs drifting gently upward + backdrop cascade.
    const pool = matrixGlyphPool;
    const altColor = hexWithAlpha(text, 0.85);
    const glyphShadow = hexWithAlpha(accent, 0.45);
    runBatch((batch, queue) => {
      for (let i = 0; i < MATRIX_BURST_KEYFRAMES.length; i++) {
        const frames = MATRIX_BURST_KEYFRAMES[i];
        if (!frames) {
          continue;
        }
        const glyph = particle(
          batch,
          `left:${x}px;top:${y}px;margin:-6px 0 0 -4px;font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:${i % 2 === 0 ? accent : altColor};text-shadow:0 0 6px ${glyphShadow};opacity:0;`,
        );
        glyph.textContent = pool[(i * 3) % pool.length] ?? '1';
        queue(glyph, frames, 380);
      }
    });
  };

  let pointerDownAttached = false;
  let clickAttached = false;

  const onPointerDown = (event: Event): void => {
    const pe = event as PointerEvent;
    if (pe.button !== 0 || prefersReducedMotion() || !isInteractiveClickTarget(pe)) {
      return;
    }
    // Cascade BEFORE spawning DOM nodes to avoid a forced synchronous layout read (`innerWidth`).
    if (alwaysCascade || effect === 'matrix-burst') {
      cascade(pe.clientX, pe.clientY);
    }
    if (effect !== 'none') {
      spawnAt(pe.clientX, pe.clientY);
    }
  };

  // Plain clicks on margins cascade interactive backdrops gently; drags that select text never do.
  const onClick = (event: Event): void => {
    const me = event as MouseEvent;
    if (
      disposed ||
      (!alwaysCascade && effect !== 'matrix-burst') ||
      !cascadeEnabled ||
      me.button !== 0 ||
      // Keyboard activation and scripted `.click()` report detail 0 and (0, 0) coordinates.
      me.detail === 0 ||
      prefersReducedMotion() ||
      isInteractiveClickTarget(me)
    ) {
      return;
    }
    const selection = doc.getSelection?.();
    if (selection && !selection.isCollapsed) {
      return;
    }
    cascade(me.clientX, me.clientY);
  };

  const syncListeners = (): void => {
    const needPointerDown = !disposed && (effect !== 'none' || (cascadeEnabled && alwaysCascade));
    if (needPointerDown !== pointerDownAttached) {
      pointerDownAttached = needPointerDown;
      if (needPointerDown) {
        doc.addEventListener('pointerdown', onPointerDown, {
          capture: true,
          passive: true,
          signal: abort.signal,
        });
      } else {
        doc.removeEventListener('pointerdown', onPointerDown, { capture: true });
      }
    }
    const needClick = !disposed && cascadeEnabled && (alwaysCascade || effect === 'matrix-burst');
    if (needClick !== clickAttached) {
      clickAttached = needClick;
      if (needClick) {
        doc.addEventListener('click', onClick, {
          capture: true,
          passive: true,
          signal: abort.signal,
        });
      } else {
        doc.removeEventListener('click', onClick, { capture: true });
      }
    }
  };

  return {
    setEffect(nextEffect, nextPalette, options) {
      effect = nextEffect;
      palette = nextPalette;
      resolvedParams = resolveEffectParams(getClickParamSpecs(nextEffect), options?.params);
      const nextScale = (resolvedParams.scale as number | undefined) ?? 1;
      if (nextEffect === 'matrix-burst') {
        const customGlyphs = Array.from(String(resolvedParams.glyphs ?? '').replace(/\s+/g, ''));
        matrixGlyphPool = customGlyphs.length > 0 ? customGlyphs : MATRIX_BURST_GLYPHS;
      } else if (nextEffect === 'supernova') {
        supernovaEmberFrames =
          nextScale === 1 ? SUPERNOVA_EMBER_KEYFRAMES : buildSupernovaEmberKeyframes(nextScale);
      } else if (nextEffect === 'spark') {
        const nextCount = Math.round((resolvedParams.count as number | undefined) ?? 8);
        sparkFrames =
          nextCount === 8 && nextScale === 1
            ? DEFAULT_SPARK_KEYFRAMES
            : buildSparkKeyframes(nextCount, nextScale);
      } else if (nextEffect === 'tide') {
        tideMotes = nextScale === 1 ? TIDE_MOTES : buildTideMotes(nextScale);
      } else if (nextEffect === 'petals') {
        petalFrames = nextScale === 1 ? PETAL_KEYFRAMES : buildPetalKeyframes(nextScale);
      } else if (nextEffect === 'seafoam') {
        seafoamBubbles = nextScale === 1 ? SEAFOAM_BUBBLES : buildSeafoamBubbles(nextScale);
      }
      cascadeEnabled = options?.cascade ?? false;
      alwaysCascade = Boolean(options?.alwaysCascade);
      if (effect === 'none') {
        removeOverlay();
      }
      syncListeners();
    },
    triggerAt(clientX, clientY) {
      if (effect === 'matrix-burst' && !prefersReducedMotion()) {
        cascade(clientX, clientY);
      }
      spawnAt(clientX, clientY);
    },
    destroy() {
      disposed = true;
      pointerDownAttached = false;
      clickAttached = false;
      abort.abort();
      removeOverlay();
    },
  };
}
