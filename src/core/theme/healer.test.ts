import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDomEnvironment } from '../dom-env';
import { Scope } from '../scope';
import { findThemePreset } from '../theming';
import { createThemeHealer, HEAL_BG_ATTR, HEAL_FG_ATTR, HEALER_STYLE_ID } from './healer';

const warmPaper = findThemePreset('warm-paper')!.palette;

describe('core/theme/healer', () => {
  afterEach(() => {
    document.head.replaceChildren();
    document.body.replaceChildren();
    document.body.style.backgroundColor = '';
  });

  it('heals inline dark surfaces and light-on-light text in real time, preserves compact CTAs, and reverts cleanly', () => {
    document.body.style.backgroundColor = warmPaper.background;
    document.body.innerHTML = `
      <div id="dark-popup" role="dialog" style="background-color: rgb(22, 24, 28); color: rgb(231, 233, 234);">
        <span id="washed-text" style="color: rgb(231, 233, 234);">Popup text</span>
      </div>
      <div id="light-on-light" style="background-color: rgb(244, 239, 230);">
        <span id="bio-span" style="color: rgb(231, 233, 234);">Unreadable bio</span>
      </div>
      <button id="cta-pill" type="button" style="background-color: rgb(15, 20, 25); color: rgb(255, 255, 255);">
        Follow
      </button>
    `;
    const cta = document.querySelector('#cta-pill') as HTMLElement;
    cta.getBoundingClientRect = () => new DOMRect(0, 0, 90, 36);

    const env = createDomEnvironment({ pierceShadow: true });
    const scope = new Scope();
    const healer = createThemeHealer(env, scope);

    healer.setPalette(warmPaper);
    const count = healer.healNow();
    expect(count).toBeGreaterThanOrEqual(2);

    // Opposite-polarity dark popup healed to light surface AND its light child text
    // healed in the SAME pass via planned `bgCache` seeding; light-on-light bio healed too.
    const popup = document.querySelector('#dark-popup') as HTMLElement;
    const washedText = document.querySelector('#washed-text') as HTMLElement;
    const bioSpan = document.querySelector('#bio-span') as HTMLElement;
    expect(popup.getAttribute(HEAL_BG_ATTR)).toBe('surface');
    expect(washedText.getAttribute(HEAL_FG_ATTR)).toBe('text');
    expect(bioSpan.getAttribute(HEAL_FG_ATTR)).toBe('text');
    expect(document.querySelector(`#${HEALER_STYLE_ID}`)).not.toBeNull();

    // Compact high-contrast CTA pill is intentionally preserved.
    expect(cta.hasAttribute(HEAL_BG_ATTR)).toBe(false);

    // Resetting to Site Default cleanly removes all heal attributes and styles.
    healer.setPalette(null);
    expect(popup.hasAttribute(HEAL_BG_ATTR)).toBe(false);
    expect(bioSpan.hasAttribute(HEAL_FG_ATTR)).toBe(false);
    expect(document.querySelector(`#${HEALER_STYLE_ID}`)).toBeNull();

    scope.dispose();
    env.dispose();
  });

  it('heals chromatic low-contrast links and nasty custom themes using contrast-light/contrast-dark fallbacks', () => {
    // Nasty custom theme: bright lime background with unreadable yellow text & blue link.
    const nastyPalette = {
      ...warmPaper,
      colorScheme: 'light' as const,
      background: '#d9f99d',
      surface: '#bef264',
      surfaceAlt: '#a3e635',
      text: '#fef08a', // terrible contrast on lime!
      textMuted: '#fde047',
      accent: '#22c55e',
    };
    document.body.style.backgroundColor = nastyPalette.background;
    document.body.innerHTML = `
      <div id="card" style="background-color: #bef264;">
        <p id="bad-text" style="color: #fef08a;">Unreadable custom text</p>
        <a id="bad-link" href="#" style="color: #86efac;">Unreadable chromatic link</a>
      </div>
    `;

    const env = createDomEnvironment();
    const scope = new Scope();
    const healer = createThemeHealer(env, scope);
    healer.setPalette(nastyPalette);

    const healed = healer.healNow();
    expect(healed).toBeGreaterThanOrEqual(2);
    expect(document.querySelector('#bad-text')?.getAttribute(HEAL_FG_ATTR)).toBe('contrast-dark');
    expect(document.querySelector('#bad-link')?.getAttribute(HEAL_FG_ATTR)).toBe('contrast-dark');
    // Native `@layer fs-healer` beats site-mapping `!important` rules cleanly without repeated-attribute hacks.
    const healerCss = document.querySelector(`#${HEALER_STYLE_ID}`)?.textContent ?? '';
    expect(healerCss).toContain('@layer fs-healer');
    expect(healerCss).toContain(`[${HEAL_FG_ATTR}="contrast-dark"]`);
    expect(healerCss).not.toContain(`[${HEAL_FG_ATTR}="contrast-dark"][${HEAL_FG_ATTR}]`);

    // SVG icon nodes are skipped cleanly and never stamped with heal attributes.
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    svg.setAttribute('style', 'color: #fef08a; background-color: #111111;');
    svg.append(path);
    document.body.append(svg);
    healer.healNow();
    expect(svg.hasAttribute(HEAL_BG_ATTR)).toBe(false);
    expect(svg.hasAttribute(HEAL_FG_ATTR)).toBe(false);
    expect(path.hasAttribute(HEAL_FG_ATTR)).toBe(false);

    scope.dispose();
    env.dispose();
  });

  it('heals dynamically inserted Shadow DOM elements and avoids bgCache poisoning when background resists override', async () => {
    const env = createDomEnvironment({ pierceShadow: true });
    const scope = new Scope();
    const healer = createThemeHealer(env, scope);
    healer.setPalette(findThemePreset('midnight')!.palette);

    // 1. Late-inserted dark-on-light node inside an open ShadowRoot heals automatically via Shadow MutationObserver.
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    document.body.append(host);
    await new Promise((r) => setTimeout(r, 25));

    const latePopup = document.createElement('div');
    latePopup.style.cssText = 'background-color: rgb(255, 255, 255); color: rgb(20, 20, 20);';
    latePopup.textContent = 'Late shadow card';
    shadow.append(latePopup);

    await new Promise((r) => setTimeout(r, 40));
    expect(latePopup.getAttribute(HEAL_BG_ATTR)).toBe('surface');

    // 2. When an element already has `data-fs-heal-bg="surface"` yet computed bg stays white
    //    (e.g. inline `!important`), descendant text heals against the true white backdrop (`contrast-dark`).
    const stubborn = document.createElement('div');
    stubborn.setAttribute(HEAL_BG_ATTR, 'surface');
    stubborn.style.cssText = 'background-color: rgb(255, 255, 255) !important;';
    const washed = document.createElement('span');
    washed.style.cssText = 'color: rgb(230, 237, 247);';
    washed.textContent = 'Light text on stubborn white';
    stubborn.append(washed);
    document.body.append(stubborn);

    healer.healNow();
    expect(washed.getAttribute(HEAL_FG_ATTR)).toBe('contrast-dark');

    scope.dispose();
    env.dispose();
  });

  it('schedules flush slices via requestIdleCallback when available and cancels them on dispose', () => {
    const callbacks = new Map<number, IdleRequestCallback>();
    let nextId = 1;
    const reqIdle = vi.fn((cb: IdleRequestCallback) => {
      const id = nextId++;
      callbacks.set(id, cb);
      return id;
    });
    const cancelIdle = vi.fn((id: number) => {
      callbacks.delete(id);
    });
    vi.stubGlobal('requestIdleCallback', reqIdle);
    vi.stubGlobal('cancelIdleCallback', cancelIdle);

    try {
      document.body.style.backgroundColor = warmPaper.background;
      document.body.innerHTML =
        '<div id="idle-card" style="background-color: rgb(22, 24, 28);">Dark card</div>';

      const env = createDomEnvironment();
      const scope = new Scope();
      const healer = createThemeHealer(env, scope);

      healer.setPalette(warmPaper);
      expect(reqIdle).toHaveBeenCalledTimes(1);

      // Disposing cancels any pending idle callback cleanly.
      scope.dispose();
      expect(cancelIdle).toHaveBeenCalledTimes(1);
      expect(callbacks.size).toBe(0);
      env.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('never stamps opaque heal backgrounds on transparentShell wrappers while a Studio backdrop is active and strips stale shell heals', () => {
    const darkPalette = findThemePreset('sunset-vapor')!.palette;
    document.body.innerHTML = `
      <div id="react-root">
        <div id="shell-wrap" style="background-color: rgb(255, 255, 255);">
          <div id="inner-card" style="background-color: rgb(255, 255, 255);">Card</div>
        </div>
      </div>
    `;

    const env = createDomEnvironment();
    const scope = new Scope();
    const healer = createThemeHealer(env, scope, {
      transparentShellSelectors: ['#react-root', '#react-root > div'],
    });

    // Without a Studio backdrop, the white wrapper gets healed as usual.
    healer.setPalette(darkPalette);
    healer.healNow();
    const shellWrap = document.querySelector('#shell-wrap') as HTMLElement;
    const innerCard = document.querySelector('#inner-card') as HTMLElement;
    expect(shellWrap.getAttribute(HEAL_BG_ATTR)).toBe('surface');
    expect(innerCard.getAttribute(HEAL_BG_ATTR)).toBe('surface');

    // Enabling a Studio backdrop strips stale HEAL_BG_ATTR from transparentShell wrappers
    // and keeps them clear on subsequent heal passes while cards stay healed.
    healer.setBackdropActive(true);
    expect(shellWrap.hasAttribute(HEAL_BG_ATTR)).toBe(false);
    expect(innerCard.getAttribute(HEAL_BG_ATTR)).toBe('surface');

    healer.healNow();
    expect(shellWrap.hasAttribute(HEAL_BG_ATTR)).toBe(false);
    expect(innerCard.getAttribute(HEAL_BG_ATTR)).toBe('surface');

    // Turning the Studio backdrop back off allows shell wrappers to heal again cleanly.
    healer.setBackdropActive(false);
    healer.healNow();
    expect(shellWrap.getAttribute(HEAL_BG_ATTR)).toBe('surface');

    // Disposing the healer stops reacting to subsequent mutations in connected open ShadowRoots.
    const shadowHost = document.createElement('div');
    const shadow = shadowHost.attachShadow({ mode: 'open' });
    document.body.append(shadowHost);
    scope.dispose();
    const afterDispose = document.createElement('div');
    afterDispose.style.cssText = 'background-color: rgb(255, 255, 255); color: rgb(20, 20, 20);';
    afterDispose.textContent = 'Post-dispose node';
    shadow.append(afterDispose);
    expect(afterDispose.hasAttribute(HEAL_BG_ATTR)).toBe(false);
    env.dispose();
  });
});
