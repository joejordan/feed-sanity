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
import type { ThemeAuditReport, ThemeHealer } from './theme';
import type { StudioVibe, ThemeEffectsConfig } from './theme-effects';
import { isRecord } from './storage';
import { OWN_ATTR } from './surface';
import {
  auditThemeCoverage,
  captureLayoutSnapshot,
  compileAdaptiveRootCss,
  createThemeHealer,
  detectHostColorScheme,
  HEALER_STYLE_ID,
  hexWithAlpha,
  isOwnUiElement,
  parseCssColor,
  rgbaContrastRatio,
  rgbaLuminance,
} from './theme';
import {
  compileBackdropRevealCss,
  compileSurfaceFinishCss,
  compileUiSurfaceCss,
  createEffectsLayerController,
  DEFAULT_THEME_EFFECTS,
  hasActiveEffects,
  readThemeEffectsConfig,
} from './theme-effects';

export type { StudioVibe, ThemeEffectsConfig } from './theme-effects';
export { hexWithAlpha } from './theme';
export { DEFAULT_THEME_EFFECTS, hasActiveEffects, readThemeEffectsConfig } from './theme-effects';

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
  {
    id: 'crimson-velvet',
    name: 'Crimson Velvet',
    description: 'Deep oxblood noir with warm ivory type and burnished crimson accents.',
    palette: {
      colorScheme: 'dark',
      background: '#11090d',
      surface: '#1c1016',
      surfaceAlt: '#2a1822',
      text: '#f7ecee',
      textMuted: '#c4a6ae',
      border: '#3f2431',
      accent: '#e11d48',
      accentText: '#ffffff',
      danger: '#fb7185',
    },
  },
  {
    id: 'synthwave-dusk',
    name: 'Synthwave Dusk',
    description: 'Ultraviolet twilight canvas with luminous orchid highlights.',
    palette: {
      colorScheme: 'dark',
      background: '#0f0a1e',
      surface: '#1a1230',
      surfaceAlt: '#261b44',
      text: '#f2ecff',
      textMuted: '#b9aad9',
      border: '#3b2b63',
      accent: '#f472b6',
      accentText: '#14091d',
      danger: '#fb7185',
    },
  },
  {
    id: 'emerald-obsidian',
    name: 'Emerald Obsidian',
    description: 'Deep obsidian pine surfaces paired with electric jade accents.',
    palette: {
      colorScheme: 'dark',
      background: '#07110d',
      surface: '#0e1e18',
      surfaceAlt: '#162d24',
      text: '#e8f7f0',
      textMuted: '#98bfb0',
      border: '#234538',
      accent: '#10b981',
      accentText: '#04140d',
      danger: '#f87171',
    },
  },
  {
    id: 'espresso-gold',
    name: 'Espresso & Gold',
    description: 'Roasted espresso canvas with warm cream text and antique gold.',
    palette: {
      colorScheme: 'dark',
      background: '#130f0b',
      surface: '#1f1913',
      surfaceAlt: '#2d241b',
      text: '#f6eee3',
      textMuted: '#c4b39c',
      border: '#443728',
      accent: '#eab308',
      accentText: '#161108',
      danger: '#f87171',
    },
  },
  {
    id: 'matcha-porcelain',
    name: 'Botanical Matcha',
    description: 'Editorial sage porcelain daylight theme with deep forest accents.',
    palette: {
      colorScheme: 'light',
      background: '#eaf1e8',
      surface: '#f9fcf8',
      surfaceAlt: '#dce7d9',
      text: '#14241a',
      textMuted: '#455f4e',
      border: '#c2d3be',
      accent: '#15803d',
      accentText: '#ffffff',
      danger: '#b91c1c',
    },
  },
  {
    id: 'royal-cobalt',
    name: 'Royal Cobalt',
    description: 'Gallery-crisp alabaster surfaces with bold Swiss cobalt accents.',
    palette: {
      colorScheme: 'light',
      background: '#ebf0fa',
      surface: '#ffffff',
      surfaceAlt: '#dde6f7',
      text: '#0e172a',
      textMuted: '#475569',
      border: '#c5d3ee',
      accent: '#1d4ed8',
      accentText: '#ffffff',
      danger: '#dc2626',
    },
  },
  {
    id: 'prism-aurora',
    name: 'Prism Aurora',
    description: 'Cosmic obsidian with a full-spectrum rainbow prism ribbon and soft aurora glow.',
    palette: {
      colorScheme: 'dark',
      background: '#090814',
      surface: '#131126',
      surfaceAlt: '#1d1a38',
      text: '#f5f3ff',
      textMuted: '#b7b0d8',
      border: '#322b5c',
      accent: '#c084fc',
      accentText: '#090814',
      danger: '#fb7185',
    },
    swatches: ['#ff3b8d', '#ff9e2c', '#ffe600', '#22e58b', '#28d7ff', '#8b5cf6'],
    swatchGradient:
      'conic-gradient(from 0deg, #ff3b8d, #ff9e2c, #ffe600, #22e58b, #28d7ff, #8b5cf6, #ff3b8d)',
    hostCss: [
      'body::before { content: ""; position: fixed; inset: 0 0 auto 0; height: 3px; pointer-events: none; z-index: 2147483640; background: linear-gradient(90deg, #ff3b8d, #ff9e2c, #ffe600, #22e58b, #28d7ff, #8b5cf6, #ff3b8d); }',
      'body { background-image: radial-gradient(ellipse 65% 42% at 12% 0%, rgb(255 59 141 / 14%), transparent 62%), radial-gradient(ellipse 60% 42% at 88% 0%, rgb(40 215 255 / 14%), transparent 62%), radial-gradient(ellipse 55% 38% at 50% 100%, rgb(139 92 246 / 12%), transparent 65%) !important; background-attachment: fixed !important; }',
    ].join('\n'),
    uiCss:
      '.dialog, .qp-root { box-shadow: inset 0 3px 0 0 transparent; }\n.dialog::before, .qp-root::before { content: ""; position: absolute; inset: 0 0 auto 0; height: 3px; pointer-events: none; z-index: 50; background: linear-gradient(90deg, #ff3b8d, #ff9e2c, #ffe600, #22e58b, #28d7ff, #8b5cf6, #ff3b8d); }',
  },
  {
    id: 'pastel-prism',
    name: 'Cotton Candy Prism',
    description:
      'Iridescent pearl daylight canvas with a pastel rainbow ribbon and vivid orchid accents.',
    palette: {
      colorScheme: 'light',
      background: '#f7f2ff',
      surface: '#ffffff',
      surfaceAlt: '#efe6ff',
      text: '#1e1333',
      textMuted: '#614d80',
      border: '#dccbf7',
      accent: '#c026d3',
      accentText: '#ffffff',
      danger: '#e11d48',
    },
    swatches: ['#ff7eb3', '#ffb86c', '#ffe87c', '#5ce1c6', '#60a5fa', '#c084fc'],
    swatchGradient:
      'conic-gradient(from 0deg, #ff7eb3, #ffb86c, #ffe87c, #5ce1c6, #60a5fa, #c084fc, #ff7eb3)',
    hostCss: [
      'body::before { content: ""; position: fixed; inset: 0 0 auto 0; height: 3px; pointer-events: none; z-index: 2147483640; background: linear-gradient(90deg, #ff7eb3, #ffb86c, #ffe87c, #5ce1c6, #60a5fa, #c084fc, #ff7eb3); }',
      'body { background-image: radial-gradient(ellipse 65% 45% at 15% 0%, rgb(255 126 179 / 16%), transparent 60%), radial-gradient(ellipse 65% 45% at 85% 0%, rgb(96 165 250 / 16%), transparent 60%), radial-gradient(ellipse 55% 40% at 50% 100%, rgb(92 225 198 / 14%), transparent 65%) !important; background-attachment: fixed !important; }',
    ].join('\n'),
    uiCss:
      '.dialog::before, .qp-root::before { content: ""; position: absolute; inset: 0 0 auto 0; height: 3px; pointer-events: none; z-index: 50; background: linear-gradient(90deg, #ff7eb3, #ffb86c, #ffe87c, #5ce1c6, #60a5fa, #c084fc, #ff7eb3); }',
  },
  {
    id: 'cyber-neon',
    name: 'Cyberpunk Neon',
    description: 'Night-city indigo with laser cyan highlights and electric magenta edge glow.',
    palette: {
      colorScheme: 'dark',
      background: '#060913',
      surface: '#0d1326',
      surfaceAlt: '#151f3d',
      text: '#eef6ff',
      textMuted: '#8ca8d6',
      border: '#243566',
      accent: '#00f0ff',
      accentText: '#04121b',
      danger: '#ff2a85',
    },
    swatches: ['#060913', '#00f0ff', '#7c3aed', '#ff2a85'],
    swatchGradient: 'linear-gradient(135deg, #00f0ff 0%, #7c3aed 52%, #ff2a85 100%)',
    hostCss: [
      'body::before { content: ""; position: fixed; inset: 0 0 auto 0; height: 2px; pointer-events: none; z-index: 2147483640; background: linear-gradient(90deg, #00f0ff, #7c3aed, #ff2a85); }',
      'body { background-image: radial-gradient(ellipse 60% 40% at 10% 0%, rgb(0 240 255 / 12%), transparent 60%), radial-gradient(ellipse 60% 40% at 90% 0%, rgb(255 42 133 / 12%), transparent 60%) !important; background-attachment: fixed !important; }',
    ].join('\n'),
    uiCss:
      '.dialog::before, .qp-root::before { content: ""; position: absolute; inset: 0 0 auto 0; height: 2px; pointer-events: none; z-index: 50; background: linear-gradient(90deg, #00f0ff, #7c3aed, #ff2a85); }',
  },
  {
    id: 'sunset-vapor',
    name: 'Miami Sunset',
    description: 'Deep twilight plum surfaces lit by tropical coral, magenta, and warm gold.',
    palette: {
      colorScheme: 'dark',
      background: '#140a1d',
      surface: '#211130',
      surfaceAlt: '#2f1942',
      text: '#fff1e6',
      textMuted: '#d4adc9',
      border: '#4c2966',
      accent: '#ff6b4a',
      accentText: '#1a0905',
      danger: '#ff4d8d',
    },
    swatches: ['#140a1d', '#ff4d8d', '#ff6b4a', '#ffb800'],
    swatchGradient: 'linear-gradient(135deg, #ff4d8d 0%, #ff6b4a 55%, #ffb800 100%)',
    hostCss: [
      'body::before { content: ""; position: fixed; inset: 0 0 auto 0; height: 3px; pointer-events: none; z-index: 2147483640; background: linear-gradient(90deg, #ff4d8d, #ff6b4a, #ffb800); }',
      'body { background-image: radial-gradient(ellipse 70% 42% at 50% 0%, rgb(255 107 74 / 15%), transparent 62%), radial-gradient(ellipse 50% 35% at 85% 10%, rgb(255 77 141 / 12%), transparent 60%) !important; background-attachment: fixed !important; }',
    ].join('\n'),
    uiCss:
      '.dialog::before, .qp-root::before { content: ""; position: absolute; inset: 0 0 auto 0; height: 3px; pointer-events: none; z-index: 50; background: linear-gradient(90deg, #ff4d8d, #ff6b4a, #ffb800); }',
  },
  {
    id: 'terminal-phosphor',
    name: 'Hacker Terminal',
    description: 'Pitch CRT obsidian with luminous phosphor mint text and matrix green accents.',
    palette: {
      colorScheme: 'dark',
      background: '#040c06',
      surface: '#08170c',
      surfaceAlt: '#0e2514',
      text: '#b6f7c8',
      textMuted: '#63b87c',
      border: '#194524',
      accent: '#22c55e',
      accentText: '#031207',
      danger: '#fb7185',
    },
    swatches: ['#040c06', '#0e2514', '#22c55e', '#b6f7c8'],
    hostCss: [
      'body::before { content: ""; position: fixed; inset: 0 0 auto 0; height: 2px; pointer-events: none; z-index: 2147483640; background: linear-gradient(90deg, transparent, #22c55e, transparent); }',
      'body { background-image: radial-gradient(ellipse 65% 40% at 50% 0%, rgb(34 197 94 / 11%), transparent 65%) !important; background-attachment: fixed !important; }',
    ].join('\n'),
    uiCss:
      '.dialog::before, .qp-root::before { content: ""; position: absolute; inset: 0 0 auto 0; height: 2px; pointer-events: none; z-index: 50; background: linear-gradient(90deg, transparent, #22c55e, transparent); }',
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

export interface BackdropRevealMetrics {
  readonly columnAlpha: number;
  readonly cardAlpha: number;
  readonly blurPx: number;
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
  /** Optional CSS to reveal live backdrops through page gutters while frosting feed columns. */
  readonly backdropRevealCss?: (
    palette: ThemePalette | null,
    metrics: BackdropRevealMetrics,
  ) => string;
  /** Opt-in automatic stylesheet compiler + real-time contrast/polarity self-healer. */
  readonly adaptive?: AdaptiveThemeMappingOptions;
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

/** Computes WCAG 2.1 relative luminance (`0..1`) to pick crisp dark/light text on custom colors. */
export function relativeLuminance(hex: string): number {
  const parsed = parseCssColor(hex);
  return parsed ? rgbaLuminance(parsed) : 0;
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

/** Computes the WCAG 2.1 contrast ratio (`1..21`) between two `#rrggbb` colors. */
export function contrastRatio(a: string, b: string): number {
  const fg = parseCssColor(a);
  const bg = parseCssColor(b);
  return fg && bg ? rgbaContrastRatio(fg, bg) : 1;
}

/** Picks `#ffffff` or `#111111` for maximum contrast on top of `backgroundHex`. */
export const contrastingText = (backgroundHex: string): string =>
  relativeLuminance(backgroundHex) > 0.42 ? '#111111' : '#ffffff';

export const THEME_DATA_KEY = 'theme';

export function readThemeConfig(raw: unknown): ThemeConfig {
  if (!isRecord(raw)) {
    return { ...DEFAULT_THEME_CONFIG };
  }
  const str = (key: string, fallback = ''): string =>
    typeof raw[key] === 'string' ? raw[key] : fallback;
  const parsedEffects = raw.effects === undefined ? undefined : readThemeEffectsConfig(raw.effects);
  return {
    preset: str('preset', 'default'),
    accent: str('accent'),
    background: str('background'),
    surface: str('surface'),
    text: str('text'),
    font: str('font', 'default'),
    customCss: str('customCss'),
    ...(parsedEffects && hasActiveEffects(parsedEffects) ? { effects: parsedEffects } : {}),
  };
}

/** Switches `config` to `preset` while clearing per-token color overrides. */
export function applyThemePreset(config: ThemeConfig, preset: string): ThemeConfig {
  return {
    ...config,
    preset,
    accent: '',
    background: '',
    surface: '',
    text: '',
  };
}

/** Applies a curated Studio Vibe (palette preset, optional font, and live effects). */
export function applyStudioVibe(config: ThemeConfig, vibe: StudioVibe): ThemeConfig {
  return {
    ...applyThemePreset(config, vibe.preset),
    font: vibe.font ?? 'default',
    effects: {
      ...DEFAULT_THEME_EFFECTS,
      ...vibe.effects,
    },
  };
}

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
  const normalizedEffects = config.effects ? readThemeEffectsConfig(config.effects) : undefined;
  const activeEffects =
    normalizedEffects && hasActiveEffects(normalizedEffects) ? normalizedEffects : undefined;

  const hasColorOverride = Boolean(preset || accent || background || surface || text);
  if (!hasColorOverride && !fontFamily && !customCss && !activeEffects) {
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
    ...(preset?.hostCss ? { presetHostCss: preset.hostCss } : {}),
    ...(preset?.uiCss ? { presetUiCss: preset.uiCss } : {}),
    ...(activeEffects ? { effects: activeEffects } : {}),
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

const FONT_TEXT_ELEMENTS =
  'p, span, div, a, li, td, th, dt, dd, label, legend, h1, h2, h3, h4, h5, h6, button, input, textarea, select, option, blockquote, figcaption, summary, article, section, main, nav, header, footer, aside';

const FONT_EXCLUDE_SELECTORS = `[${OWN_ATTR}], [${OWN_ATTR}] *, code, pre, kbd, samp, code *, pre *, [class*="icon" i], [class*="material-symbols" i], svg *`;

const HOST_FONT_VARS = [
  '--font-family-default',
  '--font-family-apple',
  '--font-family-segoe',
  '--font-family-system',
  '--x-font-sans',
  '--font-sans',
  '--font-body',
] as const;

function compileFontOverrideCss(fontFamily: string, target: 'host' | 'shadow'): string {
  const varDecls = HOST_FONT_VARS.map((v) => `${v}: ${fontFamily} !important;`).join('\n  ');
  if (target === 'shadow') {
    return [
      `:host {\n  font-family: ${fontFamily} !important;\n  ${varDecls}\n}`,
      `:where(${FONT_TEXT_ELEMENTS}):not(:where(${FONT_EXCLUDE_SELECTORS})) {\n  font-family: ${fontFamily} !important;\n}`,
    ].join('\n\n');
  }
  return [
    `:root {\n  ${varDecls}\n}`,
    `html, body {\n  font-family: ${fontFamily} !important;\n}`,
    `body :where(${FONT_TEXT_ELEMENTS}):not(:where(${FONT_EXCLUDE_SELECTORS})) {\n  font-family: ${fontFamily} !important;\n}`,
  ].join('\n\n');
}

/** Compiles `theme` + `mapping` into host-document CSS. */
export function compileHostThemeCss(
  theme: ResolvedTheme,
  mapping: SiteThemeMapping,
  hostScheme: ThemeColorScheme = theme.palette?.colorScheme ?? 'dark',
): string {
  const parts: string[] = [];
  if (theme.palette) {
    const decls = buildPaletteDeclarations(theme.palette, mapping);
    const selectors = mapping.rootSelectors.length > 0 ? mapping.rootSelectors.join(', ') : ':root';
    parts.push(`${selectors} {\n  ${decls.join('\n  ')}\n}`);
  }
  if (theme.fontFamily) {
    parts.push(compileFontOverrideCss(theme.fontFamily, 'host'));
  }
  const extra = theme.palette ? mapping.extraCss?.(theme.palette).trim() : undefined;
  if (extra) {
    parts.push(extra);
  }
  if (theme.presetHostCss) {
    parts.push(theme.presetHostCss);
  }
  if (theme.effects) {
    const revealCss = compileBackdropRevealCss(
      theme.palette,
      hostScheme,
      theme.effects,
      mapping.backdropRevealCss,
    );
    if (revealCss) {
      parts.push(revealCss);
    }
    const finishCss = compileSurfaceFinishCss(theme.palette, hostScheme, theme.effects);
    if (finishCss) {
      parts.push(finishCss);
    }
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
    parts.push(compileFontOverrideCss(theme.fontFamily, 'shadow'));
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
      `--fs-dialog-bg: ${p.surface};`,
      `--fs-sidebar-bg: ${p.background};`,
      `--fs-card-bg: ${p.colorScheme === 'dark' ? p.surfaceAlt : p.background};`,
      `--fs-control-bg: ${p.colorScheme === 'dark' ? p.background : p.surface};`,
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
  const parts: string[] = [];
  if (lines.length > 0) {
    parts.push(`:host {\n  ${lines.join('\n  ')}\n}`);
  }
  if (theme.presetUiCss) {
    parts.push(theme.presetUiCss);
  }
  const uiFxCss = compileUiSurfaceCss(theme.palette, theme.effects);
  if (uiFxCss) {
    parts.push(uiFxCss);
  }
  return parts.join('\n\n');
}

export const THEME_STYLE_ID = 'feed_sanity_user_theme';
const ADAPTIVE_STYLE_ID = 'feed_sanity_adaptive_theme';
const EARLY_THEME_CACHE_PREFIX = '__fs_early_theme__:';

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

const isOwnShadowRoot = (shadow: ShadowRoot): boolean => isOwnUiElement(shadow.host);

export interface ThemeController {
  /** Applies the persisted user theme (or clears it when `null`). */
  apply: (theme: ResolvedTheme | null) => void;
  /** Temporarily previews a theme (including `null` to preview Site Default). */
  preview: (theme: ResolvedTheme | null) => void;
  /** Ends any active preview and restores the persisted user theme. */
  clearPreview: () => void;
  /** Currently active effective theme (preview if active, else saved). */
  current: () => ResolvedTheme | null;
  /** Runs the Theme Coverage & Layout-Integrity Auditor against the live page. */
  audit?: () => ThemeAuditReport | null;
  /** Triggers an immediate self-healing pass across visible light DOM + open Shadow Roots. */
  healNow?: () => number;
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

  const adaptiveConfig = mapping.adaptive?.enabled === true ? mapping.adaptive : undefined;
  const mediaOpt = adaptiveConfig?.mediaPreserveSelectors
    ? { mediaPreserveSelectors: adaptiveConfig.mediaPreserveSelectors }
    : {};
  let detectedHostScheme: ThemeColorScheme | undefined;
  const dirtyRoots = new Set<Document | ShadowRoot>();
  let recompileTimer: ReturnType<typeof setTimeout> | undefined;
  const linkLoadAbort = new AbortController();

  const styles = new Map<Document | ShadowRoot, HTMLStyleElement>();
  const adaptiveStyles = new Map<Document | ShadowRoot, HTMLStyleElement>();
  const iframeDocs = new Set<Document>();
  const cleanups: Array<() => void> = [];
  const healer: ThemeHealer | undefined = adaptiveConfig
    ? createThemeHealer(env, env.scope, mediaOpt)
    : undefined;
  if (healer) {
    cleanups.push(() => healer.dispose());
  }
  const effectsLayer = createEffectsLayerController(env.doc);
  cleanups.push(() => effectsLayer.dispose());

  const effectiveTheme = (): ResolvedTheme | null =>
    previewTheme === undefined ? savedTheme : previewTheme;

  const disableThemeSheetsForMeasure = (includeShadowRoots: boolean): (() => void) => {
    const toggled: CSSStyleSheet[] = [];
    const toggleRoot = (root: Document | ShadowRoot): void => {
      for (const id of [THEME_STYLE_ID, ADAPTIVE_STYLE_ID, HEALER_STYLE_ID]) {
        const el = root.querySelector(`#${id}`);
        const sheet = el && el.localName === 'style' ? (el as HTMLStyleElement).sheet : null;
        if (sheet && !sheet.disabled) {
          sheet.disabled = true;
          toggled.push(sheet);
        }
      }
    };
    toggleRoot(env.doc);
    if (includeShadowRoots) {
      for (const shadow of env.shadowRoots) {
        if (!isOwnShadowRoot(shadow)) {
          toggleRoot(shadow);
        }
      }
    }
    return () => {
      for (const sheet of toggled) {
        sheet.disabled = false;
      }
    };
  };

  const detectNativeHostScheme = (): ThemeColorScheme => {
    const restore = disableThemeSheetsForMeasure(false);
    try {
      return detectHostColorScheme(env.doc);
    } finally {
      restore();
    }
  };

  const getHostScheme = (): ThemeColorScheme => {
    if (detectedHostScheme !== undefined) {
      return detectedHostScheme;
    }
    const scheme = detectNativeHostScheme();
    // Only lock in the detected scheme once `<body>` exists so an early `document_start`
    // render before host styles parse never permanently caches a fallback scheme.
    if (env.doc.body) {
      detectedHostScheme = scheme;
    }
    return scheme;
  };

  const forEachHostRoot = (
    fn: (root: Document | ShadowRoot) => void,
    includeIframes = true,
  ): void => {
    fn(env.doc);
    for (const shadow of env.shadowRoots) {
      if (!isOwnShadowRoot(shadow)) {
        fn(shadow);
      }
    }
    if (includeIframes) {
      for (const iframeDoc of iframeDocs) {
        fn(iframeDoc);
      }
    }
  };

  const getShadowCss = (): string => {
    if (shadowCss === undefined) {
      const effective = effectiveTheme();
      shadowCss = effective ? compileShadowThemeCss(effective, mapping) : '';
    }
    return shadowCss;
  };

  const findExistingStyle = (
    root: Document | ShadowRoot,
    styleId: string,
    store: Map<Document | ShadowRoot, HTMLStyleElement>,
  ): HTMLStyleElement | undefined => {
    const tracked = store.get(root);
    if (tracked?.isConnected) {
      return tracked;
    }
    const found = root.querySelector(`#${styleId}`);
    // Use `localName` rather than `instanceof HTMLStyleElement` so cross-realm
    // `<style>` elements inside same-origin iframes are matched reliably.
    if (found && found.localName === 'style') {
      const style = found as HTMLStyleElement;
      store.set(root, style);
      return style;
    }
    return undefined;
  };

  const syncNamedRoot = (
    root: Document | ShadowRoot,
    styleId: string,
    store: Map<Document | ShadowRoot, HTMLStyleElement>,
    cssText: string,
    beforeStyle?: HTMLStyleElement,
  ): void => {
    const existing = findExistingStyle(root, styleId, store);
    if (!cssText) {
      existing?.remove();
      store.delete(root);
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
          if (beforeStyle && beforeStyle.parentElement === head) {
            beforeStyle.before(existing);
          } else {
            head.append(existing);
          }
        }
      }
      return;
    }
    const owner = isDoc ? (root as Document) : (root.ownerDocument ?? env.doc);
    const style = owner.createElement('style');
    style.id = styleId;
    style.textContent = cssText;
    const target = isDoc ? ((root as Document).head ?? (root as Document).documentElement) : root;
    if (!target) {
      return;
    }
    if (beforeStyle && beforeStyle.parentNode === target) {
      beforeStyle.before(style);
    } else {
      target.append(style);
    }
    store.set(root, style);
  };

  let lastAdaptivePalette: ThemePalette | null = null;

  const samePaletteColors = (a: ThemePalette | null, b: ThemePalette | null): boolean => {
    if (a === b) {
      return true;
    }
    if (!a || !b) {
      return false;
    }
    return (
      a.colorScheme === b.colorScheme &&
      a.background === b.background &&
      a.surface === b.surface &&
      a.surfaceAlt === b.surfaceAlt &&
      a.text === b.text &&
      a.textMuted === b.textMuted &&
      a.border === b.border &&
      a.accent === b.accent &&
      a.accentText === b.accentText &&
      a.danger === b.danger
    );
  };

  const syncAdaptiveForRoot = (
    root: Document | ShadowRoot,
    resolvedHostScheme?: ThemeColorScheme,
  ): void => {
    if (!adaptiveConfig) {
      return;
    }
    dirtyRoots.delete(root);
    const palette = effectiveTheme()?.palette ?? null;
    if (!palette) {
      syncNamedRoot(root, ADAPTIVE_STYLE_ID, adaptiveStyles, '');
      return;
    }
    const css = compileAdaptiveRootCss(root, palette, {
      hostScheme: resolvedHostScheme ?? getHostScheme(),
      ...(adaptiveConfig.brandColors ? { brandColors: adaptiveConfig.brandColors } : {}),
      ...mediaOpt,
    });
    const userStyle = findExistingStyle(root, THEME_STYLE_ID, styles);
    syncNamedRoot(root, ADAPTIVE_STYLE_ID, adaptiveStyles, css, userStyle);
  };

  const cancelAdaptiveRecompile = (): void => {
    if (recompileTimer !== undefined) {
      clearTimeout(recompileTimer);
      recompileTimer = undefined;
    }
    dirtyRoots.clear();
  };

  const scheduleAdaptiveRecompile = (root: Document | ShadowRoot): void => {
    if (!adaptiveConfig || disposed || !effectiveTheme()?.palette) {
      return;
    }
    dirtyRoots.add(root);
    if (recompileTimer !== undefined) {
      return;
    }
    recompileTimer = setTimeout(() => {
      recompileTimer = undefined;
      if (disposed || !effectiveTheme()?.palette) {
        dirtyRoots.clear();
        return;
      }
      const batch = [...dirtyRoots];
      dirtyRoots.clear();
      const scheme = getHostScheme();
      for (const dirty of batch) {
        if (dirty.nodeType === Node.DOCUMENT_NODE || (dirty as ShadowRoot).host.isConnected) {
          syncAdaptiveForRoot(dirty, scheme);
        }
      }
    }, 0);
  };

  const syncRoot = (
    root: Document | ShadowRoot,
    cssText: string,
    includeAdaptive = true,
    resolvedHostScheme?: ThemeColorScheme,
  ): void => {
    syncNamedRoot(root, THEME_STYLE_ID, styles, cssText);
    if (includeAdaptive) {
      syncAdaptiveForRoot(root, resolvedHostScheme);
    }
  };

  const render = (): void => {
    if (disposed) {
      return;
    }
    const effective = effectiveTheme();
    const nextPalette = effective?.palette ?? null;
    const paletteChanged = !samePaletteColors(nextPalette, lastAdaptivePalette);
    if (paletteChanged) {
      cancelAdaptiveRecompile();
      lastAdaptivePalette = nextPalette;
    }
    let resolvedScheme: ThemeColorScheme | undefined;
    if (adaptiveConfig) {
      if (nextPalette) {
        if (detectedHostScheme === undefined && env.doc.body) {
          detectedHostScheme = detectNativeHostScheme();
        }
        if (paletteChanged) {
          resolvedScheme = getHostScheme();
        }
      } else {
        detectedHostScheme = undefined;
      }
    }
    const currentScheme = resolvedScheme ?? getHostScheme();
    hostCss = effective ? compileHostThemeCss(effective, mapping, currentScheme) : '';
    shadowCss = undefined;
    const uiCss = effective ? compileUiThemeCss(effective) : '';
    setUiThemeCss(uiCss);
    syncRoot(env.doc, hostCss, paletteChanged, resolvedScheme);
    if (env.shadowRoots.size > 0) {
      const compiledShadow = getShadowCss();
      for (const shadow of env.shadowRoots) {
        if (!isOwnShadowRoot(shadow)) {
          syncRoot(shadow, compiledShadow, paletteChanged, resolvedScheme);
        }
      }
    }
    for (const iframeDoc of iframeDocs) {
      syncRoot(iframeDoc, hostCss, paletteChanged, resolvedScheme);
    }
    healer?.setPalette(nextPalette);
    effectsLayer.sync(effective?.effects, nextPalette, currentScheme);
  };

  const watchHead = (targetEnv: DomEnvironment): (() => void) | undefined => {
    if (targetEnv.doc.head) {
      return undefined;
    }
    const stopHead = targetEnv.watcher.watch('head', {
      added: (head) => {
        stopHead();
        if (disposed) {
          return;
        }
        const existing = findExistingStyle(targetEnv.doc, THEME_STYLE_ID, styles);
        if (existing) {
          if (existing.parentElement !== head) {
            head.append(existing);
          }
          syncAdaptiveForRoot(targetEnv.doc);
        } else if (hostCss) {
          syncRoot(targetEnv.doc, hostCss);
        }
      },
    });
    return stopHead;
  };

  if (adaptiveConfig) {
    // Re-compile Layer 1 automatically whenever the host lazy-loads a new `<style>` or `<link rel="stylesheet">`
    // in light DOM or any discovered open Shadow Root.
    cleanups.push(
      env.watch('style, link[rel="stylesheet"]', {
        added: (el) => {
          if (el.id.startsWith('feed_sanity_') || el.hasAttribute(OWN_ATTR)) {
            return;
          }
          const root = el.getRootNode();
          if (
            root.nodeType === Node.DOCUMENT_FRAGMENT_NODE &&
            'host' in root &&
            isOwnShadowRoot(root as ShadowRoot)
          ) {
            return;
          }
          const targetRoot =
            root.nodeType === Node.DOCUMENT_NODE ||
            (root.nodeType === Node.DOCUMENT_FRAGMENT_NODE && 'host' in root)
              ? (root as Document | ShadowRoot)
              : env.doc;
          if (el.localName === 'link') {
            if ((el as HTMLLinkElement).sheet) {
              scheduleAdaptiveRecompile(targetRoot);
            } else {
              el.addEventListener('load', () => scheduleAdaptiveRecompile(targetRoot), {
                once: true,
                signal: linkLoadAbort.signal,
              });
            }
            return;
          }
          scheduleAdaptiveRecompile(targetRoot);
        },
      }),
    );
  }

  cleanups.push(
    env.onShadowRoot((shadow, rootScope) => {
      if (isOwnShadowRoot(shadow)) {
        return;
      }
      syncRoot(shadow, getShadowCss());
      rootScope.add(() => {
        styles.get(shadow)?.remove();
        styles.delete(shadow);
        adaptiveStyles.get(shadow)?.remove();
        adaptiveStyles.delete(shadow);
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
        cleanups.push(stopChildHead);
      }
      childEnv.scope.add(() => {
        iframeDocs.delete(childEnv.doc);
        styles.get(childEnv.doc)?.remove();
        styles.delete(childEnv.doc);
        adaptiveStyles.get(childEnv.doc)?.remove();
        adaptiveStyles.delete(childEnv.doc);
      });
    }),
  );

  // Attach or move `<style>` into `<head>` once parsed (handles both early
  // `documentElement` attachment and `document_start` before `<html>` exists).
  const stopMainHead = watchHead(env);
  if (stopMainHead) {
    cleanups.push(stopMainHead);
  }
  if (!env.doc.body) {
    const stopBody = env.watcher.watch('body', {
      added: () => {
        stopBody();
        if (disposed) {
          return;
        }
        const effective = effectiveTheme();
        if (effective?.effects) {
          effectsLayer.sync(effective.effects, effective.palette, getHostScheme());
        }
      },
    });
    cleanups.push(stopBody);
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
    audit() {
      if (disposed) {
        return null;
      }
      const effective = effectiveTheme();
      if (!effective?.palette) {
        return null;
      }
      // Perform a synchronous zero-flicker A/B snapshot on the exact current DOM:
      // disable Feed Sanity's theme stylesheets within one JS turn (before any paint),
      // measure true host geometry & opacity, re-enable them, then run the full audit.
      const restore = disableThemeSheetsForMeasure(true);
      let beforeSnapshot: ReturnType<typeof captureLayoutSnapshot>;
      try {
        beforeSnapshot = captureLayoutSnapshot(env.doc, mediaOpt);
      } finally {
        restore();
      }
      return auditThemeCoverage(env.doc, effective.palette, {
        beforeSnapshot,
        ignoreLayoutShift: Boolean(effective.fontFamily),
        ...mediaOpt,
      });
    },
    ...(adaptiveConfig
      ? {
          healNow() {
            if (disposed) {
              return 0;
            }
            const scheme = getHostScheme();
            forEachHostRoot((root) => syncAdaptiveForRoot(root, scheme));
            return healer ? healer.healNow() : 0;
          },
        }
      : {}),
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      hostCss = '';
      shadowCss = undefined;
      cancelAdaptiveRecompile();
      linkLoadAbort.abort();
      for (const stop of cleanups.splice(0)) {
        stop();
      }
      for (const style of styles.values()) {
        style.remove();
      }
      styles.clear();
      for (const style of adaptiveStyles.values()) {
        style.remove();
      }
      adaptiveStyles.clear();
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
