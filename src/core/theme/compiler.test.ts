import { afterEach, describe, expect, it } from 'vitest';
import { findThemePreset } from '../theming';
import { compileAdaptiveRootCss, splitSelectorList } from './compiler';

const warmPaper = findThemePreset('warm-paper')!.palette;

describe('core/theme/compiler', () => {
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

    // Strictly paint-only: zero layout properties, zero transparent-to-opaque rules, zero error/video overrides.
    expect(compiled).not.toContain('padding');
    expect(compiled).not.toContain('height');
    expect(compiled).not.toContain('position');
    expect(compiled).not.toContain('.r-transparent-wrapper');
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
    // Functional pseudo-class `:is(.alpha, .beta)` stayed intact (not split on inner comma).
    expect(compiled).toContain(':where(:is(.alpha, .beta))');
    // Translucent brand wash preserved alpha (`12%`).
    expect(compiled).toContain('rgb(180 83 9 / 12%) !important;');
    // Vendor pseudo-element stayed isolated in its own rule line (not merged with other selectors).
    const mozLine = compiled.split('\n').find((line) => line.includes('::-moz-placeholder'));
    expect(mozLine?.startsWith('input::-moz-placeholder {')).toBe(true);
  });
});
