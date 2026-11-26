import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Platform } from '../../core/platform';
import { startSite } from '../../core/site';
import { SITES_STORAGE_KEY } from '../../core/site-settings';
import { inMemoryStore } from '../../core/testing';
import { STUDIO_VIBES } from '../../core/theme-effects';
import {
  applyStudioVibe,
  applyThemePreset,
  DEFAULT_THEME_DOCUMENT,
  THEME_FILE_FORMAT,
  THEME_SCHEMA_VERSION,
  updateThemeTypography,
} from '../../core/theming';
import { facebookSite } from '../../sites/facebook';
import { xSite } from '../../sites/x';
import {
  findFacebookDarkModeAnchor,
  isFacebookDarkModeSettingsPath,
} from '../facebook-display-notice';
import { DISPLAY_NOTICE_HOST_ID, describeActiveTheme, findHeaderAfterAnchor } from './index';

function makePlatform(initial: Record<string, unknown> = {}): {
  platform: Platform;
  store: ReturnType<typeof inMemoryStore>;
} {
  const store = inMemoryStore(initial);
  const platform: Platform = {
    store,
    build: 'test',
    onOpenOptions: () => undefined,
    setBadge: () => undefined,
    installPageWorld: () => Promise.resolve(),
  };
  return { platform, store };
}

function renderXDisplaySettingsDom(): HTMLElement {
  // Mirrors X's 2-column desktop Settings layout where `[data-testid="primaryColumn"]`
  // holds the left settings nav and `section[aria-labelledby="detail-header"]` holds Display.
  document.body.innerHTML = `
    <main role="main">
      <div data-testid="primaryColumn" id="settings-nav-col">
        <div>Settings navigation</div>
      </div>
      <section aria-labelledby="detail-header" id="display-section">
        <div id="display-header-bar">
          <button type="button" aria-label="Back">Back</button>
          <h2 id="detail-header">Display</h2>
        </div>
        <div id="display-controls">
          <div>Font size</div>
          <div>Color</div>
          <div>Background</div>
        </div>
      </section>
    </main>
  `;
  return document.querySelector('#display-section') as HTMLElement;
}

function renderFacebookDarkModeDom(): HTMLElement {
  document.body.innerHTML = `
    <div role="main" id="fb-settings-main">
      <div id="fb-settings-col">
        <h1 id="fb-dark-mode-heading">Dark mode</h1>
        <div role="radiogroup" id="fb-dark-mode-radios">
          <label><input type="radio" name="dm" /> Off</label>
          <label><input type="radio" name="dm" checked /> On</label>
          <label><input type="radio" name="dm" /> Automatic</label>
        </div>
      </div>
    </div>
  `;
  return document.querySelector('#fb-settings-main') as HTMLElement;
}

describe('display-notice feature (X & Facebook)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
  });

  afterEach(async () => {
    const optionsHost = document.querySelector('#feed_sanity_options');
    const closeBtn = optionsHost?.shadowRoot?.querySelector<HTMLButtonElement>(
      'button[aria-label="Close"]',
    );
    closeBtn?.click();
    await new Promise((r) => setTimeout(r, 0));
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('summarizes Site Default, preset, Studio Vibe, imported theme, and custom overrides accurately', () => {
    expect(describeActiveTheme({ ...DEFAULT_THEME_DOCUMENT })).toEqual({
      overriding: false,
      label: 'Site Default',
    });
    expect(describeActiveTheme(applyThemePreset(DEFAULT_THEME_DOCUMENT, 'warm-paper'))).toEqual({
      overriding: true,
      label: 'Warm Paper',
    });
    const velvetSilk = STUDIO_VIBES.find((vibe) => vibe.id === 'velvet-silk')!;
    expect(describeActiveTheme(applyStudioVibe(DEFAULT_THEME_DOCUMENT, velvetSilk))).toEqual({
      overriding: true,
      label: velvetSilk.name,
    });
    expect(describeActiveTheme(updateThemeTypography(DEFAULT_THEME_DOCUMENT, 'serif'))).toEqual({
      overriding: true,
      label: 'Custom theme',
    });
    expect(
      describeActiveTheme({
        format: THEME_FILE_FORMAT,
        schemaVersion: THEME_SCHEMA_VERSION,
        id: 'solarized-dusk',
        meta: { name: 'Solarized Dusk' },
        palette: {
          colorScheme: 'dark',
          background: '#002b36',
          surface: '#073642',
          surfaceAlt: '#0d414f',
          text: '#eee8d5',
          textMuted: '#93a1a1',
          border: '#586e75',
          accent: '#268bd2',
          accentText: '#ffffff',
          danger: '#dc322f',
        },
      }),
    ).toEqual({
      overriding: true,
      label: 'Solarized Dusk',
    });
  });

  it('matches Facebook Dark mode route strictly and picks header/radiogroup anchors accurately', () => {
    expect(
      isFacebookDarkModeSettingsPath({ pathname: '/settings/', search: '?tab=dark_mode_category' }),
    ).toBe(true);
    expect(
      isFacebookDarkModeSettingsPath({
        pathname: '/settings',
        search: '?ref=nav&tab=dark_mode_category',
      }),
    ).toBe(true);
    expect(isFacebookDarkModeSettingsPath({ pathname: '/settings/', search: '?tab=account' })).toBe(
      false,
    );
    expect(
      isFacebookDarkModeSettingsPath({ pathname: '/', search: '?tab=dark_mode_category' }),
    ).toBe(false);

    document.body.innerHTML = `
      <section id="nested" aria-labelledby="detail-header">
        <div id="wrapper">
          <div id="header-bar"><h2 id="detail-header">Display</h2></div>
          <div id="body">Controls</div>
        </div>
      </section>
      <div id="fallback" data-testid="primaryColumn"><p>No header</p></div>
    `;
    const nested = document.querySelector('#nested') as Element;
    const headerBar = document.querySelector('#header-bar') as Element;
    expect(findHeaderAfterAnchor(nested, '#detail-header')).toEqual({
      anchor: headerBar,
      placement: 'after',
    });
    const fallback = document.querySelector('#fallback') as Element;
    expect(findHeaderAfterAnchor(fallback, '#detail-header')).toEqual({
      anchor: fallback,
      placement: 'prepend',
    });

    const fbMain = renderFacebookDarkModeDom();
    expect(findFacebookDarkModeAnchor(fbMain)).toEqual({
      anchor: document.querySelector('#fb-dark-mode-radios'),
      placement: 'before',
    });

    // Header-bar-only containers (before body controls mount) mount AFTER the header bar,
    // never inside a horizontal flex bar next to Back buttons or prepended above it.
    document.body.innerHTML = `
      <section id="bar-with-back">
        <div id="hdr-back"><button type="button">Back</button><h2 id="detail-header">Display</h2></div>
      </section>
      <section id="bar-single">
        <div id="hdr-single"><h2 id="detail-header">Display</h2></div>
      </section>
      <section id="with-own-host">
        <feed-sanity-ui data-feed-sanity=""></feed-sanity-ui>
        <div id="own-wrapper">
          <div id="own-hdr"><h2 id="detail-header">Display</h2></div>
          <div id="own-body">Controls</div>
        </div>
      </section>
    `;
    expect(
      findHeaderAfterAnchor(document.querySelector('#bar-with-back')!, '#detail-header'),
    ).toEqual({
      anchor: document.querySelector('#hdr-back'),
      placement: 'after',
    });
    expect(findHeaderAfterAnchor(document.querySelector('#bar-single')!, '#detail-header')).toEqual(
      {
        anchor: document.querySelector('#hdr-single'),
        placement: 'after',
      },
    );
    expect(
      findHeaderAfterAnchor(document.querySelector('#with-own-host')!, '#detail-header'),
    ).toEqual({
      anchor: document.querySelector('#own-hdr'),
      placement: 'after',
    });
  });

  it('X.com /settings/display: mounts below Display header, updates live, opens Appearance, self-heals, and unmounts on route leave or site disable', async () => {
    vi.spyOn(document, 'cookie', 'get').mockReturnValue('twid=u%3D424242');
    history.replaceState({}, '', '/settings/display');
    const section = renderXDisplaySettingsDom();
    const { platform, store } = makePlatform({
      'v2/x/424242/theme': applyThemePreset(DEFAULT_THEME_DOCUMENT, 'warm-paper'),
    });

    const failed = await startSite(xSite, platform);
    expect(failed).toEqual([]);

    const host = document.querySelector(`#${DISPLAY_NOTICE_HOST_ID}`) as HTMLElement | null;
    expect(host).not.toBeNull();
    expect(host?.previousElementSibling?.id).toBe('display-header-bar');
    expect(host?.nextElementSibling?.id).toBe('display-controls');
    expect(section.contains(host)).toBe(true);

    await vi.waitFor(() => {
      const shadowText = host?.shadowRoot?.textContent ?? '';
      expect(shadowText).toContain('Feed Sanity is active');
      expect(shadowText).toContain('Warm Paper');
      expect(shadowText).toContain("overrides X's display colors");
      const wordmark = host?.shadowRoot?.querySelector('svg.fs-brand-wordmark');
      expect(wordmark?.getAttribute('aria-hidden')).toBe('true');
      expect(host?.shadowRoot?.querySelector('span.fs-sr-only')?.textContent).toBe('Feed Sanity');
      expect(host?.shadowRoot?.querySelector('style')?.textContent).toContain(
        '--fs-brand-tittle: #b7791f;',
      );
    });

    // Clicking "Open Appearance" opens the Options dialog directly on Appearance.
    const openBtn = host?.shadowRoot?.querySelector<HTMLButtonElement>(
      'button.fs-display-notice-btn',
    );
    expect(openBtn?.textContent).toContain('Open Appearance');
    openBtn?.click();

    await vi.waitFor(() => {
      const optionsHost = document.querySelector('#feed_sanity_options');
      const heading = optionsHost?.shadowRoot?.querySelector('h3.pane-heading');
      expect(heading?.textContent).toBe('Appearance');
    });

    // Updating theme storage to Site Default updates the notice live.
    await store.set('v2/x/424242/theme', { ...DEFAULT_THEME_DOCUMENT });
    await vi.waitFor(() => {
      const shadowText = host?.shadowRoot?.textContent ?? '';
      expect(shadowText).toContain('Site Default');
      expect(shadowText).toContain("X's native display settings are active");
    });

    // Self-heals if X detaches the host while the anchor remains connected.
    host?.remove();
    await vi.waitFor(() => {
      const reattached = document.querySelector(`#${DISPLAY_NOTICE_HOST_ID}`);
      expect(reattached).toBe(host);
      expect(reattached?.previousElementSibling?.id).toBe('display-header-bar');
    });

    // Leaving `/settings/display` unmounts cleanly; returning remounts.
    history.pushState({}, '', '/settings/account');
    globalThis.dispatchEvent(new PopStateEvent('popstate'));
    expect(document.querySelector(`#${DISPLAY_NOTICE_HOST_ID}`)).toBeNull();

    history.pushState({}, '', '/settings/display');
    globalThis.dispatchEvent(new PopStateEvent('popstate'));
    expect(document.querySelector(`#${DISPLAY_NOTICE_HOST_ID}`)).not.toBeNull();

    // Disabling Feed Sanity on X removes the notice immediately.
    await store.set(SITES_STORAGE_KEY, { x: false });
    await vi.waitFor(() => {
      expect(document.querySelector(`#${DISPLAY_NOTICE_HOST_ID}`)).toBeNull();
    });
  });

  it('Facebook /settings/?tab=dark_mode_category: mounts above dark mode radios, opens Appearance, re-anchors on inner swap, and unmounts on tab change', async () => {
    vi.spyOn(document, 'cookie', 'get').mockReturnValue('c_user=100000000000042');
    history.replaceState({}, '', '/settings/?tab=dark_mode_category');
    const fbMain = renderFacebookDarkModeDom();
    const { platform, store } = makePlatform({
      'v2/facebook/100000000000042/theme': applyThemePreset(
        DEFAULT_THEME_DOCUMENT,
        'catppuccin-mocha',
      ),
    });

    const failed = await startSite(facebookSite, platform);
    expect(failed).toEqual([]);

    const host = document.querySelector(`#${DISPLAY_NOTICE_HOST_ID}`) as HTMLElement | null;
    expect(host).not.toBeNull();
    expect(host?.nextElementSibling?.id).toBe('fb-dark-mode-radios');
    expect(fbMain.contains(host)).toBe(true);

    await vi.waitFor(() => {
      const shadowText = host?.shadowRoot?.textContent ?? '';
      expect(shadowText).toContain('Feed Sanity is active');
      expect(shadowText).toContain('Catppuccin Mocha');
      expect(shadowText).toContain("overrides Facebook's display colors");
    });

    // Clicking "Open Appearance" opens Facebook's Options dialog directly on Appearance.
    host?.shadowRoot?.querySelector<HTMLButtonElement>('button.fs-display-notice-btn')?.click();
    await vi.waitFor(() => {
      const optionsHost = document.querySelector('#feed_sanity_options');
      const heading = optionsHost?.shadowRoot?.querySelector('h3.pane-heading');
      expect(heading?.textContent).toBe('Appearance');
    });

    // If Facebook Comet swaps the inner column inside `[role="main"]`, the notice re-anchors cleanly.
    const nextCol = document.createElement('div');
    nextCol.innerHTML =
      '<h1>Dark mode</h1><div role="radiogroup" id="fb-dark-mode-radios-v2"></div>';
    fbMain.replaceChildren(nextCol);
    await vi.waitFor(() => {
      const reanchored = document.querySelector(`#${DISPLAY_NOTICE_HOST_ID}`);
      expect(reanchored).toBe(host);
      expect(reanchored?.nextElementSibling?.id).toBe('fb-dark-mode-radios-v2');
    });

    // Navigating to a different Facebook Settings tab unmounts cleanly.
    history.pushState({}, '', '/settings/?tab=privacy');
    globalThis.dispatchEvent(new PopStateEvent('popstate'));
    expect(document.querySelector(`#${DISPLAY_NOTICE_HOST_ID}`)).toBeNull();

    // Navigating back remounts, and disabling Facebook removes it.
    history.pushState({}, '', '/settings/?tab=dark_mode_category');
    globalThis.dispatchEvent(new PopStateEvent('popstate'));
    expect(document.querySelector(`#${DISPLAY_NOTICE_HOST_ID}`)).not.toBeNull();

    await store.set(SITES_STORAGE_KEY, { facebook: false });
    await vi.waitFor(() => {
      expect(document.querySelector(`#${DISPLAY_NOTICE_HOST_ID}`)).toBeNull();
    });
  });

  it('upgrades to higher-priority container on async X SPA render and re-anchors when Facebook radios arrive late', async () => {
    vi.spyOn(document, 'cookie', 'get').mockReturnValue('twid=u%3D424242; c_user=100000000000042');

    // 1. X SPA enters `/settings/display` while only `[data-testid="primaryColumn"]` (left nav) is mounted.
    history.replaceState({}, '', '/settings/display');
    document.body.innerHTML = `
      <main role="main" id="x-main">
        <div data-testid="primaryColumn" id="x-left-nav"><div>Settings nav</div></div>
      </main>
    `;
    const { platform: xPlatform, store: xStore } = makePlatform();
    expect(await startSite(xSite, xPlatform)).toEqual([]);
    expect(
      document.querySelector('#x-left-nav')?.querySelector(`#${DISPLAY_NOTICE_HOST_ID}`),
    ).not.toBeNull();

    // Detail pane arrives asynchronously: notice must upgrade out of left nav into `#x-detail-pane`.
    const detailPane = document.createElement('section');
    detailPane.id = 'x-detail-pane';
    detailPane.setAttribute('aria-labelledby', 'detail-header');
    detailPane.innerHTML =
      '<div id="x-hdr"><button type="button">Back</button><h2 id="detail-header">Display</h2></div><div id="x-body">Controls</div>';
    document.querySelector('#x-main')?.append(detailPane);

    await vi.waitFor(() => {
      const moved = document.querySelector(`#${DISPLAY_NOTICE_HOST_ID}`);
      expect(moved?.parentElement?.id).toBe('x-detail-pane');
      expect(moved?.previousElementSibling?.id).toBe('x-hdr');
    });
    await xStore.set(SITES_STORAGE_KEY, { x: false });

    // 2. Facebook enters `/settings/?tab=dark_mode_category` while `[role="main"]` is still loading.
    history.replaceState({}, '', '/settings/?tab=dark_mode_category');
    document.body.innerHTML =
      '<div role="main" id="fb-loading-main"><div id="spinner"></div></div>';
    const { platform: fbPlatform, store: fbStore } = makePlatform();
    expect(await startSite(facebookSite, fbPlatform)).toEqual([]);
    const initialHost = document.querySelector(`#${DISPLAY_NOTICE_HOST_ID}`);
    expect(initialHost?.parentElement?.id).toBe('fb-loading-main');

    // Relay finishes rendering the Dark mode column while `initialHost` remains connected.
    const lateCol = document.createElement('div');
    lateCol.innerHTML = '<h1>Dark mode</h1><div role="radiogroup" id="fb-late-radios"></div>';
    document.querySelector('#fb-loading-main')?.append(lateCol);

    await vi.waitFor(() => {
      const upgraded = document.querySelector(`#${DISPLAY_NOTICE_HOST_ID}`);
      expect(upgraded).toBe(initialHost);
      expect(upgraded?.nextElementSibling?.id).toBe('fb-late-radios');
    });
    await fbStore.set(SITES_STORAGE_KEY, { facebook: false });
  });

  it('stays unmounted on non-display routes for both X and Facebook', async () => {
    vi.spyOn(document, 'cookie', 'get').mockReturnValue('twid=u%3D424242; c_user=100000000000042');
    history.replaceState({}, '', '/home');
    renderXDisplaySettingsDom();
    const { platform: xPlatform, store: xStore } = makePlatform();
    expect(await startSite(xSite, xPlatform)).toEqual([]);
    expect(document.querySelector(`#${DISPLAY_NOTICE_HOST_ID}`)).toBeNull();
    await xStore.set(SITES_STORAGE_KEY, { x: false });

    history.replaceState({}, '', '/settings/?tab=account');
    renderFacebookDarkModeDom();
    const { platform: fbPlatform, store: fbStore } = makePlatform();
    expect(await startSite(facebookSite, fbPlatform)).toEqual([]);
    expect(document.querySelector(`#${DISPLAY_NOTICE_HOST_ID}`)).toBeNull();
    await fbStore.set(SITES_STORAGE_KEY, { facebook: false });
  });
});
