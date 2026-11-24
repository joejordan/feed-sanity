// Layer 1 — Live Stylesheet & CSS Custom Property Compiler.
//
// Automatically discovers neutral/brand CSS custom properties (`--*`) and
// author `CSSStyleRule` paint declarations across `document.styleSheets`,
// `shadowRoot.styleSheets`, and `adoptedStyleSheets`, compiling paint-only
// overrides mapped to the active `ThemePalette`.
//
// Invariants enforced by construction:
// 1. Paint-only: NEVER emits geometry properties (`width`, `height`, `padding`,
//    `margin`, `border-width`, `position`, `display`, `overflow`) -> zero
//    layout drift.
// 2. Non-transparent only: NEVER paints a `background-color` that was
//    `transparent` (`alpha === 0`) -> zero transparent-overlay occlusion.
// 3. Injection-safe & Trusted-Types safe: validates custom property identifiers,
//    splits selectors only on top-level commas, rejects unbalanced brackets or
//    unquoted braces, and isolates `::` pseudo-element rules.

import type { ThemeColorScheme, ThemePalette } from '../theming';
import type { OklchColor, PaintPropertyKind } from './color';
import { OWN_ATTR } from '../surface';
import { THEME_LAYER_ORDER } from '../theming/types';
import {
  hexWithAlpha,
  isNeutralColor,
  mapHostNeutralToPalette,
  matchesBrandHue,
  parseCssColor,
  rgbToOklch,
} from './color';

export interface AdaptiveCompilerOptions {
  /** Host site's native color scheme (`'dark' | 'light'`) measured prior to theming. */
  readonly hostScheme: ThemeColorScheme;
  /** Site root/theme selectors where host custom properties live (e.g. `[':root', '.__fb-dark-mode']`). */
  readonly rootSelectors?: readonly string[];
  /** Optional site brand hex colors (e.g. `['#1d9bf0']`) to remap to `palette.accent`. */
  readonly brandColors?: readonly string[];
  /** Selectors whose subtrees must never be recolored (video players, media viewers). */
  readonly mediaPreserveSelectors?: readonly string[];
  /** Optional extra style element IDs to skip (all `feed_sanity_*` IDs are always skipped). */
  readonly skipStyleIds?: ReadonlySet<string>;
  /** When true, canvas-tier backgrounds bind to `var(--fs-reveal-canvas, ...)` for live Studio backdrops. */
  readonly backdropActive?: boolean;
  /** Optional user typography stack compiled onto host rules that explicitly declare a non-icon `font-family`. */
  readonly fontFamily?: string;
}

const SAFE_CUSTOM_PROP = /^--[A-Za-z0-9_-]+$/;
const VAR_BG_HINT =
  /(?:^|[-_])(?:bg|background|surface|canvas|card|modal|sheet|popover|tray|wash|panel)(?:$|[-_])/i;
const VAR_FG_HINT =
  /(?:^|[-_])(?:fg|foreground|text|content|ink|icon|label|heading|title|tone|spinner)(?:$|[-_])/i;
const VAR_BORDER_HINT =
  /(?:^|[-_])(?:border|divider|stroke|outline|hairline|separator|ring)(?:$|[-_])/i;
const VAR_BRAND_HINT = /(?:^|[-_])(?:brand|accent|primary[-_]?btn|link|blue)(?:$|[-_])/i;
const VAR_SKIP_HINT =
  /(?:^|[-_])(?:fs|feed[-_]?sanity|danger|error|warn|success|green|red|yellow|gold|verified|shadow)(?:$|[-_])/i;
const ICON_OR_MONO_FONT_RE =
  /\b(?:icon|icons|symbol|symbols|fontawesome|icomoon|octicon|glyph|mono|monospace|courier|consolas|menlo|fira\s*code|jetbrains)\b/i;

const PAINT_PROPERTIES: ReadonlyArray<{
  readonly prop: string;
  readonly kind: PaintPropertyKind;
}> = [
  { prop: 'background-color', kind: 'background' },
  { prop: 'color', kind: 'text' },
  { prop: 'border-color', kind: 'border' },
  { prop: 'border-top-color', kind: 'border' },
  { prop: 'border-right-color', kind: 'border' },
  { prop: 'border-bottom-color', kind: 'border' },
  { prop: 'border-left-color', kind: 'border' },
  { prop: 'fill', kind: 'text' },
  { prop: 'stroke', kind: 'border' },
];

const PAINT_PROPERTY_MAP = new Map<string, PaintPropertyKind>(
  PAINT_PROPERTIES.map(({ prop, kind }) => [prop, kind]),
);

// Match media element type selectors (`video.player`, `div > img`, `canvas`) without
// falsely matching class names like `.canvas-shell` or `.video-feed`.
const MEDIA_SELECTOR_HINT =
  /(?:^|[\s>+~(,])(?:video|img|picture|canvas|iframe)(?=$|[\s.#[:>+~),])/i;
const ROOT_SELECTOR_HINT =
  /(?:^|,)\s*(?::root|:host\b|html\b|body\b|\[data-theme\b|\.__fb-(?:dark|light)-mode\b|shreddit-app\b)/i;
const PURE_ROOT_SELECTOR =
  /^(?::root|:host(?:\([^)]*\))?|html(?:\.[A-Za-z0-9_-]+|\[[^\]]+\])*|body(?:\.[A-Za-z0-9_-]+|\[[^\]]+\])*|\[data-theme(?:=[^\]]+)?\]|\.__fb-(?:dark|light)-mode)$/i;
const HOST_PSEUDO_HINT = /:host(?:-context)?\b/i;
const MAX_RULES_PER_ROOT = 4000;

interface RawStyleEntry {
  readonly selector: string;
  readonly paint: ReadonlyArray<{
    readonly prop: string;
    readonly kind: PaintPropertyKind;
    readonly raw: string;
  }>;
  readonly hasNonIconFont: boolean;
}

interface RawSheetExtraction {
  readonly ruleCount: number;
  readonly rootVars: ReadonlyArray<{
    readonly selector: string;
    readonly name: string;
    readonly value: string;
  }>;
  readonly entries: readonly RawStyleEntry[];
}

/** Per-stylesheet parsed extraction cache so lazy-loading one `<style>` never re-parses existing sheets. */
const sheetCache = new WeakMap<CSSStyleSheet, RawSheetExtraction>();

function isOwnStyleElement(el: Element, skipIds: ReadonlySet<string> | undefined): boolean {
  if (el.hasAttribute(OWN_ATTR)) {
    return true;
  }
  return el.id !== '' && (el.id.startsWith('feed_sanity_') || Boolean(skipIds?.has(el.id)));
}

function isOwnStyleSheet(sheet: CSSStyleSheet, skipIds: ReadonlySet<string> | undefined): boolean {
  const owner = sheet.ownerNode;
  // Use `nodeType` instead of `instanceof Element` so same-origin iframe `<style>`
  // elements created in another realm are still recognized and skipped.
  if (!owner || owner.nodeType !== Node.ELEMENT_NODE) {
    return false;
  }
  return isOwnStyleElement(owner as Element, skipIds);
}

function collectOwnSheets(
  root: Document | ShadowRoot,
  skipIds: ReadonlySet<string> | undefined,
): Set<CSSStyleSheet> {
  const own = new Set<CSSStyleSheet>();
  for (const styleEl of root.querySelectorAll('style')) {
    if (isOwnStyleElement(styleEl, skipIds)) {
      const sheet = (styleEl as HTMLStyleElement).sheet;
      if (sheet) {
        own.add(sheet);
      }
    }
  }
  return own;
}

function collectStyleSheets(
  root: Document | ShadowRoot,
  skipIds: ReadonlySet<string> | undefined,
): CSSStyleSheet[] {
  const ownSheets = collectOwnSheets(root, skipIds);
  const seen = new Set<CSSStyleSheet>();
  const add = (sheet: CSSStyleSheet | null | undefined): void => {
    if (sheet && !ownSheets.has(sheet)) {
      seen.add(sheet);
    }
  };
  const styleSheetCount = root.styleSheets?.length ?? 0;
  if (root.styleSheets && styleSheetCount > 0) {
    for (const sheet of Array.from(root.styleSheets)) {
      add(sheet);
    }
  } else {
    // Fallback for DOM implementations where `shadowRoot.styleSheets` or detached `doc.styleSheets` is unpopulated.
    for (const styleEl of root.querySelectorAll('style')) {
      add((styleEl as HTMLStyleElement).sheet);
    }
  }
  if ('adoptedStyleSheets' in root && Array.isArray(root.adoptedStyleSheets)) {
    for (const sheet of root.adoptedStyleSheets) {
      add(sheet);
    }
  }
  return [...seen];
}

/**
 * Splits a CSS selector list strictly on top-level commas (outside `(...)`,
 * `[...]`, and `'...'`/`"..."` strings), rejecting any selector containing
 * unbalanced brackets/quotes or unquoted `{`/`}` characters.
 */
export function splitSelectorList(selector: string): string[] {
  const parts: string[] = [];
  let parenDepth = 0;
  let bracketDepth = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let start = 0;

  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i] ?? '';
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '(') {
      parenDepth++;
    } else if (ch === ')') {
      parenDepth--;
      if (parenDepth < 0) {
        return [];
      }
    } else if (ch === '[') {
      bracketDepth++;
    } else if (ch === ']') {
      bracketDepth--;
      if (bracketDepth < 0) {
        return [];
      }
    } else if (ch === '{' || ch === '}') {
      // Reject unquoted braces so untrusted CSS can never break out of a rule block.
      return [];
    } else if (ch === ',' && parenDepth === 0 && bracketDepth === 0) {
      const part = selector.slice(start, i).trim();
      if (part) {
        parts.push(part);
      }
      start = i + 1;
    }
  }

  if (parenDepth !== 0 || bracketDepth !== 0 || quote !== null || escaped) {
    return [];
  }
  const tail = selector.slice(start).trim();
  if (tail) {
    parts.push(tail);
  }
  return parts;
}

function classifyCustomProperty(
  name: string,
  rawValue: string,
  hostScheme: ThemeColorScheme,
  palette: ThemePalette,
  brandOklch: readonly OklchColor[],
): string | null {
  if (!SAFE_CUSTOM_PROP.test(name) || VAR_SKIP_HINT.test(name)) {
    return null;
  }
  const color = parseCssColor(rawValue);
  if (!color || color.a <= 0.005) {
    return null;
  }
  const oklch = rgbToOklch(color);
  if (matchesBrandHue(color, brandOklch, oklch)) {
    return color.a < 0.99 ? hexWithAlpha(palette.accent, color.a) : palette.accent;
  }
  if (!isNeutralColor(color, 0.045, oklch)) {
    return null;
  }
  // Check foreground & background roles BEFORE border so compound tokens like
  // `--progress-ring-neutral-foreground` / `--progress-ring-neutral-background`
  // classify accurately rather than matching `ring` as a border token.
  if (VAR_FG_HINT.test(name)) {
    return mapHostNeutralToPalette(color, hostScheme, 'text', palette, oklch);
  }
  if (VAR_BG_HINT.test(name)) {
    return mapHostNeutralToPalette(color, hostScheme, 'background', palette, oklch);
  }
  if (VAR_BORDER_HINT.test(name)) {
    return mapHostNeutralToPalette(color, hostScheme, 'border', palette, oklch);
  }
  if (VAR_BRAND_HINT.test(name)) {
    return color.a < 0.99 ? hexWithAlpha(palette.accent, color.a) : palette.accent;
  }
  return null;
}

function shouldSkipSelector(selector: string): boolean {
  const trimmed = selector.trim();
  if (!trimmed || trimmed.includes(OWN_ATTR) || trimmed.includes('feed-sanity')) {
    return true;
  }
  return (
    trimmed === '*' ||
    trimmed.startsWith('::') ||
    PURE_ROOT_SELECTOR.test(trimmed) ||
    MEDIA_SELECTOR_HINT.test(trimmed)
  );
}

interface GuardedSelectors {
  readonly groupable: string[];
  readonly isolated: string[];
}

function guardSelector(selector: string, excludeClause: string): GuardedSelectors {
  const groupable: string[] = [];
  const isolated: string[] = [];
  for (const clean of splitSelectorList(selector)) {
    if (shouldSkipSelector(clean)) {
      continue;
    }
    // Keep pseudo-elements (`::before`, `::-moz-placeholder`, etc.) in isolated single
    // rules so an unsupported cross-browser vendor pseudo-element never invalidates a
    // grouped rule bucket, and never wrap `:host` in compound `:not(...)` clauses.
    if (clean.includes('::')) {
      isolated.push(clean);
      continue;
    }
    if (HOST_PSEUDO_HINT.test(clean)) {
      isolated.push(clean);
      continue;
    }
    // Inside `@layer fs-adaptive`, Layer 1 already sits strictly below `fs-mapping`,
    // `fs-reveal`, `fs-finish`, `fs-healer`, and `fs-user` — no `:where(...)` wrapping
    // needed, preserving Blink/Gecko O(1) class/attribute RuleSet bucketing!
    groupable.push(excludeClause ? `${clean}${excludeClause}` : clean);
  }
  return { groupable, isolated };
}

function mapPaintProperty(
  prop: string,
  kind: PaintPropertyKind,
  raw: string,
  hostScheme: ThemeColorScheme,
  palette: ThemePalette,
  brandOklch: readonly OklchColor[],
  backdropActive: boolean,
): string | null {
  const color = parseCssColor(raw);
  if (!color || color.a <= 0.005) {
    return null;
  }
  const oklch = rgbToOklch(color);
  let mapped: string | null = null;
  if (matchesBrandHue(color, brandOklch, oklch)) {
    mapped = color.a < 0.99 ? hexWithAlpha(palette.accent, color.a) : palette.accent;
  } else if (isNeutralColor(color, 0.045, oklch)) {
    mapped = mapHostNeutralToPalette(color, hostScheme, kind, palette, oklch);
    // When a Studio backdrop is active, bind opaque canvas-tier backgrounds to
    // `--fs-reveal-canvas` so outer shell wrappers turn transparent automatically
    // while reading columns, cards, and popups re-bind `--fs-reveal-canvas` cleanly.
    if (
      backdropActive &&
      kind === 'background' &&
      color.a >= 0.99 &&
      mapped === palette.background
    ) {
      mapped = `var(--fs-reveal-canvas, ${palette.background})`;
    }
  }
  return mapped ? `${prop}: ${mapped} !important;` : null;
}

function extractRawPaint(style: CSSStyleDeclaration): ReadonlyArray<{
  readonly prop: string;
  readonly kind: PaintPropertyKind;
  readonly raw: string;
}> {
  const out: Array<{
    readonly prop: string;
    readonly kind: PaintPropertyKind;
    readonly raw: string;
  }> = [];
  if (style.length > 0 && style.length <= 4) {
    for (const prop of Array.from(style)) {
      const kind = PAINT_PROPERTY_MAP.get(prop);
      if (!kind) {
        continue;
      }
      const raw = style.getPropertyValue(prop);
      if (raw) {
        out.push({ prop, kind, raw });
      }
    }
    return out;
  }
  for (const { prop, kind } of PAINT_PROPERTIES) {
    const raw = style.getPropertyValue(prop);
    if (raw) {
      out.push({ prop, kind, raw });
    }
  }
  return out;
}

function isRootVarSelector(
  selector: string,
  rootSelectors: readonly string[] | undefined,
): boolean {
  if (ROOT_SELECTOR_HINT.test(selector)) {
    return true;
  }
  if (!rootSelectors || rootSelectors.length === 0) {
    return false;
  }
  for (const rootSel of rootSelectors) {
    const trimmed = rootSel.trim();
    if (trimmed && trimmed !== ':root' && selector.includes(trimmed)) {
      return true;
    }
  }
  return false;
}

function extractSheet(
  sheet: CSSStyleSheet,
  rules: CSSRuleList,
  matchesMedia: (cond: string) => boolean,
  rootSelectors: readonly string[] | undefined,
): RawSheetExtraction {
  const cached = sheetCache.get(sheet);
  if (cached && cached.ruleCount === rules.length) {
    return cached;
  }
  const rootVars: Array<{
    readonly selector: string;
    readonly name: string;
    readonly value: string;
  }> = [];
  const entries: RawStyleEntry[] = [];
  let inspected = 0;

  const walk = (list: CSSRuleList): void => {
    for (const rule of Array.from(list)) {
      if (inspected >= MAX_RULES_PER_ROOT) {
        return;
      }
      if (rule.type === 1) {
        inspected++;
        const styleRule = rule as CSSStyleRule;
        const selector = styleRule.selectorText;
        if (!selector) {
          continue;
        }
        const style = styleRule.style;
        if (isRootVarSelector(selector, rootSelectors)) {
          for (const propName of Array.from(style)) {
            if (!propName.startsWith('--')) {
              continue;
            }
            const rawVal = style.getPropertyValue(propName).trim();
            if (rawVal) {
              rootVars.push({ selector, name: propName, value: rawVal });
            }
          }
        }
        const paint = extractRawPaint(style);
        const rawFont = style.getPropertyValue('font-family').trim();
        const hasNonIconFont =
          rawFont.length > 0 && !ICON_OR_MONO_FONT_RE.test(rawFont) && !/\bicon\b/i.test(selector);
        if (paint.length > 0 || hasNonIconFont) {
          entries.push({ selector, paint, hasNonIconFont });
        }
      } else if ('cssRules' in rule) {
        if (rule.type === 4) {
          const mediaRule = rule as CSSMediaRule;
          const cond = mediaRule.conditionText ?? mediaRule.media?.mediaText ?? '';
          if (!matchesMedia(cond)) {
            continue;
          }
        }
        try {
          walk((rule as CSSGroupingRule).cssRules);
        } catch {
          // Ignore inaccessible nested rule lists.
        }
      }
    }
  };

  walk(rules);
  const extracted: RawSheetExtraction = { ruleCount: rules.length, rootVars, entries };
  sheetCache.set(sheet, extracted);
  return extracted;
}

/**
 * Inspects accessible author stylesheets in `root` (`Document` or open
 * `ShadowRoot`) and compiles paint-only CSS overrides for discovered neutral
 * custom properties, atomic/component color rules, and explicit host typography
 * rules inside `@layer fs-adaptive`.
 */
export function compileAdaptiveRootCss(
  root: Document | ShadowRoot,
  palette: ThemePalette | null,
  options: AdaptiveCompilerOptions,
): string {
  const fontFamily = options.fontFamily?.trim() || undefined;
  if (!palette && !fontFamily) {
    return '';
  }
  const isShadow = root.nodeType === Node.DOCUMENT_FRAGMENT_NODE;
  const win = isShadow ? root.ownerDocument?.defaultView : (root as Document).defaultView;
  const mediaMatchesCache = new Map<string, boolean>();
  const skipIds = options.skipStyleIds;
  const backdropActive = options.backdropActive === true;
  const brandOklch = (options.brandColors ?? [])
    .map((hex) => parseCssColor(hex))
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .map((c) => rgbToOklch(c));

  const excludeItems = [
    `[${OWN_ATTR}]`,
    `[${OWN_ATTR}] *`,
    'video',
    'img',
    'canvas',
    ...(options.mediaPreserveSelectors ?? []),
  ];
  const excludeClause = `:not(:where(${excludeItems.join(', ')}))`;

  const discoveredVars = new Map<string, string>();
  const declToSelectors = new Map<string, Set<string>>();
  const isolatedRules = new Set<string>();
  const fontSelectors = new Set<string>();

  const matchesMedia = (cond: string): boolean => {
    if (!cond) {
      return true;
    }
    if (cond.includes('print')) {
      return false;
    }
    const cached = mediaMatchesCache.get(cond);
    if (cached !== undefined) {
      return cached;
    }
    const result =
      win && typeof win.matchMedia === 'function' ? win.matchMedia(cond).matches : true;
    mediaMatchesCache.set(cond, result);
    return result;
  };

  for (const sheet of collectStyleSheets(root, options.skipStyleIds)) {
    if (isOwnStyleSheet(sheet, skipIds)) {
      continue;
    }
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      // Cross-origin stylesheet: handled in real time by Layer 2 (`ThemeHealer`).
      continue;
    }
    const extracted = extractSheet(sheet, rules, matchesMedia, options.rootSelectors);
    if (palette) {
      for (const { name, value } of extracted.rootVars) {
        const mappedVar = classifyCustomProperty(
          name,
          value,
          options.hostScheme,
          palette,
          brandOklch,
        );
        if (mappedVar) {
          discoveredVars.set(name, mappedVar);
        }
      }
    }
    for (const entry of extracted.entries) {
      if (palette && entry.paint.length > 0) {
        const decls: string[] = [];
        for (const { prop, kind, raw } of entry.paint) {
          const mapped = mapPaintProperty(
            prop,
            kind,
            raw,
            options.hostScheme,
            palette,
            brandOklch,
            backdropActive,
          );
          if (mapped) {
            decls.push(mapped);
          }
        }
        if (decls.length > 0) {
          const { groupable, isolated } = guardSelector(entry.selector, excludeClause);
          const block = decls.join(' ');
          if (groupable.length > 0) {
            let set = declToSelectors.get(block);
            if (!set) {
              set = new Set();
              declToSelectors.set(block, set);
            }
            for (const sel of groupable) {
              set.add(sel);
            }
          }
          for (const sel of isolated) {
            isolatedRules.add(`${sel} { ${block} }`);
          }
        }
      }
      if (fontFamily && entry.hasNonIconFont) {
        const { groupable } = guardSelector(
          entry.selector,
          `:not(:where([${OWN_ATTR}], [${OWN_ATTR}] *, code, pre, kbd, samp, svg *))`,
        );
        for (const sel of groupable) {
          fontSelectors.add(sel);
        }
      }
    }
  }

  const chunks: string[] = [];
  if (discoveredVars.size > 0) {
    let varTarget: string;
    if (isShadow) {
      const shadowRoots = (options.rootSelectors ?? [':root']).map((sel) =>
        sel.trim() === ':root' ? ':host' : sel,
      );
      if (!shadowRoots.includes(':host')) {
        shadowRoots.unshift(':host');
      }
      varTarget = shadowRoots.join(', ');
    } else if (options.rootSelectors && options.rootSelectors.length > 0) {
      varTarget = options.rootSelectors.join(', ');
    } else {
      varTarget = ':root, [data-theme]';
    }
    const lines = [...discoveredVars.entries()].map(([k, v]) => `  ${k}: ${v} !important;`);
    chunks.push(`${varTarget} {\n${lines.join('\n')}\n}`);
  }
  for (const [block, selectors] of declToSelectors) {
    chunks.push(`${[...selectors].join(', ')} { ${block} }`);
  }
  for (const rule of isolatedRules) {
    chunks.push(rule);
  }
  if (fontFamily && fontSelectors.size > 0) {
    chunks.push(`${[...fontSelectors].join(', ')} { font-family: ${fontFamily} !important; }`);
  }
  if (chunks.length === 0) {
    return '';
  }
  return `${THEME_LAYER_ORDER}\n@layer fs-adaptive {\n${chunks.join('\n')}\n}`;
}
