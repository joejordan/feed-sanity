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
  /** Optional site brand hex colors (e.g. `['#1d9bf0']`) to remap to `palette.accent`. */
  readonly brandColors?: readonly string[];
  /** Selectors whose subtrees must never be recolored (video players, media viewers). */
  readonly mediaPreserveSelectors?: readonly string[];
  /** Optional extra style element IDs to skip (all `feed_sanity_*` IDs are always skipped). */
  readonly skipStyleIds?: ReadonlySet<string>;
}

const SAFE_CUSTOM_PROP = /^--[A-Za-z0-9_-]+$/;
const VAR_BG_HINT =
  /(?:^|[-_])(?:bg|background|surface|canvas|card|modal|sheet|popover|tray|wash|panel)(?:$|[-_])/i;
const VAR_FG_HINT = /(?:^|[-_])(?:fg|text|content|ink|icon|label|heading|title|tone)(?:$|[-_])/i;
const VAR_BORDER_HINT =
  /(?:^|[-_])(?:border|divider|stroke|outline|hairline|separator|ring)(?:$|[-_])/i;
const VAR_BRAND_HINT = /(?:^|[-_])(?:brand|accent|primary[-_]?btn|link)(?:$|[-_])/i;
const VAR_SKIP_HINT =
  /(?:^|[-_])(?:fs|feed[-_]?sanity|danger|error|warn|success|green|red|yellow|gold|verified|shadow)(?:$|[-_])/i;

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

const MEDIA_SELECTOR_HINT = /\b(?:video|img|picture|canvas|iframe)\b/i;
const ROOT_SELECTOR_HINT = /(?:^|,)\s*(?::root|:host\b|html\b|body\b|\[data-theme\b)/i;
const PURE_ROOT_SELECTOR =
  /^(?::root|:host(?:\([^)]*\))?|html(?:\.[A-Za-z0-9_-]+|\[[^\]]+\])*|body(?:\.[A-Za-z0-9_-]+|\[[^\]]+\])*|\[data-theme(?:=[^\]]+)?\])$/i;
const HOST_PSEUDO_HINT = /:host(?:-context)?\b/i;
const MAX_RULES_PER_ROOT = 4000;

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
  if (
    matchesBrandHue(color, brandOklch, oklch) &&
    (VAR_BRAND_HINT.test(name) || !VAR_BORDER_HINT.test(name))
  ) {
    return color.a < 0.99 ? hexWithAlpha(palette.accent, color.a) : palette.accent;
  }
  if (!isNeutralColor(color, 0.045, oklch)) {
    return null;
  }
  if (VAR_BORDER_HINT.test(name)) {
    return mapHostNeutralToPalette(color, hostScheme, 'border', palette, oklch);
  }
  if (VAR_FG_HINT.test(name)) {
    return mapHostNeutralToPalette(color, hostScheme, 'text', palette, oklch);
  }
  if (VAR_BG_HINT.test(name)) {
    return mapHostNeutralToPalette(color, hostScheme, 'background', palette, oklch);
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
    // grouped rule bucket, and never wrap `:host` inside `:where(...)` (forbidden by CSS Scoping).
    if (clean.includes('::')) {
      isolated.push(clean);
      continue;
    }
    if (HOST_PSEUDO_HINT.test(clean)) {
      isolated.push(clean);
      continue;
    }
    const lowSpec = `:where(${clean})`;
    groupable.push(excludeClause ? `${lowSpec}${excludeClause}` : lowSpec);
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
  }
  return mapped ? `${prop}: ${mapped} !important;` : null;
}

function compileRuleStyle(
  style: CSSStyleDeclaration,
  hostScheme: ThemeColorScheme,
  palette: ThemePalette,
  brandOklch: readonly OklchColor[],
): string[] {
  const decls: string[] = [];
  // Fast path for atomic 1–4 declaration classes (`.r-*`, StyleX, Tailwind): only
  // inspect declared properties instead of probing all 9 paint slots.
  if (style.length > 0 && style.length <= 4) {
    for (const prop of Array.from(style)) {
      const kind = PAINT_PROPERTY_MAP.get(prop);
      if (!kind) {
        continue;
      }
      const mapped = mapPaintProperty(
        prop,
        kind,
        style.getPropertyValue(prop),
        hostScheme,
        palette,
        brandOklch,
      );
      if (mapped) {
        decls.push(mapped);
      }
    }
    return decls;
  }
  for (const { prop, kind } of PAINT_PROPERTIES) {
    const raw = style.getPropertyValue(prop);
    if (!raw) {
      continue;
    }
    const mapped = mapPaintProperty(prop, kind, raw, hostScheme, palette, brandOklch);
    if (mapped) {
      decls.push(mapped);
    }
  }
  return decls;
}

/**
 * Inspects accessible author stylesheets in `root` (`Document` or open
 * `ShadowRoot`) and compiles paint-only CSS overrides for discovered neutral
 * custom properties and atomic/component color rules.
 */
export function compileAdaptiveRootCss(
  root: Document | ShadowRoot,
  palette: ThemePalette,
  options: AdaptiveCompilerOptions,
): string {
  const isShadow = root.nodeType === Node.DOCUMENT_FRAGMENT_NODE;
  const win = isShadow ? root.ownerDocument?.defaultView : (root as Document).defaultView;
  const mediaMatchesCache = new Map<string, boolean>();
  const skipIds = options.skipStyleIds;
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
  let inspectedRules = 0;

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

  const walkRules = (rules: CSSRuleList): void => {
    for (const rule of Array.from(rules)) {
      if (inspectedRules >= MAX_RULES_PER_ROOT) {
        return;
      }
      // CSSRule.STYLE_RULE === 1
      if (rule.type === 1) {
        inspectedRules++;
        const styleRule = rule as CSSStyleRule;
        const selector = styleRule.selectorText;
        if (!selector) {
          continue;
        }
        const style = styleRule.style;

        // 1. Discover custom properties declared on root/theme/host rules.
        if (ROOT_SELECTOR_HINT.test(selector)) {
          for (const propName of Array.from(style)) {
            if (!propName.startsWith('--')) {
              continue;
            }
            const rawVal = style.getPropertyValue(propName).trim();
            const mappedVar = classifyCustomProperty(
              propName,
              rawVal,
              options.hostScheme,
              palette,
              brandOklch,
            );
            if (mappedVar) {
              discoveredVars.set(propName, mappedVar);
            }
          }
        }

        // 2. Compile paint-only overrides for non-pure-root selectors (including
        //    root-prefixed descendant rules like `html.theme-dark .card`).
        const decls = compileRuleStyle(style, options.hostScheme, palette, brandOklch);
        if (decls.length === 0) {
          continue;
        }
        const { groupable, isolated } = guardSelector(selector, excludeClause);
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
      } else if ('cssRules' in rule) {
        if (rule.type === 4) {
          const mediaRule = rule as CSSMediaRule;
          const cond = mediaRule.conditionText ?? mediaRule.media?.mediaText ?? '';
          if (!matchesMedia(cond)) {
            continue;
          }
        }
        try {
          walkRules((rule as CSSGroupingRule).cssRules);
        } catch {
          // Ignore inaccessible nested rule lists.
        }
      }
    }
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
    walkRules(rules);
  }

  const chunks: string[] = [];
  if (discoveredVars.size > 0) {
    const varTarget = isShadow ? ':host' : ':root, [data-theme]';
    const lines = [...discoveredVars.entries()].map(([k, v]) => `  ${k}: ${v} !important;`);
    chunks.push(`${varTarget} {\n${lines.join('\n')}\n}`);
  }
  for (const [block, selectors] of declToSelectors) {
    chunks.push(`${[...selectors].join(', ')} { ${block} }`);
  }
  for (const rule of isolatedRules) {
    chunks.push(rule);
  }
  return chunks.join('\n');
}
