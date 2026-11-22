import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { facebookThemeMapping } from '../sites/facebook/theme-mapping';
import { instagramThemeMapping } from '../sites/instagram/theme-mapping';
import { xThemeMapping } from '../sites/x/theme-mapping';
import { HOST_TAG, renderInShadow, setUserThemeCss } from '../ui/mount';
import { createDomEnvironment } from './dom-env';
import {
  BUILTIN_THEMES,
  compileHostThemeCss,
  compileShadowThemeCss,
  compileUiThemeCss,
  contrastingText,
  createThemeController,
  DEFAULT_THEME_CONFIG,
  hexToRgbTriplet,
  hexWithAlpha,
  normalizeHex,
  resolveTheme,
  THEME_FONT_STACKS,
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
    expect(hexWithAlpha('#3b82f6', 0.16)).toBe('rgb(59 130 246 / 16%)');
    expect(contrastingText('#0b0f17')).toBe('#ffffff');
    expect(contrastingText('#f4efe6')).toBe('#111111');
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
});
