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
import type { OklchColor, PaintPropertyKind, RgbaColor } from './color';
import { OWN_ATTR } from '../surface';
import { formatRootSelectors, withThemeLayerOrder, wrapThemeLayer } from '../theming/types';
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
  /** Optional callback receiving the total accessible host CSSOM rule count inspected for this root. */
  readonly onSheetRuleCount?: (count: number) => void;
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
const PURE_ROOT_SELECTOR =
  /^(?::root|:host(?:\([^)]*\))?|html(?:\.[A-Za-z0-9_-]+|\[[^\]]+\])*|body(?:\.[A-Za-z0-9_-]+|\[[^\]]+\])*|\[data-theme(?:=[^\]]+)?\]|\.__fb-(?:dark|light)-mode)$/i;
const HOST_PSEUDO_HINT = /:host(?:-context)?\b/i;
const MAX_RULES_PER_ROOT = 12_000;
const FONT_EXCLUDE_CLAUSE = `:not(:where([${OWN_ATTR}], [${OWN_ATTR}] *, code, pre, kbd, samp, svg *))`;

interface ParsedPaintDecl {
  readonly prop: string;
  readonly kind: PaintPropertyKind;
  readonly color: RgbaColor;
  readonly oklch: OklchColor;
}

interface ParsedRootVar {
  readonly name: string;
  readonly color: RgbaColor;
  readonly oklch: OklchColor;
  /** Optional polarity scope when declared exclusively on a dark/dim or light root selector. */
  readonly scheme?: ThemeColorScheme;
}

interface ParsedStyleEntry {
  readonly groupableRaw: readonly string[];
  readonly isolated: readonly string[];
  readonly paint: readonly ParsedPaintDecl[];
  readonly hasNonIconFont: boolean;
}

interface RawSheetExtraction {
  readonly ruleCount: number;
  readonly inspectedCount: number;
  readonly firstRule: CSSRule | undefined;
  readonly lastRule: CSSRule | undefined;
  readonly rootSelectorsKey: string;
  readonly mediaConds: ReadonlyArray<readonly [string, boolean]>;
  readonly rootVars: readonly ParsedRootVar[];
  readonly entries: readonly ParsedStyleEntry[];
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
  const seen = new Set<CSSStyleSheet>();
  let ownSheets: Set<CSSStyleSheet> | undefined;
  const add = (sheet: CSSStyleSheet | null | undefined): void => {
    if (!sheet || seen.has(sheet) || isOwnStyleSheet(sheet, skipIds)) {
      return;
    }
    // Only fall back to scanning `<style>` elements when `ownerNode` is absent.
    if (!sheet.ownerNode) {
      ownSheets ??= collectOwnSheets(root, skipIds);
      if (ownSheets.has(sheet)) {
        return;
      }
    }
    seen.add(sheet);
  };
  const styleSheetCount = root.styleSheets?.length ?? 0;
  if (root.styleSheets && styleSheetCount > 0) {
    for (const sheet of Array.from(root.styleSheets)) {
      add(sheet);
    }
  } else {
    // Fallback for DOM implementations where `shadowRoot.styleSheets` or detached `doc.styleSheets` is unpopulated.
    for (const styleEl of root.querySelectorAll('style')) {
      if (!isOwnStyleElement(styleEl, skipIds)) {
        add((styleEl as HTMLStyleElement).sheet);
      }
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
 * Counts accessible CSSOM rules across non-own stylesheets in `root` without
 * scanning the DOM. Used to detect runtime `sheet.insertRule()` growth
 * (e.g. React Native Web on X) which does not emit DOM `MutationObserver` records.
 */
export function countStyleSheetRules(
  root: Document | ShadowRoot,
  skipIds?: ReadonlySet<string>,
): number {
  let total = 0;
  for (const sheet of collectStyleSheets(root, skipIds)) {
    try {
      total += sheet.cssRules.length;
    } catch {
      // Ignore cross-origin stylesheets.
    }
  }
  return total;
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
  color: RgbaColor,
  oklch: OklchColor,
  hostScheme: ThemeColorScheme,
  palette: ThemePalette,
  brandOklch: readonly OklchColor[],
): string | null {
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

interface PartitionedSelectors {
  readonly groupableRaw: readonly string[];
  readonly isolated: readonly string[];
}

function partitionSelectors(selector: string): PartitionedSelectors {
  const groupableRaw: string[] = [];
  const isolated: string[] = [];
  for (const clean of splitSelectorList(selector)) {
    if (shouldSkipSelector(clean)) {
      continue;
    }
    // Keep pseudo-elements (`::before`, `::-moz-placeholder`, etc.) in isolated single
    // rules so an unsupported cross-browser vendor pseudo-element never invalidates a
    // grouped rule bucket, and never wrap `:host` in compound `:not(...)` clauses.
    if (clean.includes('::') || HOST_PSEUDO_HINT.test(clean)) {
      isolated.push(clean);
      continue;
    }
    // Inside `@layer fs-adaptive`, Layer 1 already sits strictly below `fs-mapping`,
    // `fs-reveal`, `fs-finish`, `fs-healer`, and `fs-user` — no `:where(...)` wrapping
    // needed, preserving Blink/Gecko O(1) class/attribute RuleSet bucketing!
    groupableRaw.push(clean);
  }
  return { groupableRaw, isolated };
}

function mapPaintProperty(
  { prop, kind, color, oklch }: ParsedPaintDecl,
  hostScheme: ThemeColorScheme,
  palette: ThemePalette,
  brandOklch: readonly OklchColor[],
  backdropActive: boolean,
): string | null {
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

function extractParsedPaintAndFont(
  style: CSSStyleDeclaration,
  selector: string,
): { readonly paint: ParsedPaintDecl[]; readonly hasNonIconFont: boolean } {
  const paint: ParsedPaintDecl[] = [];
  let rawFont = '';
  const pushPaint = (prop: string, kind: PaintPropertyKind): void => {
    const raw = style.getPropertyValue(prop);
    if (!raw) {
      return;
    }
    const color = parseCssColor(raw);
    if (color && color.a > 0.005) {
      paint.push({ prop, kind, color, oklch: rgbToOklch(color) });
    }
  };
  if (style.length > 0 && style.length <= 4) {
    for (let i = 0; i < style.length; i++) {
      const prop = style.item(i);
      if (prop === 'font-family') {
        rawFont = style.getPropertyValue(prop).trim();
        continue;
      }
      const kind = PAINT_PROPERTY_MAP.get(prop);
      if (kind) {
        pushPaint(prop, kind);
      }
    }
  } else {
    for (const { prop, kind } of PAINT_PROPERTIES) {
      pushPaint(prop, kind);
    }
    rawFont = style.getPropertyValue('font-family').trim();
  }
  const hasNonIconFont =
    rawFont.length > 0 && !ICON_OR_MONO_FONT_RE.test(rawFont) && !/\bicon\b/i.test(selector);
  return { paint, hasNonIconFont };
}

function normalizeExtraRootSelectors(rootSelectors: readonly string[] | undefined): string[] {
  if (!rootSelectors || rootSelectors.length === 0) {
    return [];
  }
  const extra: string[] = [];
  for (const sel of rootSelectors) {
    const trimmed = sel.trim();
    if (trimmed && trimmed !== ':root') {
      extra.push(trimmed);
    }
  }
  return extra;
}

const DARK_ROOT_TOKEN_RE = /(?:dark|dim)/i;
const LIGHT_ROOT_TOKEN_RE = /light/i;

/**
 * Checks whether `selector` targets a pure document/theme root (never a descendant
 * component selector like `.__fb-dark-mode .story-overlay`) and infers whether it is
 * scoped exclusively to `'dark'`, `'light'`, or `'any'` polarity.
 */
function classifyRootVarSelector(
  selector: string,
  extraRootSelectors: ReadonlySet<string>,
): { readonly isRoot: boolean; readonly scheme?: ThemeColorScheme } {
  let hasMatch = false;
  let hasDark = false;
  let hasLight = false;
  let hasNeutral = false;
  for (const part of splitSelectorList(selector)) {
    const clean = part.trim();
    if (!clean) {
      continue;
    }
    if (!PURE_ROOT_SELECTOR.test(clean) && !extraRootSelectors.has(clean)) {
      continue;
    }
    hasMatch = true;
    const dark = DARK_ROOT_TOKEN_RE.test(clean);
    const light = LIGHT_ROOT_TOKEN_RE.test(clean);
    if (dark && !light) {
      hasDark = true;
    } else if (light && !dark) {
      hasLight = true;
    } else {
      hasNeutral = true;
    }
  }
  if (!hasMatch) {
    return { isRoot: false };
  }
  if (hasNeutral || (hasDark && hasLight)) {
    return { isRoot: true };
  }
  return hasDark ? { isRoot: true, scheme: 'dark' } : { isRoot: true, scheme: 'light' };
}

function lastRuleOf(rules: CSSRuleList): CSSRule | undefined {
  const lastIndex = rules.length - 1;
  return lastIndex >= 0 ? rules[lastIndex] : undefined;
}

function isCacheValid(
  cached: RawSheetExtraction,
  rules: CSSRuleList,
  rootSelectorsKey: string,
  matchesMedia: (cond: string) => boolean,
): boolean {
  if (
    cached.ruleCount !== rules.length ||
    cached.rootSelectorsKey !== rootSelectorsKey ||
    cached.firstRule !== rules[0] ||
    cached.lastRule !== lastRuleOf(rules)
  ) {
    return false;
  }
  for (const [cond, wasMatch] of cached.mediaConds) {
    if (matchesMedia(cond) !== wasMatch) {
      return false;
    }
  }
  return true;
}

function extractSheet(
  sheet: CSSStyleSheet,
  rules: CSSRuleList,
  matchesMedia: (cond: string) => boolean,
  extraRootSelectors: ReadonlySet<string>,
  rootSelectorsKey: string,
): RawSheetExtraction {
  const cached = sheetCache.get(sheet);
  if (cached && isCacheValid(cached, rules, rootSelectorsKey, matchesMedia)) {
    return cached;
  }
  const rootVars: ParsedRootVar[] = [];
  const entries: ParsedStyleEntry[] = [];
  const mediaConds: Array<readonly [string, boolean]> = [];
  let inspectedCount = 0;

  const walk = (list: CSSRuleList): void => {
    for (const rule of list) {
      if (inspectedCount >= MAX_RULES_PER_ROOT) {
        return;
      }
      if (rule.type === 1) {
        inspectedCount++;
        const styleRule = rule as CSSStyleRule;
        const selector = styleRule.selectorText;
        if (!selector) {
          continue;
        }
        const style = styleRule.style;
        const rootMatch = classifyRootVarSelector(selector, extraRootSelectors);
        if (rootMatch.isRoot) {
          for (let j = 0; j < style.length; j++) {
            const propName = style.item(j);
            if (
              !propName.startsWith('--') ||
              !SAFE_CUSTOM_PROP.test(propName) ||
              VAR_SKIP_HINT.test(propName)
            ) {
              continue;
            }
            const rawVal = style.getPropertyValue(propName).trim();
            if (!rawVal) {
              continue;
            }
            const color = parseCssColor(rawVal);
            if (color && color.a > 0.005) {
              rootVars.push({
                name: propName,
                color,
                oklch: rgbToOklch(color),
                ...(rootMatch.scheme ? { scheme: rootMatch.scheme } : {}),
              });
            }
          }
        }
        const { paint, hasNonIconFont } = extractParsedPaintAndFont(style, selector);
        if (paint.length > 0 || hasNonIconFont) {
          const { groupableRaw, isolated } = partitionSelectors(selector);
          if (groupableRaw.length > 0 || isolated.length > 0) {
            entries.push({ groupableRaw, isolated, paint, hasNonIconFont });
          }
        }
      } else if ('cssRules' in rule) {
        if (rule.type === 4) {
          const mediaRule = rule as CSSMediaRule;
          const cond = mediaRule.conditionText ?? mediaRule.media?.mediaText ?? '';
          const matched = matchesMedia(cond);
          if (cond) {
            mediaConds.push([cond, matched]);
          }
          if (!matched) {
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
  const extracted: RawSheetExtraction = {
    ruleCount: rules.length,
    inspectedCount,
    firstRule: rules[0],
    lastRule: lastRuleOf(rules),
    rootSelectorsKey,
    mediaConds,
    rootVars,
    entries,
  };
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
  const extraRootList = normalizeExtraRootSelectors(options.rootSelectors);
  const extraRootSelectors = new Set(extraRootList);
  const rootSelectorsKey = extraRootList.join('\0');
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

  const recordPaintEntry = (entry: ParsedStyleEntry, activePalette: ThemePalette): void => {
    const decls: string[] = [];
    for (const paintDecl of entry.paint) {
      const mapped = mapPaintProperty(
        paintDecl,
        options.hostScheme,
        activePalette,
        brandOklch,
        backdropActive,
      );
      if (mapped) {
        decls.push(mapped);
      }
    }
    if (decls.length === 0) {
      return;
    }
    const block = decls.join(' ');
    if (entry.groupableRaw.length > 0) {
      let set = declToSelectors.get(block);
      if (!set) {
        set = new Set();
        declToSelectors.set(block, set);
      }
      for (const sel of entry.groupableRaw) {
        set.add(`${sel}${excludeClause}`);
      }
    }
    for (const sel of entry.isolated) {
      isolatedRules.add(`${sel} { ${block} }`);
    }
  };

  let totalInspected = 0;
  let totalRuleCount = 0;
  for (const sheet of collectStyleSheets(root, skipIds)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      // Cross-origin stylesheet: handled in real time by Layer 2 (`ThemeHealer`).
      continue;
    }
    totalRuleCount += rules.length;
    if (totalInspected >= MAX_RULES_PER_ROOT) {
      continue;
    }
    const extracted = extractSheet(
      sheet,
      rules,
      matchesMedia,
      extraRootSelectors,
      rootSelectorsKey,
    );
    totalInspected += extracted.inspectedCount;
    if (palette) {
      for (const { name, color, oklch, scheme } of extracted.rootVars) {
        if (scheme && scheme !== options.hostScheme) {
          continue;
        }
        const mappedVar = classifyCustomProperty(
          name,
          color,
          oklch,
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
        recordPaintEntry(entry, palette);
      }
      if (fontFamily && entry.hasNonIconFont) {
        for (const sel of entry.groupableRaw) {
          fontSelectors.add(`${sel}${FONT_EXCLUDE_CLAUSE}`);
        }
      }
    }
  }
  options.onSheetRuleCount?.(totalRuleCount);

  const chunks: string[] = [];
  if (discoveredVars.size > 0) {
    const varTarget = formatRootSelectors(options.rootSelectors, {
      shadow: isShadow,
      fallback: ':root, [data-theme]',
    });
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
  return withThemeLayerOrder([wrapThemeLayer('fs-adaptive', chunks.join('\n'))]);
}
