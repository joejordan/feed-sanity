import type { ThemeEffectsConfig } from '../theme-effects/model';
import type { ThemeDocumentV1 } from './document';

/**
 * Deterministic CSS Cascade Layer order (CSS Cascading Level 5).
 * Because `!important` layer precedence runs earliest -> highest, declaring this
 * exact header in every injected stylesheet guarantees strict precedence
 * regardless of selector specificity or stylesheet insertion order:
 *   user custom CSS > backdrop transparent shell > contrast healer >
 *   surface finishes > backdrop reveal > curated site mapping > Layer 1 adaptive.
 */
export const THEME_LAYER_ORDER =
  '@layer fs-user, fs-reveal-shell, fs-healer, fs-finish, fs-reveal, fs-mapping, fs-adaptive;';

export type ThemeLayerName =
  | 'fs-user'
  | 'fs-reveal-shell'
  | 'fs-healer'
  | 'fs-finish'
  | 'fs-reveal'
  | 'fs-mapping'
  | 'fs-adaptive';

/** Wraps non-empty CSS rules in a named Feed Sanity cascade layer. */
export function wrapThemeLayer(layer: ThemeLayerName, body: string): string {
  const trimmed = body.trim();
  return trimmed ? `@layer ${layer} {\n${trimmed}\n}` : '';
}

/** Prefixes non-empty layered CSS blocks with `THEME_LAYER_ORDER`. */
export function withThemeLayerOrder(blocks: readonly string[]): string {
  const nonEmpty = blocks.filter((b) => b.length > 0);
  if (nonEmpty.length === 0) {
    return '';
  }
  return `${THEME_LAYER_ORDER}\n\n${nonEmpty.join('\n\n')}`;
}

/**
 * Formats site `rootSelectors` for either the light document or an open ShadowRoot
 * (mapping `:root` -> `:host` and ensuring `:host` is present per CSS Scoping Level 1).
 */
export function formatRootSelectors(
  rootSelectors: readonly string[] | undefined,
  {
    shadow = false,
    fallback = ':root',
  }: { readonly shadow?: boolean; readonly fallback?: string } = {},
): string {
  if (shadow) {
    const mapped = (rootSelectors && rootSelectors.length > 0 ? rootSelectors : [':root']).map(
      (sel) => (sel.trim() === ':root' ? ':host' : sel),
    );
    if (!mapped.includes(':host')) {
      mapped.unshift(':host');
    }
    return mapped.join(', ');
  }
  return rootSelectors && rootSelectors.length > 0 ? rootSelectors.join(', ') : fallback;
}

/**
 * Text-entry `<input>` selector that deliberately excludes checkboxes, radios,
 * range sliders, switches, and buttons so painting input backgrounds never
 * obscures transparent host switch/checkbox overlays (e.g. X Snooze Topics).
 */
export const TEXT_INPUT_SELECTOR =
  'input:not([type="checkbox"], [type="radio"], [type="range"], [type="hidden"], [type="file"], [type="submit"], [type="button"], [role="switch"])';

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
  /** Optional secondary decorative accent for gradients and live scenes (falls back to `danger`). */
  readonly accentSecondary?: string;
  /** Text rendered on top of `accent` fills (`#rrggbb`). */
  readonly accentText: string;
  /** Destructive / error indicator (`#rrggbb`). */
  readonly danger: string;
}

/** Declarative edge accent ribbon compiled safely onto host and Feed Sanity UI chrome. */
export interface ThemeRibbonSpec {
  readonly enabled: boolean;
  /** 1..8 validated `#rrggbb` or `'transparent'` gradient stops. */
  readonly stops: readonly string[];
  /** Linear gradient angle in degrees (`0..360`, default `90`). */
  readonly angle?: number;
  /** Ribbon thickness in CSS pixels (`1..6`, default `3`). */
  readonly height?: number;
  readonly position?: 'top' | 'bottom';
}

/** One soft radial ambient glow spot rendered behind static themes (skipped when a live backdrop runs). */
export interface ThemeAmbientGlowSpot {
  readonly color: string;
  /** Opacity (`0.02..0.3`). */
  readonly alpha: number;
  /** Horizontal center (`0..100` percent). */
  readonly x: number;
  /** Vertical center (`0..100` percent). */
  readonly y: number;
  /** Horizontal ellipse radius (`20..90` percent, default `60`). */
  readonly radiusX?: number;
  /** Vertical ellipse radius (`20..80` percent, default `42`). */
  readonly radiusY?: number;
}

export interface ThemeAmbientGlowSpec {
  readonly enabled: boolean;
  readonly spots: readonly ThemeAmbientGlowSpot[];
}

/** Declarative visual niceties (ribbons, ambient glows) shared across built-in and exported themes. */
export interface ThemeChromeConfig {
  readonly ribbon?: ThemeRibbonSpec;
  readonly ambientGlow?: ThemeAmbientGlowSpec;
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
  /** Declarative chrome niceties (edge ribbon, static ambient glow). */
  readonly chrome?: ThemeChromeConfig;
  /** Optional Creative Studio live backdrop, surface finish, and click effects. */
  readonly effects?: ThemeEffectsConfig;
}

export interface ThemePreset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly palette: ThemePalette;
  /** Optional multi-color dot strip shown on the preset card (defaults to 4 palette tokens). */
  readonly swatches?: readonly string[];
  /** Optional CSS gradient shown on compact circular quick-theme swatches. */
  readonly swatchGradient?: string;
  /** Declarative chrome niceties (edge ribbon & soft static ambient glow). */
  readonly chrome?: ThemeChromeConfig;
}

export const THEME_FONT_STACKS = {
  default: '',
  system: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  rounded: 'ui-rounded, "SF Pro Rounded", "Trebuchet MS", "Segoe UI", system-ui, sans-serif',
  serif: 'Georgia, Cambria, "Times New Roman", Times, serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
} as const;

export type ThemeFontId = keyof typeof THEME_FONT_STACKS;

/** Type guard verifying `value` is a known built-in `ThemeFontId`. */
export function isThemeFontId(value: unknown): value is ThemeFontId {
  return typeof value === 'string' && Object.hasOwn(THEME_FONT_STACKS, value);
}

export interface ThemeConfig {
  readonly preset: string;
  readonly accent: string;
  readonly background: string;
  readonly surface: string;
  readonly text: string;
  readonly font: string;
  readonly customCss: string;
  readonly effects?: ThemeEffectsConfig;
  /** Optional imported self-contained `.fstheme.json` theme document. */
  readonly document?: ThemeDocumentV1;
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

export const THEME_DATA_KEY = 'theme';

export interface BackdropRevealMetrics {
  readonly columnAlpha: number;
  readonly cardAlpha: number;
  readonly blurPx: number;
}

export interface SurfaceRevealMetrics extends BackdropRevealMetrics {
  readonly popupAlpha: number;
}

/**
 * Declarative per-site surface contract compiled centrally by `surfaces.ts`.
 * Separating outer shells, columns, safe leaf cards, translucent panels, and
 * opaque popups prevents stacking-context and `backdrop-filter` traps across sites.
 */
export interface SurfaceSelectors {
  /** Outer page/app wrappers made transparent so live backdrops shine through margins. */
  readonly transparentShell?: readonly string[];
  /** Primary reading columns painted at `columnAlpha` (never given `backdrop-filter`). */
  readonly columns?: readonly string[];
  /** Optional opacity multiplier applied to `columnAlpha` (defaults to `1`). */
  readonly columnAlphaScale?: number;
  /** Safe leaf cards painted at `cardAlpha` — the ONLY surfaces eligible for `backdrop-filter`. */
  readonly leafCards?: readonly string[];
  /** Translucent non-leaf panels/navs/posts painted at `cardAlpha` without `backdrop-filter`. */
  readonly softSurfaces?: readonly string[];
  /** Popups, menus, dialogs, listboxes, and portals kept crisp at `>= 0.96` opacity (never `backdrop-filter`). */
  readonly popups?: readonly string[];
  /** Primary accent CTA buttons eligible for gradient/neon surface finishes. */
  readonly primaryCtas?: readonly string[];
  /** Feed post cards eligible for subtle neon hover accents. */
  readonly feedCards?: readonly string[];
  /** Search bar pill/containers styled under neon focus/surface finishes. */
  readonly searchContainers?: readonly string[];
  /** Optional site CSS custom property overrides applied during active backdrops. */
  readonly revealCssVars?: (
    palette: ThemePalette | null,
    metrics: SurfaceRevealMetrics,
  ) => Readonly<Record<string, string>>;
  /** Optional site-specific backdrop-reveal CSS (e.g. X React Native Web exclusions). */
  readonly extraRevealCss?: (palette: ThemePalette | null, metrics: SurfaceRevealMetrics) => string;
}

export interface AdaptiveThemeMappingOptions {
  /** Enables Layer 1 (live stylesheet/token compiler) + Layer 2 (viewport contrast/polarity self-healer). */
  readonly enabled?: boolean;
  /** Optional site brand hex colors (e.g. `['#1d9bf0']`) automatically remapped to `palette.accent`. */
  readonly brandColors?: readonly string[];
  /** Selectors whose subtrees represent media/photos and must never be recolored. */
  readonly mediaPreserveSelectors?: readonly string[];
}

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
  /** Declarative surface selectors compiled centrally for backdrop reveal and surface finishes. */
  readonly surfaces?: SurfaceSelectors;
  /** Legacy escape hatch for custom backdrop-reveal CSS when `surfaces` is not set. */
  readonly backdropRevealCss?: (
    palette: ThemePalette | null,
    metrics: BackdropRevealMetrics,
  ) => string;
  /** Opt-in automatic stylesheet compiler + real-time contrast/polarity self-healer. */
  readonly adaptive?: AdaptiveThemeMappingOptions;
}
