// Layer 3 — Objective Theme Coverage & Layout-Integrity Auditor.
//
// Verifies four invariants across light DOM + open Shadow Roots (both in
// Playwright CI gates and in the live Appearance panel's "Audit page" tool):
// 1. WCAG AA text contrast (`contrast`)
// 2. Opposite-polarity neutral surface leaks (`polarity-leak`)
// 3. Unexpected resize or reposition after theming (`layout-shift`)
// 4. Sticky/fixed header or transparent-to-opaque wrapper covering content
//    below (`header-occlusion`, catching bugs like X's "Post" header covering
//    the top of a post)

import type { ThemeColorScheme, ThemePalette } from '../theming';
import type { RgbaColor } from './color';
import { containsAcrossShadows } from '../dom';
import { scrubCommonPii } from '../pii';
import { isOppositePolarityNeutral, parseCssColor, rgbaContrastRatio } from './color';
import {
  hasDirectText,
  isIntentionalInvertedPill,
  isOwnUiElement,
  isStyleHidden,
  NON_VISUAL_OR_MEDIA_TAGS,
  resolveEffectiveBackground,
} from './healer';

export type ThemeViolationKind = 'contrast' | 'header-occlusion' | 'layout-shift' | 'polarity-leak';

export interface ThemeViolation {
  readonly kind: ThemeViolationKind;
  /** Human-readable selector path (PII-free tag/id/role/testid). */
  readonly selector: string;
  readonly detail: string;
}

export interface ThemeAuditSummary {
  readonly contrast: number;
  readonly polarityLeak: number;
  readonly layoutShift: number;
  readonly headerOcclusion: number;
}

export interface ThemeAuditReport {
  /** 0..100 percentage of inspected elements with zero violations. */
  readonly score: number;
  readonly totalChecked: number;
  readonly violations: readonly ThemeViolation[];
  readonly summary: ThemeAuditSummary;
}

export interface ElementLayoutSample {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly bgAlpha: number;
  readonly position: string;
}

export type LayoutSnapshot = Map<Element, ElementLayoutSample>;

export interface ThemeAuditOptions {
  /** Snapshot captured BEFORE applying the theme to detect unexpected resizes, shifts, and transparent-to-opaque occlusions. */
  readonly beforeSnapshot?: LayoutSnapshot;
  /** Skip `layout-shift` checks when the user intentionally changed `fontFamily`. */
  readonly ignoreLayoutShift?: boolean;
  /** Selectors whose subtrees represent media content (video players, photo viewers). */
  readonly mediaPreserveSelectors?: readonly string[];
  /** Pixel tolerance for geometry comparisons (defaults to `2`). */
  readonly geometryTolerancePx?: number;
  /** Maximum elements to inspect (defaults to `1200`). */
  readonly maxElements?: number;
  /** Optional native host polarity so ordinary dark/light host buttons aren't misclassified as inverted CTAs. */
  readonly hostScheme?: ThemeColorScheme;
}

const SKIP_AUDIT_TAGS = new Set([...NON_VISUAL_OR_MEDIA_TAGS, 'svg', 'path']);
const SENSITIVE_ATTR_PATTERN = /(?:useravatar-container-|^\d{6,}-|pfbid|thread-f:|fmfcg|@)/i;

interface RectLike {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function sanitizeAttrToken(raw: string): string | null {
  const scrubbed = scrubCommonPii(raw).trim();
  if (!scrubbed || scrubbed !== raw.trim() || SENSITIVE_ATTR_PATTERN.test(scrubbed)) {
    return null;
  }
  return scrubbed;
}

function describeElement(el: Element): string {
  const tag = el.localName;
  const rawTestId = el.getAttribute('data-testid');
  if (rawTestId) {
    const safeTestId = sanitizeAttrToken(rawTestId);
    if (safeTestId) {
      return `${tag}[data-testid="${safeTestId}"]`;
    }
  }
  if (el.id) {
    const safeId = sanitizeAttrToken(el.id);
    if (safeId) {
      return `${tag}#${safeId}`;
    }
  }
  const role = el.getAttribute('role');
  if (role) {
    return `${tag}[role="${role}"]`;
  }
  return tag;
}

function rectsOverlapArea(a: RectLike, b: RectLike): number {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return x * y;
}

function collectAuditElements(
  doc: Document,
  mediaSelector: string,
  maxElements: number,
): Element[] {
  const result: Element[] = [];
  const walk = (root: ParentNode): void => {
    if (result.length >= maxElements) {
      return;
    }
    for (const child of root.children) {
      if (result.length >= maxElements) {
        return;
      }
      if (SKIP_AUDIT_TAGS.has(child.localName) || isOwnUiElement(child)) {
        continue;
      }
      if (mediaSelector) {
        try {
          if (child.matches(mediaSelector)) {
            continue;
          }
        } catch {
          // Ignore invalid selector.
        }
      }
      result.push(child);
      if (child.shadowRoot) {
        walk(child.shadowRoot);
      }
      if (child.childElementCount > 0) {
        walk(child);
      }
    }
  };
  if (doc.body) {
    walk(doc.body);
  }
  return result;
}

/**
 * Captures pre-theme layout geometry and background opacity across light DOM
 * and open Shadow Roots so `auditThemeCoverage` can detect unexpected element
 * resizes, repositions, and transparent-to-opaque occlusions.
 */
export function captureLayoutSnapshot(
  doc: Document,
  options: Pick<ThemeAuditOptions, 'maxElements' | 'mediaPreserveSelectors'> = {},
): LayoutSnapshot {
  const view = doc.defaultView ?? globalThis;
  const mediaSelector = options.mediaPreserveSelectors?.join(', ') ?? '';
  const elements = collectAuditElements(doc, mediaSelector, options.maxElements ?? 1200);
  const snapshot: LayoutSnapshot = new Map();

  for (const el of elements) {
    const style = view.getComputedStyle(el);
    if (isStyleHidden(style)) {
      continue;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) {
      continue;
    }
    const bg = parseCssColor(style.backgroundColor);
    snapshot.set(el, {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      bgAlpha: bg?.a ?? 0,
      position: style.position,
    });
  }
  return snapshot;
}

/**
 * Audits visible elements across light DOM and open Shadow Roots for contrast
 * failures, opposite-polarity leaks, unexpected layout shifts/resizes, and
 * sticky/fixed header or transparent-to-opaque overlay occlusions.
 */
export function auditThemeCoverage(
  doc: Document,
  palette: ThemePalette,
  options: ThemeAuditOptions = {},
): ThemeAuditReport {
  const view = doc.defaultView ?? globalThis;
  const mediaSelector = options.mediaPreserveSelectors?.join(', ') ?? '';
  const tolerance = options.geometryTolerancePx ?? 2;
  const elements = collectAuditElements(doc, mediaSelector, options.maxElements ?? 1200);
  const fallbackBg: RgbaColor = parseCssColor(palette.background) ?? {
    r: 255,
    g: 255,
    b: 255,
    a: 1,
  };
  const paletteSurfaces: RgbaColor[] = [palette.background, palette.surface, palette.surfaceAlt]
    .map((hex) => parseCssColor(hex))
    .filter((c): c is RgbaColor => c !== null);
  const matchesPaletteSurface = (c: RgbaColor): boolean =>
    paletteSurfaces.some(
      (s) => Math.abs(c.r - s.r) <= 4 && Math.abs(c.g - s.g) <= 4 && Math.abs(c.b - s.b) <= 4,
    );
  const bgCache = new Map<Element, RgbaColor>();

  const violations: ThemeViolation[] = [];
  const violatedElements = new Set<Element>();
  const textBoxes: Array<{ el: Element; rect: DOMRect }> = [];
  const overlayCandidates: Array<{
    el: Element;
    rect: DOMRect;
    position: string;
    wasTransparent: boolean;
    grewOrShifted: boolean;
  }> = [];

  let totalChecked = 0;
  let contrastCount = 0;
  let polarityCount = 0;
  let layoutShiftCount = 0;
  let occlusionCount = 0;

  for (const el of elements) {
    const style = view.getComputedStyle(el);
    if (isStyleHidden(style)) {
      continue;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) {
      continue;
    }
    totalChecked++;

    const bg = parseCssColor(style.backgroundColor);
    const fg = parseCssColor(style.color);
    const bgAlpha = bg?.a ?? 0;

    // 1. Check WCAG AA text contrast on elements with direct readable text.
    if (fg && fg.a >= 0.3 && hasDirectText(el)) {
      textBoxes.push({ el, rect });
      const effectiveBg = resolveEffectiveBackground(el, view, fallbackBg, bgCache);
      const ratio = rgbaContrastRatio(fg, effectiveBg);
      const fontSize = Number.parseFloat(style.fontSize || '14');
      const fontWeight = Number.parseInt(style.fontWeight || '400', 10);
      const isLarge = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
      const minRatio = isLarge ? 3.0 : 4.5;
      if (ratio < minRatio) {
        contrastCount++;
        violatedElements.add(el);
        violations.push({
          kind: 'contrast',
          selector: describeElement(el),
          detail: `Contrast ${ratio.toFixed(2)}:1 < ${minRatio}:1 (fg ${style.color} on effective bg rgb(${effectiveBg.r}, ${effectiveBg.g}, ${effectiveBg.b}))`,
        });
      }
    }

    // 2. Check opposite-polarity opaque neutral surface leaks (excluding compact high-contrast CTAs
    //    and surfaces explicitly matching the user's chosen palette colors).
    if (
      bg &&
      isOppositePolarityNeutral(bg, palette.colorScheme) &&
      !matchesPaletteSurface(bg) &&
      !isIntentionalInvertedPill(el, bg, fg, rect, options.hostScheme)
    ) {
      polarityCount++;
      violatedElements.add(el);
      violations.push({
        kind: 'polarity-leak',
        selector: describeElement(el),
        detail: `Unthemed ${palette.colorScheme === 'light' ? 'dark' : 'light'} surface (${style.backgroundColor})`,
      });
    }

    // 3. Check unexpected geometry resize or reposition against pre-theme snapshot.
    const before = options.beforeSnapshot?.get(el);
    let grewOrShifted = false;
    if (before && !options.ignoreLayoutShift) {
      const dx = Math.abs(rect.x - before.x);
      const dy = Math.abs(rect.y - before.y);
      const dw = Math.abs(rect.width - before.width);
      const dh = Math.abs(rect.height - before.height);
      if (dx > tolerance || dy > tolerance || dw > tolerance || dh > tolerance) {
        grewOrShifted = true;
        layoutShiftCount++;
        violatedElements.add(el);
        violations.push({
          kind: 'layout-shift',
          selector: describeElement(el),
          detail: `Moved/resized after theming (Δx=${dx.toFixed(1)}, Δy=${dy.toFixed(1)}, Δw=${dw.toFixed(1)}, Δh=${dh.toFixed(1)})`,
        });
      }
    }

    // Collect sticky/fixed/absolute/newly-opaque elements for occlusion checks.
    const wasTransparent = before !== undefined && before.bgAlpha <= 0.05 && bgAlpha >= 0.2;
    const isOverlayPosition =
      style.position === 'sticky' || style.position === 'fixed' || style.position === 'absolute';
    if (bgAlpha >= 0.2 && (isOverlayPosition || wasTransparent)) {
      overlayCandidates.push({
        el,
        rect,
        position: style.position,
        wasTransparent,
        grewOrShifted,
      });
    }
  }

  // 4. Check header / overlay occlusion: a sticky/fixed/newly-opaque overlay covering non-descendant visible text.
  const scrollY = view.scrollY ?? 0;
  for (const overlay of overlayCandidates) {
    if (scrollY > 2 && !overlay.wasTransparent && !overlay.grewOrShifted) {
      continue;
    }
    for (const target of textBoxes) {
      if (target.el === overlay.el) {
        continue;
      }
      // Check cheap rect intersection arithmetic BEFORE Shadow-piercing DOM ancestry walks.
      const overlap = rectsOverlapArea(overlay.rect, target.rect);
      const targetArea = target.rect.width * target.rect.height;
      if (overlap <= 0 || targetArea <= 0 || overlap / targetArea < 0.15) {
        continue;
      }
      if (
        containsAcrossShadows(overlay.el, target.el) ||
        containsAcrossShadows(target.el, overlay.el)
      ) {
        continue;
      }
      const beforeOverlay = options.beforeSnapshot?.get(overlay.el);
      const beforeTarget = options.beforeSnapshot?.get(target.el);
      const alreadyOverlappedOpaque =
        beforeOverlay !== undefined &&
        beforeTarget !== undefined &&
        beforeOverlay.bgAlpha >= 0.2 &&
        rectsOverlapArea(beforeOverlay, beforeTarget) /
          Math.max(1, beforeTarget.width * beforeTarget.height) >=
          0.15;
      if (alreadyOverlappedOpaque && !overlay.grewOrShifted) {
        continue;
      }
      occlusionCount++;
      violatedElements.add(overlay.el);
      let reason = `${overlay.position} overlay`;
      if (overlay.wasTransparent) {
        reason = 'became opaque after theming';
      } else if (overlay.grewOrShifted) {
        reason = 'resized/shifted after theming';
      }
      violations.push({
        kind: 'header-occlusion',
        selector: describeElement(overlay.el),
        detail: `${reason} covers ${Math.round((overlap / targetArea) * 100)}% of ${describeElement(target.el)}`,
      });
      break;
    }
  }

  const score =
    totalChecked === 0
      ? 100
      : Math.max(0, Math.round(((totalChecked - violatedElements.size) / totalChecked) * 100));

  return {
    score,
    totalChecked,
    violations,
    summary: {
      contrast: contrastCount,
      polarityLeak: polarityCount,
      layoutShift: layoutShiftCount,
      headerOcclusion: occlusionCount,
    },
  };
}
