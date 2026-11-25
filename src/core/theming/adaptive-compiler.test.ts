import { afterEach, describe, expect, it } from 'vitest';
import type { RootCssomSnapshot } from './adaptive-compiler';
import {
  captureCssomSnapshot,
  compileAdaptiveRootCss,
  sameCssomSnapshot,
  splitSelectorList,
} from './adaptive-compiler';
import { findThemePreset } from './presets';

const warmPaper = findThemePreset('warm-paper')!.palette;

describe('core/theming/adaptive-compiler', () => {
  afterEach(() => {
    document.head.replaceChildren();
    document.body.replaceChildren();
  });

  it('auto-discovers unknown CSS custom properties and atomic paint rules while preserving layout, media, and transparent wrappers', () => {
    const style = document.createElement('style');
    style.textContent = `
      :root {
        --brand-new-card-bg: #202327;
        --brand-new-text-fg: #e7e9ea;
        --brand-new-divider-border: #2f3336;
        --brand-new-error-red: #f4212e;
      }
      .r-unknown-card {
        background-color: rgb(32, 35, 39);
        padding: 16px;
        height: 53px;
        position: sticky;
      }
      .r-transparent-wrapper {
        background-color: rgba(0, 0, 0, 0);
      }
      .r-rnw-zero-border-reset {
        border: 0px solid rgb(0, 0, 0);
      }
      .r-none-border-reset {
        border-style: none;
        border-color: rgb(47, 51, 54);
      }
      .r-real-divider {
        border-bottom-width: 1px;
        border-bottom-style: solid;
        border-bottom-color: rgb(47, 51, 54);
      }
      .r-unknown-text {
        color: rgb(231, 233, 234);
      }
      .r-brand-link {
        color: rgb(29, 155, 240);
      }
      .r-error-badge {
        color: rgb(244, 33, 46);
      }
      video.player {
        background-color: rgb(0, 0, 0);
      }
    `;
    document.head.append(style);

    const compiled = compileAdaptiveRootCss(document, warmPaper, {
      hostScheme: 'dark',
      brandColors: ['#1d9bf0'],
      mediaPreserveSelectors: ['[data-testid="videoPlayer"] *'],
    });

    // Discovered unknown custom properties remapped cleanly, leaving semantic error red untouched.
    expect(compiled).toContain(`--brand-new-card-bg: ${warmPaper.surface} !important;`);
    expect(compiled).toContain(`--brand-new-text-fg: ${warmPaper.text} !important;`);
    expect(compiled).toContain(`--brand-new-divider-border: ${warmPaper.border} !important;`);
    expect(compiled).not.toContain('--brand-new-error-red');

    // Discovered unknown atomic paint rules remapped with media guards.
    expect(compiled).toContain('.r-unknown-card');
    expect(compiled).toContain(`background-color: ${warmPaper.surface} !important;`);
    expect(compiled).toContain('.r-unknown-text');
    expect(compiled).toContain(`color: ${warmPaper.text} !important;`);
    expect(compiled).toContain('.r-brand-link');
    expect(compiled).toContain(`color: ${warmPaper.accent} !important;`);

    // Strictly paint-only: zero layout properties, zero transparent-to-opaque rules, zero-width border resets, zero error/video overrides.
    expect(compiled).not.toContain('padding');
    expect(compiled).not.toContain('height');
    expect(compiled).not.toContain('position');
    expect(compiled).not.toContain('.r-transparent-wrapper');
    expect(compiled).not.toContain('.r-rnw-zero-border-reset');
    expect(compiled).not.toContain('.r-none-border-reset');
    expect(compiled).toContain('.r-real-divider');
    expect(compiled).toContain(`border-bottom-color: ${warmPaper.border} !important;`);
    expect(compiled).not.toContain('.r-error-badge');
    expect(compiled).not.toContain('video.player');
  });

  it('compiles ShadowRoot stylesheets targeting :host', () => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host { --chat-canvas: #000000; --chat-bg: #16181c; }
      .bubble { background-color: rgb(32, 35, 39); color: rgb(231, 233, 234); }
    `;
    shadow.append(style);
    document.body.append(host);

    const compiled = compileAdaptiveRootCss(shadow, warmPaper, { hostScheme: 'dark' });
    expect(compiled).toContain(':host {');
    expect(compiled).toContain(`--chat-canvas: ${warmPaper.background} !important;`);
    expect(compiled).toContain(`--chat-bg: ${warmPaper.surface} !important;`);
    expect(compiled).toContain('.bubble');
    expect(compiled).toContain(`color: ${warmPaper.text} !important;`);
  });

  it('preserves functional selectors, isolates pseudo-elements, preserves brand alpha, compiles root-scoped descendants, blocks CSS injection, and skips own cross-realm sheets', () => {
    expect(splitSelectorList(':is(.a, .b), [data-x="1,2"]')).toEqual([
      ':is(.a, .b)',
      '[data-x="1,2"]',
    ]);
    expect(splitSelectorList('[data-a="video, ) } body { display: none; } /*"]')).toEqual([
      '[data-a="video, ) } body { display: none; } /*"]',
    ]);
    expect(splitSelectorList('.a } body { display: none }')).toEqual([]);

    const doc = document.implementation.createHTMLDocument('iframe-realm');
    const ownSheet = doc.createElement('style');
    ownSheet.id = 'feed_sanity_user_theme';
    ownSheet.textContent = '.own-rule { background-color: rgb(20, 20, 20); }';

    const hostSheet = doc.createElement('style');
    hostSheet.textContent = `
      html.theme-dark .scoped-card { background-color: rgb(32, 35, 39); }
      :is(.alpha, .beta) { color: rgb(231, 233, 234); }
      .brand-wash { background-color: rgba(29, 155, 240, 0.12); }
      input::-moz-placeholder { color: rgb(113, 118, 123); }
    `;
    doc.head.append(ownSheet, hostSheet);

    const compiled = compileAdaptiveRootCss(doc, warmPaper, {
      hostScheme: 'dark',
      brandColors: ['#1d9bf0'],
    });

    // Own cross-realm sheet skipped cleanly.
    expect(compiled).not.toContain('.own-rule');
    // Root-prefixed descendant rule compiled.
    expect(compiled).toContain('html.theme-dark .scoped-card');
    // Functional pseudo-class `:is(.alpha, .beta)` stayed intact inside `@layer fs-adaptive`
    // without `:where(...)` wrapping so browsers can hash-bucket selectors in O(1).
    expect(compiled).toContain('@layer fs-adaptive');
    expect(compiled).toContain(':is(.alpha, .beta)');
    expect(compiled).not.toContain(':where(:is(.alpha, .beta))');
    // Translucent brand wash preserved alpha (`12%`).
    expect(compiled).toContain('rgb(180 83 9 / 12%) !important;');
    // Vendor pseudo-element stayed isolated in its own rule line (not merged with other selectors).
    const mozLine = compiled.split('\n').find((line) => line.includes('::-moz-placeholder'));
    expect(mozLine?.startsWith('input::-moz-placeholder {')).toBe(true);
  });

  it('discovers non-:root theme tokens, honors foreground/background precedence over ring, binds backdrop canvas vars, and compiles targeted host fonts', () => {
    const style = document.createElement('style');
    style.textContent = `
      .__fb-dark-mode {
        --progress-ring-neutral-foreground: #e7e9ea;
        --progress-ring-neutral-background: #202327;
        --focus-ring-color: #2f3336;
      }
      .canvas-shell {
        background-color: rgb(0, 0, 0);
      }
      .tweet-copy {
        font-family: "TwitterChirp", -apple-system, sans-serif;
      }
      .icon-glyph {
        font-family: "Material Symbols Outlined", sans-serif;
      }
      .code-block {
        font-family: ui-monospace, SFMono-Regular, monospace;
      }
    `;
    document.head.append(style);

    const compiled = compileAdaptiveRootCss(document, warmPaper, {
      hostScheme: 'dark',
      rootSelectors: [':root', '.__fb-dark-mode'],
      backdropActive: true,
      fontFamily: 'Georgia, serif',
    });

    // Non-:root theme root (.__fb-dark-mode) tokens discovered and accurately classified.
    expect(compiled).toContain(`--progress-ring-neutral-foreground: ${warmPaper.text} !important;`);
    expect(compiled).toContain(
      `--progress-ring-neutral-background: ${warmPaper.surface} !important;`,
    );
    expect(compiled).toContain(`--focus-ring-color: ${warmPaper.border} !important;`);

    // Opaque canvas-tier backgrounds bind through `--fs-reveal-canvas` when a backdrop is active.
    expect(compiled).toContain(
      `background-color: var(--fs-reveal-canvas, ${warmPaper.background}) !important;`,
    );

    // Targeted host font overrides remap body/UI copy while preserving icon and monospace fonts.
    expect(compiled).toContain('.tweet-copy');
    expect(compiled).toContain('font-family: Georgia, serif !important;');
    expect(compiled).not.toContain('.icon-glyph');
    expect(compiled).not.toContain('.code-block');

    // Font-only compile (palette === null) still emits targeted host font overrides cleanly.
    const fontOnly = compileAdaptiveRootCss(document, null, {
      hostScheme: 'dark',
      fontFamily: 'Georgia, serif',
    });
    expect(fontOnly).toContain('.tweet-copy');
    expect(fontOnly).toContain('font-family: Georgia, serif !important;');
    expect(fontOnly).not.toContain('.canvas-shell');
  });

  it('filters inactive polarity & descendant vars and invalidates sheetCache on rootSelectors, media, and rule mutations', () => {
    const style = document.createElement('style');
    style.textContent = `
      .__fb-light-mode { --mode-surface: #ffffff; }
      .__fb-dark-mode { --mode-surface: #18191a; --dark-only-bg: #242526; }
      .__fb-dark-mode .story-overlay { --scoped-overlay-bg: #111111; }
      @media (min-width: 900px) { .wide-panel { background-color: rgb(32, 35, 39); } }
    `;
    document.head.append(style);

    let wideMatches = false;
    const origMatchMedia = globalThis.matchMedia;
    globalThis.matchMedia = ((query: string) => ({
      matches: query.includes('900px') ? wideMatches : false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof globalThis.matchMedia;

    try {
      // 1. In light hostScheme, opposite-polarity dark vars & descendant component vars are skipped.
      const lightOut = compileAdaptiveRootCss(document, warmPaper, {
        hostScheme: 'light',
        rootSelectors: [':root', '.__fb-light-mode', '.__fb-dark-mode'],
      });
      expect(lightOut).toContain(`--mode-surface: ${warmPaper.background} !important;`);
      expect(lightOut).not.toContain('--dark-only-bg');
      expect(lightOut).not.toContain('--scoped-overlay-bg');
      expect(lightOut).not.toContain('.wide-panel');

      // 2. Flipping @media match invalidates sheetCache and emits `.wide-panel`.
      wideMatches = true;
      const wideOut = compileAdaptiveRootCss(document, warmPaper, {
        hostScheme: 'dark',
        rootSelectors: [':root', '.__fb-dark-mode'],
      });
      expect(wideOut).toContain('--dark-only-bg:');
      expect(wideOut).toContain('.wide-panel');

      // 3. Adding a custom root selector invalidates sheetCache on rootSelectorsKey change.
      const customStyle = document.createElement('style');
      customStyle.textContent = '.custom-theme-root { --custom-root-bg: #1a1a1a; }';
      document.head.append(customStyle);
      expect(
        compileAdaptiveRootCss(document, warmPaper, {
          hostScheme: 'dark',
          rootSelectors: [':root'],
        }),
      ).not.toContain('--custom-root-bg');
      expect(
        compileAdaptiveRootCss(document, warmPaper, {
          hostScheme: 'dark',
          rootSelectors: [':root', '.custom-theme-root'],
        }),
      ).toContain('--custom-root-bg:');

      // 4. Mutating rules via CSSOM insertRule invalidates sheetCache.
      customStyle.sheet?.insertRule('.late-inserted { color: rgb(231, 233, 234); }', 1);
      expect(
        compileAdaptiveRootCss(document, warmPaper, {
          hostScheme: 'dark',
          rootSelectors: [':root', '.custom-theme-root'],
        }),
      ).toContain('.late-inserted');
    } finally {
      globalThis.matchMedia = origMatchMedia;
    }
  });

  it('captures weak-ID CSSOM snapshots that match compileAdaptiveRootCss, skip own sheets, and detect insertRule, replaceSync, and adoptedStyleSheets swaps', () => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const hostStyle = document.createElement('style');
    hostStyle.textContent = '.card { background-color: rgb(24, 24, 24); }';
    const adoptedA = new CSSStyleSheet();
    adoptedA.replaceSync('.pill-a { background-color: rgb(32, 32, 32); }');
    shadow.append(hostStyle);
    shadow.adoptedStyleSheets = [adoptedA];
    document.body.append(host);

    let fromCompile: RootCssomSnapshot | undefined;
    compileAdaptiveRootCss(shadow, warmPaper, {
      hostScheme: 'dark',
      onCssomSnapshot: (snap) => {
        fromCompile = snap;
      },
    });
    expect(fromCompile).toBeDefined();
    expect(sameCssomSnapshot(fromCompile!, captureCssomSnapshot(shadow))).toBe(true);

    // Injecting our own `feed_sanity_*` stylesheet must NOT invalidate the host snapshot.
    const ownStyle = document.createElement('style');
    ownStyle.id = 'feed_sanity_adaptive_theme';
    ownStyle.textContent = '.ignored { color: red; }';
    shadow.append(ownStyle);
    expect(sameCssomSnapshot(fromCompile!, captureCssomSnapshot(shadow))).toBe(true);

    // `insertRule()` invalidates snapshot.
    hostStyle.sheet?.insertRule('.card-2 { color: rgb(231, 233, 234); }', 1);
    const afterInsert = captureCssomSnapshot(shadow);
    expect(sameCssomSnapshot(fromCompile!, afterInsert)).toBe(false);

    // Same-rule-count `replaceSync()` invalidates snapshot.
    adoptedA.replaceSync('.pill-b { background-color: rgb(36, 36, 36); }');
    const afterReplace = captureCssomSnapshot(shadow);
    expect(sameCssomSnapshot(afterInsert, afterReplace)).toBe(false);

    // Swapping `adoptedStyleSheets` to a different sheet with identical rule count invalidates snapshot.
    const adoptedB = new CSSStyleSheet();
    adoptedB.replaceSync('.pill-b { background-color: rgb(36, 36, 36); }');
    shadow.adoptedStyleSheets = [adoptedB];
    const afterSwap = captureCssomSnapshot(shadow);
    expect(sameCssomSnapshot(afterReplace, afterSwap)).toBe(false);
  });
});
