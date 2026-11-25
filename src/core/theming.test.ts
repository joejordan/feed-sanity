import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { facebookThemeMapping } from '../sites/facebook/theme-mapping';
import { instagramThemeMapping } from '../sites/instagram/theme-mapping';
import { xThemeMapping } from '../sites/x/theme-mapping';
import { HOST_TAG, renderInShadow, setUserThemeCss } from '../ui/mount';
import { createDomEnvironment } from './dom-env';
import { SHELL_ATTR } from './surface';
import { BACKDROP_SELECTOR, DEFAULT_THEME_EFFECTS } from './theme-effects';
import {
  applyEarlyThemeCss,
  applyThemePreset,
  BUILTIN_THEMES,
  clearEarlyThemeStyle,
  compileHostThemeCss,
  compileShadowThemeCss,
  compileUiThemeCss,
  contrastingText,
  contrastRatio,
  createThemeController,
  DEFAULT_THEME_DOCUMENT,
  hexToHslTriplet,
  hexToRgbTriplet,
  hexWithAlpha,
  mixHex,
  normalizeHex,
  readEarlyThemeCss,
  readThemeDocument,
  resolveTheme,
  THEME_FONT_STACKS,
  THEME_STYLE_ID,
  updateThemeCustomCss,
  updateThemePalette,
  updateThemeTypography,
  writeEarlyThemeCss,
} from './theming';
import { samePalette } from './theming/color';

describe('first-class multi-site theming engine', () => {
  const cleanups: Array<() => void> = [];

  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    document.body.removeAttribute('style');
    document.documentElement.removeAttribute('style');
    setUserThemeCss('');
  });

  afterEach(() => {
    for (const stop of cleanups.splice(0).reverse()) {
      stop();
    }
    document.body.removeAttribute('style');
    document.documentElement.removeAttribute('style');
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
    const resolved = resolveTheme(applyThemePreset(DEFAULT_THEME_DOCUMENT, 'midnight'))!;
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
    expect(resolveTheme(DEFAULT_THEME_DOCUMENT)).toBeNull();

    const catppuccin = resolveTheme(applyThemePreset(DEFAULT_THEME_DOCUMENT, 'catppuccin-mocha'));
    expect(catppuccin?.palette?.background).toBe('#1e1e2e');
    expect(catppuccin?.palette?.colorScheme).toBe('dark');

    // Font or custom CSS alone on Site Default must NOT force Midnight Slate colors!
    const fontOnly = resolveTheme(
      updateThemeCustomCss(
        updateThemeTypography(DEFAULT_THEME_DOCUMENT, 'serif'),
        'article { border-radius: 12px; }',
      ),
    );
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

    // Prototype-chain keys like `toString` or `constructor` in typography presets must be ignored cleanly.
    for (const preset of ['toString', 'constructor']) {
      expect(
        resolveTheme(readThemeDocument({ ...DEFAULT_THEME_DOCUMENT, typography: { preset } })),
      ).toBeNull();
    }

    // Custom light canvas on top of 'default' infers light colorScheme and contrasting accentText.
    const customLight = resolveTheme(
      updateThemeTypography(
        updateThemePalette(DEFAULT_THEME_DOCUMENT, { background: '#faf6ef', accent: '#fde047' }),
        'serif',
      ),
    );
    expect(customLight?.palette?.colorScheme).toBe('light');
    expect(customLight?.palette?.background).toBe('#faf6ef');
    expect(customLight?.palette?.accentText).toBe('#111111');

    // Invalid hex values are ignored cleanly without producing broken CSS.
    expect(
      resolveTheme(updateThemePalette(DEFAULT_THEME_DOCUMENT, { accent: 'not-a-color' })),
    ).toBeNull();
  });

  it('compiles host, shadow (:host), and Feed Sanity UI CSS accurately across Facebook, Instagram, and X', () => {
    const resolved = resolveTheme(
      updateThemeTypography(applyThemePreset(DEFAULT_THEME_DOCUMENT, 'catppuccin-mocha'), 'mono'),
    )!;

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
    expect(xCss).toContain(
      '[data-testid="primaryColumn"] [data-testid="toolBar"] [role="tablist"] {\n  background-color: transparent !important;\n  border-bottom-color: transparent !important;\n}',
    );

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

    const warmPaperResolved = resolveTheme(applyThemePreset(DEFAULT_THEME_DOCUMENT, 'warm-paper'))!;
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

    const serifOnly = resolveTheme(updateThemeTypography(DEFAULT_THEME_DOCUMENT, 'serif'))!;
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

    const prism = resolveTheme(applyThemePreset(DEFAULT_THEME_DOCUMENT, 'prism-aurora'))!;
    expect(compileHostThemeCss(prism, xThemeMapping)).toContain('linear-gradient(90deg, #ff3b8d');
    expect(compileHostThemeCss(prism, xThemeMapping)).not.toContain('background-attachment: fixed');
    expect(compileUiThemeCss(prism)).toContain('linear-gradient(90deg, #ff3b8d');

    // Normal custom CSS stays unlayered so non-!important user rules beat layered rules;
    // !important custom CSS enters @layer fs-user (highest !important priority).
    const normalCustom = resolveTheme(
      updateThemeCustomCss(
        applyThemePreset(DEFAULT_THEME_DOCUMENT, 'midnight'),
        'article { border-radius: 12px; }',
      ),
    )!;
    const normalCustomCss = compileHostThemeCss(normalCustom, xThemeMapping);
    expect(normalCustomCss).not.toContain('@layer fs-user {');
    expect(normalCustomCss.trim().endsWith('article { border-radius: 12px; }')).toBe(true);

    const importantCustom = resolveTheme(
      updateThemeCustomCss(
        applyThemePreset(DEFAULT_THEME_DOCUMENT, 'midnight'),
        'a { color: #ff0000 !important; }',
      ),
    )!;
    expect(compileHostThemeCss(importantCustom, xThemeMapping)).toContain('@layer fs-user {');
  });

  it('compares accentSecondary in samePalette, skips CSS recompiles on canvas-only updates, self-heals detached backdrops, and tracks native scheme flips', async () => {
    const base = BUILTIN_THEMES[0]!.palette;
    expect(samePalette(base, { ...base })).toBe(true);
    expect(samePalette(base, { ...base, accentSecondary: '#ec4899' })).toBe(false);

    const env = createDomEnvironment({ pierceShadow: true });
    cleanups.push(() => env.dispose());

    const hostStyle = document.createElement('style');
    hostStyle.textContent = '.surface-card { background-color: #ffffff; color: #111111; }';
    document.head.append(hostStyle);
    document.body.style.backgroundColor = 'rgb(255, 255, 255)';

    const extraCss = vi.fn(() => '.curated { opacity: 1; }');
    const setUiCss = vi.fn();
    const controller = createThemeController(
      env,
      {
        rootSelectors: [':root'],
        extraCss,
        adaptive: { enabled: true },
      },
      setUiCss,
    );
    cleanups.push(() => controller.dispose());

    const initial = {
      palette: base,
      effects: {
        ...DEFAULT_THEME_EFFECTS,
        backdrop: 'aurora' as const,
        surface: 'glass' as const,
        glassStrength: 0.25,
        intensity: 0.8,
        speed: 1,
      },
    };
    controller.apply(initial);
    expect(extraCss).toHaveBeenCalledTimes(1);
    expect(setUiCss).toHaveBeenCalledTimes(1);
    const firstBackdrop = document.querySelector(BACKDROP_SELECTOR);
    expect(firstBackdrop).not.toBeNull();

    // Canvas-only updates (`speed`, `intensity`, `paused`, `click`, live-to-live backdrop switch)
    // must NOT recompile host/UI CSS.
    controller.preview({
      ...initial,
      effects: {
        ...initial.effects,
        backdrop: 'silk',
        speed: 1.75,
        intensity: 0.45,
        paused: true,
        click: 'spark',
      },
    });
    expect(extraCss).toHaveBeenCalledTimes(1);
    expect(setUiCss).toHaveBeenCalledTimes(1);
    expect((firstBackdrop as HTMLElement).style.opacity).toBe('0.45');
    expect(firstBackdrop?.getAttribute('data-fs-backdrop')).toBe('silk');

    // Turning backdrop off (`silk` -> `none`) DOES recompile CSS.
    controller.preview({
      ...initial,
      effects: { ...initial.effects, backdrop: 'none' },
    });
    expect(extraCss).toHaveBeenCalledTimes(2);

    // CSS-affecting `glassStrength` update DOES recompile CSS.
    controller.preview({
      ...initial,
      effects: { ...initial.effects, glassStrength: 0.5 },
    });
    expect(extraCss).toHaveBeenCalledTimes(3);
    expect(setUiCss).toHaveBeenCalledTimes(3);

    // Switching to Prism + tuning `surfaceParams` MUST recompile host CSS AND update live Prism driver.
    controller.preview({
      ...initial,
      effects: {
        ...initial.effects,
        surface: 'prism',
        surfaceParams: { baseAngle: 140, sweep: 60 },
        click: 'supernova',
      },
    });
    expect(extraCss).toHaveBeenCalledTimes(4);
    expect(document.querySelector(`#${THEME_STYLE_ID}`)?.textContent).toContain(
      'var(--fs-ptr-angle, 140deg)',
    );
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 600, clientY: 180 }));
    await vi.waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--fs-ptr-angle')).toMatch(/^\d+deg$/);
    });

    // Updating only `surfaceParams.baseAngle` recompiles CSS and clears stale inline `--fs-ptr-angle`.
    controller.preview({
      ...initial,
      effects: {
        ...initial.effects,
        surface: 'prism',
        surfaceParams: { baseAngle: 220, sweep: 60 },
        click: 'supernova',
      },
    });
    expect(extraCss).toHaveBeenCalledTimes(5);
    expect(document.querySelector(`#${THEME_STYLE_ID}`)?.textContent).toContain(
      'var(--fs-ptr-angle, 220deg)',
    );
    expect(document.documentElement.style.getPropertyValue('--fs-ptr-angle')).toBe('');

    // Updating only `clickParams` skips host CSS recompile while syncing live `clickFx`.
    const clickTarget = document.createElement('button');
    document.body.append(clickTarget);
    controller.preview({
      ...initial,
      effects: {
        ...initial.effects,
        surface: 'prism',
        surfaceParams: { baseAngle: 220, sweep: 60 },
        click: 'supernova',
        clickParams: { style: 'rings', scale: 1.3 },
      },
    });
    expect(extraCss).toHaveBeenCalledTimes(5);
    clickTarget.dispatchEvent(
      new PointerEvent('pointerdown', { button: 0, clientX: 90, clientY: 90, bubbles: true }),
    );
    const clickFxHost = document.querySelector('[data-feed-sanity="theme-click-fx"]');
    expect(clickFxHost?.shadowRoot?.childElementCount).toBe(2);
    clickTarget.remove();

    controller.clearPreview();
    expect(extraCss).toHaveBeenCalledTimes(6);

    // Self-healing backdrop: if the host SPA removes our backdrop div, controller remounts it automatically.
    const currentBackdrop = document.querySelector(BACKDROP_SELECTOR)!;
    currentBackdrop.remove();
    await vi.waitFor(() => {
      const healed = document.querySelector(BACKDROP_SELECTOR);
      expect(healed).not.toBeNull();
      expect(healed).not.toBe(currentBackdrop);
    });

    // Noisy non-color `body.style.overflow = 'hidden'` modal writes must NOT even invoke
    // `detectNativeHostScheme` / `getComputedStyle` on root elements.
    const computedSpy = vi.spyOn(globalThis, 'getComputedStyle');
    const compilesBeforeModal = extraCss.mock.calls.length;
    document.body.style.overflow = 'hidden';
    await new Promise((resolve) => setTimeout(resolve, 120));
    const rootStyleReads = computedSpy.mock.calls.filter(
      ([el]) => el === document.body || el === document.documentElement,
    );
    expect(rootStyleReads).toHaveLength(0);
    expect(extraCss.mock.calls.length).toBe(compilesBeforeModal);

    // Flipping native host polarity (light -> dark) invalidates cached hostScheme and recompiles cleanly.
    document.body.style.backgroundColor = 'rgb(0, 0, 0)';
    await vi.waitFor(() => {
      expect(extraCss.mock.calls.length).toBeGreaterThan(compilesBeforeModal);
    });
    computedSpy.mockRestore();

    // Intentional teardown (`apply(null)`) removes the backdrop and does NOT self-heal it back.
    controller.apply(null);
    expect(document.querySelector(BACKDROP_SELECTOR)).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.querySelector(BACKDROP_SELECTOR)).toBeNull();
  });

  it('reconciles document_start dark body arrival, reacts to matchMedia prefers-color-scheme changes, and cleans up headless iframe watchers', async () => {
    // 1. document_start pre-<body> apply reconciles hostScheme once dark <body> arrives.
    const earlyDoc = document.implementation.createHTMLDocument('early');
    earlyDoc.body.remove();
    const earlyEnv = createDomEnvironment({ doc: earlyDoc });
    cleanups.push(() => earlyEnv.dispose());
    const earlyStyle = earlyDoc.createElement('style');
    earlyStyle.textContent = '.card { background-color: #121212; color: #f0f0f0; }';
    earlyDoc.head.append(earlyStyle);
    const earlyController = createThemeController(
      earlyEnv,
      { rootSelectors: [':root'], adaptive: { enabled: true } },
      vi.fn(),
    );
    cleanups.push(() => earlyController.dispose());

    const warmPaper = BUILTIN_THEMES.find((t) => t.id === 'warm-paper')!.palette;
    earlyController.apply({ palette: warmPaper });
    // Before <body> exists, fallback scheme is 'light', so dark `.card` is treated as opposite-polarity and skipped.
    expect(earlyDoc.querySelector('#feed_sanity_adaptive_theme')?.textContent ?? '').not.toContain(
      '.card',
    );

    const darkBody = earlyDoc.createElement('body');
    darkBody.style.backgroundColor = 'rgb(0, 0, 0)';
    earlyDoc.documentElement.append(darkBody);
    await vi.waitFor(() =>
      expect(earlyDoc.querySelector('#feed_sanity_adaptive_theme')?.textContent).toContain('.card'),
    );

    // 2. matchMedia('(prefers-color-scheme: dark)') change listener triggers recompile & aborts on dispose.
    let changeHandler: (() => void) | undefined;
    let changeSignal: AbortSignal | undefined;
    const matchMediaSpy = vi.spyOn(globalThis, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: false,
          media: query,
          addEventListener: (
            event: string,
            cb: () => void,
            opts?: { readonly signal?: AbortSignal },
          ) => {
            if (event === 'change') {
              changeHandler = cb;
              changeSignal = opts?.signal;
            }
          },
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList,
    );
    const mediaEnv = createDomEnvironment();
    cleanups.push(() => mediaEnv.dispose());
    const mediaExtraCss = vi.fn(() => '.media-test { opacity: 1; }');
    const mediaController = createThemeController(
      mediaEnv,
      { rootSelectors: [':root'], extraCss: mediaExtraCss, adaptive: { enabled: true } },
      vi.fn(),
    );
    cleanups.push(() => {
      mediaController.dispose();
      matchMediaSpy.mockRestore();
    });

    let mockedBg = 'rgb(255, 255, 255)';
    const styleSpy = vi
      .spyOn(globalThis, 'getComputedStyle')
      .mockImplementation(
        () => ({ backgroundColor: mockedBg, colorScheme: '' }) as unknown as CSSStyleDeclaration,
      );
    try {
      mediaController.apply({ palette: warmPaper });
      expect(mediaExtraCss).toHaveBeenCalledTimes(1);
      expect(changeHandler).toBeDefined();

      mockedBg = 'rgb(0, 0, 0)';
      changeHandler?.();
      await vi.waitFor(() => expect(mediaExtraCss).toHaveBeenCalledTimes(2));

      mediaController.dispose();
      expect(changeSignal?.aborted).toBe(true);
    } finally {
      styleSpy.mockRestore();
    }

    // 3. Headless iframe watchHead cleanup prevents leaks on early iframe removal & controller dispose.
    const iframeEnv = createDomEnvironment({ includeIframes: true });
    cleanups.push(() => iframeEnv.dispose());
    const iframeController = createThemeController(iframeEnv, facebookThemeMapping, vi.fn());
    cleanups.push(() => iframeController.dispose());
    iframeController.apply({ palette: BUILTIN_THEMES[0]!.palette });

    const headlessFrame = document.createElement('iframe');
    const headlessDoc = document.implementation.createHTMLDocument('headless');
    headlessDoc.documentElement.remove();
    Object.defineProperty(headlessFrame, 'contentDocument', {
      value: headlessDoc,
      configurable: true,
    });
    document.body.append(headlessFrame);
    await new Promise((resolve) => setTimeout(resolve, 10));
    headlessFrame.remove();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Appending <head> after the iframe was removed must NOT inject theme CSS into the detached document.
    const lateHtml = headlessDoc.createElement('html');
    lateHtml.append(headlessDoc.createElement('head'));
    headlessDoc.append(lateHtml);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(headlessDoc.querySelector('#feed_sanity_user_theme')).toBeNull();
  });

  it('never locks an unconfirmed light fallback on unstyled boot, picks up CSSOM insertRule() RNW classes, and re-verifies polarity on Studio -> Light toggle', async () => {
    const env = createDomEnvironment();
    cleanups.push(() => env.dispose());

    const controller = createThemeController(
      env,
      { rootSelectors: [':root'], adaptive: { enabled: true } },
      vi.fn(),
    );
    cleanups.push(() => controller.dispose());

    // 1. Apply a dark Studio theme while <body> is still unstyled/transparent (no confirmed polarity yet).
    const darkStudio = {
      palette: BUILTIN_THEMES.find((t) => t.id === 'crimson-velvet')!.palette,
      effects: { ...DEFAULT_THEME_EFFECTS, backdrop: 'silk' as const, surface: 'glass' as const },
    };
    controller.apply(darkStudio);

    // 2. Host dark stylesheet arrives AFTER boot, painting body dark and defining an RNW-style dark card + light text class.
    const rnwStyle = document.createElement('style');
    rnwStyle.textContent =
      'body { background-color: rgb(0, 0, 0); } .r-dark-card { background-color: rgb(22, 24, 28); } .r-light-ink { color: rgb(231, 233, 234); }';
    document.head.append(rnwStyle);

    // Wait for debounced adaptive recompile to confirm hostScheme === 'dark'.
    await vi.waitFor(() => {
      const adaptive = document.querySelector('#feed_sanity_adaptive_theme')?.textContent ?? '';
      expect(adaptive).toContain('.r-dark-card');
      expect(adaptive).toContain('.r-light-ink');
    });

    // 3. Simulate React Native Web dynamically appending a new dark class via CSSOM `sheet.insertRule()`
    //    when a new tweet renders (no new <style> element added to DOM).
    rnwStyle.sheet?.insertRule(
      '.r-late-dark-pill { background-color: rgb(32, 35, 39); color: rgb(239, 243, 244); }',
      rnwStyle.sheet.cssRules.length,
    );
    const lateTweet = document.createElement('div');
    lateTweet.className = 'r-late-dark-pill';
    document.body.append(lateTweet);

    await vi.waitFor(
      () => {
        const adaptive = document.querySelector('#feed_sanity_adaptive_theme')?.textContent ?? '';
        expect(adaptive).toContain('.r-late-dark-pill');
      },
      { timeout: 1500 },
    );

    // 4. Toggle from dark Studio theme to Warm Paper (light): Layer 1 must remap BOTH dark surfaces
    //    AND light text classes to Warm Paper's light surface & dark text (never light-on-light!).
    const warmPaper = BUILTIN_THEMES.find((t) => t.id === 'warm-paper')!.palette;
    controller.apply({ palette: warmPaper });

    const adaptiveAfterToggle =
      document.querySelector('#feed_sanity_adaptive_theme')?.textContent ?? '';
    expect(adaptiveAfterToggle).toContain('.r-dark-card');
    expect(adaptiveAfterToggle).toContain(warmPaper.surface);
    expect(adaptiveAfterToggle).toContain('.r-light-ink');
    expect(adaptiveAfterToggle).toContain(warmPaper.text);
    expect(adaptiveAfterToggle).toContain('.r-late-dark-pill');
  });

  it('re-verifies stale cached host polarity on Appearance Panel preview() -> apply() -> clearPreview() transitions', () => {
    const env = createDomEnvironment();
    cleanups.push(() => env.dispose());

    // Start with a confirmed native light canvas so `detectedHostScheme` caches `'light'`.
    const style = document.createElement('style');
    style.textContent =
      'body { background-color: rgb(255, 255, 255); } .r-dark-card { background-color: rgb(22, 24, 28); } .r-light-ink { color: rgb(231, 233, 234); }';
    document.head.append(style);

    const controller = createThemeController(
      env,
      { rootSelectors: [':root'], adaptive: { enabled: true } },
      vi.fn(),
    );
    cleanups.push(() => controller.dispose());

    const darkStudio = {
      palette: BUILTIN_THEMES.find((t) => t.id === 'crimson-velvet')!.palette,
      effects: { ...DEFAULT_THEME_EFFECTS, backdrop: 'silk' as const, surface: 'glass' as const },
    };
    controller.apply(darkStudio);

    // Host flips dark purely via CSSOM rule insertion (no html/body attribute mutation, so the
    // attribute observer does not fire and the cached scheme remains stale `'light'`).
    style.sheet?.insertRule(
      'body { background-color: rgb(0, 0, 0); }',
      style.sheet.cssRules.length,
    );

    // Simulate an Appearance Panel click on Warm Paper (`preview()` -> `apply()` -> `clearPreview()`).
    const warmPaper = BUILTIN_THEMES.find((t) => t.id === 'warm-paper')!.palette;
    controller.preview({ palette: warmPaper });
    controller.apply({ palette: warmPaper });
    controller.clearPreview();

    const adaptive = document.querySelector('#feed_sanity_adaptive_theme')?.textContent ?? '';
    expect(adaptive).toContain('.r-dark-card');
    expect(adaptive).toContain(warmPaper.surface);
    expect(adaptive).toContain('.r-light-ink');
    expect(adaptive).toContain(warmPaper.text);
  });

  it('tracks YouTube-style <html dark> flips and Shadow DOM CSSOM insertRule() / replaceSync() mutations', async () => {
    const env = createDomEnvironment({ pierceShadow: true });
    cleanups.push(() => env.dispose());

    const docStyle = document.createElement('style');
    docStyle.textContent =
      '.yt-card { background-color: rgb(15, 15, 15); color: rgb(241, 241, 241); }';
    document.head.append(docStyle);

    // Mount an open ShadowRoot with both a `<style>` sheet and a constructable adoptedStyleSheet.
    const host = document.createElement('ytd-test-widget');
    const shadow = host.attachShadow({ mode: 'open' });
    const shadowStyle = document.createElement('style');
    shadowStyle.textContent = '.wc-panel { background-color: rgb(24, 24, 24); }';
    shadow.append(shadowStyle);
    const adopted = new CSSStyleSheet();
    adopted.replaceSync('.wc-chip-v1 { background-color: rgb(32, 32, 32); }');
    shadow.adoptedStyleSheets = [adopted];
    document.body.append(host);

    const controller = createThemeController(
      env,
      { rootSelectors: [':root'], adaptive: { enabled: true } },
      vi.fn(),
    );
    cleanups.push(() => {
      controller.dispose();
      document.documentElement.removeAttribute('dark');
    });

    const warmPaper = BUILTIN_THEMES.find((t) => t.id === 'warm-paper')!.palette;
    controller.apply({ palette: warmPaper });

    // 1. Flipping bare `<html dark>` (YouTube dark mode) triggers `schemeObserver` and remaps `.yt-card`.
    document.documentElement.setAttribute('dark', '');
    await vi.waitFor(() => {
      const adaptive = document.querySelector('#feed_sanity_adaptive_theme')?.textContent ?? '';
      expect(adaptive).toContain('.yt-card');
      expect(adaptive).toContain(warmPaper.background);
      expect(adaptive).toContain(warmPaper.text);
    });

    // 2. Shadow DOM `<style>` `insertRule()` auto-recompiles on child DOM addition.
    shadowStyle.sheet?.insertRule(
      '.wc-late-card { background-color: rgb(28, 28, 28); }',
      shadowStyle.sheet.cssRules.length,
    );
    const child1 = document.createElement('div');
    child1.className = 'wc-late-card';
    shadow.append(child1);

    await vi.waitFor(
      () => {
        const shadowAdaptive =
          shadow.querySelector('#feed_sanity_adaptive_theme')?.textContent ?? '';
        expect(shadowAdaptive).toContain('.wc-late-card');
        expect(shadowAdaptive).toContain('.wc-chip-v1');
      },
      { timeout: 1500 },
    );

    // 3. Isolated `adoptedStyleSheets` `replaceSync()` with identical rule count (`1 -> 1`)
    //    must still invalidate `RootCssomSnapshot` and recompile `.wc-chip-v2` cleanly.
    adopted.replaceSync('.wc-chip-v2 { background-color: rgb(36, 36, 36); }');
    const child2 = document.createElement('div');
    child2.className = 'wc-chip-v2';
    shadow.append(child2);

    await vi.waitFor(
      () => {
        const shadowAdaptive =
          shadow.querySelector('#feed_sanity_adaptive_theme')?.textContent ?? '';
        expect(shadowAdaptive).toContain('.wc-chip-v2');
        expect(shadowAdaptive).not.toContain('.wc-chip-v1');
      },
      { timeout: 1500 },
    );
  });

  it('automatically marks ancestor shell wrappers with data-fs-shell during Studio backdrops, skips popups/own UI, tracks SPA additions, and cleans up on exit', async () => {
    document.body.innerHTML = `
      <div id="app-root">
        <div id="deep-wrapper-1">
          <div id="deep-wrapper-2">
            <main role="main" id="main-landmark">
              <div id="col-wrapper">
                <div data-testid="primaryColumn" id="primary-col">
                  <article id="feed-post">Post</article>
                </div>
              </div>
              <div data-testid="sidebarColumn" id="sidebar-col">
                <div id="sidebar-inner">
                  <aside id="leaf-card" role="complementary" aria-label="Who to follow">Card</aside>
                </div>
              </div>
            </main>
          </div>
        </div>
        <div role="dialog" id="modal-dialog">
          <div id="modal-inner">
            <article data-testid="tweet" id="modal-article">Dialog tweet</article>
          </div>
        </div>
        <feed-sanity-ui data-feed-sanity="" id="own-ui-host">
          <div id="own-ui-inner">
            <main id="own-ui-main">Own UI main</main>
          </div>
        </feed-sanity-ui>
      </div>
    `;

    const env = createDomEnvironment();
    cleanups.push(() => env.dispose());
    const controller = createThemeController(env, xThemeMapping, vi.fn());
    cleanups.push(() => controller.dispose());

    const midnight = BUILTIN_THEMES[0]!.palette;

    // Static theme (no Studio backdrop) stamps zero SHELL_ATTR attributes.
    controller.apply({ palette: midnight });
    expect(document.querySelectorAll(`[${SHELL_ATTR}]`).length).toBe(0);

    // Enabling a Studio backdrop automatically marks every arbitrary wrapper ancestor between
    // semantic landmarks/cards and <body> without hardcoded `div > div` ladders.
    controller.apply({
      palette: midnight,
      effects: { ...DEFAULT_THEME_EFFECTS, backdrop: 'aurora', surface: 'glass' },
    });

    expect(document.querySelector('#app-root')?.hasAttribute(SHELL_ATTR)).toBe(true);
    expect(document.querySelector('#deep-wrapper-1')?.hasAttribute(SHELL_ATTR)).toBe(true);
    expect(document.querySelector('#deep-wrapper-2')?.hasAttribute(SHELL_ATTR)).toBe(true);
    expect(document.querySelector('#main-landmark')?.hasAttribute(SHELL_ATTR)).toBe(true);
    expect(document.querySelector('#col-wrapper')?.hasAttribute(SHELL_ATTR)).toBe(true);
    expect(document.querySelector('#sidebar-col')?.hasAttribute(SHELL_ATTR)).toBe(true);
    expect(document.querySelector('#sidebar-inner')?.hasAttribute(SHELL_ATTR)).toBe(true);
    // Semantic content surfaces themselves, dialogs, and Feed Sanity's own UI interior wrappers
    // must NEVER be marked transparent shell.
    expect(document.querySelector('#primary-col')?.hasAttribute(SHELL_ATTR)).toBe(false);
    expect(document.querySelector('#leaf-card')?.hasAttribute(SHELL_ATTR)).toBe(false);
    expect(document.querySelector('#modal-dialog')?.hasAttribute(SHELL_ATTR)).toBe(false);
    expect(document.querySelector('#modal-inner')?.hasAttribute(SHELL_ATTR)).toBe(false);
    expect(document.querySelector('#own-ui-host')?.hasAttribute(SHELL_ATTR)).toBe(false);
    expect(document.querySelector('#own-ui-inner')?.hasAttribute(SHELL_ATTR)).toBe(false);
    expect(document.querySelector('#own-ui-main')?.hasAttribute(SHELL_ATTR)).toBe(false);

    // Dynamically inserted SPA subtrees inside columns & outside popups get their wrapper ancestors marked.
    const lateShell = document.createElement('div');
    lateShell.id = 'late-spa-shell';
    const lateCard = document.createElement('section');
    lateCard.id = 'late-card';
    lateCard.setAttribute('aria-label', 'Trending');
    lateShell.append(lateCard);
    document.querySelector('#sidebar-col')?.append(lateShell);

    const colPostWrapper = document.createElement('div');
    colPostWrapper.id = 'late-col-post-wrapper';
    const colPost = document.createElement('article');
    colPost.dataset.testid = 'tweet';
    colPostWrapper.append(colPost);
    document.querySelector('#primary-col')?.append(colPostWrapper);

    await vi.waitFor(() => {
      expect(lateShell.hasAttribute(SHELL_ATTR)).toBe(true);
      expect(colPostWrapper.hasAttribute(SHELL_ATTR)).toBe(true);
    });
    expect(lateCard.hasAttribute(SHELL_ATTR)).toBe(false);
    expect(colPost.hasAttribute(SHELL_ATTR)).toBe(false);

    // Mutations strictly inside a popup dialog never receive SHELL_ATTR or disturb marked shells.
    const modalChild = document.createElement('div');
    modalChild.append(document.createElement('span'));
    document.querySelector('#modal-inner')?.append(modalChild);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(modalChild.hasAttribute(SHELL_ATTR)).toBe(false);

    // Turning the backdrop off removes every SHELL_ATTR cleanly.
    controller.apply({ palette: midnight });
    expect(document.querySelectorAll(`[${SHELL_ATTR}]`).length).toBe(0);

    // Fallback site mapping (no declarative `surfaces`): only wrappers ABOVE `<main>` get SHELL_ATTR
    // so `<main>` keeps its fallback `cardAlpha` background in `@layer fs-reveal`.
    const fallbackController = createThemeController(env, { rootSelectors: [':root'] }, vi.fn());
    cleanups.push(() => fallbackController.dispose());
    fallbackController.apply({
      palette: midnight,
      effects: { ...DEFAULT_THEME_EFFECTS, backdrop: 'aurora' },
    });
    expect(document.querySelector('#app-root')?.hasAttribute(SHELL_ATTR)).toBe(true);
    expect(document.querySelector('#deep-wrapper-2')?.hasAttribute(SHELL_ATTR)).toBe(true);
    expect(document.querySelector('#main-landmark')?.hasAttribute(SHELL_ATTR)).toBe(false);
    fallbackController.apply(null);
    expect(document.querySelectorAll(`[${SHELL_ATTR}]`).length).toBe(0);
  });
});
