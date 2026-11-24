import type { ThemeEffectsConfig } from '../theme-effects/model';

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
  /** Optional ambient CSS contributed by a showpiece built-in preset (host document). */
  readonly presetHostCss?: string;
  /** Optional ambient CSS contributed by a showpiece built-in preset (Feed Sanity UI). */
  readonly presetUiCss?: string;
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
  /** Optional ambient CSS layered on the host page (ribbon, soft radial backdrop, etc.). */
  readonly hostCss?: string;
  /** Optional ambient CSS layered inside Feed Sanity's own dialog & toolbar popup. */
  readonly uiCss?: string;
}

export const THEME_FONT_STACKS = {
  default: '',
  system: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  rounded: 'ui-rounded, "SF Pro Rounded", "Trebuchet MS", "Segoe UI", system-ui, sans-serif',
  serif: 'Georgia, Cambria, "Times New Roman", Times, serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
} as const;

export type ThemeFontId = keyof typeof THEME_FONT_STACKS;

export interface ThemeConfig {
  readonly preset: string;
  readonly accent: string;
  readonly background: string;
  readonly surface: string;
  readonly text: string;
  readonly font: string;
  readonly customCss: string;
  readonly effects?: ThemeEffectsConfig;
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
