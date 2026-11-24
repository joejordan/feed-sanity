import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { facebookThemeMapping } from '../sites/facebook/theme-mapping';
import { instagramThemeMapping } from '../sites/instagram/theme-mapping';
import { xThemeMapping } from '../sites/x/theme-mapping';
import { HOST_TAG, renderInShadow, setUserThemeCss } from '../ui/mount';
import { createDomEnvironment } from './dom-env';
import {
  applyEarlyThemeCss,
  BUILTIN_THEMES,
  clearEarlyThemeStyle,
  compileHostThemeCss,
  compileShadowThemeCss,
  compileUiThemeCss,
  contrastingText,
  contrastRatio,
  createThemeController,
  DEFAULT_THEME_CONFIG,
  hexToHslTriplet,
  hexToRgbTriplet,
  hexWithAlpha,
  mixHex,
  normalizeHex,
  readEarlyThemeCss,
  resolveTheme,
  THEME_FONT_STACKS,
  writeEarlyThemeCss,
} from './theming';

describe('first-class multi-site theming engine', () => {
  const cleanups: Array<() => void> = [];

  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    setUserThemeCss('');
  });

  afterEach(() => {
    for (const stop of cleanups.splice(0).reverse()) {
      stop();
    }
    setUserThemeCss('');
  });

  it('normalizes hex colors, converts RGB triplets / alpha, and computes contrasting text', () => {
    expect(normalizeHex('#AbC')).toBe('#aabbcc');
    expect(normalizeHex('  #1E1E2E  ')).toBe('#1e1e2e');
    expect(normalizeHex('rgb(1,2,3)')).toBeNull();
    expect(normalizeHex('#12345')).toBeNull();

    expect(hexToRgbTriplet('#1e1e2e')).toBe('30, 30, 46');
    expect(hexToHslTriplet('#1e1e2e')).toBe('240 21% 15%');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#1e1e2e', '#cdd6f4')).toBeGreaterThan(10);
    expect(hexWithAlpha('#3b82f6', 0.16)).toBe('rgb(59 130 246 / 16%)');
    expect(contrastingText('#0b0f17')).toBe('#ffffff');
    expect(contrastingText('#f4efe6')).toBe('#111111');
  });

  it('compiles shadowExtraCss and manages the synchronous zero-FOUC early theme cache', () => {
    const resolved = resolveTheme({ ...DEFAULT_THEME_CONFIG, preset: 'midnight' })!;
    const shadowCss = compileShadowThemeCss(resolved, {
      rootSelectors: [':root'],
      shadowExtraCss: (p) => `.card { background: ${p.surface}; }`,
    });
    expect(shadowCss).toContain('.card { background: #131926; }');

    writeEarlyThemeCss('test-site', 'body { background: #0b0f17; }');
    expect(readEarlyThemeCss('test-site')).toBe('body { background: #0b0f17; }');
    const style = applyEarlyThemeCss('test-site', document);
    expect(style?.id).toBe('feed_sanity_user_theme');
    expect(document.querySelector('#feed_sanity_user_theme')?.textContent).toBe(
      'body { background: #0b0f17; }',
    );

    writeEarlyThemeCss('test-site', '');
    expect(readEarlyThemeCss('test-site')).toBe('');
    clearEarlyThemeStyle(document);
    expect(document.querySelector('#feed_sanity_user_theme')).toBeNull();
  });

  it('resolves presets, keeps font/customCss orthogonal from Site Default colors, and blocks prototype keys', () => {
    expect(resolveTheme(DEFAULT_THEME_CONFIG)).toBeNull();

    const catppuccin = resolveTheme({ ...DEFAULT_THEME_CONFIG, preset: 'catppuccin-mocha' });
    expect(catppuccin?.palette?.background).toBe('#1e1e2e');
    expect(catppuccin?.palette?.colorScheme).toBe('dark');

    // Font or custom CSS alone on Site Default must NOT force Midnight Slate colors!
    const fontOnly = resolveTheme({
      ...DEFAULT_THEME_CONFIG,
      font: 'serif',
      customCss: 'article { border-radius: 12px; }',
    });
    expect(fontOnly?.palette).toBeNull();
    expect(fontOnly?.fontFamily).toBe(THEME_FONT_STACKS.serif);
    expect(fontOnly?.customCss).toBe('article { border-radius: 12px; }');
    const fontOnlyCss = compileHostThemeCss(fontOnly!, facebookThemeMapping);
    expect(fontOnlyCss).toContain('font-family: Georgia');
    expect(fontOnlyCss).toContain('article { border-radius: 12px; }');
    expect(fontOnlyCss).not.toContain('--web-wash');
    expect(fontOnlyCss).not.toContain('color-scheme');
    expect(compileUiThemeCss(fontOnly!)).toBe(
      `:host {\n  --fs-font: ${THEME_FONT_STACKS.serif};\n}`,
    );

    // Prototype-chain keys like `toString` or `constructor` must be ignored cleanly.
    expect(resolveTheme({ ...DEFAULT_THEME_CONFIG, font: 'toString' })).toBeNull();
    expect(resolveTheme({ ...DEFAULT_THEME_CONFIG, font: 'constructor' })).toBeNull();

    // Custom light canvas on top of 'default' infers light colorScheme and contrasting accentText.
    const customLight = resolveTheme({
      ...DEFAULT_THEME_CONFIG,
      background: '#faf6ef',
      accent: '#fde047',
      font: 'serif',
    });
    expect(customLight?.palette?.colorScheme).toBe('light');
    expect(customLight?.palette?.background).toBe('#faf6ef');
    expect(customLight?.palette?.accentText).toBe('#111111');

    // Invalid hex values are ignored cleanly without producing broken CSS.
    expect(resolveTheme({ ...DEFAULT_THEME_CONFIG, accent: 'not-a-color' })).toBeNull();
  });

  it('compiles host, shadow (:host), and Feed Sanity UI CSS accurately across Facebook, Instagram, and X', () => {
    const resolved = resolveTheme({
      ...DEFAULT_THEME_CONFIG,
      preset: 'catppuccin-mocha',
      font: 'mono',
    })!;

    const fbCss = compileHostThemeCss(resolved, facebookThemeMapping);
    expect(fbCss).toContain(':root, .__fb-dark-mode, .__fb-light-mode');
    expect(fbCss).toContain('color-scheme: dark !important;');
    expect(fbCss).toContain('--web-wash: #1e1e2e !important;');
    expect(fbCss).toContain('--accent: #cba6f7 !important;');

    const igCss = compileHostThemeCss(resolved, instagramThemeMapping);
    expect(igCss).toContain(':root, .__fb-dark-mode, .__fb-light-mode');
    expect(igCss).toContain('--ig-primary-background: 30, 30, 46 !important;');
    expect(igCss).toContain('--ig-primary-button: 203, 166, 247 !important;');

    const xCss = compileHostThemeCss(resolved, xThemeMapping);
    expect(xCss).toContain('[data-testid="primaryColumn"]');
    expect(xCss).toContain('background-color: #1e1e2e !important;');
    expect(xCss).toContain('--x-bg-primary: #1e1e2e !important;');
    expect(xCss).toContain('--x-fg-primary: #cdd6f4 !important;');
    expect(xCss).toContain('[data-testid="SearchBox_Search_Input"]');
    expect(xCss).toContain('background-color: transparent !important;');
    expect(xCss).toContain('[data-testid="sheetDialog"]');
    expect(xCss).toContain('[data-testid="UserDescription"]');
    expect(xCss).toContain('[data-testid="ScrollSnap-prevButtonWrapper"] button');

    const xShadowCss = compileShadowThemeCss(resolved, xThemeMapping);
    expect(xShadowCss).toContain(
      ':host, [data-theme="dark"], [data-theme="light"], [data-theme="dim"]',
    );
    expect(xShadowCss).toContain('--x-bg-primary: #1e1e2e !important;');
    expect(xShadowCss).toContain('--x-fg-primary: #cdd6f4 !important;');
    expect(xShadowCss).toContain('--x-fg-alpha-10: rgb(205 214 244 / 10%) !important;');
    expect(xShadowCss).toContain('--x-neutral-1000: #29293a !important;');
    expect(xShadowCss).toContain('--x-btn-secondary-hover: #3d3f52 !important;');
    expect(xShadowCss).toContain('--color-background: 240 21% 15% !important;');
    expect(xShadowCss).not.toContain(':root');

    const warmPaperResolved = resolveTheme({ ...DEFAULT_THEME_CONFIG, preset: 'warm-paper' })!;
    const xLightCss = compileHostThemeCss(warmPaperResolved, xThemeMapping);
    expect(xLightCss).toContain('color-scheme: light !important;');
    expect(xLightCss).toContain('--x-bg-primary: #f4efe6 !important;');
    expect(xLightCss).toContain('--x-fg-primary: #2b241c !important;');
    expect(xLightCss).toContain('0 4px 18px rgb(0 0 0 / 14%), 0 0 1px rgb(0 0 0 / 12%)');

    const shadowCss = compileShadowThemeCss(resolved, facebookThemeMapping);
    expect(shadowCss).toContain(':host, .__fb-dark-mode, .__fb-light-mode');
    expect(shadowCss).toContain(':host {\n  font-family:');
    expect(shadowCss).not.toContain(':root');

    const uiCss = compileUiThemeCss(resolved);
    expect(uiCss).toContain(':host {');
    expect(uiCss).toContain('--fs-accent: #cba6f7;');
    expect(uiCss).toContain('--fs-surface: #1e1e2e;');
    expect(uiCss).toContain(`--fs-font: ${THEME_FONT_STACKS.mono};`);
  });

  it('propagates live themes into light DOM, host Shadow DOM (:host), same-origin iframes, and Feed Sanity UI while skipping own shadow roots', async () => {
    const env = createDomEnvironment({ pierceShadow: true, includeIframes: true });
    cleanups.push(() => env.dispose());

    // Mount a Feed Sanity `<feed-sanity-ui>` shadow widget before applying theme to verify reactive UI updates
    // AND verify host CSS is NOT injected into Feed Sanity's own shadow root.
    const uiHost = document.createElement(HOST_TAG);
    document.body.append(uiHost);
    const unmountUi = renderInShadow(uiHost, 'Themed UI');
    cleanups.push(unmountUi);

    const controller = createThemeController(env, facebookThemeMapping, setUserThemeCss);
    cleanups.push(() => controller.dispose());

    const midnight = { palette: BUILTIN_THEMES[0]!.palette };
    const warmPaper = { palette: BUILTIN_THEMES.find((t) => t.id === 'warm-paper')!.palette };

    controller.apply(midnight);
    expect(document.querySelector('#feed_sanity_user_theme')?.textContent).toContain('#0b0f17');

    // Feed Sanity's own shadow root gets `--fs-*` UI tokens via `setUserThemeCss`, NOT `#feed_sanity_user_theme`.
    expect(uiHost.shadowRoot?.querySelector('#feed_sanity_user_theme')).toBeNull();
    const readUiStyles = (): string =>
      [...(uiHost.shadowRoot?.querySelectorAll('style') ?? [])]
        .map((s) => s.textContent ?? '')
        .join('\n');
    expect(readUiStyles()).toContain('--fs-accent: #3b82f6;');

    // Dynamically added host ShadowRoot gets `:host` themed automatically.
    const hostShadowEl = document.createElement('div');
    const hostShadow = hostShadowEl.attachShadow({ mode: 'open' });
    document.body.append(hostShadowEl);
    await vi.waitFor(() =>
      expect(hostShadow.querySelector('#feed_sanity_user_theme')?.textContent).toContain(':host'),
    );
    expect(hostShadow.querySelector('#feed_sanity_user_theme')?.textContent).toContain('#0b0f17');

    // Dynamically added same-origin iframe gets themed across apply/preview/clearPreview/dispose.
    const iframe = document.createElement('iframe');
    const childDoc = document.implementation.createHTMLDocument('child');
    Object.defineProperty(iframe, 'contentDocument', { value: childDoc, configurable: true });
    document.body.append(iframe);
    await vi.waitFor(() =>
      expect(childDoc.querySelector('#feed_sanity_user_theme')?.textContent).toContain('#0b0f17'),
    );

    // Previewing a different preset (and previewing Site Default `null`) overrides saved theme live,
    // and `clearPreview()` restores the saved theme across document, shadow root, and iframe.
    controller.preview(warmPaper);
    expect(controller.current()).toBe(warmPaper);
    expect(document.querySelector('#feed_sanity_user_theme')?.textContent).toContain('#f4efe6');
    expect(hostShadow.querySelector('#feed_sanity_user_theme')?.textContent).toContain('#f4efe6');
    expect(childDoc.querySelector('#feed_sanity_user_theme')?.textContent).toContain('#f4efe6');

    controller.preview(null);
    expect(controller.current()).toBeNull();
    expect(document.querySelector('#feed_sanity_user_theme')).toBeNull();
    expect(hostShadow.querySelector('#feed_sanity_user_theme')).toBeNull();
    expect(childDoc.querySelector('#feed_sanity_user_theme')).toBeNull();

    controller.clearPreview();
    expect(controller.current()).toBe(midnight);
    expect(document.querySelector('#feed_sanity_user_theme')?.textContent).toContain('#0b0f17');
    expect(hostShadow.querySelector('#feed_sanity_user_theme')?.textContent).toContain('#0b0f17');
    expect(childDoc.querySelector('#feed_sanity_user_theme')?.textContent).toContain('#0b0f17');

    // Removing the iframe cleans up its injected style; disposing cleans up everything including UI theme CSS.
    iframe.remove();
    await vi.waitFor(() => expect(childDoc.querySelector('#feed_sanity_user_theme')).toBeNull());

    controller.dispose();
    expect(document.querySelector('#feed_sanity_user_theme')).toBeNull();
    expect(hostShadow.querySelector('#feed_sanity_user_theme')).toBeNull();
    expect(readUiStyles()).not.toContain('--fs-accent: #3b82f6;');
  });

  it('attaches theme into <head> when apply() runs at document_start before <html>/<head> exist', async () => {
    const emptyDoc = document.implementation.createHTMLDocument('empty');
    emptyDoc.documentElement.remove();
    const env = createDomEnvironment({ doc: emptyDoc });
    cleanups.push(() => env.dispose());

    const controller = createThemeController(env, instagramThemeMapping, setUserThemeCss);
    cleanups.push(() => controller.dispose());

    // Apply while documentElement and head are both null.
    const mocha = BUILTIN_THEMES.find((t) => t.id === 'catppuccin-mocha')!.palette;
    controller.apply({ palette: mocha });
    expect(emptyDoc.querySelector('#feed_sanity_user_theme')).toBeNull();

    // Once parser creates <html><head>, theme attaches automatically into <head>.
    const html = emptyDoc.createElement('html');
    const head = emptyDoc.createElement('head');
    html.append(head);
    emptyDoc.append(html);
    await vi.waitFor(() =>
      expect(head.querySelector('#feed_sanity_user_theme')?.textContent).toContain(
        '--ig-primary-background: 30, 30, 46 !important;',
      ),
    );
  });

  it('orders adaptive CSS before curated CSS, recompiles lazy styles in light & Shadow DOM, and supports audit()/healNow()/dispose()', async () => {
    const env = createDomEnvironment({ pierceShadow: true });
    cleanups.push(() => env.dispose());

    const initialStyle = document.createElement('style');
    initialStyle.textContent = '.initial-card { background-color: #ffffff; color: #111111; }';
    document.head.append(initialStyle);

    const controller = createThemeController(
      env,
      {
        rootSelectors: [':root'],
        colorVars: { '--curated-bg': (p) => p.background },
        adaptive: { enabled: true },
      },
      setUserThemeCss,
    );
    cleanups.push(() => controller.dispose());

    const midnight = { palette: BUILTIN_THEMES[0]!.palette };
    controller.apply(midnight);

    const adaptiveStyle = document.querySelector('#feed_sanity_adaptive_theme');
    const userStyle = document.querySelector('#feed_sanity_user_theme');
    expect(adaptiveStyle?.textContent).toContain('.initial-card');
    expect(userStyle?.textContent).toContain('--curated-bg');
    // Layer 1 adaptive stylesheet must precede curated user stylesheet in DOM cascade order.
    expect(
      Boolean(
        adaptiveStyle &&
          userStyle &&
          adaptiveStyle.compareDocumentPosition(userStyle) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);

    // Lazy-loaded light-DOM <style> triggers debounced Layer 1 recompile automatically.
    const lazyStyle = document.createElement('style');
    lazyStyle.textContent = '.lazy-banner { background-color: #f8f9fa; color: #050505; }';
    document.head.append(lazyStyle);
    await vi.waitFor(() =>
      expect(document.querySelector('#feed_sanity_adaptive_theme')?.textContent).toContain(
        '.lazy-banner',
      ),
    );

    // Lazy-loaded Shadow DOM <style> also triggers Layer 1 recompile for that ShadowRoot.
    const shadowHost = document.createElement('div');
    const shadow = shadowHost.attachShadow({ mode: 'open' });
    document.body.append(shadowHost);
    await vi.waitFor(() => expect(shadow.querySelector('#feed_sanity_user_theme')).not.toBeNull());
    const lazyShadowStyle = document.createElement('style');
    lazyShadowStyle.textContent = '.shadow-card { background-color: #ffffff; color: #101010; }';
    shadow.append(lazyShadowStyle);
    await vi.waitFor(() =>
      expect(shadow.querySelector('#feed_sanity_adaptive_theme')?.textContent).toContain(
        '.shadow-card',
      ),
    );

    // `audit()` runs synchronously without leaving theme stylesheets disabled.
    const report = controller.audit?.();
    expect(report).toBeDefined();
    expect(report?.score).toBeGreaterThanOrEqual(0);
    expect((userStyle as HTMLStyleElement).sheet?.disabled ?? false).toBe(false);
    expect((adaptiveStyle as HTMLStyleElement).sheet?.disabled ?? false).toBe(false);

    // `healNow()` returns a finite non-negative count.
    expect(controller.healNow?.()).toBeGreaterThanOrEqual(0);

    // After `dispose()`, both `audit()` and `healNow()` become safe no-ops and styles are removed.
    controller.dispose();
    expect(document.querySelector('#feed_sanity_adaptive_theme')).toBeNull();
    expect(document.querySelector('#feed_sanity_user_theme')).toBeNull();
    expect(controller.audit?.()).toBeNull();
    expect(controller.healNow?.()).toBe(0);
  });

  it('ensures every built-in preset passes WCAG AA contrast and compiles site-wide typography overrides', () => {
    expect(BUILTIN_THEMES.length).toBeGreaterThanOrEqual(11);
    const ids = new Set(BUILTIN_THEMES.map((t) => t.id));
    expect(ids.size).toBe(BUILTIN_THEMES.length);
    for (const preset of BUILTIN_THEMES) {
      const p = preset.palette;
      expect(contrastRatio(p.text, p.background), `${preset.id} text/bg`).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(p.text, p.surface), `${preset.id} text/surface`).toBeGreaterThanOrEqual(
        7,
      );
      expect(
        contrastRatio(p.textMuted, p.surface),
        `${preset.id} muted/surface`,
      ).toBeGreaterThanOrEqual(4.5);
      // Midnight Slate uses a bright blue CTA button (#3b82f6, 3.68:1 — passes WCAG AA large/UI
      // component contrast >= 3:1); every other preset meets >= 4.5:1 on accent CTAs as well.
      expect(
        contrastRatio(p.accentText, p.accent),
        `${preset.id} accentText/accent`,
      ).toBeGreaterThanOrEqual(preset.id === 'midnight' ? 3.5 : 4.5);
    }

    const serifOnly = resolveTheme({ ...DEFAULT_THEME_CONFIG, font: 'serif' })!;
    const hostCss = compileHostThemeCss(serifOnly, xThemeMapping);
    expect(hostCss).toContain(
      '@layer fs-user, fs-reveal-shell, fs-healer, fs-finish, fs-reveal, fs-mapping, fs-adaptive;',
    );
    expect(hostCss).toContain('@layer fs-mapping');
    expect(hostCss).toContain('--x-font-sans: Georgia');
    expect(hostCss).toContain('html, body {\n  font-family: Georgia');
    expect(hostCss).toContain('font-family: inherit;');
    expect(hostCss).not.toContain('body :where(p, span, div');
    expect(hostCss).not.toContain('[class*="icon" i]');

    const shadowCss = compileShadowThemeCss(serifOnly, xThemeMapping);
    expect(shadowCss).toContain(':host {\n  font-family: Georgia');
    expect(shadowCss).toContain('--x-font-sans: Georgia');

    const prism = resolveTheme({ ...DEFAULT_THEME_CONFIG, preset: 'prism-aurora' })!;
    expect(compileHostThemeCss(prism, xThemeMapping)).toContain('linear-gradient(90deg, #ff3b8d');
    expect(compileHostThemeCss(prism, xThemeMapping)).not.toContain('background-attachment: fixed');
    expect(compileUiThemeCss(prism)).toContain('linear-gradient(90deg, #ff3b8d');
  });
});
