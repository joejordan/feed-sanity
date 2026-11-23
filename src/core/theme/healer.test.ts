import { afterEach, describe, expect, it } from 'vitest';
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
});
