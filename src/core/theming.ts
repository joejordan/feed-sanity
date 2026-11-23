// First-class multi-site theming engine.
//
// Compiles a single site-agnostic semantic `ResolvedTheme` (optional color
// palette + optional typography + optional custom CSS) onto any host site via
// its declarative `SiteThemeMapping` (CSS variables, bare RGB triplets like
// Instagram's `--ig-*`, or semantic selectors like X.com's React Native Web
// layout), automatically propagating into open host Shadow Roots (`:host`),
// same-origin iframes, and Feed Sanity's own Shadow DOM UI. Strictly Trusted
// Types safe (`style.textContent`) and 100% reversible with zero page reload.

import type { DomEnvironment } from './dom-env';
import type { Scope } from './scope';
import { OWN_ATTR } from './surface';

export type ThemeColorScheme = 'dark' | 'light';

export interface ThemePalette {
  readonly colorScheme: ThemeColorScheme;
  /** Main page canvas / wash (`#rrggbb`). */
  readonly background: string;
  /** Elevated card / post / modal surface (`#rrggbb`). */
  readonly surface: string;
  /** Secondary surface for inputs, comments, and muted chips (`#rrggbb`). */
  readonly surfaceAlt: string;
  /** Primary readable text (`#rrggbb`). */
  readonly text: string;
  /** Secondary metadata / timestamp text (`#rrggbb`). */
  readonly textMuted: string;
  /** Hairline dividers and card borders (`#rrggbb`). */
  readonly border: string;
  /** Primary accent for links, active indicators, and primary buttons (`#rrggbb`). */
  readonly accent: string;
  /** Text rendered on top of `accent` fills (`#rrggbb`). */
  readonly accentText: string;
  /** Destructive / error indicator (`#rrggbb`). */
  readonly danger: string;
}

/**
 * Resolved user theme separated into color overrides (`palette`, null when
 * keeping the site's native colors), typography (`fontFamily`), and `customCss`.
 * Keeping these orthogonal ensures picking a font or custom CSS on Site Default
 * never forces dark-mode colors onto the host.
 */
export interface ResolvedTheme {
  readonly palette: ThemePalette | null;
  readonly fontFamily?: string;
  readonly customCss?: string;
}

export interface ThemePreset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly palette: ThemePalette;
}

export const THEME_FONT_STACKS = {
  default: '',
  system: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  rounded: 'ui-rounded, "SF Pro Rounded", "Segoe UI", system-ui, sans-serif',
  serif: 'Georgia, Cambria, "Times New Roman", Times, serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
} as const;

export type ThemeFontId = keyof typeof THEME_FONT_STACKS;

export const BUILTIN_THEMES: readonly ThemePreset[] = [
  {
    id: 'midnight',
    name: 'Midnight Slate',
    description: 'Deep low-glare slate with crisp blue accents.',
    palette: {
      colorScheme: 'dark',
      background: '#0b0f17',
      surface: '#131926',
      surfaceAlt: '#1c2436',
      text: '#e6edf7',
      textMuted: '#8d9cb5',
      border: '#253147',
      accent: '#3b82f6',
      accentText: '#ffffff',
      danger: '#f87171',
    },
  },
  {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    description: 'Soft dark pastel palette with mauve highlights.',
    palette: {
      colorScheme: 'dark',
      background: '#1e1e2e',
      surface: '#262637',
      surfaceAlt: '#313244',
      text: '#cdd6f4',
      textMuted: '#a6adc8',
      border: '#45475a',
      accent: '#cba6f7',
      accentText: '#11111b',
      danger: '#f38ba8',
    },
  },
  {
    id: 'nord',
    name: 'Nord Frost',
    description: 'Arctic blue-grey tones with calm frost accents.',
    palette: {
      colorScheme: 'dark',
      background: '#2e3440',
      surface: '#3b4252',
      surfaceAlt: '#434c5e',
      text: '#eceff4',
      textMuted: '#d8dee9',
      border: '#4c566a',
      accent: '#88c0d0',
      accentText: '#2e3440',
      danger: '#bf616a',
    },
  },
  {
    id: 'warm-paper',
    name: 'Warm Paper',
    description: 'Low-glare sepia daylight theme easy on the eyes.',
    palette: {
      colorScheme: 'light',
      background: '#f4efe6',
      surface: '#fdfaf4',
      surfaceAlt: '#ebe4d6',
      text: '#2b241c',
      textMuted: '#6f6253',
      border: '#dcd2c2',
      accent: '#b45309',
      accentText: '#ffffff',
      danger: '#c81e1e',
    },
  },
  {
    id: 'high-contrast',
    name: 'High Contrast',
    description: 'Pure black surfaces, crisp white text, and high-visibility gold.',
    palette: {
      colorScheme: 'dark',
      background: '#000000',
      surface: '#0e0e11',
      surfaceAlt: '#1b1b21',
      text: '#ffffff',
      textMuted: '#d4d4dc',
      border: '#52525e',
      accent: '#ffd60a',
      accentText: '#000000',
      danger: '#ff453a',
    },
  },
];

export interface ThemeConfig {
  readonly preset: string;
  readonly accent: string;
  readonly background: string;
  readonly surface: string;
  readonly text: string;
  readonly font: string;
  readonly customCss: string;
}

export const DEFAULT_THEME_CONFIG: ThemeConfig = {
  preset: 'default',
  accent: '',
  background: '',
  surface: '',
  text: '',
  font: 'default',
  customCss: '',
};

/** Declarative mapping from semantic `ThemePalette` tokens onto a host site's CSS architecture. */
export interface SiteThemeMapping {
  /** Selectors where CSS variable declarations apply (e.g. `[':root', '.__fb-dark-mode']`). */
  readonly rootSelectors: readonly string[];
  /** Standard CSS custom properties receiving `#rrggbb` or `rgb(...)` values. */
  readonly colorVars?: Readonly<Record<string, (palette: ThemePalette) => string>>;
  /** Bare `R, G, B` triplet variables (such as Instagram's `--ig-*` variables). */
  readonly rgbTripletVars?: Readonly<Record<string, (palette: ThemePalette) => string>>;
  /** Optional host-specific CSS rules (e.g. X.com inline body / column surfaces). */
  readonly extraCss?: (palette: ThemePalette) => string;
  /** Optional host-specific CSS rules injected into discovered open `ShadowRoot`s. */
  readonly shadowExtraCss?: (palette: ThemePalette) => string;
}

const HEX6 = /^#([0-9a-f]{6})$/i;
const HEX3 = /^#([0-9a-f]{3})$/i;

/** Validates and normalizes `#rgb` or `#rrggbb` to lowercase `#rrggbb`, or returns `null`. */
export function normalizeHex(input: string): string | null {
  const trimmed = input.trim();
  if (HEX6.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  const short = HEX3.exec(trimmed);
  if (short?.[1]) {
    const [r, g, b] = short[1];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return null;
}

function parseHexRgb(hex: string, fallback = '#000000'): [number, number, number] {
  const norm = normalizeHex(hex) ?? fallback;
  return [
    Number.parseInt(norm.slice(1, 3), 16),
    Number.parseInt(norm.slice(3, 5), 16),
    Number.parseInt(norm.slice(5, 7), 16),
  ];
}

/** Converts `#rrggbb` into a bare `R, G, B` triplet (e.g. `'30, 30, 46'`). */
export function hexToRgbTriplet(hex: string): string {
  const [r, g, b] = parseHexRgb(hex);
  return `${r}, ${g}, ${b}`;
}

/** Converts `#rrggbb` and opacity `0..1` into `rgb(R G B / A%)`. */
export function hexWithAlpha(hex: string, alpha: number): string {
  const [r, g, b] = parseHexRgb(hex);
  const pct = Math.max(0, Math.min(100, Math.round(alpha * 100)));
  return `rgb(${r} ${g} ${b} / ${pct}%)`;
}

/** Computes relative luminance (`0..1`) to pick crisp dark/light text on custom colors. */
export function relativeLuminance(hex: string): number {
  const toLinear = (channel: number): number => {
    const s = channel / 255;
    return s <= 0.039_28 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = parseHexRgb(hex);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** Converts `#rrggbb` into a bare `H S% L%` triplet (e.g. `'220 20% 15%'`). */
export function hexToHslTriplet(hex: string): string {
  const [ri, gi, bi] = parseHexRgb(hex);
  const r = ri / 255;
  const g = gi / 255;
  const b = bi / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) {
      h = (g - b) / d + (g < b ? 6 : 0);
    } else if (max === g) {
      h = (b - r) / d + 2;
    } else {
      h = (r - g) / d + 4;
    }
    h *= 60;
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/** Mixes two `#rrggbb` colors by `weight` (`0` = `a`, `1` = `b`) into `#rrggbb`. */
export function mixHex(a: string, b: string, weight: number): string {
  const [ra, ga, ba] = parseHexRgb(a, '#000000');
  const [rb, gb, bb] = parseHexRgb(b, '#ffffff');
  const w = Math.max(0, Math.min(1, weight));
  const mix = (ca: number, cb: number): string =>
    Math.round(ca + (cb - ca) * w)
      .toString(16)
      .padStart(2, '0');
  return `#${mix(ra, rb)}${mix(ga, gb)}${mix(ba, bb)}`;
}

/** Computes the WCAG 2.x contrast ratio (`1..21`) between two `#rrggbb` colors. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Picks `#ffffff` or `#111111` for maximum contrast on top of `backgroundHex`. */
export const contrastingText = (backgroundHex: string): string =>
  relativeLuminance(backgroundHex) > 0.42 ? '#111111' : '#ffffff';

export function findThemePreset(id: string): ThemePreset | undefined {
  return BUILTIN_THEMES.find((preset) => preset.id === id);
}

/**
 * Resolves a `ThemeConfig` into an active `ResolvedTheme` (or `null` when
 * set to `'default'` with no color, font, or custom CSS overrides).
 * Color overrides (`palette`) stay `null` when only `font` or `customCss` is set.
 */
export function resolveTheme(config: ThemeConfig): ResolvedTheme | null {
  const preset = findThemePreset(config.preset);
  const accent = normalizeHex(config.accent);
  const background = normalizeHex(config.background);
  const surface = normalizeHex(config.surface);
  const text = normalizeHex(config.text);
  const fontKey: ThemeFontId = Object.hasOwn(THEME_FONT_STACKS, config.font)
    ? (config.font as ThemeFontId)
    : 'default';
  const fontFamily = THEME_FONT_STACKS[fontKey];
  const customCss = config.customCss.trim();

  const hasColorOverride = Boolean(preset || accent || background || surface || text);
  if (!hasColorOverride && !fontFamily && !customCss) {
    return null;
  }

  let palette: ThemePalette | null = null;
  if (hasColorOverride) {
    const inferredLight = background !== null && relativeLuminance(background) > 0.45;
    const fallbackBase = inferredLight
      ? (findThemePreset('warm-paper')?.palette as ThemePalette)
      : (findThemePreset('midnight')?.palette as ThemePalette);
    const base = preset?.palette ?? fallbackBase;

    const resolvedBg = background ?? base.background;
    const resolvedSurface = surface ?? base.surface;
    const resolvedText = text ?? base.text;
    const resolvedAccent = accent ?? base.accent;
    let resolvedScheme: ThemeColorScheme = base.colorScheme;
    if (background !== null) {
      resolvedScheme = inferredLight ? 'light' : 'dark';
    }

    palette = {
      ...base,
      colorScheme: resolvedScheme,
      background: resolvedBg,
      surface: resolvedSurface,
      text: resolvedText,
      accent: resolvedAccent,
      accentText: accent ? contrastingText(resolvedAccent) : base.accentText,
    };
  }

  return {
    palette,
    ...(fontFamily ? { fontFamily } : {}),
    ...(customCss ? { customCss } : {}),
  };
}

function buildPaletteDeclarations(palette: ThemePalette, mapping: SiteThemeMapping): string[] {
  const decls: string[] = [`color-scheme: ${palette.colorScheme} !important;`];
  if (mapping.colorVars) {
    for (const [name, resolve] of Object.entries(mapping.colorVars)) {
      decls.push(`${name}: ${resolve(palette)} !important;`);
    }
  }
  if (mapping.rgbTripletVars) {
    for (const [name, resolve] of Object.entries(mapping.rgbTripletVars)) {
      decls.push(`${name}: ${hexToRgbTriplet(resolve(palette))} !important;`);
    }
  }
  return decls;
}

/** Compiles `theme` + `mapping` into host-document CSS. */
export function compileHostThemeCss(theme: ResolvedTheme, mapping: SiteThemeMapping): string {
  const parts: string[] = [];
  if (theme.palette) {
    const decls = buildPaletteDeclarations(theme.palette, mapping);
    const selectors = mapping.rootSelectors.length > 0 ? mapping.rootSelectors.join(', ') : ':root';
    parts.push(`${selectors} {\n  ${decls.join('\n  ')}\n}`);
  }
  if (theme.fontFamily) {
    parts.push(`html, body {\n  font-family: ${theme.fontFamily} !important;\n}`);
  }
  const extra = theme.palette ? mapping.extraCss?.(theme.palette).trim() : undefined;
  if (extra) {
    parts.push(extra);
  }
  if (theme.customCss) {
    parts.push(theme.customCss);
  }
  return parts.join('\n\n');
}

/**
 * Compiles `theme` + `mapping` for injection into host open `ShadowRoot`s.
 * Maps document-level `:root` / `html, body` selectors to `:host` because
 * `:root` never matches inside a Shadow Tree per CSS Scoping Level 1.
 */
export function compileShadowThemeCss(theme: ResolvedTheme, mapping: SiteThemeMapping): string {
  const parts: string[] = [];
  if (theme.palette) {
    const decls = buildPaletteDeclarations(theme.palette, mapping);
    const shadowSelectors = mapping.rootSelectors.map((sel) =>
      sel.trim() === ':root' ? ':host' : sel,
    );
    if (!shadowSelectors.includes(':host')) {
      shadowSelectors.unshift(':host');
    }
    parts.push(`${shadowSelectors.join(', ')} {\n  ${decls.join('\n  ')}\n}`);
  }
  if (theme.fontFamily) {
    parts.push(`:host {\n  font-family: ${theme.fontFamily} !important;\n}`);
  }
  const shadowExtra = theme.palette ? mapping.shadowExtraCss?.(theme.palette).trim() : undefined;
  if (shadowExtra) {
    parts.push(shadowExtra);
  }
  if (theme.customCss) {
    parts.push(theme.customCss);
  }
  return parts.join('\n\n');
}

/** Compiles `theme` into Feed Sanity's own Shadow DOM `--fs-*` token overrides. */
export function compileUiThemeCss(theme: ResolvedTheme): string {
  const lines: string[] = [];
  if (theme.palette) {
    const p = theme.palette;
    const hoverOverlay = p.colorScheme === 'dark' ? 'rgb(255 255 255 / 7%)' : 'rgb(0 0 0 / 5%)';
    const pressOverlay = p.colorScheme === 'dark' ? 'rgb(255 255 255 / 13%)' : 'rgb(0 0 0 / 10%)';
    lines.push(
      `color-scheme: ${p.colorScheme};`,
      `--fs-background: ${p.surface};`,
      `--fs-surface: ${p.background};`,
      `--fs-hover: ${hoverOverlay};`,
      `--fs-press: ${pressOverlay};`,
      `--fs-icon: ${p.text};`,
      `--fs-icon-secondary: ${p.textMuted};`,
      `--fs-text: ${p.text};`,
      `--fs-text-secondary: ${p.textMuted};`,
      `--fs-divider: ${p.border};`,
      `--fs-accent: ${p.accent};`,
      `--fs-accent-surface: ${hexWithAlpha(p.accent, 0.16)};`,
      `--fs-accent-text: ${p.accentText};`,
      `--fs-button-secondary: ${p.surfaceAlt};`,
      `--fs-comment: ${p.surfaceAlt};`,
      `--fs-shadow-2: ${p.colorScheme === 'dark' ? 'rgb(0 0 0 / 45%)' : 'rgb(0 0 0 / 18%)'};`,
      `--fs-input: ${p.background};`,
      `--fs-error: ${p.danger};`,
    );
  }
  if (theme.fontFamily) {
    lines.push(`--fs-font: ${theme.fontFamily};`);
  }
  if (lines.length === 0) {
    return '';
  }
  return `:host {\n  ${lines.join('\n  ')}\n}`;
}

export const THEME_STYLE_ID = 'feed_sanity_user_theme';
const EARLY_THEME_CACHE_PREFIX = '__fs_early_theme__:';
const OWN_UI_TAG = 'feed-sanity-ui';

const earlyThemeKey = (siteId: string): string => `${EARLY_THEME_CACHE_PREFIX}${siteId}`;

/** Reads the cached host theme CSS for `siteId` from `sessionStorage` (empty string if unavailable). */
export function readEarlyThemeCss(siteId: string): string {
  try {
    return globalThis.sessionStorage?.getItem(earlyThemeKey(siteId)) ?? '';
  } catch {
    return '';
  }
}

/** Persists or clears the synchronous per-origin early theme CSS cache for `siteId`. */
export function writeEarlyThemeCss(siteId: string, css: string): void {
  try {
    const storage = globalThis.sessionStorage;
    if (!storage) {
      return;
    }
    const key = earlyThemeKey(siteId);
    if (css) {
      storage.setItem(key, css);
    } else {
      storage.removeItem(key);
    }
  } catch {
    // Ignore storage quota or sandboxed iframe restrictions.
  }
}

/**
 * Synchronously injects the cached host theme CSS into `doc` before async
 * storage resolves, preventing first-paint FOUC. `ThemeController` reconciles
 * or removes `#feed_sanity_user_theme` once persisted settings load.
 */
export function applyEarlyThemeCss(
  siteId: string,
  doc: Document = document,
): HTMLStyleElement | null {
  const css = readEarlyThemeCss(siteId);
  if (!css) {
    return null;
  }
  const existing = doc.querySelector(`#${THEME_STYLE_ID}`);
  if (existing && existing.localName === 'style') {
    if (existing.textContent !== css) {
      existing.textContent = css;
    }
    return existing as HTMLStyleElement;
  }
  const target = doc.head ?? doc.documentElement;
  if (!target) {
    return null;
  }
  const style = doc.createElement('style');
  style.id = THEME_STYLE_ID;
  style.textContent = css;
  target.append(style);
  return style;
}

/** Removes any synchronously injected early theme `<style>` from `doc`. */
export function clearEarlyThemeStyle(doc: Document = document): void {
  const existing = doc.querySelector(`#${THEME_STYLE_ID}`);
  if (existing && existing.localName === 'style') {
    existing.remove();
  }
}

const isOwnShadowRoot = (shadow: ShadowRoot): boolean =>
  shadow.host.localName === OWN_UI_TAG || shadow.host.hasAttribute(OWN_ATTR);

export interface ThemeController {
  /** Applies the persisted user theme (or clears it when `null`). */
  apply: (theme: ResolvedTheme | null) => void;
  /** Temporarily previews a theme (including `null` to preview Site Default). */
  preview: (theme: ResolvedTheme | null) => void;
  /** Ends any active preview and restores the persisted user theme. */
  clearPreview: () => void;
  /** Currently active effective theme (preview if active, else saved). */
  current: () => ResolvedTheme | null;
  dispose: () => void;
}

/**
 * Manages live host + host Shadow DOM + same-origin iframe + Feed Sanity UI
 * theming for one `DomEnvironment`. Attaches styles directly to `documentElement`
 * when `<head>` is not yet parsed so themes apply before first paint at
 * `document_start`.
 */
export function createThemeController(
  env: DomEnvironment,
  mapping: SiteThemeMapping,
  setUiThemeCss: (css: string) => void,
): ThemeController {
  let savedTheme: ResolvedTheme | null = null;
  let previewTheme: ResolvedTheme | null | undefined;
  let hostCss = '';
  let shadowCss: string | undefined;
  let disposed = false;

  const styles = new Map<Document | ShadowRoot, HTMLStyleElement>();
  const iframeDocs = new Set<Document>();
  const cleanups: Array<() => void> = [];

  const effectiveTheme = (): ResolvedTheme | null =>
    previewTheme === undefined ? savedTheme : previewTheme;

  const getShadowCss = (): string => {
    if (shadowCss === undefined) {
      const effective = effectiveTheme();
      shadowCss = effective ? compileShadowThemeCss(effective, mapping) : '';
    }
    return shadowCss;
  };

  const findExistingStyle = (root: Document | ShadowRoot): HTMLStyleElement | undefined => {
    const tracked = styles.get(root);
    if (tracked?.isConnected) {
      return tracked;
    }
    const found = root.querySelector(`#${THEME_STYLE_ID}`);
    // Use `localName` rather than `instanceof HTMLStyleElement` so cross-realm
    // `<style>` elements inside same-origin iframes are matched reliably.
    if (found && found.localName === 'style') {
      const style = found as HTMLStyleElement;
      styles.set(root, style);
      return style;
    }
    return undefined;
  };

  const syncRoot = (root: Document | ShadowRoot, cssText: string): void => {
    const existing = findExistingStyle(root);
    if (!cssText) {
      existing?.remove();
      styles.delete(root);
      return;
    }
    const isDoc = root.nodeType === Node.DOCUMENT_NODE;
    if (existing) {
      if (existing.textContent !== cssText) {
        existing.textContent = cssText;
      }
      // Promote an early `document_start` style appended to `<html>` into `<head>`
      // once parsed so it sits after host stylesheets in CSS cascade order.
      if (isDoc) {
        const head = (root as Document).head;
        if (head && existing.parentElement !== head) {
          head.append(existing);
        }
      }
      return;
    }
    const owner = isDoc ? (root as Document) : (root.ownerDocument ?? env.doc);
    const style = owner.createElement('style');
    style.id = THEME_STYLE_ID;
    style.textContent = cssText;
    const target = isDoc ? ((root as Document).head ?? (root as Document).documentElement) : root;
    if (!target) {
      return;
    }
    target.append(style);
    styles.set(root, style);
  };

  const render = (): void => {
    if (disposed) {
      return;
    }
    const effective = effectiveTheme();
    hostCss = effective ? compileHostThemeCss(effective, mapping) : '';
    shadowCss = undefined;
    const uiCss = effective ? compileUiThemeCss(effective) : '';
    setUiThemeCss(uiCss);
    syncRoot(env.doc, hostCss);
    if (env.shadowRoots.size > 0) {
      const compiledShadow = getShadowCss();
      for (const shadow of env.shadowRoots) {
        if (!isOwnShadowRoot(shadow)) {
          syncRoot(shadow, compiledShadow);
        }
      }
    }
    for (const iframeDoc of iframeDocs) {
      syncRoot(iframeDoc, hostCss);
    }
  };

  const watchHead = (targetEnv: DomEnvironment): (() => void) | undefined => {
    if (targetEnv.doc.head) {
      return undefined;
    }
    const stopHead = targetEnv.watcher.watch('head', {
      added: (head) => {
        stopHead();
        const existing = findExistingStyle(targetEnv.doc);
        if (existing) {
          if (existing.parentElement !== head) {
            head.append(existing);
          }
        } else if (hostCss) {
          syncRoot(targetEnv.doc, hostCss);
        }
      },
    });
    return stopHead;
  };

  cleanups.push(
    env.onShadowRoot((shadow, rootScope) => {
      if (isOwnShadowRoot(shadow)) {
        return;
      }
      syncRoot(shadow, getShadowCss());
      rootScope.add(() => {
        styles.get(shadow)?.remove();
        styles.delete(shadow);
      });
    }),
  );

  cleanups.push(
    env.onIframe((childEnv) => {
      iframeDocs.add(childEnv.doc);
      syncRoot(childEnv.doc, hostCss);
      const stopChildHead = watchHead(childEnv);
      if (stopChildHead) {
        childEnv.scope.add(stopChildHead);
      }
      childEnv.scope.add(() => {
        iframeDocs.delete(childEnv.doc);
        styles.get(childEnv.doc)?.remove();
        styles.delete(childEnv.doc);
      });
    }),
  );

  // Attach or move `<style>` into `<head>` once parsed (handles both early
  // `documentElement` attachment and `document_start` before `<html>` exists).
  const stopMainHead = watchHead(env);
  if (stopMainHead) {
    cleanups.push(stopMainHead);
  }

  return {
    apply(theme) {
      savedTheme = theme;
      if (previewTheme === undefined) {
        render();
      }
    },
    preview(theme) {
      previewTheme = theme;
      render();
    },
    clearPreview() {
      if (previewTheme === undefined) {
        return;
      }
      previewTheme = undefined;
      render();
    },
    current: effectiveTheme,
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const stop of cleanups.splice(0)) {
        stop();
      }
      for (const style of styles.values()) {
        style.remove();
      }
      styles.clear();
      iframeDocs.clear();
      setUiThemeCss('');
    },
  };
}

/** Helper to wire `ThemeController` cleanup into a `Scope`. */
export function attachThemeScope(scope: Scope, controller: ThemeController): ThemeController {
  scope.add(() => controller.dispose());
  return controller;
}
