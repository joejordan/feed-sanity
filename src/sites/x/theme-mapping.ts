import type { SiteThemeMapping, ThemePalette } from '../../core/theming';
import { hexToHslTriplet, hexWithAlpha, mixHex, TEXT_INPUT_SELECTOR } from '../../core/theming';

const ALPHA_PERCENTS = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 30, 40, 50, 60, 70, 80, 85, 90, 95, 100,
] as const;

const IN_VIDEO = '[data-testid="videoComponent"] *, [data-testid="videoPlayer"] *';
const NOT_IN_VIDEO = `:not(:where(${IN_VIDEO}))`;
const RNW_CANVAS_SELECTORS = [
  `.r-kemksi${NOT_IN_VIDEO}`,
  `.r-yfoy6g${NOT_IN_VIDEO}`,
  `.r-14lw9ot:not(:where(button, [role="button"], [role="switch"], [role="switch"] *, ${IN_VIDEO}))`,
] as const;

const NEUTRAL_STEPS = [
  ['000', 0.96],
  ['050', 0.9],
  ['100', 0.82],
  ['200', 0.72],
  ['300', 0.62],
  ['400', 0.52],
  ['500', 0.44],
  ['600', 0.36],
  ['700', 0.28],
  ['800', 0.2],
  ['900', 0.12],
  ['1000', 0.06],
  ['1100', 0.02],
] as const;

function buildXDesignSystemVars(): Record<string, (p: ThemePalette) => string> {
  const vars: Record<string, (p: ThemePalette) => string> = {
    // Feed Sanity host tokens
    '--fs-host-bg': (p) => p.background,
    '--fs-host-surface': (p) => p.surface,
    '--fs-host-surface-alt': (p) => p.surfaceAlt,
    '--fs-host-text': (p) => p.text,
    '--fs-host-muted': (p) => p.textMuted,
    '--fs-host-border': (p) => p.border,
    '--fs-host-accent': (p) => p.accent,

    // X modern design system (`--x-*`) used by Chat (Shadow DOM), Calls (Shadow DOM),
    // Grok, Premium, Money, and `.x-commerce` dialogs/sheets.
    '--x-bg-primary': (p) => p.background,
    '--x-bg-secondary': (p) => p.surface,
    '--x-bg-tertiary': (p) => p.surfaceAlt,
    '--x-bg-quaternary': (p) => hexWithAlpha(p.text, 0.05),
    '--x-bg-sheets': (p) => p.surface,
    '--x-bg-inputs': (p) => p.surfaceAlt,
    '--x-bg-modal': (p) => p.surface,
    '--x-modal-bg': (p) => p.surface,
    '--x-plan-tabs-page': (p) => p.background,
    '--x-fg-primary': (p) => p.text,
    '--x-fg-secondary': (p) => p.textMuted,
    '--x-fg-tertiary': (p) => hexWithAlpha(p.textMuted, 0.75),
    '--x-fg-inverted': (p) => p.background,
    '--x-fg-on-color': (p) => p.accentText,
    '--x-fg-on-brand': (p) => p.accentText,
    '--x-fg-brand': (p) => p.accent,
    '--x-brand-subtle': (p) => hexWithAlpha(p.accent, 0.16),
    '--x-brand-wash': (p) => hexWithAlpha(p.accent, 0.12),
    '--x-fg-destructive': (p) => p.danger,
    '--x-border-normal': (p) => p.border,
    '--x-border-divider': (p) => p.border,
    '--x-border-hover': (p) => hexWithAlpha(p.text, 0.25),
    '--x-border-active': (p) => p.accent,
    '--x-border-media': (p) => hexWithAlpha(p.text, 0.08),
    '--x-border-elevated': (p) => p.border,
    '--x-border-destructive': (p) => p.danger,
    '--x-btn-primary': (p) => p.text,
    '--x-btn-primary-hover': (p) => hexWithAlpha(p.text, 0.86),
    '--x-btn-primary-pressed': (p) => hexWithAlpha(p.text, 0.74),
    '--x-btn-secondary': (p) => p.surfaceAlt,
    '--x-btn-secondary-hover': (p) => mixHex(p.surfaceAlt, p.text, 0.08),
    '--x-btn-secondary-pressed': (p) => mixHex(p.surfaceAlt, p.text, 0.14),
    '--x-btn-tertiary': (p) => hexWithAlpha(p.text, 0.08),
    '--x-btn-tertiary-hover': (p) => hexWithAlpha(p.text, 0.14),
    '--x-btn-tertiary-pressed': (p) => hexWithAlpha(p.text, 0.2),
    '--x-btn-tertiary-opaque': (p) => p.surfaceAlt,
    '--x-btn-tertiary-opaque-hover': (p) => mixHex(p.surfaceAlt, p.text, 0.08),
    '--x-btn-tertiary-opaque-pressed': (p) => mixHex(p.surfaceAlt, p.text, 0.14),
    '--x-btn-ghost-hover': (p) => hexWithAlpha(p.text, 0.08),
    '--x-btn-ghost-pressed': (p) => hexWithAlpha(p.text, 0.14),
    '--x-btn-inverted': (p) => p.background,
    '--x-btn-inverted-hover': (p) => hexWithAlpha(p.background, 0.9),
    '--x-btn-inverted-pressed': (p) => hexWithAlpha(p.background, 0.8),
    '--x-btn-brand': (p) => p.accent,
    '--x-btn-brand-hover': (p) => hexWithAlpha(p.accent, 0.88),
    '--x-btn-brand-pressed': (p) => hexWithAlpha(p.accent, 0.78),
    '--x-hover-subtle': (p) => hexWithAlpha(p.text, 0.07),
    '--x-hover-faint': (p) => hexWithAlpha(p.text, 0.04),
    '--x-skeleton-shimmer': (p) => hexWithAlpha(p.text, 0.08),
    '--x-tooltip-bg': (p) => p.text,
    '--x-tooltip-fg': (p) => p.background,
    '--x-toast-bg': (p) => p.surface,
    '--x-segmented-control-thumb': (p) => p.surface,
    '--x-ring': (p) => p.accent,
    '--row-base': (p) => p.background,
    '--row-tint': (p) => hexWithAlpha(p.text, 0.08),

    // X Chat & Calls Shadow DOM utility / tray / toast tokens
    '--background': (p) => p.surface,
    '--foreground': (p) => p.text,
    '--border': (p) => p.border,
    '--color-background': (p) => hexToHslTriplet(p.background),
    '--color-text': (p) => hexToHslTriplet(p.text),
    '--color-gray-0': (p) => hexToHslTriplet(p.surface),
    '--color-gray-100': (p) => hexToHslTriplet(mixHex(p.background, p.text, 0.08)),
    '--color-gray-200': (p) => hexToHslTriplet(mixHex(p.background, p.text, 0.14)),
    '--color-gray-300': (p) => hexToHslTriplet(mixHex(p.background, p.text, 0.22)),
    '--color-gray-400': (p) => hexToHslTriplet(mixHex(p.background, p.text, 0.38)),
    '--color-gray-500': (p) => hexToHslTriplet(p.textMuted),
    '--jf-tray-surface': (p) => p.surface,
    '--jf-tray-modal-surface': (p) => p.surface,
    '--jf-tray-fg': (p) => p.text,
    '--jf-tray-separator': (p) => p.border,
    '--jf-tray-nav-hover': (p) => hexWithAlpha(p.text, 0.08),
    '--jf-tray-nav-pressed': (p) => hexWithAlpha(p.text, 0.14),
    '--jf-tray-btn-primary': (p) => p.accent,
    '--jf-tray-btn-primary-fg': (p) => p.accentText,
    '--jf-tray-btn-secondary': (p) => p.surfaceAlt,
    '--normal-bg': (p) => p.surface,
    '--normal-bg-hover': (p) => p.surfaceAlt,
    '--normal-border': (p) => p.border,
    '--normal-border-hover': (p) => hexWithAlpha(p.text, 0.28),
    '--normal-text': (p) => p.text,
  };

  for (const pct of ALPHA_PERCENTS) {
    const step = String(pct).padStart(2, '0');
    const alpha = pct / 100;
    vars[`--x-fg-alpha-${step}`] = (p) => hexWithAlpha(p.text, alpha);
    vars[`--x-bg-alpha-${step}`] = (p) => hexWithAlpha(p.background, alpha);
  }

  for (const [step, weight] of NEUTRAL_STEPS) {
    // `--x-neutral-1000`..`1100` sit near canvas; `000`..`300` sit near foreground text.
    vars[`--x-neutral-${step}`] = (p) => mixHex(p.background, p.text, weight);
  }

  return vars;
}

/**
 * Maps Feed Sanity's semantic `ThemePalette` onto all three layers of X.com's UI:
 * 1. Modern `--x-*` / Tailwind CSS variables (used across Chat & Calls Shadow DOM,
 *    Grok, Premium, Money, and `.x-commerce` dialogs).
 * 2. Semantic landmarks, dialogs, dropdowns, menus, tabs, search pill, composer,
 *    profile bio, and sidebar modules.
 * 3. React Native Web atomic stylesheet + inline `style="...rgb(...)..."` rules
 *    for X's Lights Out, Dim, and Light host themes (keeping media overlays,
 *    verified icons, toggles, and accent CTAs crisp).
 */
export const xThemeMapping: SiteThemeMapping = {
  rootSelectors: [':root', '[data-theme="dark"]', '[data-theme="light"]', '[data-theme="dim"]'],
  adaptive: {
    enabled: true,
    brandColors: ['#1d9bf0'],
    mediaPreserveSelectors: [
      '[data-testid="videoComponent"] *',
      '[data-testid="videoPlayer"] *',
      '[data-testid="tweetPhoto"] *',
    ],
  },
  colorVars: buildXDesignSystemVars(),
  extraCss: (p) => {
    const frostedBg = hexWithAlpha(p.background, 0.88);
    const floatingBg = hexWithAlpha(p.surface, 0.92);
    const hoverBg = hexWithAlpha(p.text, 0.08);
    const activeBg = hexWithAlpha(p.text, 0.14);
    const popupShadow =
      p.colorScheme === 'dark'
        ? '0 4px 18px rgb(0 0 0 / 55%), 0 0 1px rgb(255 255 255 / 12%)'
        : '0 4px 18px rgb(0 0 0 / 14%), 0 0 1px rgb(0 0 0 / 12%)';

    return `
/* === 1. Document canvas, scrollbars, and left navigation rail === */
html, body, #react-root, header[role="banner"], main[role="main"] {
  background-color: ${p.background} !important;
  color: ${p.text} !important;
  scrollbar-color: ${p.border} ${p.background} !important;
}
:where(header[role="banner"]) :where(a, a span, button, button span, svg) {
  color: ${p.text} !important;
}

/* === 2. Primary column, sticky frosted bars (Home, Notifications, Status, Settings) === */
/* Only theme elements that already paint a backdrop (.r-5zmot / .r-6026j / [role="tablist"])
 * so transparent wrappers around the sticky "Post" header never become opaque curtains
 * covering the top of the post below. */
[data-testid="primaryColumn"],
[data-testid="primaryColumn"] [data-testid="toolBar"],
[data-testid="cellInnerDiv"] {
  border-color: ${p.border} !important;
}
[data-testid="primaryColumn"],
[data-testid="primaryColumn"] [data-testid="toolBar"] {
  background-color: ${p.background} !important;
}
[data-testid="primaryColumn"] [role="tablist"],
.r-5zmot${NOT_IN_VIDEO},
.r-6026j${NOT_IN_VIDEO} {
  background-color: ${frostedBg} !important;
  border-bottom-color: ${p.border} !important;
}

/* === 3. React Native Web dark & light canvas/surface/border/text atomic palette === */
/* Dark & light host canvas (Lights Out #000, Dim #15202b, Light #fff).
 * Uses --fs-reveal-canvas so Studio backdrops turn outer shells transparent
 * while #layers, form[role="search"], and popups stay opaque cleanly. */
${RNW_CANVAS_SELECTORS.join(',\n')},
div[style*="background-color: rgb(0, 0, 0)"]:not(:where(${IN_VIDEO}, [data-testid="mask"])),
div[style*="background-color: rgb(21, 32, 43)"]:not(:where(${IN_VIDEO}, [data-testid="mask"])) {
  background-color: var(--fs-reveal-canvas, ${p.background}) !important;
}
/* Light-mode host surface buttons using .r-14lw9ot so dark themes keep readable contrast */
:where(html[style*="color-scheme: light"]) :where(button, [role="button"]).r-14lw9ot {
  background-color: ${p.surface} !important;
  border-color: ${p.border} !important;
}
/* Elevated sheets, cards, dialogs, menus, active settings routes */
.r-g2wdr4,
.r-cl2sl0,
.r-1che71a,
.r-x572qd,
[data-testid="activeRoute"] {
  background-color: ${p.surface} !important;
}
/* Secondary inputs, muted pills, recessed controls */
.r-z32n2g,
.r-1fkb3t2 {
  background-color: ${p.surfaceAlt} !important;
}
/* Hairline separator bars & thread connectors */
.r-gu4em3,
.r-1bnu78o,
.r-1shrkeu,
[role="separator"] {
  background-color: ${p.border} !important;
}
/* Subtle hover / selection highlight tints */
.r-1cuuowz,
.r-q773ft,
.r-c8f5pn,
.r-pjtv4k,
.r-1hdo0pc {
  background-color: ${hoverBg} !important;
}
.r-11gmi9o,
.r-1a7u7ko,
.r-7l9xyp,
.r-1fpi9eo {
  background-color: ${activeBg} !important;
}
/* Borders across dark, dim, and light X modes */
.r-1kqtdi0,
.r-1roi411,
.r-16cnnyw,
.r-j7xza8,
.r-1l9avrr,
.r-7jjzhb,
.r-14wv3jr,
.r-316qow,
.r-1ets6dv,
.r-jxzhtn,
.r-1wl2o3p,
.r-1d6w8o1,
[style*="border-color: rgb(47, 51, 54)"],
[style*="border-color: rgb(51, 54, 57)"],
[style*="border-color: rgb(62, 65, 68)"],
[style*="border-color: rgb(83, 100, 113)"],
[style*="border-color: rgb(207, 217, 222)"] {
  border-color: ${p.border} !important;
}
.r-1igl3o0,
.r-j5o65s,
.r-zjs74l {
  border-bottom-color: ${p.border} !important;
}
.r-2sztyj,
.r-12s0y0c,
.r-1dgieki {
  border-top-color: ${p.border} !important;
}
.r-motplv {
  border-left-color: ${p.border} !important;
}
.r-1hm43qg {
  border-right-color: ${p.border} !important;
}
/* Elevation shadows (replaces dark-mode white glow on popovers/menus) */
.r-qo02w8,
.r-15ce4ve,
.r-1upvrn0,
.r-1jyoszn {
  box-shadow: ${popupShadow} !important;
}
.r-1cejsyx {
  box-shadow: ${p.border} 0px 0px 0px 1px inset !important;
}
.r-q6j2rf {
  box-shadow: ${p.border} 0px -1px 0px !important;
}

/* === 4. Text & SVG foreground contrast (dark-mode & light-mode X accounts) === */
.r-1nao33i${NOT_IN_VIDEO},
.r-54znze${NOT_IN_VIDEO},
[style*="color: rgb(231, 233, 234)"]${NOT_IN_VIDEO},
[style*="color: rgb(239, 243, 244)"]${NOT_IN_VIDEO},
[style*="color: rgb(247, 249, 249)"]${NOT_IN_VIDEO},
article[data-testid="tweet"],
[data-testid="tweetText"],
[data-testid="tweetTextarea_0"],
[data-testid="tweetTextarea_0"] :is(div, span),
[data-testid="User-Name"],
[data-testid="User-Name"] span,
[data-testid="UserDescription"],
[data-testid="UserDescription"] span,
[data-testid="UserProfileHeader_Items"],
[data-testid="UserProfileHeader_Items"] span {
  color: ${p.text} !important;
}
/* Light-mode host text overrides (scoped with :where so CTA pills still outrank them) */
:where(html[style*="color-scheme: light"]) .r-18jsvk2,
:where(html[style*="color-scheme: light"]) [style*="color: rgb(15, 20, 25)"] {
  color: ${p.text} !important;
}
.r-1o2jch0 {
  fill: ${p.text} !important;
}
.r-1bwzh9t,
.r-14j79pv,
[style*="color: rgb(113, 118, 123)"],
[style*="color: rgb(83, 100, 113)"],
[data-testid="User-Name"] a[tabindex="-1"] span,
[data-testid="UserJoinDate"] {
  color: ${p.textMuted} !important;
}
.r-s7we3t {
  fill: ${p.textMuted} !important;
}
/* Manage timelines '+' button & close/back app-bar icons */
button[aria-label="Manage timelines"] svg,
[data-testid="app-bar-close"] svg,
[data-testid="app-bar-back"] svg {
  color: ${p.text} !important;
}

/* === 5. Timeline tabs, category strip, and ScrollSnap arrow buttons === */
[data-testid="primaryColumn"] [role="tab"][aria-selected="true"],
[data-testid="primaryColumn"] [role="tab"][aria-selected="true"] div,
[data-testid="primaryColumn"] [role="tab"][aria-selected="true"] span,
[data-testid="primaryColumn"] [role="tab"][aria-selected="true"] svg {
  color: ${p.text} !important;
}
[data-testid="primaryColumn"] [role="tab"][aria-selected="false"],
[data-testid="primaryColumn"] [role="tab"][aria-selected="false"] div,
[data-testid="primaryColumn"] [role="tab"][aria-selected="false"] span,
[data-testid="primaryColumn"] [role="tab"][aria-selected="false"] svg {
  color: ${p.textMuted} !important;
}
[data-testid="primaryColumn"] [role="tab"][aria-selected="true"] [style*="background-color: rgb(29, 155, 240)"] {
  background-color: ${p.accent} !important;
}
/* Category & toolbar scroll arrow buttons (For You / Following strip + composer toolbar) */
/* Use box-shadow instead of border to avoid changing button box dimensions. */
[data-testid="ScrollSnap-prevButtonWrapper"] button,
[data-testid="ScrollSnap-nextButtonWrapper"] button {
  background-color: ${floatingBg} !important;
  color: ${p.text} !important;
  box-shadow: inset 0 0 0 1px ${p.border}, ${popupShadow} !important;
}
[data-testid="ScrollSnap-prevButtonWrapper"] button div,
[data-testid="ScrollSnap-nextButtonWrapper"] button div,
[data-testid="ScrollSnap-prevButtonWrapper"] button svg,
[data-testid="ScrollSnap-nextButtonWrapper"] button svg {
  color: ${p.text} !important;
}

/* === 6. Right sidebar rail, search pill, and module cards === */
[data-testid="sidebarColumn"],
[data-testid="sidebarColumn"] > div > div > div > div,
[data-testid="sidebarColumn"] > div > div > div > div > div {
  background-color: ${p.background} !important;
  border-color: ${p.border} !important;
  color: ${p.text} !important;
}
/* Individual right-sidebar module cards (Today's News, Live on X, NFL/NBA/NHL, Trends, Who to follow) */
[data-testid="sidebarColumn"] section,
[data-testid="sidebarColumn"] aside[role="complementary"],
[data-testid="sidebarColumn"] [data-testid="news_sidebar"],
[data-testid="sidebarColumn"] .r-1867qdf.r-1kqtdi0,
[data-testid="sidebarColumn"] .r-1867qdf.r-1phboty {
  background-color: ${p.surface} !important;
  border-color: ${p.border} !important;
  color: ${p.text} !important;
}
[data-testid="sidebarColumn"] [data-testid="pill-contents-container"] > div {
  background-color: ${p.surfaceAlt} !important;
}
/* Search pill: keep full 9999px rounding by leaving the inner <input> transparent */
[data-testid="sidebarColumn"] form[role="search"] > div > div {
  background-color: ${p.surfaceAlt} !important;
  border-color: ${p.border} !important;
  border-radius: 9999px !important;
  overflow: hidden !important;
  color: ${p.text} !important;
}
[data-testid="SearchBox_Search_Input"] {
  background-color: transparent !important;
  color: ${p.text} !important;
}
[data-testid="SearchBox_Search_Input"]::placeholder,
[data-testid="sidebarColumn"] form[role="search"] svg {
  color: ${p.textMuted} !important;
}

/* === 7. Popovers, menus, dialogs, HoverCards, Emoji/GIF/Poll/Schedule/Location === */
[role="dialog"],
[data-testid="sheetDialog"],
[role="menu"],
[role="listbox"],
[data-testid="Dropdown"],
[data-testid="HoverCard"] {
  background-color: ${p.surface} !important;
  border-color: ${p.border} !important;
  color: ${p.text} !important;
}
[role="dialog"] [data-testid="toolBar"],
[role="dialog"] .r-kemksi${NOT_IN_VIDEO},
[data-testid="sheetDialog"] .r-kemksi,
[role="menu"] .r-kemksi,
[data-testid="Dropdown"] .r-kemksi,
[data-testid="HoverCard"] .r-kemksi {
  background-color: ${p.surface} !important;
}
[role="menu"] a,
[role="menu"] [role="menuitem"],
[role="menu"] span,
[role="menu"] svg,
[role="listbox"] [role="option"],
[role="listbox"] span,
[data-testid="Dropdown"] a,
[data-testid="Dropdown"] span,
[data-testid="Dropdown"] svg,
[data-testid="HoverCard"] a,
[data-testid="HoverCard"] [role="menuitem"],
[data-testid="HoverCard"] span,
[data-testid="HoverCard"] svg,
[data-testid="sheetDialog"] h2,
[data-testid="sheetDialog"] span,
[data-testid="sheetDialog"] svg {
  color: ${p.text} !important;
}
/* Search inputs, comboboxes, poll inputs, and schedule selects inside dialogs/popovers.
 * Never paint checkbox/radio/switch inputs (X overlays transparent <input type="checkbox">
 * controls on top of toggle switches, e.g. Snooze Topics). */
[role="dialog"] ${TEXT_INPUT_SELECTOR},
[role="dialog"] select,
[role="dialog"] textarea,
[data-testid="HoverCard"] ${TEXT_INPUT_SELECTOR},
[data-testid="HoverCard"] [role="combobox"] > div,
[role="dialog"] [role="combobox"] > div,
[data-testid="attachments"] > div {
  background-color: ${p.surfaceAlt} !important;
  border-color: ${p.border} !important;
  color: ${p.text} !important;
}
[role="dialog"] option {
  background-color: ${p.surface} !important;
  color: ${p.text} !important;
}
/* Floating Grok / Chat drawer launcher buttons in #layers */
[data-testid="GrokDrawerHeader"],
[data-testid="chat-drawer-main"] {
  background-color: ${floatingBg} !important;
  border-color: ${p.border} !important;
  color: ${p.text} !important;
  box-shadow: ${popupShadow} !important;
}
[data-testid="GrokDrawerHeader"] svg,
[data-testid="chat-drawer-main"] svg {
  color: ${p.text} !important;
}

/* === 8. High-contrast CTA pills, accent buttons, and brand links === */
:where(button, a)[style*="background-color: rgb(239, 243, 244)"],
:where(button, a)[style*="background-color: rgb(255, 255, 255)"] {
  background-color: ${p.text} !important;
  border-color: ${p.text} !important;
  color: ${p.background} !important;
}
:where(button, a)[style*="background-color: rgb(239, 243, 244)"] :is(div, span, svg),
:where(button, a)[style*="background-color: rgb(255, 255, 255)"] :is(div, span, svg) {
  color: ${p.background} !important;
}
:is(a, button)[data-testid="SideNav_NewTweet_Button"],
:is(a, button)[data-testid="tweetButtonInline"],
:is(a, button)[data-testid="tweetButton"],
[role="status"] button.r-l5o3uw {
  background-color: ${p.accent} !important;
  border-color: ${p.accent} !important;
  color: ${p.accentText} !important;
}
:is(a, button)[data-testid="SideNav_NewTweet_Button"] :is(div, span, svg),
:is(a, button)[data-testid="tweetButtonInline"] :is(div, span, svg),
:is(a, button)[data-testid="tweetButton"] :is(div, span, svg),
[role="status"] button.r-l5o3uw :is(div, span, svg) {
  color: ${p.accentText} !important;
}
a[href^="/hashtag/"],
a[role="link"][style*="rgb(29, 155, 240)"],
button[aria-label="Everyone can reply"],
button[aria-label="Everyone can reply"] :is(div, span, svg),
button[aria-label="Choose audience"] :is(div, span, svg),
.r-1cvl2hr {
  color: ${p.accent} !important;
}
/* Preserve verified checkmarks and engagement accents */
svg[data-testid="icon-verified"] {
  color: ${p.accent} !important;
}
::selection {
  background-color: ${hexWithAlpha(p.accent, 0.28)} !important;
}
`.trim();
  },
  shadowExtraCss: (p) =>
    `
:host {
  color: ${p.text};
  scrollbar-color: ${p.border} ${p.background};
}
:where(${TEXT_INPUT_SELECTOR}, textarea, select, [contenteditable="true"]) {
  background-color: ${p.surfaceAlt} !important;
  border-color: ${p.border} !important;
  color: ${p.text} !important;
}
:where([role="separator"], hr) {
  border-color: ${p.border} !important;
  background-color: ${p.border} !important;
}
::selection {
  background-color: ${hexWithAlpha(p.accent, 0.28)} !important;
}
`.trim(),
  surfaces: {
    transparentShell: [
      '#react-root',
      '#react-root > div:not(:where(#layers, [role="dialog"], [role="menu"], [role="listbox"], [data-testid="Dropdown"], [data-testid="HoverCard"], [data-testid="sheetDialog"]))',
      '#react-root > div:not(#layers) > div:not(:where(#layers, [role="dialog"], [role="menu"], [role="listbox"], [data-testid="Dropdown"], [data-testid="HoverCard"], [data-testid="sheetDialog"]))',
      '#react-root > div:not(#layers) > div:not(#layers) > div:not(:where(#layers, [role="dialog"], [role="menu"], [role="listbox"], [data-testid="Dropdown"], [data-testid="HoverCard"], [data-testid="sheetDialog"]))',
      'header[role="banner"]',
      'header[role="banner"] > div:not(:where([role="dialog"], [role="menu"], [role="listbox"], [data-testid="Dropdown"], [data-testid="HoverCard"]))',
      'header[role="banner"] > div > div:not(:where([role="dialog"], [role="menu"], [role="listbox"], [data-testid="Dropdown"], [data-testid="HoverCard"]))',
      'header[role="banner"] > div > div > div:not(:where([role="dialog"], [role="menu"], [role="listbox"], [data-testid="Dropdown"], [data-testid="HoverCard"]))',
      'main[role="main"]',
      'main[role="main"] > div:not(:where([role="dialog"], [role="menu"], [role="listbox"], [data-testid="Dropdown"], [data-testid="HoverCard"], [data-testid="sheetDialog"], [data-testid="primaryColumn"]))',
      'main[role="main"] > div > div:not(:where([role="dialog"], [role="menu"], [role="listbox"], [data-testid="Dropdown"], [data-testid="HoverCard"], [data-testid="sheetDialog"], [data-testid="primaryColumn"]))',
      'main[role="main"] > div > div > div:not(:where([role="dialog"], [role="menu"], [role="listbox"], [data-testid="Dropdown"], [data-testid="HoverCard"], [data-testid="sheetDialog"], [data-testid="primaryColumn"]))',
      '[data-testid="sidebarColumn"]',
      '[data-testid="sidebarColumn"] > div > div > div > div:not(:where([role="dialog"], [role="menu"], [role="listbox"], [id^="typeaheadDropdown"], [data-testid="typeaheadDropdown"], [data-testid="Dropdown"], [data-testid="HoverCard"], [data-testid="news_sidebar"], .r-1867qdf))',
      '[data-testid="sidebarColumn"] > div > div > div > div > div:not(:where([role="dialog"], [role="menu"], [role="listbox"], [id^="typeaheadDropdown"], [data-testid="typeaheadDropdown"], [data-testid="Dropdown"], [data-testid="HoverCard"], [data-testid="news_sidebar"], .r-1867qdf))',
    ],
    columns: [
      '[data-testid="primaryColumn"]',
      '[data-testid="primaryColumn"] [data-testid="toolBar"]',
    ],
    leafCards: [
      '[data-testid="sidebarColumn"] section',
      '[data-testid="sidebarColumn"] aside[role="complementary"]',
      '[data-testid="sidebarColumn"] [data-testid="news_sidebar"]',
      '[data-testid="sidebarColumn"] .r-1867qdf.r-1kqtdi0',
      '[data-testid="sidebarColumn"] .r-1867qdf.r-1phboty',
    ],
    popups: [
      '[role="dialog"]',
      '[data-testid="sheetDialog"]',
      '[role="menu"]',
      '[role="listbox"]',
      '[id^="typeaheadDropdown"]',
      '[data-testid="typeaheadDropdown"]',
      'form[role="search"] :is([role="listbox"], [id^="typeaheadDropdown"], [data-testid="typeaheadDropdown"])',
      'form[role="search"] :has(> [role="listbox"], > [id^="typeaheadDropdown"], > [data-testid="typeaheadDropdown"])',
      '#layers :is([role="dialog"], [role="menu"], [role="listbox"], [data-testid="Dropdown"], [data-testid="HoverCard"], [data-testid="sheetDialog"])',
      '[data-testid="Dropdown"]',
      '[data-testid="HoverCard"]',
    ],
    primaryCtas: [
      '[data-testid="SideNav_NewTweet_Button"]',
      '[data-testid="tweetButtonInline"]',
      '[data-testid="tweetButton"]',
    ],
    feedCards: ['article[data-testid="tweet"]'],
    searchContainers: ['[data-testid="sidebarColumn"] form[role="search"] > div > div'],
    extraRevealCss: (p, { popupAlpha }) => {
      const hoverTint = hexWithAlpha(p?.text ?? '#ffffff', 0.06);
      const popBg = hexWithAlpha(p?.surface ?? '#111622', popupAlpha);
      return `
#layers,
form[role="search"] {
  --fs-reveal-canvas: ${popBg};
}
${RNW_CANVAS_SELECTORS.join(',\n')} {
  background-color: var(--fs-reveal-canvas, transparent) !important;
}
[data-testid="sidebarColumn"] section [data-testid="trend"],
[data-testid="sidebarColumn"] section [data-testid="cellInnerDiv"],
[data-testid="sidebarColumn"] section [data-testid="cellInnerDiv"] > div {
  background-color: transparent !important;
}
[data-testid="sidebarColumn"] section [data-testid="trend"]:hover {
  background-color: ${hoverTint} !important;
}`.trim();
    },
  },
};
